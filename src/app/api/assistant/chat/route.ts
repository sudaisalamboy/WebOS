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
export const maxDuration = 600

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

const MAX_STEPS = 100

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
  maxAttempts = 5,
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

          // 3. Ask the LLM what to do next — NATURAL LANGUAGE approach.
          // Instead of forcing JSON output (which the LLM keeps breaking),
          // we ask in plain text and parse the response.
          const actionResp = await decideAction(zai, goal, history, step, pageSummary, shot, actionsTaken, (msg) => send({ type: 'status', data: msg }), noteContext)
          let action = actionResp.action
          let params = actionResp.params ?? {}
          let thought = actionResp.thought ?? ''

          // Navigation guard — only block if AI tries to navigate to a
          // completely different site that the user never mentioned.
          // Allow clicking links that happen to navigate (that's normal browsing).
          if ((action === 'navigate' || action === 'new_tab') && !goalWantsNavigation(goal)) {
            // Instead of blocking + stopping, just skip this action and
            // tell the AI to work on the current page instead.
            const blockMsg = `Stay on the current page (${pageSummary.url.slice(0, 50)}). Work with what's already open — don't navigate away.`
            actionsTaken.push(`step ${step}: navigate BLOCKED — stay on current page`)
            // Don't break — continue to next step so AI can try a different action
            send({
              type: 'step',
              data: { step, thought: 'blocked navigation — staying on current page', action: 'skip', params, result: blockMsg } as AssistantStep,
            })
            continue
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
  const elements = page.interactiveElements.slice(0, 30).map((e, i) => {
    let info = `${i + 1}. <${e.tag}>`
    if (e.type) info += ` type="${e.type}"`
    if (e.id) info += ` id="${e.id}"`
    if (e.name) info += ` name="${e.name}"`
    if (e.placeholder) info += ` placeholder="${e.placeholder}"`
    if (e.text) info += ` text="${e.text}"`
    info += ` @ (${e.x},${e.y})`
    if (e.selector) info += ` selector=${e.selector}`
    return info
  }).join('\n')

  // List ALL form fields (input boxes) with their selectors, placeholders, and coordinates
  const formFields = page.formFields.length
    ? page.formFields.map((f, i) => {
        let info = `${i + 1}. <${f.tag} type="${f.type}">`
        if (f.id) info += ` id="${f.id}"`
        if (f.name) info += ` name="${f.name}"`
        if (f.placeholder) info += ` placeholder="${f.placeholder}"`
        if (f.label) info += ` label="${f.label}"`
        if (f.value) info += ` value="${f.value}"`
        info += ` @ (${f.x},${f.y}) selector=${f.selector}`
        return info
      }).join('\n')
    : '(no input boxes found)'

  const pageState = `URL: ${page.url}
Title: ${page.title}
Page text (first 4000 chars): ${page.pageText.slice(0, 4000)}

INPUT BOXES (search boxes, login fields, etc — use these to type/search):
${formFields}

CLICKABLE ELEMENTS (buttons, links, videos — use these coordinates to click):
${elements || '(none found)'}`

  const prompt = `You are browsing a website. The user wants: ${goal}

Current page:
${pageState}

Previous actions: ${actionsTaken.length ? actionsTaken.join('; ') : 'none'}

What ONE thing should you do next? Reply in this EXACT format (one line each):
ACTION: <click|fill|type|press_key|scroll|navigate|eval_js|done>
PARAMS: <key=value pairs, or the expression/url/text>
THOUGHT: <why>

Examples:
ACTION: click
PARAMS: x=640 y=360
THOUGHT: clicking the search box

ACTION: fill
PARAMS: selector=#search text=hello world
THOUGHT: typing the search query

ACTION: eval_js
PARAMS: expr=document.title
THOUGHT: getting the page title

ACTION: done
PARAMS: message=<h1>Result</h1><p>Found it</p>
THOUGHT: task complete

Rules:
- DON'T navigate away unless user explicitly asked to go to a different site.
- DON'T say done until task is COMPLETE — you must have DONE the action, not just described it. "I will search" is NOT done. Actually filling the search box and pressing Enter IS done.
- DON'T waste steps on eval_js when the INPUT BOXES and CLICKABLE ELEMENTS lists already have what you need. USE THE LISTS.
- To SEARCH: look at the INPUT BOXES list above. Find the search box (placeholder contains "Search" or type=search or name=q). Then:
    Step 1: ACTION: fill, PARAMS: selector=<selector_from_list> text=<what_user_wants_to_search>
    Step 2: ACTION: press_key, PARAMS: key=Enter
    Step 3: ACTION: done, PARAMS: message=<result>
- To CLICK something: look at the CLICKABLE ELEMENTS list above for coordinates. ACTION: click, PARAMS: x=XCOORD y=YCOORD
- To CLICK A VIDEO: don't click <video> elements directly (they're often hidden/0x0). Click the video THUMBNAIL — look for <a> tags with video titles or <img> in the CLICKABLE ELEMENTS list. Click those links to open the video page.
- To READ page: use eval_js expr=document.body.innerText.slice(0,5000)
- If a cookie popup is blocking, click "Accept" or "OK" or "Got it" button first (look in CLICKABLE ELEMENTS).
- DON'T run eval_js to find elements when they're already listed above. Wastes steps.`

  let raw = ''
  try {
    const completion = await callLlmWithRetry(
      () => zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: prompt },
          { role: 'user', content: `Step ${step}. What do you do next?` },
        ],
        thinking: { type: 'disabled' },
      }),
      (attempt, ms) => onStatus(`Retrying in ${Math.round(ms / 1000)}s...`),
    )
    raw = (completion.choices?.[0]?.message?.content ?? '').trim()
  } catch {
    return { action: 'done', params: { message: 'AI service unavailable. Please try again.' }, thought: 'LLM error' }
  }

  return parseNlAction(raw)
}

function parseNlAction(raw: string): ActionDecision {
  const lines = raw.split('\n')
  let action = 'done'
  let paramsStr = ''
  let thought = ''

  for (const line of lines) {
    const lower = line.toLowerCase().trim()
    if (lower.startsWith('action:')) action = line.slice(7).trim().toLowerCase().split(/\s/)[0]
    else if (lower.startsWith('params:')) paramsStr = line.slice(7).trim()
    else if (lower.startsWith('thought:')) thought = line.slice(9).trim()
  }

  const params: Record<string, unknown> = {}

  if (action === 'eval_js') {
    if (paramsStr.startsWith('expr=')) params.expr = paramsStr.slice(5)
    else if (paramsStr && !paramsStr.includes('=')) params.expr = paramsStr
    else { const m = raw.match(/expr\s*=\s*(.+)/i); if (m) params.expr = m[1].trim() }
  } else if (action === 'done') {
    params.message = paramsStr.startsWith('message=') ? paramsStr.slice(8) : (paramsStr || 'Done.')
  } else if (action === 'navigate' || action === 'new_tab') {
    params.url = paramsStr.startsWith('url=') ? paramsStr.slice(4).split(/\s/)[0] : (paramsStr.startsWith('http') ? paramsStr.split(/\s/)[0] : paramsStr)
  } else if (action === 'fill') {
    const s = paramsStr.match(/selector\s*=\s*(\S+)/); if (s) params.selector = s[1]
    const t = paramsStr.match(/text\s*=\s*(.+?)(?:\s+\w+=|$)/); if (t) params.text = t[1].trim()
    const x = paramsStr.match(/x\s*=\s*(\d+)/i); if (x) params.x = Number(x[1])
    const y = paramsStr.match(/y\s*=\s*(\d+)/i); if (y) params.y = Number(y[1])
  } else if (action === 'click') {
    const x = paramsStr.match(/x\s*=\s*(\d+)/i); if (x) params.x = Number(x[1])
    const y = paramsStr.match(/y\s*=\s*(\d+)/i); if (y) params.y = Number(y[1])
    if (!params.x || !params.y) { const c = paramsStr.match(/(\d+)\s*,\s*(\d+)/); if (c) { params.x = Number(c[1]); params.y = Number(c[2]) } }
  } else if (action === 'type') {
    params.text = paramsStr.startsWith('text=') ? paramsStr.slice(5) : paramsStr
  } else if (action === 'press_key') {
    params.key = paramsStr.startsWith('key=') ? paramsStr.slice(4) : paramsStr
  } else if (action === 'scroll') {
    const d = paramsStr.match(/direction\s*=\s*(up|down)/i); params.direction = d ? d[1].toLowerCase() : 'down'
    const a = paramsStr.match(/amount\s*=\s*(\d+)/i); params.amount = a ? Number(a[1]) : 400
  }

  return { action, params, thought }
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
        let expr = String(params.expr ?? params.expression ?? '')
        // If no expr but the goal mentions "title", "url", "buttons" etc,
        // auto-generate the right eval_js expression.
        if (!expr && goal) {
          const g = goal.toLowerCase()
          if (g.includes('title')) expr = 'document.title'
          else if (g.includes('url') || g.includes('link')) expr = 'location.href'
          else if (g.includes('button') || g.includes('buttons')) expr = "Array.from(document.querySelectorAll('button')).map(e=>e.textContent.trim().slice(0,50))"
          else if (g.includes('input') || g.includes('form')) expr = "Array.from(document.querySelectorAll('input,textarea,select')).map(e=>({type:e.type,name:e.name,id:e.id,placeholder:e.placeholder}))"
          else if (g.includes('link') || g.includes('links')) expr = "Array.from(document.querySelectorAll('a')).map(e=>({text:e.textContent.trim().slice(0,50),href:e.href}))"
          else if (g.includes('video')) expr = "Array.from(document.querySelectorAll('video')).map(e=>({src:e.src,paused:e.paused}))"
          else if (g.includes('image') || g.includes('images')) expr = "Array.from(document.querySelectorAll('img')).map(e=>({src:e.src.slice(0,80),alt:e.alt}))"
          else if (g.includes('text') || g.includes('read')) expr = 'document.body.innerText.slice(0,5000)'
          else if (g.includes('search box') || g.includes('search')) expr = "document.querySelector('input[type=search],input[name=q],input[placeholder*=search]')?'yes':'no'"
        }
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
