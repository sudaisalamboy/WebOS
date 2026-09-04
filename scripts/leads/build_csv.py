"""
Build the final leads CSV from leads_with_emails.json.

Output: /home/z/my-project/download/leads/leads.csv
"""
import csv
import json
import os
import re

RESULTS_FILE = "/home/z/my-project/download/leads/leads_with_emails.json"
CSV_FILE = "/home/z/my-project/download/leads/leads.csv"

COLUMNS = [
    "Lead #",
    "Lead Type",                # no-website | low-quality-website
    "Business Name",
    "Category",
    "City / Region",
    "Country (Tier 1)",
    "Phone",
    "Email (Primary)",
    "Email (Secondary)",
    "Website URL",
    "Website Status",           # No website | Low quality (failed fetch) | Low quality (no SSL/no viewport)
    "Quality Score (0-100)",
    "Quality Issues",
    "Has Facebook",
    "Notes",
]


def country_from_query(query):
    if "UK" in query or "England" in query or "Scotland" in query or "Wales" in query:
        return "United Kingdom"
    if "Ireland" in query:
        return "Ireland"
    if "NZ" in query or "New Zealand" in query:
        return "New Zealand"
    if "Australia" in query or any(s in query for s in ("VIC", "QLD", "TAS", "NSW", "SA", "WA")):
        return "Australia"
    if any(s in query for s in ("BC", "ON", "NS", "AB", "QC", "MB", "SK")):
        return "Canada"
    if any(s in query for s in ("NC", "MT", "VT", "OR", "GA", "NY", "AZ", "CO", "NM", "SC")):
        return "United States"
    return "Unknown (Tier 1)"


def city_from_query(query):
    # Queries are formatted as "{category} {City} {State}" with no "in".
    # Heuristic: take the last 2 tokens (City + State code like "Asheville NC").
    parts = query.rsplit(" ", 2)
    if len(parts) >= 2:
        return parts[-2]  # City name (2nd-to-last token)
    return ""


def state_from_query(query):
    parts = query.rsplit(" ", 1)
    if len(parts) == 2:
        return parts[-1]  # State code (last token)
    return ""


def category_from_query(query):
    # Take the part before "in"
    m = re.match(r"^(.+?)\s+in\s+", query)
    if m:
        return m.group(1).strip()
    return query


def main():
    with open(RESULTS_FILE) as f:
        data = json.load(f)

    rows = []
    n = 0
    # No-website leads first
    for b in data.get("no_website", []):
        n += 1
        emails = b.get("emails", [])
        query = b.get("_query", "")
        reasons = b.get("quality_reasons") or []
        has_fb = "Yes" if b.get("facebook_url") else "No"
        notes_parts = []
        if b.get("other_url"):
            notes_parts.append(f"Found via: {b['other_url'][:80]}")
        if b.get("facebook_url"):
            notes_parts.append(f"FB: {b['facebook_url']}")
        rows.append({
            "Lead #": n,
            "Lead Type": "No Website",
            "Business Name": b.get("name", ""),
            "Category": category_from_query(query),
            "City / Region": city_from_query(query),
            "Country (Tier 1)": country_from_query(query),
            "Phone": b.get("phone") or "",
            "Email (Primary)": emails[0] if emails else "",
            "Email (Secondary)": emails[1] if len(emails) > 1 else "",
            "Website URL": "",
            "Website Status": "No website — found contact via web search",
            "Quality Score (0-100)": "N/A",
            "Quality Issues": "",
            "Has Facebook": has_fb,
            "Notes": " | ".join(notes_parts),
        })

    # Low-quality website leads
    for b in data.get("has_website", []):
        n += 1
        emails = b.get("emails", [])
        query = b.get("_query", "")
        reasons = b.get("quality_reasons") or []
        score = b.get("quality_score")
        has_fb = "Yes" if b.get("facebook_url") else "No"
        # Determine website status text
        if score == 0:
            status = "Low quality — site unreachable or broken (score 0)"
        else:
            status = f"Low quality (score {score}/100)"
        notes_parts = []
        if b.get("generator"):
            notes_parts.append(f"Generator: {b['generator']}")
        if b.get("copyright_year"):
            notes_parts.append(f"Copyright © {b['copyright_year']}")
        if b.get("html_size"):
            notes_parts.append(f"HTML size: {b['html_size']} bytes")
        if b.get("website_title"):
            notes_parts.append(f"Title: {b['website_title'][:60]}")
        rows.append({
            "Lead #": n,
            "Lead Type": "Low Quality Website",
            "Business Name": b.get("name", ""),
            "Category": category_from_query(query),
            "City / Region": city_from_query(query),
            "Country (Tier 1)": country_from_query(query),
            "Phone": b.get("phone") or "",
            "Email (Primary)": emails[0] if emails else "",
            "Email (Secondary)": emails[1] if len(emails) > 1 else "",
            "Website URL": b.get("websiteUrl") or "",
            "Website Status": status,
            "Quality Score (0-100)": score if score is not None else "",
            "Quality Issues": ", ".join(reasons) if reasons else "",
            "Has Facebook": has_fb,
            "Notes": " | ".join(notes_parts),
        })

    # Write CSV
    with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    # Also write a friendly summary
    print(f"✓ CSV written: {CSV_FILE}")
    print(f"  Total leads: {len(rows)}")
    no_w = sum(1 for r in rows if r["Lead Type"] == "No Website")
    lo_q = sum(1 for r in rows if r["Lead Type"] == "Low Quality Website")
    print(f"  No website: {no_w}")
    print(f"  Low-quality website: {lo_q}")
    print()
    # Country breakdown
    from collections import Counter
    countries = Counter(r["Country (Tier 1)"] for r in rows)
    print("  By country:")
    for c, n in countries.most_common():
        print(f"    {c}: {n}")
    print()
    print("=== Sample rows ===")
    for r in rows[:5]:
        print(f"  #{r['Lead #']} [{r['Lead Type']}] {r['Business Name']} | {r['City / Region']}, {r['Country (Tier 1)']} | {r['Email (Primary)']}")


if __name__ == "__main__":
    main()
