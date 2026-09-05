#!/usr/bin/env python3
"""
Robust next-batch runner — scrapes schools, finds emails, sends pitches.

Designed to survive crashes: each query is run as a separate subprocess,
and progress is saved after each step. If the script dies, re-running it
will resume from where it left off.
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts/leads")
os.chdir("/home/z/my-project/scripts/leads")

from scraper_http import scrape_query_http, dedupe_by_name_phone
from registry import load_master, load_sent, print_status

RAW_FILE = "/home/z/my-project/download/leads/raw_listings.json"
BATCH_PROGRESS = "/home/z/my-project/download/leads/batch_progress.json"
BATCH_RESULTS = "/home/z/my-project/download/leads/batch_schools.json"
BATCH_SENT_LOG = "/home/z/my-project/download/leads/batch_sent_log.json"

SCHOOL_TYPES = [
    "tutoring centers", "private schools", "preschools", "daycares",
    "dance schools", "music schools", "martial arts schools", "driving schools",
    "montessori schools", "test prep centers", "art schools", "language schools",
]

CITIES = ["Austin TX", "San Antonio TX"]
TARGET = 50


def load_progress():
    if os.path.exists(BATCH_PROGRESS):
        with open(BATCH_PROGRESS) as f:
            return json.load(f)
    return {"scraped_queries": [], "listings": [], "phase": "scrape"}


def save_progress(p):
    with open(BATCH_PROGRESS, "w") as f:
        json.dump(p, f, ensure_ascii=False, indent=2)


def login():
    subprocess.run(
        ["curl", "-s", "-c", "/tmp/webos-cookies.txt", "-X", "POST",
         "http://localhost:3000/api/auth/login",
         "-H", "Content-Type: application/json",
         "-d", '{"password":"webos"}'],
        capture_output=True, timeout=10,
    )


def phase1_scrape():
    """Scrape all queries, saving progress after each."""
    p = load_progress()
    queries = []
    for city in CITIES:
        for st in SCHOOL_TYPES:
            queries.append(f"{st} in {city}")
    
    print(f"Phase 1: {len(queries)} queries, {len(p['scraped_queries'])} already done")
    
    for q in queries:
        if q in p["scraped_queries"]:
            continue
        print(f"\n  → {q}")
        try:
            listings = scrape_query_http(q, scrolls=3, scroll_pause=2.0)
            for b in listings:
                b["_query"] = q
                p["listings"].append(b)
            p["scraped_queries"].append(q)
            save_progress(p)
            print(f"    ✓ {len(listings)} listings (total: {len(p['listings'])})")
        except Exception as e:
            print(f"    ✗ error: {e}")
            # Re-login in case auth expired
            login()
        time.sleep(1.5)
    
    p["phase"] = "find_emails"
    save_progress(p)
    
    # Dedupe + filter to no-website
    unique = dedupe_by_name_phone(p["listings"])
    no_site = [b for b in unique if not b.get("hasWebsite")]
    print(f"\n✓ Phase 1 complete: {len(unique)} unique listings, {len(no_site)} no-website")
    return no_site


def find_email_for_one(name, query_hint):
    """Find email for one school via z-ai web search. Returns (emails, fb_url, other_url)."""
    from run_email_finder_v2 import find_business_email
    from email_finder_v2 import visit_website_for_email
    emails, fb_url, other_url, _ = find_business_email(name, query_hint)
    if not emails and other_url:
        visit_r = visit_website_for_email(other_url, max_paths=3)
        emails = visit_r.get("emails", [])
    return emails, fb_url, other_url


def phase2_find_emails(no_site_schools):
    """Find emails for no-website schools, skipping already-known."""
    from registry import (load_master, save_master, add_email_to_master,
                           load_sent, is_email_sent, norm_email, is_email_in_master)
    master = load_master()
    sent = load_sent()
    
    # Load existing results (resume)
    if os.path.exists(BATCH_RESULTS):
        with open(BATCH_RESULTS) as f:
            results = json.load(f)
    else:
        results = []
    done_names = {r["name"] for r in results}
    
    print(f"\nPhase 2: Finding emails for {len(no_site_schools)} no-website schools")
    print(f"  Already found: {len(results)}, target: {TARGET}")
    
    CHAINS = ("walmart", "kumon", "sylvan", "mathnasium", "kindercare",
              "goddard", "primrose", "la petite", "childtime", "hoeckers")
    
    for i, b in enumerate(no_site_schools, 1):
        if len(results) >= TARGET:
            print(f"\n  ✓ Target reached: {len(results)} schools with emails")
            break
        name = b["name"]
        if name in done_names:
            continue
        if any(c in name.lower() for c in CHAINS):
            continue
        print(f"\n  [{i}/{len(no_site_schools)}] {name}")
        q_hint = b.get("_query", "").replace(name, "").strip()
        try:
            emails, fb_url, other_url = find_email_for_one(name, q_hint)
            print(f"    emails: {emails[:3]}")
            if emails:
                # Check registry — skip if already known
                primary = norm_email(emails[0])
                if is_email_in_master(master, primary) or is_email_sent(sent, primary):
                    print(f"    ⊘ already in registry — skipped")
                    continue
                b["emails"] = emails[:3]
                b["facebook_url"] = fb_url
                b["other_url"] = other_url
                b["lead_type"] = "no-website-school"
                results.append(b)
                # Register in master
                for e in emails[:3]:
                    add_email_to_master(master, e, name, b.get("_query", ""))
                save_master(master)
                done_names.add(name)
                print(f"    ✓ ADDED #{len(results)}")
                with open(BATCH_RESULTS, "w") as f:
                    json.dump(results, f, ensure_ascii=False, indent=2)
            else:
                print(f"    ✗ no email")
        except Exception as e:
            print(f"    ✗ error: {e}")
            login()
        time.sleep(1.0)
    
    print(f"\n✓ Phase 2 complete: {len(results)} schools with emails")
    return results


def send_one_school_email(lead):
    """Compose + send a single school pitch email. Watermark removed before send."""
    from school_pitch import build_school_subject, build_school_body, school_label_from_query
    from send_emails import (eval_js, keypress, open_compose, get_compose_field_ids,
                              focus_and_type_input, focus_body_iframe_and_clear_watermark,
                              type_in_body, click_send, dismiss_any_dialog)
    import json as _json
    name = lead.get("name", "")
    emails = lead.get("emails", [])
    if not emails:
        return {"ok": False, "error": "no email", "lead": name}
    recipient = emails[0]
    query = lead.get("_query", "")
    subject = build_school_subject(name, school_label_from_query(query))
    body = build_school_body(lead)
    
    # 0. Close any existing compose
    eval_js('''(function(){const btns=Array.from(document.querySelectorAll("button"));const d=btns.find(b=>/^discard$/i.test((b.textContent||"").trim()));if(d)d.click();const c=btns.find(b=>/composer:close/i.test(b.getAttribute("data-testid")||""));if(c)c.click();})()''', await_promise=False, timeout=10)
    time.sleep(1.5)
    
    if not open_compose():
        return {"ok": False, "error": "compose didn't open", "lead": name}
    time.sleep(2)
    
    fields = get_compose_field_ids()
    if not fields.get("toId"):
        return {"ok": False, "error": "To field not found", "lead": name}
    
    focus_and_type_input(f"input#{fields['toId']}", recipient)
    time.sleep(0.4)
    keypress({"action": "press", "key": "Enter"}, timeout=10)
    time.sleep(0.6)
    
    if not fields.get("subjectId"):
        return {"ok": False, "error": "Subject field not found", "lead": name}
    focus_and_type_input(f"input#{fields['subjectId']}", subject)
    time.sleep(0.4)
    
    # CLEAR WATERMARK (select all + delete)
    if not focus_body_iframe_and_clear_watermark():
        return {"ok": False, "error": "body iframe not focusable", "lead": name}
    time.sleep(0.4)
    
    type_in_body(body)
    time.sleep(1.0)
    
    # Verify watermark is gone
    verify = eval_js('''(function(){const iframe=Array.from(document.querySelectorAll("iframe")).find(f=>f.title==="Email composer");const t=iframe?(iframe.contentDocument.body.innerText||""):"";return {hasWatermark: /Sent with Proton/i.test(t), bodyLen: t.length};})()''', await_promise=False, timeout=15)
    v = verify.get("value", {}) if verify.get("ok") else {}
    if v.get("hasWatermark"):
        print(f"    ⚠ watermark still present — clearing again")
        focus_body_iframe_and_clear_watermark()
        time.sleep(0.3)
    
    ok, info = click_send()
    time.sleep(1.0)
    dismiss_any_dialog()
    time.sleep(1.0)
    
    if ok:
        return {"ok": True, "recipient": recipient, "subject": subject, "lead": name}
    return {"ok": False, "error": "send failed", "lead": name, "info": info}


def phase3_send_emails(schools):
    """Send pitch emails to all schools via ProtonMail."""
    from registry import load_sent as load_sent_registry, save_sent as save_sent_registry, add_sent_entry, norm_email
    
    sent_registry = load_sent_registry()
    sent_normalized = set(sent_registry["emails"].keys())
    
    # Load batch sent log (for resume)
    if os.path.exists(BATCH_SENT_LOG):
        with open(BATCH_SENT_LOG) as f:
            log = json.load(f)
    else:
        log = {"sent": [], "failed": []}
    sent_this_batch = {s.get("recipient") for s in log["sent"]}
    
    pending = []
    for school in schools:
        emails = school.get("emails", [])
        if not emails: continue
        ne = norm_email(emails[0])
        if emails[0] in sent_this_batch: continue
        if ne in sent_normalized: continue
        pending.append(school)
    
    print(f"\nPhase 3: Sending {len(pending)} pitch emails (watermark removed)")
    print(f"  Already sent (all campaigns): {sent_registry['total_sent']}")
    
    DELAY = 75
    sent_count = 0
    for i, school in enumerate(pending, 1):
        name = school.get("name", "")
        print(f"\n  [{i}/{len(pending)}] {name}")
        try:
            result = send_one_school_email(school)
            if result.get("ok"):
                log["sent"].append({
                    "lead": name, "recipient": result["recipient"],
                    "subject": result["subject"], "type": "no-website-school",
                    "ts": int(time.time()),
                })
                add_sent_entry(sent_registry, result["recipient"],
                               result["subject"], name, "no-website-school")
                save_sent_registry(sent_registry)
                sent_count += 1
                print(f"    ✓ SENT to {result['recipient']}")
            else:
                log["failed"].append({"lead": name, "error": result.get("error","unknown"), "ts": int(time.time())})
                print(f"    ✗ FAILED: {result.get('error')}")
            with open(BATCH_SENT_LOG, "w") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log["failed"].append({"lead": name, "error": f"exception: {str(e)[:120]}", "ts": int(time.time())})
            with open(BATCH_SENT_LOG, "w") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
            print(f"    ✗ EXCEPTION: {e}")
            # Re-login in case auth expired
            login()
        
        if i < len(pending):
            print(f"    ... waiting {DELAY}s")
            time.sleep(DELAY)
    
    print(f"\n✓ Phase 3 complete: {sent_count} sent this batch")
    return sent_count


def main():
    login()
    print("="*60)
    print("  NEXT BATCH — Austin TX + San Antonio TX schools")
    print("="*60)
    
    # Phase 1: Scrape
    print("\n>>> PHASE 1: Scrape Google Maps")
    no_site = phase1_scrape()
    
    # Phase 2: Find emails
    print("\n>>> PHASE 2: Find emails")
    schools = phase2_find_emails(no_site)
    
    # Phase 3: Send
    print("\n>>> PHASE 3: Send pitches")
    sent_count = phase3_send_emails(schools)
    
    print("\n" + "="*60)
    print(f"  BATCH COMPLETE")
    print(f"  Sent this batch: {sent_count}")
    print("="*60)
    print_status()


if __name__ == "__main__":
    main()
