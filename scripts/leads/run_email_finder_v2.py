"""
Find emails for all leads using z-ai web_search (returns snippets with emails).

For each lead:
  1. z-ai function --name web_search "{name} {city} email contact"
  2. Parse snippets for emails
  3. (Has-website leads) Visit website + assess quality

Saves to: /home/z/my-project/download/leads/leads_with_emails.json
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

sys.path.insert(0, "/home/z/my-project/scripts/leads")
from email_finder_v2 import visit_website_for_email, clean_email, find_emails_in_html
from registry import (load_master, save_master, add_email_to_master,
                        load_sent, is_email_sent, norm_email, is_email_in_master)

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

RAW_FILE = "/home/z/my-project/download/leads/raw_listings.json"
RESULTS_FILE = "/home/z/my-project/download/leads/leads_with_emails.json"

TARGET_NO_SITE = 20
TARGET_LOW_QUALITY = 10
LOW_QUALITY_THRESHOLD = 70


def load_raw():
    with open(RAW_FILE) as f:
        data = json.load(f)
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


def zai_web_search(query, num=6, timeout=45):
    """Call z-ai function --name web_search via subprocess."""
    args = json.dumps({"query": query, "num": num})
    try:
        r = subprocess.run(
            ["z-ai", "function", "--name", "web_search", "--args", args],
            capture_output=True, text=True, timeout=timeout, cwd="/home/z/my-project"
        )
        # Output has emoji header lines, then JSON. Find the JSON array.
        out = r.stdout
        # Strip non-JSON prefix
        start = out.find("[")
        end = out.rfind("]")
        if start < 0 or end < 0:
            return []
        try:
            return json.loads(out[start:end+1])
        except Exception:
            return []
    except Exception as e:
        print(f"  z-ai error: {e}", file=sys.stderr)
        return []


def extract_emails_from_results(results):
    """Find emails in search result snippets + URLs."""
    emails = []
    for r in results:
        snippet = r.get("snippet", "") + " " + r.get("name", "")
        for m in EMAIL_RE.findall(snippet):
            e = clean_email(m)
            if e and e not in emails:
                emails.append(e)
    return emails


def find_business_email(name, query_hint, timeout=45):
    """Search z-ai for a business and extract emails from snippets."""
    q = f"{name} {query_hint} email contact"
    results = zai_web_search(q, num=6, timeout=timeout)
    emails = extract_emails_from_results(results)
    fb_url = None
    other_url = None
    for r in results:
        url = r.get("url", "") or ""
        host = urllib.parse.urlparse(url).hostname or ""
        if not fb_url and "facebook.com" in host:
            fb_url = url
        elif not other_url and not any(d in host for d in (
            "google.", "youtube.", "wikipedia.", "facebook.com",
            "instagram.com", "twitter.com", "linkedin.com", "yelp.")):
            other_url = url
    return emails, fb_url, other_url, results


def main():
    raw = load_raw()
    no_site = [b for b in raw if not b.get("hasWebsite")]
    has_site = [b for b in raw if b.get("hasWebsite")]
    print(f"Loaded {len(raw)} unique listings")
    print(f"  no-website: {len(no_site)} (target: {TARGET_NO_SITE})")
    print(f"  has-website: {len(has_site)} (target: {TARGET_LOW_QUALITY})")

    # Load the registries — we use these to skip leads whose emails we've
    # already discovered (master) or already pitched (sent).
    master = load_master()
    sent = load_sent()
    print(f"Registry: {master['total_discovered']} emails known, {sent['total_sent']} already sent")

    results = load_results()
    print(f"Resuming — {len(results['no_website'])} no-website + {len(results['has_website'])} has-website so far")

    def emails_already_known(emails):
        """Return True if the primary email is already in master or sent registry."""
        if not emails:
            return False
        primary = norm_email(emails[0])
        if not primary:
            return False
        return is_email_in_master(master, primary) or is_email_sent(sent, primary)

    def register_new_emails(lead):
        """Add a lead's emails to the master registry (persists across campaigns)."""
        name = lead.get("name", "")
        query = lead.get("_query", "")
        for e in lead.get("emails", []):
            add_email_to_master(master, e, name, query)
        save_master(master)

    # === NO-WEBSITE LEADS ===
    if len(results["no_website"]) < TARGET_NO_SITE:
        done = {(r["name"], r.get("phone")) for r in results["no_website"]}
        pending = [b for b in no_site if (b["name"], b.get("phone")) not in done]
        print(f"\n========== NO-WEBSITE LEADS ({len(pending)} pending) ==========")
        for i, b in enumerate(pending, 1):
            if len(results["no_website"]) >= TARGET_NO_SITE:
                break
            # Skip chains (Walmart, etc.)
            name = b["name"]
            if any(c in name.lower() for c in ("walmart", "target", "home depot", "lowe's", "costco")):
                continue
            print(f"\n[{i}/{len(pending)}] {name}")
            q_hint = b.get("_query", "").replace(name, "").strip()
            emails, fb_url, other_url, search_results = find_business_email(name, q_hint)
            print(f"  z-ai search → emails: {emails[:3]}")
            if not emails and other_url:
                # Try visiting the other_url (might be a directory page with email)
                print(f"  Visiting: {other_url[:60]}")
                visit_r = visit_website_for_email(other_url, max_paths=3)
                emails = visit_r.get("emails", [])
                print(f"    emails from visit: {emails[:3]}")
            if emails:
                # Skip if primary email is already known (master) or already pitched (sent)
                if emails_already_known(emails):
                    print(f"  ⊘ skipped — email already in registry (master/sent)")
                    continue
                b["emails"] = emails[:3]
                b["facebook_url"] = fb_url
                b["other_url"] = other_url
                b["lead_type"] = "no-website"
                results["no_website"].append(b)
                # Register the new emails in the master registry
                register_new_emails(b)
                print(f"  ✓ ADDED lead #{len(results['no_website'])}  (+ registered {len(emails[:3])} email(s) in master)")
                save_results(results)
            else:
                print(f"  ✗ no email found")
            time.sleep(1.0)  # polite delay

    # === HAS-WEBSITE (LOW QUALITY) LEADS ===
    if len(results["has_website"]) < TARGET_LOW_QUALITY:
        done = {(r["name"], r.get("phone")) for r in results["has_website"]}
        pending = [b for b in has_site if (b["name"], b.get("phone")) not in done]
        print(f"\n========== HAS-WEBSITE LEADS ({len(pending)} pending) ==========")
        for i, b in enumerate(pending, 1):
            if len(results["has_website"]) >= TARGET_LOW_QUALITY:
                break
            url = b.get("websiteUrl") or ""
            if not url or "google.com/maps" in url:
                continue
            print(f"\n[{i}/{len(pending)}] {b['name']} → {url[:60]}")
            # Visit website for quality + email
            visit_r = visit_website_for_email(url, max_paths=4)
            emails = visit_r.get("emails", [])
            score = visit_r.get("quality_score", 0)
            print(f"  visit → score={score} emails={emails[:3]}")
            # Also try z-ai search if no email found via website
            if not emails:
                q_hint = b.get("_query", "").replace(b["name"], "").strip()
                search_emails, _, _, _ = find_business_email(b["name"], q_hint)
                print(f"  z-ai search → emails: {search_emails[:3]}")
                if search_emails:
                    emails = search_emails
            if emails and score is not None and score < LOW_QUALITY_THRESHOLD:
                # Skip if primary email is already known or already pitched
                if emails_already_known(emails):
                    print(f"  ⊘ skipped — email already in registry (master/sent)")
                    continue
                b["emails"] = emails[:3]
                b["quality_score"] = score
                b["quality_reasons"] = visit_r.get("quality_reasons", [])
                b["website_title"] = visit_r.get("title")
                b["generator"] = visit_r.get("generator")
                b["copyright_year"] = visit_r.get("copyright_year")
                b["html_size"] = visit_r.get("html_size")
                b["is_https"] = visit_r.get("is_https")
                b["viewport_meta"] = visit_r.get("viewport_meta")
                b["lead_type"] = "low-quality-website"
                results["has_website"].append(b)
                # Register the new emails in the master registry
                register_new_emails(b)
                print(f"  ✓ ADDED lead #{len(results['has_website'])} (score={score})  (+ registered {len(emails[:3])} email(s) in master)")
                save_results(results)
            else:
                why = "no email" if not emails else f"score {score} too high"
                print(f"  ✗ skipped ({why})")
            time.sleep(0.8)

    print("\n========== FINAL ==========")
    print(f"no-website leads with emails: {len(results['no_website'])}")
    print(f"low-quality website leads with emails: {len(results['has_website'])}")
    save_results(results)


if __name__ == "__main__":
    main()
