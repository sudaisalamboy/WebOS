#!/usr/bin/env python3
"""Standalone send phase — sends pitches to schools in batch_schools.json.
Has resume support: skips already-sent emails."""
import sys, os, json, time
sys.path.insert(0, "/home/z/my-project/scripts/leads")
os.chdir("/home/z/my-project/scripts/leads")

from next_batch_robust import send_one_school_email, login
from registry import load_sent as load_sent_registry, save_sent as save_sent_registry, add_sent_entry, norm_email
from send_emails import eval_js

SCHOOLS_FILE = "/home/z/my-project/download/leads/batch_schools.json"
SENT_LOG = "/home/z/my-project/download/leads/batch_sent_log.json"
DELAY = 75

def main():
    login()
    # Navigate to ProtonMail inbox
    eval_js('window.location.href = "https://mail.proton.me/u/1/inbox"', await_promise=False, timeout=15)
    time.sleep(10)
    
    with open(SCHOOLS_FILE) as f:
        schools = json.load(f)
    print(f"Loaded {len(schools)} schools")
    
    sent_registry = load_sent_registry()
    sent_normalized = set(sent_registry["emails"].keys())
    
    if os.path.exists(SENT_LOG):
        with open(SENT_LOG) as f:
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
    
    print(f"Pending: {len(pending)} schools")
    print()
    
    sent_count = 0
    for i, school in enumerate(pending, 1):
        name = school.get("name", "")
        print(f"[{i}/{len(pending)}] {name}")
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
                print(f"  ✓ SENT to {result['recipient']}")
            else:
                log["failed"].append({"lead": name, "error": result.get("error","unknown"), "ts": int(time.time())})
                print(f"  ✗ FAILED: {result.get('error')}")
            with open(SENT_LOG, "w") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log["failed"].append({"lead": name, "error": f"exception: {str(e)[:120]}", "ts": int(time.time())})
            with open(SENT_LOG, "w") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
            print(f"  ✗ EXCEPTION: {e}")
            # Re-login + re-navigate
            login()
            eval_js('window.location.href = "https://mail.proton.me/u/1/inbox"', await_promise=False, timeout=15)
            time.sleep(10)
        
        if i < len(pending):
            print(f"  ... waiting {DELAY}s")
            time.sleep(DELAY)
    
    print()
    print(f"===== DONE =====")
    print(f"Sent this run: {sent_count}")
    print(f"Total sent (all): {sent_registry['total_sent']}")

if __name__ == "__main__":
    main()
