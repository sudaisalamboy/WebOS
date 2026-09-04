#!/usr/bin/env python3
"""
find_and_pitch.py — Master pipeline for finding new leads and pitching them.

This is the one-command entry point. It:
  1. Loads the master + sent registries (persistent dedup state)
  2. Scrapes Google Maps for the queries you specify
  3. For each new business found, runs the email finder (z-ai web search + site visit)
  4. Filters out leads whose emails are already in master (already discovered)
     or already in sent registry (already pitched)
  5. Sends pitch emails to the unique new leads
  6. Updates both registries throughout

Usage:
  # Default: scrape a few US cities (lawn care + cleaning)
  python3 find_and_pitch.py

  # Custom queries
  python3 find_and_pitch.py --queries "plumbers in Denver CO" "roofers in Tampa FL"

  # Scrape only (don't send emails yet — review leads first)
  python3 find_and_pitch.py --scrape-only

  # Send only (use existing leads_with_emails.json, skip scraping)
  python3 find_and_pitch.py --send-only

  # Set targets
  python3 find_and_pitch.py --no-website 5 --low-quality 3

  # Use a different delay between emails (seconds)
  python3 find_and_pitch.py --delay 90
"""
import argparse
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts/leads")

from registry import (load_master, load_sent, save_master, save_sent,
                       add_email_to_master, add_sent_entry, norm_email,
                       is_email_in_master, is_email_sent, print_status)

# Default queries (small US cities, service businesses prone to no-website)
DEFAULT_QUERIES = [
    "lawn care service Asheville NC",
    "house cleaning Burlington VT",
    "mobile car detailing Bend OR",
    "handyman Savannah GA",
    "pressure washing Flagstaff AZ",
    "landscaping Bozeman MT",
    "tree service Missoula MT",
    "dog walker Boulder CO",
    "fence contractor Eugene OR",
    "junk removal Ithaca NY",
]

RAW_FILE = "/home/z/my-project/download/leads/raw_listings.json"
RESULTS_FILE = "/home/z/my-project/download/leads/leads_with_emails.json"


def step(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}\n")


def run_scraper(queries):
    """Run the Google Maps scraper for the given queries."""
    from cdp_driver import CDP
    from scraper import scrape_query, dedupe_by_name_phone
    cdp = CDP()
    all_listings = []
    try:
        for q in queries:
            print(f"  → {q}")
            listings = scrape_query(cdp, q, scrolls=4, scroll_pause=2.0)
            for b in listings:
                b["_query"] = q
            all_listings.extend(listings)
            time.sleep(1.5)
    finally:
        cdp.close()
    # Dedupe by (name, phone)
    unique = dedupe_by_name_phone(all_listings)
    # Save raw listings (append to existing if present)
    if os.path.exists(RAW_FILE):
        with open(RAW_FILE) as f:
            existing = json.load(f)
        existing_keys = {(b.get("name",""), b.get("phone") or "") for b in existing}
        new_unique = [b for b in unique if (b.get("name",""), b.get("phone") or "") not in existing_keys]
        all_data = existing + new_unique
        print(f"  + {len(new_unique)} new listings (appended to {len(existing)} existing)")
    else:
        all_data = unique
        print(f"  + {len(unique)} listings (new file)")
    with open(RAW_FILE, "w") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    return all_data


def find_emails_for_leads(target_no_site=10, target_low_quality=5):
    """Run the email finder (with registry integration)."""
    # The run_email_finder_v2.py is now registry-aware
    env = os.environ.copy()
    env["TARGET_NO_SITE"] = str(target_no_site)
    env["TARGET_LOW_QUALITY"] = str(target_low_quality)
    r = subprocess.run(
        [sys.executable, "/home/z/my-project/scripts/leads/run_email_finder_v2.py"],
        env=env, cwd="/home/z/my-project/scripts/leads",
    )
    return r.returncode == 0


def send_emails(delay=75):
    """Run the email sender (with registry integration)."""
    r = subprocess.run(
        [sys.executable, "/home/z/my-project/scripts/leads/send_emails.py",
         "--delay", str(delay)],
        cwd="/home/z/my-project/scripts/leads",
    )
    return r.returncode == 0


def main():
    p = argparse.ArgumentParser(description="Find new leads and pitch them — full dedup pipeline")
    p.add_argument("--queries", nargs="+", default=DEFAULT_QUERIES,
                   help="Google Maps search queries (default: 10 US small-city queries)")
    p.add_argument("--no-website", type=int, default=10,
                   help="Target number of no-website leads to find (default: 10)")
    p.add_argument("--low-quality", type=int, default=5,
                   help="Target number of low-quality-website leads (default: 5)")
    p.add_argument("--delay", type=int, default=75,
                   help="Seconds between emails (default: 75)")
    p.add_argument("--scrape-only", action="store_true",
                   help="Only scrape Google Maps + find emails — don't send pitches")
    p.add_argument("--send-only", action="store_true",
                   help="Only send pitches to existing leads_with_emails.json — skip scraping")
    p.add_argument("--status", action="store_true",
                   help="Just show registry status and exit")
    args = p.parse_args()

    if args.status:
        print_status()
        return

    # Show current state
    master = load_master()
    sent = load_sent()
    step(f"STARTING PIPELINE\n  Known emails: {master['total_discovered']}\n  Already sent: {sent['total_sent']}")

    if not args.send_only:
        # Phase 1: Scrape Google Maps
        step(f"PHASE 1: Scrape Google Maps ({len(args.queries)} queries)")
        run_scraper(args.queries)

        # Phase 2: Find emails for the new leads
        step(f"PHASE 2: Find emails (targets: {args.no_website} no-website + {args.low_quality} low-quality)")
        find_emails_for_leads(args.no_website, args.low_quality)
    else:
        print("Skipping scrape phase (--send-only)")

    if args.scrape_only:
        step("DONE (scrape-only — review leads_with_emails.json before sending)")
        print_status()
        return

    # Phase 3: Show what's pending
    master = load_master()
    sent = load_sent()
    step(f"PHASE 3: Send pitches\n  Known emails: {master['total_discovered']}\n  Already sent: {sent['total_sent']}")

    # Load leads and show how many are pending (not in sent registry)
    if not os.path.exists(RESULTS_FILE):
        print("No leads_with_emails.json found — nothing to send.")
        return
    with open(RESULTS_FILE) as f:
        data = json.load(f)
    no_site = data.get("no_website", [])
    low_qual = data.get("has_website", [])

    pending_count = 0
    sent_count = 0
    for lead in no_site + low_qual:
        emails = lead.get("emails", [])
        if not emails:
            continue
        ne = norm_email(emails[0])
        if is_email_sent(sent, ne):
            sent_count += 1
        else:
            pending_count += 1
    print(f"  Leads in current batch: {len(no_site) + len(low_qual)}")
    print(f"  Already sent (cross-campaign): {sent_count}")
    print(f"  Pending (will be pitched): {pending_count}")
    if pending_count == 0:
        print("\n  ✗ No new leads to pitch — all already sent!")
        return

    # Phase 4: Send emails
    step(f"PHASE 4: Send pitches (delay: {args.delay}s between emails)")
    send_emails(delay=args.delay)

    # Final status
    master = load_master()
    sent = load_sent()
    step(f"PIPELINE COMPLETE\n  Total emails discovered: {master['total_discovered']}\n  Total emails sent: {sent['total_sent']}")
    print_status()


if __name__ == "__main__":
    main()
