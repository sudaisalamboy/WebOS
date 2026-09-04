"""
Find contact emails for August 2026 startups (TechCrunch Battlefield 200 + YC S26).
For each startup, visit their website and look for: founder email, contact@,
jobs@, careers@, hello@, info@, team@. Then dedupe against master + sent registries.
"""
import json
import os
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

sys.path.insert(0, "/home/z/my-project/scripts/leads")
from email_finder_v2 import visit_website_for_email, clean_email, find_emails_in_html
from registry import (load_master, save_master, add_email_to_master,
                       load_sent, is_email_sent, is_email_in_master, norm_email)

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}

# Sources
TC_FILE = "/home/z/my-project/download/startups/tc_battlefield_raw.json"
YC_FILE = "/home/z/my-project/download/startups/yc_s26_raw.json"
OUT_FILE = "/home/z/my-project/download/startups/startups_with_emails.json"

# Domains to skip (not actual startups — newsletters, social, etc.)
SKIP_DOMAINS = (
    "strictlyvc.com", "extruct.ai", "calendly.com", "ycombinator.com",
    "techcrunch.com", "google.com", "facebook.com", "twitter.com", "x.com",
    "linkedin.com", "youtube.com", "instagram.com", "wp.com", "gravatar.com",
    "gstatic.com", "googleapis.com", "schema.org", "wikipedia.org",
    "medium.com", "substack.com", "github.com", "gitlab.com",
    "apple.com", "microsoft.com", "amazon.com", "play.google.com",
)

# Email patterns that suggest job-relevant contacts
JOB_EMAIL_PRIORITY = (
    "jobs@", "careers@", "hiring@", "talent@", "hr@",
    "founder@", "ceo@", "cto@", "coo@", "team@",
    "hello@", "hi@", "contact@", "info@", "support@",
    "general@", "office@", "admin@",
)


def load_startups():
    """Load + merge both startup lists, filter out non-startups."""
    all_startups = []
    seen_hosts = set()

    for fname, source in [(TC_FILE, "TechCrunch Battlefield 200"), (YC_FILE, "YC S26")]:
        if not os.path.exists(fname):
            continue
        with open(fname) as f:
            entries = json.load(f)
        for e in entries:
            host = e.get("host", "").lower().lstrip("www.")
            if not host or host in seen_hosts:
                continue
            if any(d in host for d in SKIP_DOMAINS):
                continue
            # Skip generic TLDs / single-word hosts that look like nav items
            text = e.get("text", "").strip()
            if not text or len(text) > 80:
                continue
            # Skip if the "name" looks like a UI element
            if text.lower() in ("book a call", "learn more", "read more", "sign up", "get started", "contact", "home"):
                continue
            seen_hosts.add(host)
            all_startups.append({
                "name": text,
                "website_url": e.get("url", ""),
                "host": host,
                "source": source,
            })
    return all_startups


def find_startup_email(startup, timeout=8):
    """Visit a startup's website, find contact email + basic info.
    Returns {startup, email, all_emails, title, has_careers_page}."""
    url = startup["website_url"]
    if not url:
        return None
    result = {
        "name": startup["name"],
        "website_url": url,
        "host": startup["host"],
        "source": startup["source"],
        "emails": [],
        "title": None,
        "has_careers_page": False,
        "error": None,
    }
    try:
        visit_r = visit_website_for_email(url, max_paths=5)
        result["emails"] = visit_r.get("emails", [])[:5]
        result["title"] = visit_r.get("title")
        # Check if there's a careers/jobs page
        careers_paths = ["/careers", "/jobs", "/join", "/join-us", "/about/careers", "/team"]
        base = url.rstrip("/")
        for path in careers_paths:
            try:
                r = requests.get(base + path, headers=HEADERS, timeout=5, allow_redirects=True)
                if r.status_code == 200 and len(r.text) > 1000:
                    result["has_careers_page"] = True
                    # Look for jobs@/careers@ emails on the careers page
                    for e in find_emails_in_html(r.text):
                        if e not in result["emails"]:
                            result["emails"].append(e)
                    break
            except Exception:
                continue
    except Exception as e:
        result["error"] = str(e)[:80]
    return result


def pick_best_job_email(emails):
    """Pick the most relevant email for job applications."""
    if not emails:
        return None
    # Priority: jobs@, careers@, founder@, ceo@, cto@, team@, hello@, contact@, info@
    for prefix in JOB_EMAIL_PRIORITY:
        for e in emails:
            if e.lower().startswith(prefix):
                return e
    # Otherwise return the first one
    return emails[0]


def main():
    # 1. Load all startups
    startups = load_startups()
    print(f"Loaded {len(startups)} unique startups from TechCrunch + YC S26")
    print(f"  Sources: {sum(1 for s in startups if s['source']=='TechCrunch Battlefield 200')} TC + {sum(1 for s in startups if s['source']=='YC S26')} YC")
    print()

    # 2. Load registries
    master = load_master()
    sent = load_sent()
    print(f"Registry: {master['total_discovered']} emails known, {sent['total_sent']} already sent")
    print()

    # 3. Find emails for each startup (sequential — polite, ~8s per site)
    results = []
    already_known = 0
    new_found = 0
    no_email = 0

    print("Visiting startup websites to find contact emails...")
    print("(this will take ~10-15 min for all startups)")
    print()

    for i, startup in enumerate(startups, 1):
        # Quick check: is the host already in master? Skip if so
        # (we check by trying to find any email with this host)
        print(f"[{i}/{len(startups)}] {startup['name'][:35]:35s} → {startup['website_url'][:50]}", end="", flush=True)

        r = find_startup_email(startup)
        if not r:
            print("  ✗ skip")
            continue

        emails = r["emails"]
        if not emails:
            print(f"  ✗ no email")
            no_email += 1
            results.append(r)
            continue

        # Check if primary email is already in master or sent
        primary = pick_best_job_email(emails)
        ne = norm_email(primary)
        if is_email_sent(sent, ne):
            print(f"  ⊘ already-sent: {primary}")
            already_known += 1
            continue
        if is_email_in_master(master, ne):
            print(f"  ⊘ in-master: {primary}")
            already_known += 1
            continue

        print(f"  ✓ {primary}")
        r["primary_email"] = primary
        # Register in master
        add_email_to_master(master, primary, startup["name"], f"startup-{startup['source']}")
        new_found += 1
        results.append(r)
        # Save master periodically
        if new_found % 5 == 0:
            save_master(master)

    save_master(master)

    # 4. Save results
    with open(OUT_FILE, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # 5. Filter to only startups with findable + unique emails
    unique_targets = [r for r in results if r.get("primary_email")]
    with open(OUT_FILE.replace(".json", "_unique.json"), "w") as f:
        json.dump(unique_targets, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 60)
    print(f"  Total startups processed : {len(startups)}")
    print(f"  New emails found         : {new_found}")
    print(f"  Already known (skipped)   : {already_known}")
    print(f"  No email found           : {no_email}")
    print(f"  Unique targets ready     : {len(unique_targets)}")
    print()
    print(f"  Results saved to: {OUT_FILE}")
    print(f"  Unique targets:  {OUT_FILE.replace('.json', '_unique.json')}")


if __name__ == "__main__":
    main()
