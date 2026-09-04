"""
Run the email finder across all leads, building a CSV-ready results file.

Pipeline:
  1. Load raw_listings.json
  2. Split into no-website / has-website buckets
  3. For no-website leads: DuckDuckGo search to find email/Facebook/other
     → stop at 20 with emails
  4. For has-website leads: visit website, find email + quality score
     → stop at 10 with email + low quality (<70)

Saves results to: /home/z/my-project/download/leads/leads_with_emails.json
"""
import json
import os
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts/leads")
from cdp_driver import CDP
from email_finder import visit_website_for_email, find_email_via_ddg

RAW_FILE = "/home/z/my-project/download/leads/raw_listings.json"
RESULTS_FILE = "/home/z/my-project/download/leads/leads_with_emails.json"

# Targets
TARGET_NO_SITE = 20
TARGET_LOW_QUALITY = 10
LOW_QUALITY_THRESHOLD = 70  # quality_score < this = "low quality"


def load_raw():
    with open(RAW_FILE) as f:
        data = json.load(f)
    # Dedupe by (name, phone)
    seen = {}
    for b in data:
        key = (b.get("name", ""), b.get("phone") or "")
        if key not in seen:
            seen[key] = b
    return list(seen.values())


def load_results():
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE) as f:
            return json.load(f)
    return {"no_website": [], "has_website": []}


def save_results(results):
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


def main():
    raw = load_raw()
    print(f"Loaded {len(raw)} unique raw listings")

    no_site = [b for b in raw if not b.get("hasWebsite")]
    has_site = [b for b in raw if b.get("hasWebsite")]
    print(f"  no-website: {len(no_site)} (target: {TARGET_NO_SITE})")
    print(f"  has-website: {len(has_site)} (target: {TARGET_LOW_QUALITY})")

    results = load_results()
    print(f"Loaded {len(results['no_website'])} no-website results so far")
    print(f"Loaded {len(results['has_website'])} has-website results so far")

    cdp = CDP()

    try:
        # === NO-WEBSITE LEADS ===
        if len(results["no_website"]) < TARGET_NO_SITE:
            done_keys = {(r["name"], r.get("phone")) for r in results["no_website"]}
            pending = [b for b in no_site if (b["name"], b.get("phone")) not in done_keys]
            print(f"\n========== NO-WEBSITE LEADS ({len(pending)} pending) ==========")
            for i, b in enumerate(pending, 1):
                if len(results["no_website"]) >= TARGET_NO_SITE:
                    break
                q = f'{b["name"]} {b.get("_query","")}'
                print(f"\n[{i}/{len(pending)}] {b['name']}")
                try:
                    info = find_email_via_ddg(cdp, q, timeout_sec=10)
                    emails = info.get("emails", [])
                    fb = info.get('facebook_url') or ''
                    yp = info.get('yelp_url') or ''
                    ot = info.get('other_url') or ''
                    print(f"  DDG: emails={emails} fb={fb[:50]} yelp={yp[:50]} other={ot[:50]}")
                    if emails:
                        b["emails"] = emails
                        b["facebook_url"] = info.get("facebook_url")
                        b["yelp_url"] = info.get("yelp_url")
                        b["other_url"] = info.get("other_url")
                        b["lead_type"] = "no-website"
                        results["no_website"].append(b)
                        print(f"  ✓ ADDED lead #{len(results['no_website'])} with {len(emails)} email(s)")
                        save_results(results)
                    else:
                        print(f"  ✗ no email found — skipped")
                except Exception as e:
                    print(f"  ✗ error: {e}")
                    time.sleep(2)
                    try: cdp.close()
                    except: pass
                    cdp = CDP()
                time.sleep(1.0)

        # === HAS-WEBSITE (LOW QUALITY) LEADS ===
        if len(results["has_website"]) < TARGET_LOW_QUALITY:
            done_keys = {(r["name"], r.get("phone")) for r in results["has_website"]}
            pending = [b for b in has_site if (b["name"], b.get("phone")) not in done_keys]
            print(f"\n========== HAS-WEBSITE LEADS ({len(pending)} pending) ==========")
            for i, b in enumerate(pending, 1):
                if len(results["has_website"]) >= TARGET_LOW_QUALITY:
                    break
                url = b.get("websiteUrl") or ""
                if not url or "google.com/maps" in url:
                    continue
                print(f"\n[{i}/{len(pending)}] {b['name']} → {url[:60]}")
                try:
                    info = visit_website_for_email(cdp, url, timeout_sec=8)
                    emails = info.get("emails", [])
                    score = info.get("quality_score", 0)
                    reasons = info.get("quality_reasons", [])
                    print(f"  score={score} emails={emails} reasons={reasons}")
                    if emails and score is not None and score < LOW_QUALITY_THRESHOLD:
                        b["emails"] = emails
                        b["quality_score"] = score
                        b["quality_reasons"] = reasons
                        b["website_title"] = info.get("title")
                        b["generator"] = info.get("generator")
                        b["copyright_year"] = info.get("copyright_year")
                        b["html_size"] = info.get("html_size")
                        b["is_https"] = info.get("is_https")
                        b["viewport_meta"] = info.get("viewport_meta")
                        b["lead_type"] = "low-quality-website"
                        results["has_website"].append(b)
                        print(f"  ✓ ADDED lead #{len(results['has_website'])} (score={score}) with {len(emails)} email(s)")
                        save_results(results)
                    else:
                        why = "no email" if not emails else f"score {score} too high"
                        print(f"  ✗ skipped ({why})")
                except Exception as e:
                    print(f"  ✗ error: {e}")
                    time.sleep(2)
                    try: cdp.close()
                    except: pass
                    cdp = CDP()
                time.sleep(0.8)

        # === Final stats ===
        print("\n========== FINAL ==========")
        print(f"no-website leads with emails: {len(results['no_website'])}")
        print(f"low-quality website leads with emails: {len(results['has_website'])}")
        save_results(results)

    finally:
        cdp.close()


if __name__ == "__main__":
    main()
