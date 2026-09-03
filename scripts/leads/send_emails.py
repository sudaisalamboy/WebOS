"""
Send pitch emails to all 30 leads via the logged-in ProtonMail in Remote Chrome.

Flow per lead:
  1. Click "New message" button (data-testid="sidebar:compose")
  2. Find To field (input[id^="to-composer"]) → focus it → type recipient email
  3. Press Tab to move to Subject field
  4. Type subject
  5. Press Tab to move into body iframe
  6. In body iframe: Ctrl+A (select watermark), Backspace (delete it)
  7. Type the personalized message body
  8. Click Send button
  9. Wait 60-90 seconds before next lead (avoid spam filters)

Resume support: skips leads already in sent_log.json
"""
import json
import os
import re
import subprocess
import sys
import time

COOKIE_FILE = "/tmp/webos-cookies.txt"
EVAL_URL = "http://localhost:3000/api/vnc/eval"
KEYPRESS_URL = "http://localhost:3000/api/vnc/keypress"

RESULTS_FILE = "/home/z/my-project/download/leads/leads_with_emails.json"
SENT_LOG = "/home/z/my-project/download/leads/sent_log.json"

# Delay between emails (seconds) — protects the ProtonMail account from spam filters
DELAY_BETWEEN_EMAILS = 75


# ---------- HTTP helpers ----------

def eval_js(expression: str, await_promise: bool = False, timeout: int = 30):
    payload = json.dumps({"expression": expression, "awaitPromise": await_promise})
    try:
        r = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout), "-b", COOKIE_FILE,
             "-X", "POST", EVAL_URL, "-H", "Content-Type: application/json",
             "-d", payload],
            capture_output=True, text=True, timeout=timeout + 5,
        )
        return json.loads(r.stdout)
    except Exception as e:
        return {"ok": False, "error": str(e)[:120]}


def keypress(action_data: dict, timeout: int = 30):
    payload = json.dumps(action_data)
    try:
        r = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout), "-b", COOKIE_FILE,
             "-X", "POST", KEYPRESS_URL, "-H", "Content-Type: application/json",
             "-d", payload],
            capture_output=True, text=True, timeout=timeout + 5,
        )
        return json.loads(r.stdout)
    except Exception as e:
        return {"ok": False, "error": str(e)[:120]}


# ---------- Pitch message templates (romanized Hindi/Urdu, psychological selling) ----------

def build_no_website_subject(business_name: str) -> str:
    return f"Aapka business online nahi hai — leads lose ho rahe hain"


def build_no_website_body(business_name: str, category: str, city: str) -> str:
    return f"""Namaste {business_name} team,

Maine dekha ki aapka business ({category} in {city}) online nahi hai. Aaj kal har customer Google pe search karta hai jab usko koi service chahiye hoti hai. Agar aapka website nahi hai, to aap har din naye customers lose kar rahe hain — aur wo customers aapke competitors ke paas ja rahe hain.

Hum aapke liye ek professional online profile bana kar denge jisse:

- Koi bhi online customer attract hoga jab wo search karega
- Aapko daily naye leads milenge (calls + WhatsApp + email)
- Aapka business 2x-3x grow karega within 3-6 months

Iske liye ek website bahut zaruri hai. Hum aapko ek modern, fast, mobile-friendly website bana kar denge — jo aapke customers ko impress kare aur aapko naye leads laaye.

Price bahut reasonable hai. Ek baar baat karke dekhiye — free consultation milega.

Agar interested hain, to is email ka reply karein ya WhatsApp karein. Hum aapke saath 10 minute me detail discuss karenge.

Dhanyavad,
Web Solutions Team
websiteDeveloper007@proton.me
"""


def build_low_quality_subject(business_name: str) -> str:
    return f"Aapki website seriously tooti hui hai — customers bhaag rahe hain"


def build_low_quality_body(business_name: str, website_url: str, reasons: list) -> str:
    issues_text = ""
    if reasons:
        readable = []
        for r in reasons[:3]:
            if r == "no-viewport-meta":
                readable.append("Mobile pe sahi nahi dikhti")
            elif r == "no-https":
                readable.append("Security warning dikhta hai (no HTTPS)")
            elif r == "short-title":
                readable.append("Google pe sahi se index nahi ho rahi")
            elif r.startswith("old-copyright"):
                readable.append("Purani lagti hai (copyright update nahi)")
            elif r.startswith("generator"):
                readable.append("Free website builder pe bani hai (unprofessional)")
            elif r == "small-page":
                readable.append("Bahut chhoti hai, content kam hai")
            elif r.startswith("fetch-failed"):
                readable.append("Properly load nahi ho rahi (broken)")
            else:
                readable.append(r)
        issues_text = "\n".join(f"✗ {x}" for x in readable)
    else:
        issues_text = "✗ Website properly load nahi ho rahi\n✗ Modern features missing"

    return f"""Namaste {business_name} team,

Maine aapki website check ki ({website_url}) aur usme kuch serious issues hain:

{issues_text}

Ye sab problems ki wajah se jab bhi koi customer aapki website pe aata hai, wo turant wapas chala jaata hai. Aap roz naye customers lose kar rahe hain bina jaane.

Hum aapka pura system bana kar denge — cheap me, fast me, aur properly working:

✓ Modern design jo customers ko impress kare
✓ Mobile-friendly (har phone pe sahi dikhegi)
✓ Fast loading (2 second me khul jayegi)
✓ SEO-optimized (Google pe top pe aayegi)
✓ SSL secure (no warnings)
✓ WhatsApp + call button (direct leads)

Ek baar free consultation le lijiye — 10 minute me hum aapko dikhayenge ki kya kya improve ho sakta hai.

Reply karein ya WhatsApp karein, hum aapke saath baat karenge.

Dhanyavad,
Web Solutions Team
websiteDeveloper007@proton.me
"""


# ---------- ProtonMail compose flow ----------

def open_compose():
    """Click the New Message button and wait for compose modal."""
    js = '''(function(){
  const btn = document.querySelector('button[data-testid="sidebar:compose"]');
  if (!btn) return {ok: false, error: "compose button not found"};
  btn.click();
  return {ok: true};
})()'''
    r = eval_js(js, await_promise=False, timeout=15)
    time.sleep(3)  # wait for compose modal to open + iframe to load
    return r.get("ok", False)


def get_compose_field_ids():
    """Get dynamic IDs of the To and Subject fields, plus body iframe."""
    js = '''(function(){
  const toField = document.querySelector('input[id^="to-composer"]');
  const subjField = document.querySelector('input[id^="subject-composer"]');
  const iframe = Array.from(document.querySelectorAll('iframe')).find(f => f.title === "Email composer");
  const sendBtn = Array.from(document.querySelectorAll('button')).find(b => /send/i.test(b.getAttribute('data-testid') || '') || /^send$/i.test((b.textContent || '').trim()));
  return {
    toId: toField ? toField.id : null,
    subjectId: subjField ? subjField.id : null,
    hasBodyFrame: !!iframe,
    bodyFrameSrc: iframe ? (iframe.src || 'about:blank').slice(0, 50) : null,
    hasSendBtn: !!sendBtn,
    sendBtnTid: sendBtn ? sendBtn.getAttribute('data-testid') : null,
    sendBtnText: sendBtn ? (sendBtn.textContent || '').trim().slice(0, 20) : null,
  };
})()'''
    r = eval_js(js, await_promise=False, timeout=20)
    return r.get("value", {}) if r.get("ok") else {}


def focus_and_type_input(element_selector: str, text: str):
    """Focus an input via JS, then use CDP Input.insertText to type.

    For React-controlled inputs (like ProtonMail's To field), the React
    value-tracker trick is used: set value via the native setter, then
    dispatch an 'input' event so React's onChange fires.
    """
    # Focus + React value-tracker trick + dispatch input event
    js = f'''(function(){{
  const el = document.querySelector({json.dumps(element_selector)});
  if (!el) return false;
  el.focus();
  el.click();
  // React value-tracker trick: use native setter + dispatch input event
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, {json.dumps(text)});
  el.dispatchEvent(new Event("input", {{bubbles: true}}));
  el.dispatchEvent(new Event("change", {{bubbles: true}}));
  return true;
}})()'''
    eval_js(js, await_promise=False, timeout=10)
    time.sleep(0.3)


def focus_body_iframe_and_clear_watermark():
    """Clear the body editor (removes 'Sent with Proton Mail' watermark).

    Uses execCommand('selectAll') + execCommand('delete') inside the
    same-origin body iframe's contenteditable DIV.
    """
    js = '''(function(){
  const iframe = Array.from(document.querySelectorAll("iframe")).find(f => f.title === "Email composer");
  if (!iframe) return {ok: false, error: "no body iframe"};
  try {
    const doc = iframe.contentDocument;
    const editor = doc.querySelector("[contenteditable=true]");
    if (!editor) return {ok: false, error: "no editable"};
    iframe.focus();
    editor.focus();
    // Select all + delete (removes watermark)
    doc.execCommand("selectAll", false, null);
    doc.execCommand("delete", false, null);
    return {ok: true, bodyText: (doc.body.innerText || "").slice(0, 50)};
  } catch(e) {
    return {ok: false, error: e.message};
  }
})()'''
    r = eval_js(js, await_promise=False, timeout=15)
    info = r.get("value", {}) if r.get("ok") else {}
    if not info.get("ok"):
        print(f"  ⚠ body clear failed: {info}")
        return False
    time.sleep(0.3)
    return True


def type_in_body(text: str):
    """Type text into the body editor (must already be focused).

    Uses execCommand('insertText') inside the body iframe's contenteditable
    DIV — works with Squire (ProtonMail's editor).
    """
    # Convert plain text to HTML-safe, preserving line breaks
    # Squire needs <br> or <div> for line breaks; insertText with \n may not work
    # Strategy: insert line by line, using insertText + execCommand insertHTML for <br>
    js = f'''(function(){{
  const iframe = Array.from(document.querySelectorAll("iframe")).find(f => f.title === "Email composer");
  if (!iframe) return {{ok: false, error: "no body iframe"}};
  const doc = iframe.contentDocument;
  const editor = doc.querySelector("[contenteditable=true]");
  if (!editor) return {{ok: false, error: "no editable"}};
  iframe.focus();
  editor.focus();
  // Split into lines and insert each line, with <br> between them
  const lines = {json.dumps(text)}.split("\\n");
  for (let i = 0; i < lines.length; i++) {{
    if (i > 0) {{
      // Insert line break (paragraph break)
      doc.execCommand("insertHTML", false, "<div><br></div>");
    }}
    if (lines[i].length > 0) {{
      doc.execCommand("insertText", false, lines[i]);
    }}
  }}
  return {{ok: true, bodyText: (doc.body.innerText || "").slice(0, 100)}};
}})()'''
    r = eval_js(js, await_promise=False, timeout=20)
    time.sleep(0.5)
    return r


def click_send():
    """Click the Send button. ProtonMail shows a 'Message sent' toast for ~5s
    before closing the compose modal, so we wait for it to actually close."""
    js = '''(function(){
  const btn = Array.from(document.querySelectorAll('button')).find(b => /send/i.test(b.getAttribute('data-testid') || '') || /^send$/i.test((b.textContent || '').trim()));
  if (!btn) return {ok: false, error: "send button not found"};
  btn.click();
  return {ok: true, text: (btn.textContent || '').trim()};
})()'''
    r = eval_js(js, await_promise=False, timeout=15)
    if not r.get("ok"):
        return False, r.get("value", {})
    # Wait for the compose modal to close (up to 15s — ProtonMail keeps it open while "Message sent" toast shows)
    deadline = time.time() + 15
    closed = False
    while time.time() < deadline:
        time.sleep(1.5)
        check = eval_js('(function(){return !!document.querySelector("input[id^=to-composer]");})()', await_promise=False, timeout=10)
        still_open = check.get("value") if check.get("ok") else True
        if not still_open:
            closed = True
            break
    # Look for the success toast
    toast = eval_js('''(function(){
  const toasts = Array.from(document.querySelectorAll("[role=status], [class*=toast], [class*=notification]"));
  const success = toasts.find(t => /message sent|sent successfully/i.test(t.textContent || ""));
  return success ? (success.textContent || "").slice(0, 50) : null;
})()''', await_promise=False, timeout=10)
    return closed, {"toast": toast.get("value") if toast.get("ok") else None, "waited": int(time.time() - (deadline - 15))}


def dismiss_any_dialog():
    """If a confirmation dialog appears (e.g. 'Send without subject?'), click Send anyway."""
    js = '''(function(){
  const dialogs = Array.from(document.querySelectorAll('[role=dialog], [role=alertdialog]'));
  for (const d of dialogs) {
    const text = (d.textContent || '').toLowerCase();
    if (text.includes('send') && (text.includes('without') || text.includes('subject') || text.includes('confirm'))) {
      const sendBtn = Array.from(d.querySelectorAll('button')).find(b => /send/i.test(b.textContent || ''));
      if (sendBtn) { sendBtn.click(); return {dismissed: true, dialog: text.slice(0, 100)}; }
    }
  }
  return {dismissed: false};
})()'''
    r = eval_js(js, await_promise=False, timeout=10)
    return r.get("value", {})


# ---------- Sent-log management ----------

def load_sent_log():
    if os.path.exists(SENT_LOG):
        with open(SENT_LOG) as f:
            return json.load(f)
    return {"sent": [], "failed": []}


def save_sent_log(log):
    with open(SENT_LOG, "w") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)


# ---------- Main pipeline ----------

def send_one_email(lead: dict, lead_type: str) -> dict:
    """Send a single email to a lead. Returns {ok, error?, lead}."""
    name = lead.get("name", "")
    emails = lead.get("emails", [])
    if not emails:
        return {"ok": False, "error": "no email", "lead": name}
    recipient = emails[0]
    query = lead.get("_query", "")
    parts = query.rsplit(" ", 2)
    city = parts[-2] if len(parts) >= 2 else ""
    category = parts[0] if len(parts) >= 3 else query
    website_url = lead.get("websiteUrl") or ""
    reasons = lead.get("quality_reasons") or []

    if lead_type == "no-website":
        subject = build_no_website_subject(name)
        body = build_no_website_body(name, category, city)
    else:
        subject = build_low_quality_subject(name)
        body = build_low_quality_body(name, website_url, reasons)

    print(f"  → To: {recipient}")
    print(f"  → Subject: {subject}")

    # 0. Close any existing compose modal first (in case previous send failed)
    eval_js('''(function(){
      // Try discard button first
      const btns = Array.from(document.querySelectorAll("button"));
      const discard = btns.find(b => /^discard$/i.test((b.textContent || "").trim()));
      if (discard) { discard.click(); return "discarded"; }
      // Try close button
      const close = btns.find(b => /composer:close/i.test(b.getAttribute("data-testid") || ""));
      if (close) { close.click(); return "closed"; }
      return "nothing-to-close";
    })()''', await_promise=False, timeout=10)
    time.sleep(1.5)

    # 1. Open compose
    if not open_compose():
        return {"ok": False, "error": "compose didn't open", "lead": name}
    time.sleep(2)

    # 2. Get field IDs
    fields = get_compose_field_ids()
    if not fields.get("toId"):
        return {"ok": False, "error": "To field not found", "lead": name}
    print(f"  → Compose open: to={fields.get('toId')}, subj={fields.get('subjectId')}")

    # 3. Type recipient email in To field (React value-tracker trick) + press Enter to commit chip
    focus_and_type_input(f"input#{fields['toId']}", recipient)
    time.sleep(0.4)
    # Press Enter to commit the recipient as a chip
    keypress({"action": "press", "key": "Enter"}, timeout=10)
    time.sleep(0.6)

    # 4. Verify recipient was committed (look for the email in chips, not in input value)
    verify_to = eval_js('''(function(){
      const allSpans = Array.from(document.querySelectorAll("span, div"));
      const emailChips = allSpans.filter(s => /@/.test(s.textContent || "") && s.children.length === 0 && (s.textContent || "").length < 60 && !/proton\\.me/i.test(s.textContent || ""));
      const chipTexts = emailChips.map(s => (s.textContent || "").trim());
      const hasRecipient = chipTexts.some(t => t.toLowerCase().includes(arguments[0].toLowerCase()));
      return {chips: chipTexts, hasRecipient: hasRecipient};
    })("''' + recipient + '''")''', await_promise=False, timeout=10)
    to_info = verify_to.get("value", {}) if verify_to.get("ok") else {}
    if not to_info.get("hasRecipient"):
        # Try Tab as fallback (some ProtonMail versions use Tab to commit)
        keypress({"action": "press", "key": "Tab"}, timeout=10)
        time.sleep(0.4)
    print(f"  → Recipient committed: {to_info.get('hasRecipient')}")

    # 5. Type subject (click directly into Subject field — don't rely on Tab navigation)
    if not fields.get("subjectId"):
        return {"ok": False, "error": "Subject field not found", "lead": name}
    focus_and_type_input(f"input#{fields['subjectId']}", subject)
    time.sleep(0.4)

    # 6. Focus body iframe + clear watermark
    if not focus_body_iframe_and_clear_watermark():
        return {"ok": False, "error": "body iframe not focusable", "lead": name}
    time.sleep(0.4)

    # 7. Type body
    type_in_body(body)
    time.sleep(1.0)

    # 8. Verify everything before sending
    verify = eval_js('''(function(){
      const iframe = Array.from(document.querySelectorAll("iframe")).find(f => f.title === "Email composer");
      const bodyText = iframe ? (iframe.contentDocument.body.innerText || "") : "";
      return {
        subjectVal: document.querySelector("input[id^='subject-composer']")?.value || "",
        bodyLen: bodyText.length,
        hasWatermark: /Sent with Proton/i.test(bodyText),
      };
    })()''', await_promise=False, timeout=15)
    v = verify.get("value", {}) if verify.get("ok") else {}
    if v.get("hasWatermark"):
        print(f"  ⚠ Watermark still present — trying to clear again")
        focus_body_iframe_and_clear_watermark()
        time.sleep(0.3)
    print(f"  → Body ready: subject={v.get('subjectVal', '')[:40]!r}, bodyLen={v.get('bodyLen')}, watermark={v.get('hasWatermark')}")

    # 9. Click Send
    ok, info = click_send()
    time.sleep(1.0)
    # 10. Dismiss any confirmation dialog
    dismiss_any_dialog()
    time.sleep(1.0)

    if ok:
        return {"ok": True, "recipient": recipient, "subject": subject, "lead": name}
    return {"ok": False, "error": "send button click failed", "lead": name, "info": info}


def main():
    # Login (refresh cookie)
    subprocess.run(
        ["curl", "-s", "-c", COOKIE_FILE, "-X", "POST",
         "http://localhost:3000/api/auth/login",
         "-H", "Content-Type: application/json",
         "-d", '{"password":"webos"}'],
        capture_output=True, timeout=10,
    )

    with open(RESULTS_FILE) as f:
        data = json.load(f)
    no_site = data.get("no_website", [])
    low_qual = data.get("has_website", [])

    log = load_sent_log()
    sent_emails = {s.get("recipient") for s in log["sent"]}
    print(f"Loaded {len(no_site)} no-website + {len(low_qual)} low-quality leads")
    print(f"Already sent: {len(sent_emails)}")
    print()

    all_leads = [(b, "no-website") for b in no_site] + [(b, "low-quality-website") for b in low_qual]
    pending = [(b, t) for b, t in all_leads if (b.get("emails") or [""])[0] not in sent_emails]
    print(f"Pending: {len(pending)} leads")
    print(f"Delay between emails: {DELAY_BETWEEN_EMAILS}s (total ~{len(pending) * DELAY_BETWEEN_EMAILS / 60:.1f} min)")
    print()

    for i, (lead, lead_type) in enumerate(pending, 1):
        name = lead.get("name", "")
        print(f"[{i}/{len(pending)}] {name} ({lead_type})")
        try:
            result = send_one_email(lead, lead_type)
            if result.get("ok"):
                log["sent"].append({
                    "lead": name,
                    "recipient": result["recipient"],
                    "subject": result["subject"],
                    "type": lead_type,
                    "ts": int(time.time()),
                })
                print(f"  ✓ SENT to {result['recipient']}")
            else:
                log["failed"].append({
                    "lead": name,
                    "error": result.get("error", "unknown"),
                    "ts": int(time.time()),
                })
                print(f"  ✗ FAILED: {result.get('error')}")
            save_sent_log(log)
        except Exception as e:
            log["failed"].append({"lead": name, "error": f"exception: {str(e)[:120]}", "ts": int(time.time())})
            save_sent_log(log)
            print(f"  ✗ EXCEPTION: {e}")

        # Delay before next email
        if i < len(pending):
            print(f"  ... waiting {DELAY_BETWEEN_EMAILS}s before next email")
            time.sleep(DELAY_BETWEEN_EMAILS)

    print()
    print("===== FINAL =====")
    print(f"Sent:   {len(log['sent'])}")
    print(f"Failed: {len(log['failed'])}")
    if log["failed"]:
        print("\nFailed leads:")
        for f in log["failed"]:
            print(f"  - {f['lead']}: {f['error']}")


if __name__ == "__main__":
    main()
