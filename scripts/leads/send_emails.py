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


# ---------- Country detection ----------

def country_from_query(query: str) -> str:
    """Detect country from the lead's source query."""
    if any(s in query for s in ("NC", "MT", "VT", "OR", "GA", "NY", "AZ", "CO", "NM", "SC")):
        return "US"
    if any(s in query for s in ("BC", "ON", "NS", "AB", "QC", "MB", "SK")):
        return "CA"
    if "UK" in query or any(s in query for s in ("England", "Scotland", "Wales")):
        return "UK"
    if "Ireland" in query:
        return "IE"
    if "NZ" in query:
        return "NZ"
    if any(s in query for s in ("VIC", "QLD", "TAS", "NSW", "SA", "WA")):
        return "AU"
    return "US"  # default


# ---------- English cold-outreach pitch templates (country-specific tone) ----------
#
# Cold email best practices applied:
#   - Short (4 short paragraphs max)
#   - Personalized opener (mentions their business + city + rating)
#   - Problem stated plainly (no hype)
#   - One concrete offer
#   - Single clear CTA (reply or quick call)
#   - Professional sign-off matching the country
#
# Country tone differences:
#   US    — direct, results-focused, casual-professional, contractions, ROI/growth language
#   UK    — more formal/polite, British spellings (organisation, favour, programme),
#            "Kind regards", understated
#   CA    — polite, friendly, slightly more reserved than US, mentions local market,
#            "Cheers" or "Best regards"
#   AU    — casual, mate-y but professional, "Cheers", mentions local competition


# ============== NO-WEBSITE LEADS ==============

def build_no_website_subject(business_name: str, country: str = "US") -> str:
    # Country-specific subject lines (all English, cold-outreach tone)
    if country == "UK":
        return f"Quick question about {business_name}"
    if country == "CA":
        return f"{business_name} — quick question about your online presence"
    if country == "AU":
        return f"Quick question re {business_name}"
    # US default
    return f"Quick question about {business_name}"


def build_no_website_body(lead: dict) -> str:
    """English cold-outreach email for a no-website business.
    Personalized with name, category, city, rating, reviews, phone/FB presence.
    """
    name = lead.get("name", "")
    query = lead.get("_query", "")
    parts = query.rsplit(" ", 2)
    city = parts[-2] if len(parts) >= 2 else "your area"
    state = parts[-1] if len(parts) >= 2 else ""
    category = parts[0] if len(parts) >= 3 else query
    rating = lead.get("rating")
    reviews = lead.get("reviews")
    phone = lead.get("phone") or ""
    has_fb = bool(lead.get("facebook_url"))
    country = country_from_query(query)

    # Build a line that acknowledges what they're doing well
    praise_bits = []
    if rating and rating >= 4.5:
        praise_bits.append(f"a {rating}-star rating")
    if reviews and reviews >= 20:
        praise_bits.append(f"{reviews}+ Google reviews")
    if has_fb:
        praise_bits.append("an active Facebook presence")
    if praise_bits:
        if len(praise_bits) == 1:
            praise = praise_bits[0]
        elif len(praise_bits) == 2:
            praise = f"{praise_bits[0]} and {praise_bits[1]}"
        else:
            praise = ", ".join(praise_bits[:-1]) + f", and {praise_bits[-1]}"
    else:
        praise = "a solid local reputation"

    # Clean up the category word (e.g. "lawn care service" → "lawn care")
    # Many queries are "lawn care service Asheville NC" so the first token-group
    # before the city is the full category phrase. Trim trailing "service".
    cat_clean = category
    cat_clean = re.sub(r"\s+service$", "", cat_clean, flags=re.IGNORECASE)
    cat_clean = re.sub(r"\s+services$", "", cat_clean, flags=re.IGNORECASE)
    category_phrase = cat_clean or category

    # Build the locality reference (city, state for US; just city elsewhere)
    if country == "US":
        locality = f"{city}, {state}" if state else city
        opener_locality = locality
    elif country == "UK":
        locality = city
        opener_locality = f"{city}"
    elif country == "CA":
        # Canadian province code is in the query like "BC", "ON"
        locality = f"{city}, {state}" if state else city
        opener_locality = locality
    elif country == "AU":
        # Australian state code like "VIC", "QLD"
        locality = f"{city}, {state}" if state else city
        opener_locality = locality
    else:
        locality = city
        opener_locality = city

    # Country-specific tone + sign-off
    if country == "UK":
        greeting = f"Hi {name} team,"
        closer = "Kind regards,"
        # British spellings + slightly more formal
        problem_para = (
            f"I came across {name} while looking at {category_phrase} services in {opener_locality}, "
            f"and I noticed you've got {praise} — but no website listed."
        )
        value_para = (
            f"Nowadays, when someone in {locality} searches for {category_phrase} on Google, "
            f"they tend to go with whichever business has a proper site they can look at first. "
            f"Without one, you're likely losing enquiries to competitors who do."
        )
        offer_para = (
            f"I build straightforward, modern websites for service businesses like yours — "
            f"mobile-friendly, fast, and set up to rank well locally. I'd be happy to put one "
            f"together for {name} at a fair price, and have it live within a week or two."
        )
        cta_para = (
            f"If that sounds worthwhile, just reply to this email and we can arrange a quick "
            f"10-minute call to go over the details. No obligation."
        )
    elif country == "CA":
        greeting = f"Hi {name} team,"
        closer = "Best regards,"
        problem_para = (
            f"I was looking into {category_phrase} services in {opener_locality} and came across {name}. "
            f"It looks like you've built {praise} — but I noticed you don't have a website."
        )
        value_para = (
            f"These days, most people in {locality} check online before they pick a {category_phrase} provider. "
            f"When they can't find you on Google, they usually go with someone who's there."
        )
        offer_para = (
            f"I build clean, fast, mobile-friendly websites for local service businesses across Canada. "
            f"I'd be glad to put one together for {name} — set up to bring in local enquiries — at a reasonable price."
        )
        cta_para = (
            f"If you'd like to chat about it, just reply here and we can set up a quick 10-minute call. "
            f"Cheers."
        )
    elif country == "AU":
        greeting = f"Hi {name} team,"
        closer = "Cheers,"
        problem_para = (
            f"I came across {name} while having a look at {category_phrase} services in {opener_locality}. "
            f"You've clearly got {praise} — but I noticed there's no website listed."
        )
        value_para = (
            f"These days, when someone in {locality} Googles a {category_phrase} business, they tend to go with "
            f"the ones that have a proper site to look at. Without one, you're likely losing work to "
            f"the competition."
        )
        offer_para = (
            f"I build simple, modern, mobile-friendly websites for service businesses — set up to show up "
            f"in local search and turn visitors into enquiries. Happy to put one together for {name} at a fair price."
        )
        cta_para = (
            f"If you're keen, just reply here and we can sort out a quick 10-minute chat to go through the details."
        )
    else:  # US default — direct, results-focused
        greeting = f"Hi {name} team,"
        closer = "Best,"
        problem_para = (
            f"I came across {name} while searching for {category_phrase} services in {opener_locality}, "
            f"and it looks like you've got {praise} — but no website listed."
        )
        value_para = (
            f"These days, when someone in {locality} searches for {category_phrase} on Google, they usually go "
            f"with whoever shows up with a real site they can look at. Without one, you're losing those "
            f"leads to competitors who do."
        )
        offer_para = (
            f"I build clean, modern, mobile-friendly websites for local service businesses — set up to "
            f"rank well locally and turn visitors into calls. I'd be glad to put one together for {name} "
            f"at a fair price, and have it live within a week or two."
        )
        cta_para = (
            f"If that sounds worth exploring, just reply to this email and we can set up a quick 10-minute "
            f"call to go over the details. No pressure."
        )

    return (
        f"{greeting}\n\n"
        f"{problem_para}\n\n"
        f"{value_para}\n\n"
        f"{offer_para}\n\n"
        f"{cta_para}\n\n"
        f"{closer}\n"
        f"Web Solutions\n"
        f"websiteDeveloper007@proton.me\n"
    )


# ============== LOW-QUALITY-WEBSITE LEADS ==============

def build_low_quality_subject(business_name: str, country: str = "US") -> str:
    if country == "UK":
        return f"Quick note about the {business_name} website"
    if country == "CA":
        return f"{business_name} website — quick note"
    if country == "AU":
        return f"Quick note about the {business_name} website"
    return f"Quick note about the {business_name} website"


def _humanize_reason(reason: str) -> str:
    """Turn a quality_reason code into a plain-English line for the email."""
    if reason == "no-viewport-meta":
        return "doesn't display properly on mobile phones"
    if reason == "no-https":
        return "shows a 'not secure' warning in the browser"
    if reason == "short-title":
        return "isn't properly indexed by Google"
    if reason.startswith("old-copyright"):
        return "looks out of date (copyright hasn't been updated)"
    if reason.startswith("generator"):
        gen = reason.split("-", 1)[1] if "-" in reason else ""
        if "wix" in gen.lower():
            return "is built on a free Wix template (looks unprofessional)"
        if "godaddy" in gen.lower():
            return "is built on a GoDaddy template (looks generic)"
        if "weebly" in gen.lower():
            return "is built on a free Weebly template"
        return "looks like it was built with a free website builder"
    if reason == "small-page":
        return "has very little content"
    if reason.startswith("fetch-failed"):
        return "isn't loading properly when people visit it"
    return reason.replace("-", " ")


def build_low_quality_body(lead: dict) -> str:
    """English cold-outreach email for a business with a low-quality website."""
    name = lead.get("name", "")
    query = lead.get("_query", "")
    parts = query.rsplit(" ", 2)
    city = parts[-2] if len(parts) >= 2 else "your area"
    state = parts[-1] if len(parts) >= 2 else ""
    category = parts[0] if len(parts) >= 3 else query
    website_url = lead.get("websiteUrl") or ""
    reasons = lead.get("quality_reasons") or []
    rating = lead.get("rating")
    reviews = lead.get("reviews")
    country = country_from_query(query)

    # Clean up the category word (trim trailing "service"/"services")
    cat_clean = re.sub(r"\s+service$", "", category, flags=re.IGNORECASE)
    cat_clean = re.sub(r"\s+services$", "", cat_clean, flags=re.IGNORECASE)
    category_phrase = cat_clean or category

    # Build locality + opener
    if country == "US":
        locality = f"{city}, {state}" if state else city
    elif country == "UK":
        locality = city
    elif country == "CA":
        locality = f"{city}, {state}" if state else city
    elif country == "AU":
        locality = f"{city}, {state}" if state else city
    else:
        locality = city

    # Acknowledge what they're doing well
    praise_bits = []
    if rating and rating >= 4.5:
        praise_bits.append(f"a {rating}-star rating")
    if reviews and reviews >= 20:
        praise_bits.append(f"{reviews}+ Google reviews")
    praise = ", ".join(praise_bits[:-1]) + (" and " + praise_bits[-1] if len(praise_bits) > 1 else praise_bits[0]) if praise_bits else "a solid reputation locally"

    # Translate quality issues to plain English
    if reasons:
        readable = [_humanize_reason(r) for r in reasons[:3]]
        issues_block = "\n".join(f"  - it {r}" for r in readable)
    else:
        issues_block = "  - it isn't loading properly when people visit it\n  - it's missing modern features"

    # Country-specific tone
    if country == "UK":
        greeting = f"Hi {name} team,"
        closer = "Kind regards,"
        problem_para = (
            f"I was looking at {category_phrase} services in {locality} and came across {name} — "
            f"you've clearly built {praise}. Whilst having a look, I noticed your website "
            f"({website_url}) has a few issues:"
        )
        value_para = (
            f"These sorts of problems tend to put people off — when a site doesn't load properly or "
            f"looks out of date, visitors usually go back to Google and pick a competitor instead."
        )
        offer_para = (
            f"I build straightforward, modern websites for service businesses — mobile-friendly, fast, "
            f"secure, and set up to rank well locally. I'd be happy to rebuild {name}'s site properly, "
            f"at a fair price, and have it live within a week or two."
        )
        cta_para = (
            f"If that sounds useful, just reply to this email and we can arrange a quick 10-minute call "
            f"to go over what needs sorting. No obligation."
        )
    elif country == "CA":
        greeting = f"Hi {name} team,"
        closer = "Best regards,"
        problem_para = (
            f"I was looking into {category_phrase} services in {locality} and came across {name} — "
            f"you've built {praise}. While I was checking things out, I noticed your website "
            f"({website_url}) has a few issues:"
        )
        value_para = (
            f"These kinds of issues tend to turn visitors away — when a site doesn't load well or "
            f"looks dated, people usually head back to Google and pick a competitor instead."
        )
        offer_para = (
            f"I build clean, modern, mobile-friendly websites for service businesses across Canada — "
            f"set up to rank well locally and bring in enquiries. I'd be glad to rebuild {name}'s site "
            f"properly at a reasonable price."
        )
        cta_para = (
            f"If you'd like to chat about it, just reply here and we can set up a quick 10-minute call. "
            f"Cheers."
        )
    elif country == "AU":
        greeting = f"Hi {name} team,"
        closer = "Cheers,"
        problem_para = (
            f"I came across {name} while looking at {category_phrase} services in {locality} — "
            f"you've clearly got {praise}. While I was having a look, I noticed your website "
            f"({website_url}) has a few issues:"
        )
        value_para = (
            f"That sort of thing tends to put people off — when a site doesn't load properly or "
            f"looks a bit rough, visitors usually head back to Google and go with a competitor instead."
        )
        offer_para = (
            f"I build simple, modern, mobile-friendly websites for service businesses — set up to show "
            f"up in local search and turn visitors into enquiries. Happy to rebuild {name}'s site properly "
            f"at a fair price."
        )
        cta_para = (
            f"If you're keen, just reply here and we can sort out a quick 10-minute chat to go through the details."
        )
    else:  # US default
        greeting = f"Hi {name} team,"
        closer = "Best,"
        problem_para = (
            f"I came across {name} while searching for {category_phrase} services in {locality} — "
            f"you've clearly built {praise}. While checking things out, I noticed your website "
            f"({website_url}) has a few issues:"
        )
        value_para = (
            f"These kinds of problems tend to drive visitors away — when a site doesn't load properly or "
            f"looks outdated, people usually head back to Google and pick a competitor instead."
        )
        offer_para = (
            f"I build clean, modern, mobile-friendly websites for local service businesses — set up to "
            f"rank well locally and turn visitors into calls. I'd be glad to rebuild {name}'s site properly, "
            f"at a fair price, and have it live within a week or two."
        )
        cta_para = (
            f"If that sounds worth exploring, just reply to this email and we can set up a quick 10-minute "
            f"call to go over what needs fixing. No pressure."
        )

    return (
        f"{greeting}\n\n"
        f"{problem_para}\n"
        f"{issues_block}\n\n"
        f"{value_para}\n\n"
        f"{offer_para}\n\n"
        f"{cta_para}\n\n"
        f"{closer}\n"
        f"Web Solutions\n"
        f"websiteDeveloper007@proton.me\n"
    )


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
    country = country_from_query(query)

    # Build subject + body using the new English cold-outreach templates
    if lead_type == "no-website":
        subject = build_no_website_subject(name, country)
        body = build_no_website_body(lead)
    else:
        subject = build_low_quality_subject(name, country)
        body = build_low_quality_body(lead)

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
    # ALSO load the persistent sent registry — this is cross-campaign dedup
    # so we never pitch the same email twice even across different lead batches.
    from registry import load_sent as load_sent_registry, save_sent as save_sent_registry, add_sent_entry, norm_email, is_email_sent
    sent_registry = load_sent_registry()
    sent_emails = {s.get("recipient") for s in log["sent"]}
    # Also include the persistent registry in the "already sent" set
    sent_normalized = set(sent_registry["emails"].keys())
    print(f"Loaded {len(no_site)} no-website + {len(low_qual)} low-quality leads")
    print(f"Already sent (this campaign): {len(sent_emails)}")
    print(f"Already sent (all campaigns): {sent_registry['total_sent']}")

    all_leads = [(b, "no-website") for b in no_site] + [(b, "low-quality-website") for b in low_qual]
    # Filter pending: skip if email is in sent_log OR in persistent sent registry
    pending = []
    for lead, t in all_leads:
        primary = (lead.get("emails") or [""])[0]
        if not primary:
            continue
        ne = norm_email(primary)
        if primary in sent_emails:
            continue  # already sent this campaign
        if ne in sent_normalized:
            continue  # already sent in a previous campaign
        pending.append((lead, t))

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
                # ALSO add to the persistent sent registry (cross-campaign dedup)
                add_sent_entry(sent_registry, result["recipient"],
                               result["subject"], name, lead_type)
                save_sent_registry(sent_registry)
                print(f"  ✓ SENT to {result['recipient']}  (+ added to sent registry)")
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
    print(f"Sent this run:   {len(log['sent'])}")
    print(f"Failed this run: {len(log['failed'])}")
    print(f"Total in sent registry: {sent_registry['total_sent']}")
    if log["failed"]:
        print("\nFailed leads:")
        for f in log["failed"]:
            print(f"  - {f['lead']}: {f['error']}")


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Send pitch emails via ProtonMail in Remote Chrome")
    p.add_argument("--delay", type=int, default=DELAY_BETWEEN_EMAILS,
                   help=f"Seconds between emails (default: {DELAY_BETWEEN_EMAILS})")
    args = p.parse_args()
    DELAY_BETWEEN_EMAILS = args.delay
    main()
