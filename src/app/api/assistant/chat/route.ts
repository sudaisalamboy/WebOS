import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getTabs, closeTab, newTab, screenshot, navigate, click, scroll,
  typeText, typeInto, fillBySelector, pressKey, evalJs, getPageSummary, type PageSummary,
} from '@/lib/chrome-cdp'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface AssistantStep {
  step: number
  thought: string
  action: string
  params: Record<string, unknown>
  result: string
  screenshot?: string  // base64 PNG of the page AFTER the action
}

interface SSEEvent {
  type: 'status' | 'screenshot' | 'step' | 'done' | 'error'
  data: unknown
}

const MAX_STEPS = 15

// Server-side memo of the last note content the assistant saw, so we can
// diff against it each turn and surface only what changed (new bug reports,
// requests, etc.). Lives for the lifetime of the server process.
let lastNoteSeen: string | null = null

/**
 * Compute a simple line-based diff between the previous and current note
 * content. Returns the new/changed lines (what the user just added). Used to
 * tell the assistant what's new in the Notes pad so it can act on freshly-
 * reported bugs/requests without re-reading the whole pad every turn.
 */
function computeNoteDiff(prev: string, curr: string): string {
  const prevLines = new Set(prev.split('\n').map((l) => l.trim()).filter(Boolean))
  const currLines = curr.split('\n')
  const added: string[] = []
  for (const line of currLines) {
    const t = line.trim()
    if (t && !prevLines.has(t)) added.push(line)
  }
  return added.join('\n')
}

/**
 * Wrap an LLM call with automatic retry on rate-limit (HTTP 429) or transient
 * network errors. Waits with exponential backoff so a temporary rate limit
 * doesn't fail the whole assistant task.
 */
async function callLlmWithRetry<T>(
  fn: () => Promise<T>,
  onWait?: (attempt: number, ms: number) => void,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = (err as Error)?.message ?? String(err)
      const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('too many requests')
      const isTransient = msg.includes('fetch') || msg.includes('ECONN') || msg.includes('timeout')
      if (!isRateLimit && !isTransient) throw err
      if (attempt === maxAttempts) throw err
      // Reduced waits: 5s/10s for rate limits (was 8s/16s/24s which blocked too long)
      const waitMs = isRateLimit ? 5000 * attempt : 2000 * attempt
      onWait?.(attempt, waitMs)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr
}

/**
 * POST /api/assistant/chat
 * Body: { message: string, history?: {role, content}[] }
 *
 * Streams SSE events as the assistant:
 *   1. takes a screenshot of the remote Chrome
 *   2. asks the VLM "what's the next action given the goal + this screenshot"
 *   3. executes that action (click / type / scroll / eval_js / navigate / close_tab / new_tab / press_key)
 *   4. repeats until the VLM says "done" or MAX_STEPS reached
 *
 * The assistant SEES the same Chrome desktop the user sees in the Remote
 * Chrome noVNC window (both driven by CDP on port 9222).
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: { message?: string; history?: { role: string; content: string }[] }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  const goal = (body.message ?? '').trim()
  if (!goal) {
    return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
      }

      try {
        // 1. Check Chrome is up
        send({ type: 'status', data: 'Checking Chrome…' })
        const tabs = await getTabs()
        if (tabs.length === 0) {
          send({ type: 'error', data: 'Remote Chrome is not running. Open the "Remote Chrome" app and click Start first, then ask me again.' })
          controller.close()
          return
        }
        send({ type: 'status', data: `Chrome up · ${tabs.length} tab(s). Working on: "${goal}"` })

        const zai = await ZAI.create()
        const history = body.history ?? []
        // Track actions already taken this turn so the model doesn't repeat.
        const actionsTaken: string[] = []
        // Track recent action signatures for loop detection.
        const recentActionKeys: string[] = []

        // Read the shared Notes pad — users may have written bug reports or
        // requests there. We compare with the previous note content (from
        // history) to detect what changed, and prepend any new instructions
        // to the goal so the assistant acts on them.
        let noteContent = ''
        let noteContext = ''
        try {
          let note = await db.note.findUnique({ where: { id: 'main' } })
          if (!note) note = await db.note.create({ data: { id: 'main', content: '' } })
          noteContent = note.content || ''
          // The previous note content the assistant saw (stored in a server-
          // side memo so we can diff). On first run there's no previous, so
          // the whole note is "new".
          const prevNote = lastNoteSeen
          lastNoteSeen = noteContent
          if (noteContent.trim()) {
            if (prevNote === null) {
              // First time the assistant sees the note — treat the whole
              // thing as instructions if the user didn't give an explicit goal.
              noteContext = `\n\n[Notes pad content — the user may have written bug reports or requests here; pay attention to them]:\n${noteContent.trim().slice(0, 2000)}`
            } else if (prevNote !== noteContent) {
              // Note changed since last turn — show the user the diff (new/changed lines)
              const diff = computeNoteDiff(prevNote, noteContent)
              if (diff) {
                noteContext = `\n\n[Notes pad was just updated — new/changed lines the user added]:\n${diff.slice(0, 1500)}`
              }
            }
          }
        } catch (e) {
          // DB not available — skip note context, assistant still works
        }

        for (let step = 1; step <= MAX_STEPS; step++) {
          // Client disconnect / Stop button: if the user aborted the fetch,
          // req.signal aborts → stop the agentic loop immediately.
          if (req.signal.aborted) {
            break
          }
          // 2. Capture current state — EFFICIENT flow:
          //    Step 1: take screenshot + full page summary (text, elements, forms, buttons)
          //    Steps 2+: text-only (getPageSummary) — no screenshot needed unless page changed.
          //    This avoids wasting time/tokens on repeated screenshots.
          send({ type: 'status', data: `Step ${step}/${MAX_STEPS} — analyzing the page…` })
          let pageSummary: PageSummary
          let shot: string = ''
          try {
            pageSummary = await getPageSummary()
            // Only take screenshot on step 1, or if the previous action was
            // a navigate/click/new_tab (page likely changed). Saves time.
            const prevAction = actionsTaken.length > 0 ? actionsTaken[actionsTaken.length - 1] : ''
            const pageChanged = step === 1 || /navigate|new_tab|click/.test(prevAction)
            if (pageChanged) {
              shot = await screenshot()
            }
          } catch (err) {
            send({ type: 'error', data: `Cannot read Chrome: ${(err as Error).message}` })
            break
          }
          if (shot) {
            send({ type: 'screenshot', data: { step, image: `data:image/png;base64,${shot}` } })
          }

          // 3. Ask the VLM for the next action
          const actionResp = await decideAction(zai, goal, history, step, pageSummary, shot, actionsTaken, (msg) => send({ type: 'status', data: msg }), noteContext)
          let action = actionResp.action
          let params = actionResp.params ?? {}
          let thought = actionResp.thought ?? ''

          // Hard guard: if the model tries to navigate to a different site
          // but the user never asked for a specific URL, block it. The user
          // wants actions on the CURRENT page (e.g. "click the video" should
          // NOT send Chrome off to youtube.com). Convert the navigate into a
          // no-op "done" with a message telling the user we're staying put.
          // Navigation guard: only allow if the user explicitly asked to go
          // somewhere (not when the AI decides to wander off on its own).
          if ((action === 'navigate' || action === 'new_tab') && !goalWantsNavigation(goal)) {
            const targetUrl = String(params.url ?? '')
            const blockMsg = `I'm staying on the current page. If you want me to open a specific site, say "go to example.com".`
            history.push({ role: 'assistant', content: blockMsg })
            send({
              type: 'step',
              data: { step, thought: 'blocked unauthorized navigation', action: 'done', params: { message: blockMsg }, result: blockMsg } as AssistantStep,
            })
            send({ type: 'done', data: { message: blockMsg, steps: step } })
            break
          }

          // Loop guard: if the model keeps emitting the SAME action+params,
          // it's stuck (e.g. clicking a video that looks identical playing
          // vs paused). Force a state-check via eval_js, then mark done.
          const actionKey = `${action}:${JSON.stringify(params)}`
          recentActionKeys.push(actionKey)
          if (recentActionKeys.length > 6) recentActionKeys.shift()
          const lastThree = recentActionKeys.slice(-3)
          const isStuckLoop = lastThree.length === 3 &&
            lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2] &&
            action !== 'done'

          if (isStuckLoop) {
            // Instead of just stopping, force the assistant to ANSWER the
            // user's question using whatever info it has gathered so far.
            // This prevents "stops without answering" when scrolling to find
            // video views etc.
            let stateInfo = ''
            try {
              const state = await evalJs(`(function(){
                var info={url:location.href,title:document.title};
                var v=document.querySelector('video');
                if(v){info.video={paused:v.paused,playing:!v.paused,currentTime:Math.round(v.currentTime),duration:Math.round(v.duration||0)};}
                // collect visible text that might answer the question
                info.bodyText=document.body?document.body.innerText.slice(0,1500):"";
                return JSON.stringify(info);
              })()`)
              stateInfo = state.value ? String(state.value).slice(0, 1500) : ''
            } catch {}
            // Ask the LLM to answer the user's ORIGINAL goal using the state info
            let answerMsg = `I repeated ${action} a few times. Based on what I found: ${stateInfo.slice(0, 300)}`
            try {
              const answerResp = await callLlmWithRetry(
                () => zai.chat.completions.create({
                  messages: [
                    { role: 'assistant', content: 'Answer the user question concisely in HTML (use <h1>, <b>, <ul><li>). Max 150 words. Use the page info below.' },
                    { role: 'user', content: `Question: ${goal}\n\nPage info: ${stateInfo}\n\nAnswer now:` },
                  ],
                  thinking: { type: 'disabled' },
                }),
              )
              const llmAnswer = (answerResp.choices?.[0]?.message?.content ?? '').trim()
              if (llmAnswer) answerMsg = llmAnswer
            } catch {}
            history.push({ role: 'assistant', content: answerMsg })
            send({
              type: 'step',
              data: { step, thought: 'repeated actions — answering with gathered info', action: 'done', params: { message: answerMsg }, result: answerMsg } as AssistantStep,
            })
            send({ type: 'done', data: { message: answerMsg, steps: step } })
            break
          }

          if (!action || action === 'done') {
            const finalMsg = (params.message as string) || actionResp.message || 'Done.'
            history.push({ role: 'assistant', content: finalMsg })
            send({
              type: 'step',
              data: { step, thought, action: 'done', params, result: finalMsg } as AssistantStep,
            })
            send({ type: 'done', data: { message: finalMsg, steps: step } })
            break
          }

          // 4. Execute the action
          const execResult = await executeAction(action, params, goal)
          actionsTaken.push(`step ${step}: ${action} ${JSON.stringify(params).slice(0, 80)} -> ${execResult.slice(0, 80)}`)
          // NO post-action screenshot — wasteful. The next step's getPageSummary
          // will read the updated page text. Only take a screenshot on the NEXT
          // step if the page changed (handled by the pageChanged check above).
          const stepRecord: AssistantStep = {
            step,
            thought,
            action,
            params,
            result: execResult,
          }
          send({ type: 'step', data: stepRecord })

          // brief pause so the page settles (animations / navigations)
          await new Promise((r) => setTimeout(r, 600))

          if (step === MAX_STEPS) {
            history.push({ role: 'assistant', content: `I reached the step limit (${MAX_STEPS}). Last action: ${action}. Let me know what to do next.` })
            send({ type: 'done', data: { message: `Reached step limit (${MAX_STEPS}). Tell me to continue or what to do next.`, steps: step } })
          }
        }

        controller.close()
      } catch (err) {
        send({ type: 'error', data: `Assistant error: ${(err as Error).message}` })
        try { controller.close() } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

interface ActionDecision {
  action: string
  params: Record<string, unknown>
  thought: string
  message?: string
}

async function decideAction(
  zai: any,
  goal: string,
  history: { role: string; content: string }[],
  step: number,
  page: PageSummary,
  shotB64: string,
  actionsTaken: string[],
  onStatus: (msg: string) => void = () => {},
  noteContext: string = '',
): Promise<ActionDecision> {
  const elementsText = page.interactiveElements.length
    ? page.interactiveElements.map((e, i) => {
        const sel = e.selector ? ` selector="${e.selector}"` : ''
        const ph = e.placeholder ? ` placeholder="${e.placeholder}"` : ''
        return `${i + 1}. <${e.tag}${e.role ? ' role=' + e.role : ''}${ph}${sel}> "${e.text}" @ (${e.x}, ${e.y})`
      }).join('\n')
    : '(no interactive elements visible — you may need to scroll or navigate)'

  const videosText = page.videoDetails.length
    ? page.videoDetails.map((v, i) =>
        `video #${i + 1}: center (${v.x}, ${v.y}), ${v.width}x${v.height}px, ${v.playing ? 'PLAYING' : 'PAUSED'} (${v.currentTime}s/${v.duration}s)${v.src ? ', src=' + v.src.slice(0, 50) : ''}`
      ).join('\n')
    : 'no <video> elements on the page'

  const systemPrompt = `You are a generalist AI web browsing assistant. The user gives you a GOAL. You do ONE action per turn.

TOOLS: click, fill (selector or x,y + text), type, press_key, scroll, navigate, eval_js, close_tab, new_tab, switch_tab, set_cookies, done.

CRITICAL RULES:
1. NEVER say "done" until the task is ACTUALLY COMPLETE. If you haven't done the work yet, DON'T use done. Do the work first, then say done.
2. EXECUTE — don't describe. If user says "search X", you must: click search box → fill "X" → press Enter. Do each in separate turns. Don't just click and say done.
3. After clicking a field, the NEXT step MUST be to type/fill into it. Don't click the same thing again.
4. Use eval_js to find elements: "Array.from(document.querySelectorAll('input,textarea,button,a')).map(e=>({tag:e.tagName,type:e.type,name:e.name,id:e.id,placeholder:e.placeholder,text:(e.textContent||'').trim().slice(0,50),rect:JSON.stringify(e.getBoundingClientRect().toJSON())}))"
5. Answer with HTML (h1, b, ul, p). Max 200 words. But ONLY when task is done.
6. Plan in your thought field. Example: "Plan: 1) click search 2) type 'cats' 3) Enter. Step 1 now."

Don't scroll — use eval_js "document.body.innerText.slice(0,8000)" to read the full page.

Reply with ONE JSON object only.

Current page:
- URL: ${page.url}
- Title: ${page.title}
- Viewport: ${page.viewport.width}x${page.viewport.height}
- Videos on page: ${page.videos}
${videosText}
- Scroll position: ${page.scrollY}px (page height ${page.scrollHeight}px)

Full visible page text:
${page.pageText || '(no visible text)'}

Visible interactive elements:
${elementsText}`

  const priorActions = actionsTaken.length
    ? `Actions you have already taken this turn (do NOT repeat the same one unless clearly needed):
${actionsTaken.map((a) => '  - ' + a).join('\n')}`
    : '(no actions taken yet this turn)'

  const userContent: any[] = [
    { type: 'text', text: `GOAL: ${goal}${noteContext}\n\n${priorActions}\n\nStep ${step}. Look at the screenshot, the video list, and the element list, then choose the NEXT action. IMPORTANT: after you click a video, use eval_js to check if it's now playing (expr: "document.querySelector('video') && {paused:document.querySelector('video').paused}") before clicking again — if it's playing, the goal is done.\n\nIf the user reported a bug or made a request in the Notes pad (shown above), address it directly — e.g. "bug: terminal disconnects" means investigate the terminal, "make the search box bigger" means use eval_js to resize it. If the note says the previous content matches the current state (no bug reported), just continue with the goal.` },
  ]
  if (shotB64) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${shotB64}` },
    })
  }

  let raw = ''
  try {
    const completion = await callLlmWithRetry(
      () => zai.chat.completions.createVision({
        messages: [
          { role: 'assistant', content: systemPrompt },
          ...history.slice(-4),
          { role: 'user', content: userContent },
        ],
        thinking: { type: 'disabled' },
      }),
      (attempt, ms) => onStatus(`Rate limited, retrying in ${Math.round(ms / 1000)}s (attempt ${attempt})…`),
    )
    raw = (completion.choices?.[0]?.message?.content ?? '').trim()
  } catch (visionErr) {
    // Vision API can reject screenshots via its content filter (status 400) or
    // persistently rate-limit. Fall back to a text-only LLM call using just
    // the page summary (no image) so the assistant keeps working on ANY page.
    onStatus('Screenshot unavailable this turn — using page summary instead…')
    const textOnlyPrompt = `${systemPrompt}\n\nNOTE: the screenshot could not be processed this turn, so rely on the element list and page summary text above.`
    const fallback = await callLlmWithRetry(
      () => zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: textOnlyPrompt },
          ...history.slice(-4),
          { role: 'user', content: `GOAL: ${goal}\n\nStep ${step}. Choose the next action based on the page summary (no screenshot available this turn).` },
        ],
        thinking: { type: 'disabled' },
      }),
      (attempt, ms) => onStatus(`Rate limited, retrying in ${Math.round(ms / 1000)}s (attempt ${attempt})…`),
    )
    raw = (fallback.choices?.[0]?.message?.content ?? '').trim()
  }

  let decision = parseActionJson(raw)
  // If the model returned plain text (not JSON) or broken JSON, retry with
  // a stronger instruction. Don't just say "done" — the AI didn't do anything yet.
  if (decision.action === 'done' && decision.thought === 'unparseable response') {
    try {
      const repair = await callLlmWithRetry(
        () => zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: systemPrompt },
            { role: 'user', content: `The user wants: ${goal}. Look at the page info and decide the FIRST action.` },
            { role: 'assistant', content: raw },
            { role: 'user', content: 'That was not a valid JSON action. You MUST reply with ONLY a JSON object like {"action":"click","params":{"x":100,"y":200},"thought":"..."}. No prose. What is the first action to do?' },
          ],
          thinking: { type: 'disabled' },
        }),
        (attempt, ms) => onStatus(`Retrying — AI gave invalid response…`),
      )
      const repaired = (repair.choices?.[0]?.message?.content ?? '').trim()
      const repairedDecision = parseActionJson(repaired)
      if (repairedDecision.action !== 'done' || repairedDecision.thought !== 'unparseable response') {
        decision = repairedDecision
      }
    } catch {}
  }

  return decision
}

/**
 * Does the user's goal explicitly ask to navigate to a different site?
 * Only true if the goal contains a URL-like token or a "go to"/"open" intent.
 * Used to gate the navigate/new_tab actions so the assistant doesn't wander
 * off on its own when the user just said "click the video".
 */
function goalWantsNavigation(goal: string): boolean {
  const g = goal.toLowerCase()
  if (/\bhttps?:\/\//i.test(goal)) return true
  if (/\b[a-z0-9-]+\.(com|org|net|io|dev|ai|co|edu|gov|info|xyz|tv)\b/i.test(goal)) return true
  if (/\b(go to|go on|open|navigate to|visit|browse to|take me to|show me|check out)\b/.test(g)) return true
  if (/\b(google|youtube|facebook|twitter|instagram|reddit|wikipedia|amazon|github|duckduckgo|gmail|maps|google maps)\b/.test(g)) return true
  return false
}

function parseActionJson(raw: string): ActionDecision {
  // strip markdown fences if present
  let s = raw
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // extract the first {...} block
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1)
  }
  try {
    const obj = JSON.parse(s)
    let action = String(obj.action ?? 'done')
    let params = (obj.params ?? {}) as Record<string, unknown>
    let thought = String(obj.thought ?? '')
    let message: string | undefined = obj.message ? String(obj.message) : (params.message ? String(params.message) : undefined)
    // Unwrap a nested done: sometimes the model wraps the whole action JSON
    // inside params.message (e.g. {"action":"done","params":{"message":"{\"action\":\"done\",...}"}}).
    if (message && message.trim().startsWith('{')) {
      try {
        const inner = JSON.parse(message)
        if (inner.action === 'done' && inner.params?.message) {
          message = String(inner.params.message)
          thought = String(inner.thought ?? thought)
        }
      } catch {
        // not valid nested JSON — keep original message
      }
    }
    return { action, params, thought, message }
  } catch {
    // if the model didn't produce parseable JSON, treat as done with the raw text
    return { action: 'done', params: { message: raw.slice(0, 400) }, thought: 'unparseable response' }
  }
}

async function executeAction(action: string, params: Record<string, unknown>, goal: string = ''): Promise<string> {
  try {
    switch (action) {
      case 'click': {
        const x = Number(params.x), y = Number(params.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return 'invalid coordinates'
        await click(x, y)
        return `clicked (${x}, ${y})`
      }
      case 'type': {
        const text = String(params.text ?? '')
        if (!text) return 'empty text'
        await typeText(text)
        return `typed "${text.slice(0, 60)}"`
      }
      case 'fill': {
        // Fill a form field. Prefer "selector" (CSS selector like "#email",
        // "input[name=password]", ".signup-form input[type=email]") — it's
        // reliable because it doesn't depend on click-coordinate accuracy
        // (the LLM's screenshot y-coords are often offset by the browser-
        // chrome height). Fall back to (x,y) + per-character keystrokes.
        const selector = params.selector ? String(params.selector) : ''
        const text = String(params.text ?? '')
        if (!text) return 'empty text'
        if (selector) {
          const r = await fillBySelector(selector, text)
          return `filled "${selector}" with "${text.slice(0, 50)}" → ${r}`
        }
        const x = Number(params.x), y = Number(params.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return 'fill needs either a "selector" or "x"+"y" coordinates'
        await typeInto(x, y, text)
        return `filled (${x},${y}) with "${text.slice(0, 50)}"`
      }
      case 'press_key': {
        const key = String(params.key ?? 'Enter')
        await pressKey(key)
        return `pressed ${key}`
      }
      case 'scroll': {
        const dir = String(params.direction ?? 'down')
        const amount = Number(params.amount ?? 400)
        await scroll(640, 400, dir === 'up' ? -amount : amount)
        return `scrolled ${dir} ${amount}px`
      }
      case 'navigate': {
        let url = String(params.url ?? '')
        // If the AI forgot the URL (returns params:{}), ask the LLM to
        // figure out the URL from the user's original goal text.
        if (!url && goal) {
          try {
            const zai2 = await ZAI.create()
            const r = await zai2.chat.completions.create({
              messages: [
                { role: 'assistant', content: 'Extract the URL from the user request. Reply with ONLY the full URL (https://...), nothing else. If it is a GitHub profile like "github per sudaisalamboy", the URL is https://github.com/sudaisalamboy. If "google map", it is https://www.google.com/maps. Think and reply.' },
                { role: 'user', content: goal },
              ],
              thinking: { type: 'disabled' },
            })
            const extracted = (r.choices?.[0]?.message?.content ?? '').trim()
            // Extract just the URL from the response
            const urlMatch = extracted.match(/https?:\/\/[^\s"'<>]+/)
            if (urlMatch) url = urlMatch[0]
          } catch {}
        }
        if (!url) return 'no url — could not figure out the destination'
        await navigate(url)
        return `navigated to ${url}`
      }
      case 'eval_js': {
        const expr = String(params.expr ?? '')
        if (!expr) return 'no expr'
        const r = await evalJs(expr)
        return r.error ? `JS error: ${r.error}` : `=> ${r.value.slice(0, 300)}`
      }
      case 'close_tab': {
        const id = String(params.targetId ?? '')
        const ok = await closeTab(id)
        return ok ? `closed tab ${id}` : `failed to close ${id}`
      }
      case 'new_tab': {
        const url = String(params.url ?? '')
        const t = await newTab(url)
        return t ? `new tab -> ${url}` : `failed to open ${url}`
      }
      default:
        return `unknown action: ${action}`
    }
  } catch (err) {
    return `error: ${(err as Error).message}`
  }
}
