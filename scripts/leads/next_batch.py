#!/usr/bin/env python3
"""
next_batch.py — Reusable "next batch" pipeline for school leads.

When the user says "next batch" on chat, run this script. It will:
  1. Scrape Google Maps for school-type queries in a fresh city
  2. Filter to NO-WEBSITE schools only
  3. Find emails for each (z-ai web search + website visit)
  4. Skip any school whose email is already in master/sent registry (dedup)
  5. Send pitch emails to the unique new schools via ProtonMail
  6. Remove the "Sent with Proton Mail" watermark before each send
  7. Target: 50 schools per batch

Usage:
  python3 next_batch.py                          # Default: Austin TX + San Antonio TX
  python3 next_batch.py --city "Phoenix AZ"      # Single city
  python3 next_batch.py --target 30               # Custom target count
  python3 next_batch.py --scrape-only             # Scrape + find emails, don't send
"""
import argparse
import json
import os
import subprocess
import sys
import time

# Ensure our scripts dir is on the path regardless of how we're invoked
SCRIPTS_DIR = "/home/z/my-project/scripts/leads"
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)
# Also set cwd so relative imports work
os.chdir(SCRIPTS_DIR)

from cdp_driver import CDP
from scraper import scrape_query, dedupe_by_name_phone as _dedupe
from scraper_http import scrape_query_http, dedupe_by_name_phone, eval_js as http_eval_js
from email_finder_v2 import visit_website_for_email, clean_email
from run_email_finder_v2 import find_business_email
from registry import (load_master, save_master, add_email_to_master,
                       load_sent, save_sent, add_sent_entry, norm_email,
                       is_email_sent, is_email_in_master, print_status)
from school_pitch import build_school_subject, build_school_body, school_label_from_query
from send_emails import (
    COOKIE_FILE, eval_js, keypress, open_compose, get_compose_field_ids,
    focus_and_type_input, focus_body_iframe_and_clear_watermark, type_in_body,
    click_send, dismiss_any_dialog,
)

# School-type queries (rotated across batches)
SCHOOL_TYPES = [
    "tutoring centers", "private schools", "preschools", "daycares",
    "dance schools", "music schools", "martial arts schools", "driving schools",
    "montessori schools", "test prep centers", "art schools", "language schools",
    "yoga studios", "gymnastics schools", "acting schools", "cooking schools",
    "beauty schools", "swim schools",
]

# Cities to rotate through (one batch = one city, or two for bigger batches)
BATCH_CITIES = [
    ["Austin TX", "San Antonio TX"],   # Batch 1
    ["Phoenix AZ", "Tucson AZ"],        # Batch 2
    ["Denver CO", "Colorado Springs CO"],  # Batch 3
    ["Nashville TN", "Memphis TN"],     # Batch 4
    ["Charlotte NC", "Raleigh NC"],     # Batch 5
    ["Indianapolis IN", "Fort Wayne IN"],  # Batch 6
    ["Kansas City MO", "St Louis MO"],  # Batch 7
    ["Omaha NE", "Lincoln NE"],         # Batch 8
    ["Albuquerque NM", "Santa Fe NM"],  # Batch 9
    ["Birmingham AL", "Montgomery AL"], # Batch 10
]

RAW_FILE = "/home/z/my-project/download/leads/raw_listings.json"
BATCH_RESULTS = "/home/z/my-project/download/leads/batch_schools.json"
BATCH_SENT_LOG = "/home/z/my-project/download/leads/batch_sent_log.json"

DEFAULT_TARGET = 50
DELAY_BETWEEN_EMAILS = 75


def step(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}\n")


def emails_already_known(master, sent, emails):
    if not emails: return False
    primary = norm_email(emails[0])
    if not primary: return False
    return is_email_in_master(master, primary) or is_email_sent(sent, primary)


def register_new_emails(master, lead):
    name = lead.get("name", "")
    query = lead.get("_query", "")
    for e in lead.get("emails", []):
        add_email_to_master(master, e, name, query)
    save_master(master)


def phase1_scrape(cities, school_types):
    """Scrape Google Maps for schools in the given cities (HTTP-based, reliable)."""
    queries = []
    for city in cities:
        for st in school_types:
            queries.append(f"{st} in {city}")
    print(f"Phase 1: Scraping {len(queries)} queries across {len(cities)} city(ies)")
    print(f"  Cities: {cities}")
    print(f"  School types: {len(school_types)}")
    
    all_listings = []
    for i, q in enumerate(queries, 1):
        print(f"\n  [{i}/{len(queries)}] {q}")
        try:
            listings = scrape_query_http(q, scrolls=3, scroll_pause=2.0)
            for b in listings:
                b["_query"] = q
            all_listings.extend(listings)
        except Exception as e:
            print(f"    ✗ error: {e}")
        time.sleep(1.0)
    
    unique = dedupe_by_name_phone(all_listings)
    print(f"\n  Scraped {len(unique)} unique listings")
    
    # Append to raw_listings.json
    if os.path.exists(RAW_FILE):
        with open(RAW_FILE) as f:
            existing = json.load(f)
        existing_keys = {(b.get("name",""), b.get("phone") or "") for b in existing}
        new_unique = [b for b in unique if (b.get("name",""), b.get("phone") or "") not in existing_keys]
        all_data = existing + new_unique
    else:
        all_data = unique
        new_unique = unique
    with open(RAW_FILE, "w") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    print(f"  + {len(new_unique)} new listings added to raw_listings.json (total: {len(all_data)})")
    
    # Filter to no-website schools
    no_site = [b for b in unique if not b.get("hasWebsite")]
    print(f"  No-website schools: {len(no_site)} (TARGET)")
    return no_site


def phase2_find_emails(no_site_schools, target=50):
    """Find emails for no-website schools using z-ai web search + site visits."""
    master = load_master()
    sent = load_sent()
    print(f"\nPhase 2: Finding emails for {len(no_site_schools)} no-website schools")
    print(f"  Registry: {master['total_discovered']} emails known, {sent['total_sent']} already sent")
    print(f"  Target: {target} schools with emails")
    
    results = []
    # Skip chains
    CHAINS = ("walmart", "target", "kumon", "sylvan", "mathnasium", "hoeckers",
              "kindercare", "goddard", "primrose", "la petite", "childtime")
    
    for i, b in enumerate(no_site_schools, 1):
        if len(results) >= target:
            print(f"\n  ✓ Target reached: {len(results)} schools with emails")
            break
        name = b["name"]
        if any(c in name.lower() for c in CHAINS):
            continue
        print(f"\n  [{i}/{len(no_site_schools)}] {name}")
        q_hint = b.get("_query", "").replace(name, "").strip()
        emails, fb_url, other_url, _ = find_business_email(name, q_hint)
        print(f"    z-ai → {emails[:3]}")
        if not emails and other_url:
            visit_r = visit_website_for_email(other_url, max_paths=3)
            emails = visit_r.get("emails", [])
            print(f"    visit → {emails[:3]}")
        if emails:
            if emails_already_known(master, sent, emails):
                print(f"    ⊘ skipped — already in registry")
                continue
            b["emails"] = emails[:3]
            b["facebook_url"] = fb_url
            b["other_url"] = other_url
            b["lead_type"] = "no-website-school"
            results.append(b)
            register_new_emails(master, b)
            print(f"    ✓ ADDED #{len(results)}  (+ registered in master)")
            with open(BATCH_RESULTS, "w") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
        else:
            print(f"    ✗ no email")
        time.sleep(1.0)
    
    print(f"\n  Final: {len(results)} schools with emails ready to pitch")
    return results


def phase3_send_emails(schools, delay=75):
    """Send pitch emails to all schools via ProtonMail (watermark removed)."""
    # Login refresh
    subprocess.run(
        ["curl", "-s", "-c", COOKIE_FILE, "-X", "POST",
         "http://localhost:3000/api/auth/login",
         "-H", "Content-Type: application/json",
         "-d", '{"password":"webos"}'],
        capture_output=True, timeout=10,
    )
    
    # Verify ProtonMail is logged in
    r = eval_js('({url: window.location.href, loggedIn: /mail\\.proton\\.me\\/u\\//.test(window.location.href)})', await_promise=False, timeout=20)
    state = r.get("value", {}) if r.get("ok") else {}
    if not state.get("loggedIn"):
        print(f"\n  ⚠ ProtonMail not logged in! URL: {state.get('url','?')}")
        print(f"  Please log in via the VNC browser (Remote Chrome app), then re-run with --send-only")
        return 0
    
    # Navigate to inbox if not already
    if "inbox" not in state.get("url", ""):
        eval_js('window.location.href = "https://mail.proton.me/u/1/inbox"', await_promise=False, timeout=15)
        time.sleep(8)
    
    sent_registry = load_sent()
    sent_normalized = set(sent_registry["emails"].keys())
    
    # Load batch sent log (for resume)
    if os.path.exists(BATCH_SENT_LOG):
        with open(BATCH_SENT_LOG) as f:
            log = json.load(f)
    else:
        log = {"sent": [], "failed": []}
    sent_this_batch = {s.get("recipient") for s in log["sent"]}
    
    # Filter to pending
    pending = []
    for school in schools:
        emails = school.get("emails", [])
        if not emails: continue
        ne = norm_email(emails[0])
        if emails[0] in sent_this_batch: continue
        if ne in sent_normalized: continue
        pending.append(school)
    
    print(f"\nPhase 3: Sending {len(pending)} pitch emails (delay: {delay}s)")
    print(f"  Already sent (all campaigns): {sent_registry['total_sent']}")
    print(f"  Watermark removal: enabled (execCommand selectAll+delete)")
    
    sent_count = 0
    for i, school in enumerate(pending, 1):
        name = school.get("name", "")
        print(f"\n  [{i}/{len(pending)}] {name}")
        try:
            result = send_one_school_email(school)
            if result.get("ok"):
                log["sent"].append({
                    "lead": name,
                    "recipient": result["recipient"],
                    "subject": result["subject"],
                    "type": "no-website-school",
                    "ts": int(time.time()),
                })
                add_sent_entry(sent_registry, result["recipient"],
                               result["subject"], name, "no-website-school")
                save_sent_registry(sent_registry)
                sent_count += 1
                print(f"    ✓ SENT to {result['recipient']}  (+ sent registry)")
            else:
                log["failed"].append({
                    "lead": name,
                    "error": result.get("error", "unknown"),
                    "ts": int(time.time()),
                })
                print(f"    ✗ FAILED: {result.get('error')}")
            with open(BATCH_SENT_LOG, "w") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log["failed"].append({"lead": name, "error": f"exception: {str(e)[:120]}", "ts": int(time.time())})
            with open(BATCH_SENT_LOG, "w") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
            print(f"    ✗ EXCEPTION: {e}")
        
        if i < len(pending):
            print(f"    ... waiting {delay}s")
            time.sleep(delay)
    
    print(f"\n  Sent this batch: {sent_count}")
    return sent_count


def send_one_school_email(lead):
    """Compose + send a single school pitch email. Watermark is removed before typing body."""
    name = lead.get("name", "")
    emails = lead.get("emails", [])
    if not emails:
        return {"ok": False, "error": "no email", "lead": name}
    recipient = emails[0]
    query = lead.get("_query", "")
    subject = build_school_subject(name, school_label_from_query(query))
    body = build_school_body(lead)
    
    # 0. Close any existing compose modal (cleanup from previous failure)
    eval_js('''(function(){
      const btns = Array.from(document.querySelectorAll("button"));
      const discard = btns.find(b => /^discard$/i.test((b.textContent || "").trim()));
      if (discard) { discard.click(); return "discarded"; }
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
    
    # 3. Type recipient email + Enter to commit chip
    focus_and_type_input(f"input#{fields['toId']}", recipient)
    time.sleep(0.4)
    keypress({"action": "press", "key": "Enter"}, timeout=10)
    time.sleep(0.6)
    
    # 4. Type subject
    if not fields.get("subjectId"):
        return {"ok": False, "error": "Subject field not found", "lead": name}
    focus_and_type_input(f"input#{fields['subjectId']}", subject)
    time.sleep(0.4)
    
    # 5. Clear body watermark (SELECT ALL + DELETE — removes "Sent with Proton Mail")
    if not focus_body_iframe_and_clear_watermark():
        return {"ok": False, "error": "body iframe not focusable", "lead": name}
    time.sleep(0.4)
    
    # 6. Type body
    type_in_body(body)
    time.sleep(1.0)
    
    # 7. Verify watermark is gone
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
        print(f"    ⚠ Watermark still present — clearing again")
        focus_body_iframe_and_clear_watermark()
        time.sleep(0.3)
    
    # 8. Click Send
    ok, info = click_send()
    time.sleep(1.0)
    dismiss_any_dialog()
    time.sleep(1.0)
    
    if ok:
        return {"ok": True, "recipient": recipient, "subject": subject, "lead": name}
    return {"ok": False, "error": "send button click failed", "lead": name, "info": info}


def main():
    p = argparse.ArgumentParser(description="Next batch: scrape 50 no-website schools + pitch them")
    p.add_argument("--city", help="Single city (e.g. 'Phoenix AZ'). Default: rotate from BATCH_CITIES")
    p.add_argument("--target", type=int, default=DEFAULT_TARGET, help=f"Target count (default: {DEFAULT_TARGET})")
    p.add_argument("--delay", type=int, default=DELAY_BETWEEN_EMAILS, help=f"Delay between emails (default: {DELAY_BETWEEN_EMAILS})")
    p.add_argument("--scrape-only", action="store_true", help="Scrape + find emails, don't send")
    p.add_argument("--send-only", action="store_true", help="Send pitches to existing batch_schools.json, skip scraping")
    args = p.parse_args()
    
    # Show starting state
    master = load_master()
    sent = load_sent()
    step(f"NEXT BATCH — STARTING\n  Known emails: {master['total_discovered']}\n  Already sent: {sent['total_sent']}\n  Target: {args.target} new schools")
    
    # Determine cities for this batch
    if args.city:
        cities = [args.city]
    else:
        # Rotate: pick the first city-pair not yet scraped (based on raw_listings.json)
        with open(RAW_FILE) as f:
            raw = json.load(f)
        done_queries = {b.get("_query", "") for b in raw}
        for pair in BATCH_CITIES:
            already = any(any(city in q for city in pair) for q in done_queries)
            if not already:
                cities = pair
                break
        else:
            cities = BATCH_CITIES[0]  # fallback
    
    if not args.send_only:
        # Phase 1: Scrape
        step(f"PHASE 1: Scrape Google Maps\n  Cities: {cities}")
        no_site_schools = phase1_scrape(cities, SCHOOL_TYPES[:12])  # first 12 school types
        
        # Phase 2: Find emails
        step(f"PHASE 2: Find emails (target: {args.target})")
        schools = phase2_find_emails(no_site_schools, target=args.target)
    else:
        with open(BATCH_RESULTS) as f:
            schools = json.load(f)
        print(f"Loaded {len(schools)} schools from {BATCH_RESULTS}")
    
    if args.scrape_only:
        step(f"DONE (scrape-only)\n  Schools with emails: {len(schools)}\n  Review {BATCH_RESULTS} then run with --send-only")
        print_status()
        return
    
    if len(schools) == 0:
        print("\n  ✗ No new schools to pitch — all already sent!")
        return
    
    # Phase 3: Send
    step(f"PHASE 3: Send pitches ({len(schools)} schools)")
    sent_count = phase3_send_emails(schools, delay=args.delay)
    
    # Final
    master = load_master()
    sent = load_sent()
    step(f"BATCH COMPLETE\n  Sent this batch: {sent_count}\n  Total sent (all): {sent['total_sent']}\n  Master emails: {master['total_discovered']}")
    print_status()


if __name__ == "__main__":
    main()
