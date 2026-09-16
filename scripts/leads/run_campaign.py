"""
Run a lead-generation campaign: scrape Google Maps across many Tier 1 queries
to find 30 businesses with findable emails (20 without websites, 10 with
low-quality websites).

Output: /home/z/my-project/download/leads/raw_listings.json
"""
import json
import os
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts/leads")
from cdp_driver import CDP
from scraper import scrape_query, dedupe_by_name_phone

OUT_FILE = "/home/z/my-project/download/leads/raw_listings.json"

# Tier 1 countries (small/medium cities where small biz often lacks a site)
QUERIES = [
    # US — small/medium cities, service categories prone to no-website
    "lawn care service Asheville NC",
    "landscaping Bozeman MT",
    "house cleaning Burlington VT",
    "mobile car detailing Bend OR",
    "handyman Savannah GA",
    "junk removal Ithaca NY",
    "pressure washing Flagstaff AZ",
    "tree service Missoula MT",
    "dog walker Boulder CO",
    "fence contractor Eugene OR",
    "pet sitting Santa Fe NM",
    "roof cleaning Charleston SC",
    "gutter cleaning Greenville SC",
    "window cleaner Asheville NC",
    # Canada
    "lawn care Kelowna BC",
    "house cleaning Kingston ON",
    "snow removal Halifax NS",
    "junk removal Victoria BC",
    # UK
    "garden services York UK",
    "window cleaning Bath UK",
    "oven cleaning Exeter UK",
    "carpet cleaning Inverness UK",
    # Australia
    "lawn mowing Ballarat VIC",
    "house cleaning Toowoomba QLD",
    "car detailing Hobart TAS",
    # Ireland
    "window cleaning Galway Ireland",
    "garden maintenance Cork Ireland",
    # New Zealand
    "lawn mowing Dunedin NZ",
    "house cleaning Napier NZ",
]


def main():
    # Resume support — load existing results
    if os.path.exists(OUT_FILE):
        with open(OUT_FILE) as f:
            all_results = json.load(f)
        print(f"Resuming — {len(all_results)} listings already collected")
    else:
        all_results = []

    done_queries = {b.get("_query") for b in all_results}
    pending = [q for q in QUERIES if q not in done_queries]
    print(f"Pending: {len(pending)} queries")

    cdp = CDP()
    try:
        for i, q in enumerate(pending, 1):
            print(f"\n[{i}/{len(pending)}] Query: {q}")
            try:
                listings = scrape_query(cdp, q, scrolls=6, scroll_pause=2.0)
            except Exception as e:
                print(f"  ✗ error: {e}")
                time.sleep(3)
                # Reconnect
                try: cdp.close()
                except: pass
                cdp = CDP()
                continue

            for b in listings:
                b["_query"] = q
            all_results.extend(listings)

            # Save progress every 2 queries
            if i % 2 == 0:
                with open(OUT_FILE, "w") as f:
                    json.dump(all_results, f, ensure_ascii=False, indent=2)
                # Print stats
                no_site = sum(1 for b in all_results if not b.get("hasWebsite"))
                has_site = sum(1 for b in all_results if b.get("hasWebsite"))
                print(f"  [progress] total={len(all_results)} no_site={no_site} has_site={has_site}")

            time.sleep(1.5)  # polite delay between queries

        # Final save + dedupe
        with open(OUT_FILE, "w") as f:
            json.dump(all_results, f, ensure_ascii=False, indent=2)

        unique = dedupe_by_name_phone(all_results)
        no_site = [b for b in unique if not b.get("hasWebsite")]
        has_site = [b for b in unique if b.get("hasWebsite")]
        print(f"\n========== CAMPAIGN COMPLETE ==========")
        print(f"Total raw listings: {len(all_results)}")
        print(f"Unique listings:    {len(unique)}")
        print(f"  No website:       {len(no_site)}  (target: 20)")
        print(f"  Has website:      {len(has_site)}  (target: 10 from this)")
    finally:
        cdp.close()


if __name__ == "__main__":
    main()
