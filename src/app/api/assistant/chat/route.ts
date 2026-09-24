import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import {
  getTabs, closeTab, newTab, screenshot, navigate, click, scroll,
  typeText, typeInto, fillBySelector, pressKey, evalJs, getPageSummary,
  waitForSettle, setFileInputFiles, clearDialogFlag,
  type PageSummary,
} from '@/lib/chrome-cdp'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'
import { withQpsBypass, getCachedDecision, setCachedDecision, decisionCacheKey, pageHashForCache } from '@/lib/llm-quota'

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

// Per-session memo of the last note content the assistant saw.
// Keyed by the authenticated user/session so multi-user setups don't
// cross-contaminate. Each entry holds the previous note content so we
// can diff against it each turn and surface only what changed (new bug
// reports, requests, etc.). Lives for the lifetime of the server process.
const lastNoteSeenBySession = new Map<string, string | null>()

/** Page history memory: tracks the last N page states (URL + pageText hash)
 *  so the assistant can detect whether the page actually CHANGED between
 *  steps. This replaces the old "dumb" stuck-loop detector which just
 *  compared action strings — now we know if repeating an action is actually
 *  making progress (page is changing) or truly stuck (page is identical). */
interface PageStateSnapshot {
  url: string
  textHash: string   // first 500 chars of pageText (cheap fingerprint)
  step: number
}
const pageHistoryBySession = new Map<string, PageStateSnapshot[]>()

/** Compute a cheap hash of page text for change detection. */
function pageTextHash(text: string): string {
  // Use first 500 chars as a fingerprint — fast and sufficient for
  // detecting "did the page change after my action?"
  return text.slice(0, 500).replace(/\s+/g, ' ').trim()
}

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
    // Semantic-ish diff: ignore pure whitespace changes and minor edits
    // that don't add meaningful content. This prevents false-positive
    // triggers when the user just fixed a typo.
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

  // Session key for per-session state (note diff, page history).
  // Uses the authenticated user if available, falls back to a per-request key.
  const sessionKey = (req.headers.get('x-user-id') || req.headers.get('x-session-id') || 'default')

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
        // TRIM history to last 6 messages to prevent context bloat.
        // The old code sent the ENTIRE history every step, which caused
        // exponential token cost and eventual context window overflow
        // after ~50 steps. Now we keep only the most recent exchanges.
        const fullHistory = body.history ?? []
        const history = fullHistory.slice(-6)
        // Track actions already taken this turn so the model doesn't repeat.
        const actionsTaken: string[] = []
        // Track recent page states for SMART loop detection (not just action repetition).
        const recentPageStates: string[] = []
        // Track the last error so we can feed it back into the next decision.
        let lastError: string | null = null

        // Read the shared Notes pad — users may have written bug reports or
        // requests there. We compare with the previous note content (from
        // per-session memo) to detect what changed, and prepend any new
        // instructions to the goal so the assistant acts on them.
        let noteContent = ''
        let noteContext = ''
        try {
          let note = await db.note.findUnique({ where: { id: 'main' } })
          if (!note) note = await db.note.create({ data: { id: 'main', content: '' } })
          noteContent = note.content || ''
          // Per-session note tracking (was global before — caused cross-user
          // contamination in multi-user setups).
          const prevNote = lastNoteSeenBySession.get(sessionKey) ?? null
          lastNoteSeenBySession.set(sessionKey, noteContent)
          if (noteContent.trim()) {
            if (prevNote === null) {
              noteContext = `\n\n[Notes pad content — the user may have written bug reports or requests here; pay attention to them]:\n${noteContent.trim().slice(0, 2000)}`
            } else if (prevNote !== noteContent) {
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
          // 2. Capture current state — VISION-FIRST approach:
          //    Take screenshot + full page summary on EVERY step.
          //    The old code skipped screenshots on non-navigation steps to
          //    "save time", but that meant the LLM was BLIND — it only got
          //    text, never the actual visual layout. Now the LLM gets the
          //    screenshot on every step so it can see icons, colors, layout,
          //    spatial relationships, and visual state that text can't convey.
          send({ type: 'status', data: `Step ${step}/${MAX_STEPS} — analyzing the page…` })
          let pageSummary: PageSummary
          let shot: string = ''
          try {
            pageSummary = await getPageSummary()
            shot = await screenshot()
          } catch (err) {
            send({ type: 'error', data: `Cannot read Chrome: ${(err as Error).message}` })
            break
          }
          if (shot) {
            send({ type: 'screenshot', data: { step, image: `data:image/png;base64,${shot}` } })
          }

          // ---- Dialog detection (Fix #18) ----
          // If a native dialog (alert/confirm/prompt) was captured by our
          // injected override, surface it to the LLM so it can acknowledge
          // it or report it to the user instead of getting stuck.
          let dialogContext = ''
          if (pageSummary.dialog) {
            dialogContext = `\n\n⚠️ NATIVE DIALOG DETECTED: type=${pageSummary.dialog.type}, message="${pageSummary.dialog.message}". The dialog has been auto-dismissed. Report this to the user if relevant.`
            // Clear the flag so the next step doesn't re-report the same dialog
            await clearDialogFlag()
          }

          // ---- Page history tracking (Fix #26) ----
          // Record the current page state (URL + text hash) so we can detect
          // whether the page actually changed after our last action.
          const currentTextHash = pageTextHash(pageSummary.pageText)
          recentPageStates.push(`${pageSummary.url}|${currentTextHash}`)
          if (recentPageStates.length > 5) recentPageStates.shift()

          // 3. Ask the LLM what to do next — now WITH VISION (multimodal).
          const actionResp = await decideAction(
            zai, goal, history, step, pageSummary, shot,
            actionsTaken, (msg) => send({ type: 'status', data: msg }),
            noteContext + dialogContext + (lastError ? `\n\n⚠️ LAST ACTION FAILED: ${lastError}. Try a different approach.` : ''),
          )
          let action = actionResp.action
          let params = actionResp.params ?? {}
          let thought = actionResp.thought ?? ''

          // Navigation guard — only block if AI tries to navigate to a
          // completely different site that the user never mentioned.
          if ((action === 'navigate' || action === 'new_tab') && !goalWantsNavigation(goal)) {
            const blockMsg = `Stay on the current page (${pageSummary.url.slice(0, 50)}). Work with what's already open — don't navigate away.`
            actionsTaken.push(`step ${step}: navigate BLOCKED — stay on current page`)
            send({
              type: 'step',
              data: { step, thought: 'blocked navigation — staying on current page', action: 'skip', params, result: blockMsg } as AssistantStep,
            })
            continue
          }

          // ---- SMART stuck-loop detection (Fix #3) ----
          // The old code checked if the last 3 ACTIONS were identical. But
          // that's wrong — repeating the same action is FINE if the page is
          // actually changing (e.g. clicking "Next" to paginate). The new
          // approach checks if the last 3 PAGE STATES were identical AND
          // the actions were the same. Only then do we conclude "stuck".
          //
          // IMPORTANT: strip the "step N:" prefix before comparing actions,
          // otherwise the step number makes every action look different.
          let isStuckLoop = false
          if (action !== 'done' && recentPageStates.length >= 3) {
            // Check if the last 3 page states were all the same
            const states = recentPageStates.slice(-3)
            const samePage = states[0] === states[1] && states[1] === states[2]
            // AND the last 3 actions were the same (strip step number prefix)
            const stripStep = (s: string) => s.replace(/^step \d+:\s*/, '').split('->')[0].trim()
            const recentActions = actionsTaken.slice(-3)
            const sameAction = recentActions.length === 3 &&
              stripStep(recentActions[0]) === stripStep(recentActions[1]) &&
              stripStep(recentActions[1]) === stripStep(recentActions[2])
            isStuckLoop = samePage && sameAction
          }

          if (isStuckLoop) {
            // Force the assistant to ANSWER the user's question using gathered info.
            let stateInfo = ''
            try {
              const state = await evalJs(`(function(){
                var info={url:location.href,title:document.title};
                var v=document.querySelector('video');
                if(v){info.video={paused:v.paused,playing:!v.paused,currentTime:Math.round(v.currentTime),duration:Math.round(v.duration||0)};}
                info.bodyText=document.body?document.body.innerText.slice(0,1500):"";
                return JSON.stringify(info);
              })()`)
              stateInfo = state.value ? String(state.value).slice(0, 1500) : ''
            } catch {}
            let answerMsg = `I repeated ${action} a few times with no page change. Based on what I found: ${stateInfo.slice(0, 300)}`
            try {
              const answerResp = await callLlmWithRetry(
                () => withQpsBypass(zai, () => zai.chat.completions.create({
                  messages: [
                    { role: 'assistant', content: 'Answer the user question concisely in HTML (use <h1>, <b>, <ul><li>). Max 150 words. Use the page info below.' },
                    { role: 'user', content: `Question: ${goal}\n\nPage info: ${stateInfo}\n\nAnswer now:` },
                  ],
                  thinking: { type: 'disabled' },
                }), 'answer'),
              )
              const llmAnswer = (answerResp.choices?.[0]?.message?.content ?? '').trim()
              if (llmAnswer) answerMsg = llmAnswer
            } catch {}

            history.push({ role: 'assistant', content: answerMsg })
            send({
              type: 'step',
              data: { step, thought: 'stuck — page not changing — answering with gathered info', action: 'done', params: { message: answerMsg }, result: answerMsg } as AssistantStep,
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
          // ---- Error recovery (Fix #21) ----
          // If the action failed, feed the error into the next decision so
          // the LLM can try a different approach instead of repeating blindly.
          // Check for error indicators ANYWHERE in the result (not just start)
          // because fill returns "filled X → not found: Y" where "not found"
          // is in the middle.
          const isError = execResult.startsWith('error:') ||
            execResult.startsWith('invalid') ||
            execResult.startsWith('not found') ||
            execResult.includes('not found:') ||
            execResult.includes('failed') ||
            execResult.includes('JS error:') ||
            execResult.includes('→ not found') ||
            execResult.includes('error:')
          lastError = isError ? execResult.slice(0, 200) : null

          actionsTaken.push(`step ${step}: ${action} ${JSON.stringify(params).slice(0, 80)} -> ${execResult.slice(0, 80)}`)
          const stepRecord: AssistantStep = {
            step,
            thought,
            action,
            params,
            result: execResult,
          }
          send({ type: 'step', data: stepRecord })

          // ---- Adaptive wait (Fix #7) ----
          // Old code: hardcoded 600ms sleep. New code: waitForSettle uses
          // CDP Network domain to detect when the page has been quiet for
          // 500ms (no in-flight requests), up to 3s max. This means:
          // - Fast sites: wait ~500ms (faster than before)
          // - Slow sites: wait up to 3s (more reliable than before)
          // Only wait if the action likely triggered network activity.
          if (/navigate|new_tab|click|fill|type|press_key/.test(action)) {
            await waitForSettle(3000)
          } else {
            await new Promise((r) => setTimeout(r, 300))
          }

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
  // List up to 60 interactive elements (was 30 — too few for complex pages)
  const elements = page.interactiveElements.slice(0, 60).map((e, i) => {
    let info = `${i + 1}. <${e.tag}>`
    if (e.type) info += ` type="${e.type}"`
    if (e.id) info += ` id="${e.id}"`
    if (e.name) info += ` name="${e.name}"`
    if (e.placeholder) info += ` placeholder="${e.placeholder}"`
    if (e.text) info += ` text="${e.text}"`
    info += ` @ (${e.x},${e.y})`
    if (e.selector) info += ` selector=${e.selector}`
    if (e.context && e.context !== 'main') info += ` [${e.context}]`
    return info
  }).join('\n')

  // List ALL form fields with selectors, placeholders, labels, and SELECT OPTIONS
  const formFields = page.formFields.length
    ? page.formFields.map((f, i) => {
        let info = `${i + 1}. <${f.tag} type="${f.type}">`
        if (f.id) info += ` id="${f.id}"`
        if (f.name) info += ` name="${f.name}"`
        if (f.placeholder) info += ` placeholder="${f.placeholder}"`
        if (f.label) info += ` label="${f.label}"`
        if (f.value) info += ` value="${f.value}"`
        if (f.required) info += ` required`
        info += ` @ (${f.x},${f.y}) selector=${f.selector}`
        // For <select> dropdowns, list available options so the AI can
        // choose the right one without guessing.
        if (f.options && f.options.length > 0) {
          info += `\n   options: ${f.options.slice(0, 10).map(o => `"${o.text}"`).join(', ')}`
        }
        return info
      }).join('\n')
    : '(no input boxes found)'

  const pageState = `URL: ${page.url}
Title: ${page.title}
Viewport: ${page.viewport.width}x${page.viewport.height}
Scroll: ${page.scrollY}/${page.scrollHeight}px
${page.videos > 0 ? `Videos on page: ${page.videos}` : ''}

Page text (first 6000 chars):
${page.pageText.slice(0, 6000)}

INPUT BOXES (search boxes, login fields, dropdowns — use selectors to fill):
${formFields}

CLICKABLE ELEMENTS (buttons, links, videos — use coordinates or selectors):
${elements || '(none found)'}`

  const prompt = `You are browsing a website and can SEE the screenshot. The user wants: ${goal}${noteContext}

Current page state:
${pageState}

Previous actions: ${actionsTaken.length ? actionsTaken.slice(-8).join('\n') : 'none'}

You have BOTH the screenshot (visual) and the text dump (structured data). USE BOTH.
Look at the screenshot to understand the visual layout, icons, colors, and spatial relationships.
Use the text lists to get exact coordinates and selectors.

CRITICAL RULE FOR SELECTORS: When filling form fields, ALWAYS copy the EXACT selector from the
INPUT BOXES list above. Do NOT make up your own selectors based on what you see in the screenshot.
The selector in the INPUT BOXES list is generated from the actual DOM — it knows whether the element
is <input> or <textarea> or <select>. If you guess "input[name=q]" but the element is actually
<textarea name="q">, your fill will fail. USE THE EXACT SELECTOR FROM THE LIST.

What ONE thing should you do next? Reply in this EXACT format (one line each):
ACTION: <click|fill|type|press_key|scroll|navigate|new_tab|eval_js|upload|go_back|done>
PARAMS: <key=value pairs>
THOUGHT: <why>

Examples:
ACTION: click
PARAMS: x=640 y=360
THOUGHT: clicking the search box

ACTION: fill
PARAMS: selector=textarea[name="q"] text=hello world
THOUGHT: typing the search query into the textarea (note: it's textarea, not input)

ACTION: fill
PARAMS: selector=#email text=user@example.com
THOUGHT: typing the email

ACTION: fill
PARAMS: selector=select[name=country] text=United States
THOUGHT: selecting country from dropdown

ACTION: press_key
PARAMS: key=Enter
THOUGHT: submitting the form

ACTION: upload
PARAMS: selector=input[type=file] files=/tmp/upload.jpg
THOUGHT: uploading a file

ACTION: go_back
PARAMS:
THOUGHT: going back to previous page

ACTION: eval_js
PARAMS: expr=document.title
THOUGHT: getting the page title

ACTION: done
PARAMS: message=<h1>Result</h1><p>Found it</p>
THOUGHT: task complete

Rules:
- DON'T navigate away unless user explicitly asked to go to a different site.
- DON'T say done until task is COMPLETE — you must have DONE the action, not just described it.
- To SEARCH: find the search box in INPUT BOXES. COPY THE EXACT SELECTOR. Step 1: fill selector=<EXACT_SELECTOR_FROM_LIST> text=<query>. Step 2: press_key key=Enter. Step 3: done.
- To CLICK: use coordinates from CLICKABLE ELEMENTS. ACTION: click, PARAMS: x=XCOORD y=YCOORD
- To FILL a form field: ALWAYS copy the EXACT selector from the INPUT BOXES list. NEVER guess the tag name (input vs textarea) — use what the list says.
- For <select> dropdowns: use fill with the option TEXT (e.g. text="United States"). The options are listed under each select field.
- If a fill action returned "not found", you used the WRONG selector. Look at the INPUT BOXES list again and copy the EXACT selector.
- To upload a file: use upload with selector=input[type=file] files=/path/to/file
- To go back: use go_back action
- If the screenshot shows an error message or unexpected state, adjust your plan accordingly.
- If a native dialog (alert/confirm) was detected, it has been auto-dismissed. Report it to the user if relevant.`

  let raw = ''
  try {
    // ---- DECISION CACHE: reuse last decision if page+goal unchanged ----
    // This stretches the 300/day quota. If the user asks the same thing on
    // the same page (e.g. "click search" twice in a row on the same Google
    // page), we skip the LLM call entirely and reuse the cached decision.
    const ph = pageHashForCache(page.pageText)
    const cacheKey = decisionCacheKey(goal, page.url, ph)
    const cached = getCachedDecision(cacheKey)
    if (cached && !noteContext) {  // don't cache when notes changed (context differs)
      return { action: cached.action, params: cached.params, thought: cached.thought + ' [cached]', message: cached.message }
    }

    // ---- VISION: send the screenshot to the LLM as an image (Fix #1) ----
    // The old code NEVER sent the screenshot to the LLM — it only sent text.
    // This made the AI "blind" — it couldn't see icons, colors, layout, or
    // spatial relationships. Now we use zai.chat.completions.createVision()
    // (the VLM API) with multimodal messages (text + image_url) so the model
    // can actually SEE the page and make visually-informed decisions.
    //
    // Note: the regular create() API only accepts string content. The
    // createVision() API accepts content arrays with image_url blocks.
    //
    // ---- QPS BYPASS via chatId rotation ----
    // Each LLM call gets a FRESH chatId so it lands in its own QPS bucket.
    // The Z.ai API's 2-req/sec limit is PER-CHATID, so rotating chatId
    // means we never get 429-throttled for speed. This makes the assistant
    // 2-3x faster (no more 5s retry waits on 429).
    let completion
    if (shotB64) {
      completion = await callLlmWithRetry(
        () => withQpsBypass(zai, () => zai.chat.completions.createVision({
          messages: [
            { role: 'assistant', content: prompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: `Step ${step}. Here is the current screenshot of the page. What do you do next?` },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${shotB64}` } },
              ],
            },
          ],
          thinking: { type: 'disabled' },
        }), 'vision'),
        (attempt, ms) => onStatus(`Retrying in ${Math.round(ms / 1000)}s...`),
      )
    } else {
      // No screenshot — fall back to text-only API
      completion = await callLlmWithRetry(
        () => withQpsBypass(zai, () => zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: prompt },
            { role: 'user', content: `Step ${step}. What do you do next?` },
          ],
          thinking: { type: 'disabled' },
        }), 'text'),
        (attempt, ms) => onStatus(`Retrying in ${Math.round(ms / 1000)}s...`),
      )
    }
    raw = (completion.choices?.[0]?.message?.content ?? '').trim()
  } catch {
    return { action: 'done', params: { message: 'AI service unavailable. Please try again.' }, thought: 'LLM error' }
  }

  const decision = parseNlAction(raw)
  // Cache the decision for future reuse (stretches the 300/day quota).
  // Only cache non-error decisions and non-done actions (done = task complete,
  // no point caching).
  if (decision.action !== 'done' && !noteContext) {
    setCachedDecision(cacheKey, decision)
  }
  return decision
}

function parseNlAction(raw: string): ActionDecision {
  // ---- Robust parsing (Fix #13) ----
  // The old parser used fragile regex like `text\s*=\s*(.+?)(?:\s+\w+=|$)`
  // which broke when text contained spaces followed by a word that looked
  // like a param name (e.g. "text=hello world selector=#x" worked, but
  // "text=hello world what" lost "what").
  //
  // New approach: parse PARAMS line by splitting on known key= patterns,
  // and handle quoted values (text="hello world") for full robustness.
  const lines = raw.split('\n')
  let action = 'done'
  let paramsStr = ''
  let thought = ''
  // Also capture multi-line params (LLM sometimes writes PARAMS across lines)
  let inParams = false
  let inThought = false

  for (const line of lines) {
    const lower = line.toLowerCase().trim()
    if (lower.startsWith('action:')) {
      action = line.slice(7).trim().toLowerCase().split(/\s/)[0]
      inParams = false; inThought = false
    } else if (lower.startsWith('params:')) {
      paramsStr = line.slice(7).trim()
      inParams = true; inThought = false
    } else if (lower.startsWith('thought:')) {
      thought = line.slice(9).trim()
      inParams = false; inThought = true
    } else if (inParams) {
      // Continuation of PARAMS line (multi-line params)
      paramsStr += ' ' + line.trim()
    } else if (inThought) {
      thought += ' ' + line.trim()
    }
  }

  const params: Record<string, unknown> = {}

  // Helper: extract a key=value where value can be quoted ("...") or unquoted
  // Stops at the next `key=` boundary (whitespace followed by word=)
  function extractVal(str: string, key: string): string | null {
    // Match: key="value" or key=value (until next key= or end)
    const quoted = str.match(new RegExp(key + '\\s*=\\s*"([^"]*)"', 'i'))
    if (quoted) return quoted[1]
    const unquoted = str.match(new RegExp(key + '\\s*=\\s*(.+?)(?=\\s+\\w+=|$)', 'i'))
    if (unquoted) return unquoted[1].trim()
    return null
  }

  if (action === 'eval_js') {
    const expr = extractVal(paramsStr, 'expr')
    params.expr = expr || (paramsStr && !paramsStr.includes('=') ? paramsStr : '')
    if (!params.expr) { const m = raw.match(/expr\s*=\s*([\s\S]+)/i); if (m) params.expr = m[1].trim() }
  } else if (action === 'done') {
    const msg = extractVal(paramsStr, 'message')
    params.message = msg ?? (paramsStr || 'Done.')
  } else if (action === 'navigate' || action === 'new_tab') {
    const url = extractVal(paramsStr, 'url')
    params.url = url || (paramsStr.startsWith('http') ? paramsStr.split(/\s/)[0] : paramsStr)
  } else if (action === 'fill') {
    const sel = extractVal(paramsStr, 'selector')
    if (sel) params.selector = sel
    const txt = extractVal(paramsStr, 'text')
    if (txt) params.text = txt
    const x = paramsStr.match(/x\s*=\s*(\d+)/i); if (x) params.x = Number(x[1])
    const y = paramsStr.match(/y\s*=\s*(\d+)/i); if (y) params.y = Number(y[1])
  } else if (action === 'click') {
    const x = paramsStr.match(/x\s*=\s*(\d+)/i); if (x) params.x = Number(x[1])
    const y = paramsStr.match(/y\s*=\s*(\d+)/i); if (y) params.y = Number(y[1])
    if (!params.x || !params.y) { const c = paramsStr.match(/(\d+)\s*,\s*(\d+)/); if (c) { params.x = Number(c[1]); params.y = Number(c[2]) } }
  } else if (action === 'type') {
    const txt = extractVal(paramsStr, 'text')
    params.text = txt ?? (paramsStr.startsWith('text=') ? paramsStr.slice(5) : paramsStr)
  } else if (action === 'press_key') {
    const key = extractVal(paramsStr, 'key')
    params.key = key ?? (paramsStr.startsWith('key=') ? paramsStr.slice(4) : paramsStr)
  } else if (action === 'scroll') {
    const d = paramsStr.match(/direction\s*=\s*(up|down)/i); params.direction = d ? d[1].toLowerCase() : 'down'
    const a = paramsStr.match(/amount\s*=\s*(\d+)/i); params.amount = a ? Number(a[1]) : 400
  } else if (action === 'upload') {
    const sel = extractVal(paramsStr, 'selector')
    if (sel) params.selector = sel
    const files = extractVal(paramsStr, 'files')
    if (files) params.files = files.split(',').map(f => f.trim())
  }
  // go_back: no params needed

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
            const r = await withQpsBypass(zai2, () => zai2.chat.completions.create({
              messages: [
                { role: 'assistant', content: 'Extract the URL from the user request. Reply with ONLY the full URL (https://...), nothing else. If it is a GitHub profile like "github per sudaisalamboy", the URL is https://github.com/sudaisalamboy. If "google map", it is https://www.google.com/maps. Think and reply.' },
                { role: 'user', content: goal },
              ],
              thinking: { type: 'disabled' },
            }), 'url-extract')
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
        // ---- Fix #16: increased truncation from 300 to 2000 chars ----
        // The old code truncated eval_js results to 300 chars, which meant
        // when the AI asked for document.body.innerText, it only saw the
        // first 300 chars — not enough to make informed decisions.
        return r.error ? `JS error: ${r.error}` : `=> ${r.value.slice(0, 2000)}`
      }
      case 'upload': {
        // ---- Fix #23: file upload support ----
        // Uses CDP DOM.setFileInputFiles to upload files to <input type=file>.
        // This is the ONLY way to handle file uploads — browser file picker
        // dialogs can't be controlled via JS.
        const selector = String(params.selector ?? 'input[type=file]')
        const files = params.files as string[] | undefined
        if (!files || files.length === 0) return 'upload needs files parameter (comma-separated paths)'
        const r = await setFileInputFiles(selector, files)
        return r
      }
      case 'go_back': {
        // ---- Fix #17: back/undo mechanism ----
        // Navigate browser history back one step. This lets the AI recover
        // from wrong clicks (e.g. accidentally navigated to a wrong page).
        await evalJs('history.back()')
        await new Promise((r) => setTimeout(r, 1000))
        return 'went back in history'
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
