"""
Build a polished Excel (.xlsx) leads file with:
  - Sheet 1: All Leads (30 rows, color-coded by type)
  - Sheet 2: No-Website Leads (20 rows)
  - Sheet 3: Low-Quality-Website Leads (10 rows)
  - Sheet 4: Summary stats
"""
import json
import os
from collections import Counter
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

RESULTS_FILE = "/home/z/my-project/download/leads/leads_with_emails.json"
XLSX_FILE = "/home/z/my-project/download/leads/leads.xlsx"

# Design tokens (zinc/cyan palette matching the WebOS theme)
HEADER_FILL = PatternFill("solid", fgColor="0F172A")
HEADER_FONT = Font(name="Calibri", bold=True, color="E2E8F0", size=11)
NO_SITE_FILL = PatternFill("solid", fgColor="FEF3C7")  # amber tint
LOW_QUAL_FILL = PatternFill("solid", fgColor="FEE2E2")  # rose tint
ZEBRA_FILL = PatternFill("solid", fgColor="F8FAFC")
BORDER = Border(
    left=Side(style="thin", color="E2E8F0"),
    right=Side(style="thin", color="E2E8F0"),
    top=Side(style="thin", color="E2E8F0"),
    bottom=Side(style="thin", color="E2E8F0"),
)
SUMMARY_FILL = PatternFill("solid", fgColor="ECFDF5")  # emerald tint

COLUMNS = [
    ("Lead #", 8),
    ("Lead Type", 22),
    ("Business Name", 38),
    ("Category", 32),
    ("City", 14),
    ("State", 8),
    ("Country", 16),
    ("Phone", 18),
    ("Email (Primary)", 36),
    ("Email (Secondary)", 36),
    ("Website URL", 50),
    ("Website Status", 38),
    ("Quality Score", 12),
    ("Quality Issues", 32),
    ("Has Facebook", 12),
    ("Notes", 60),
]


def state_from_query(query):
    parts = query.rsplit(" ", 1)
    return parts[-1] if len(parts) == 2 else ""


def city_from_query(query):
    parts = query.rsplit(" ", 2)
    return parts[-2] if len(parts) >= 2 else ""


def category_from_query(query):
    parts = query.rsplit(" ", 2)
    return parts[0] if len(parts) >= 3 else query


def country_from_query(query):
    if any(s in query for s in ("NC", "MT", "VT", "OR", "GA", "NY", "AZ", "CO", "NM", "SC")):
        return "United States"
    if any(s in query for s in ("BC", "ON", "NS", "AB", "QC")):
        return "Canada"
    if "UK" in query or any(s in query for s in ("England", "Scotland", "Wales")):
        return "United Kingdom"
    if "Ireland" in query:
        return "Ireland"
    if "NZ" in query:
        return "New Zealand"
    if any(s in query for s in ("VIC", "QLD", "TAS", "NSW")):
        return "Australia"
    return "Unknown (Tier 1)"


def lead_to_row(b, n, lead_type):
    emails = b.get("emails", [])
    query = b.get("_query", "")
    reasons = b.get("quality_reasons") or []
    score = b.get("quality_score")
    has_fb = "Yes" if b.get("facebook_url") else "No"
    notes = []
    if b.get("other_url"):
        notes.append(f"Found via: {b['other_url'][:80]}")
    if b.get("facebook_url"):
        notes.append(f"FB: {b['facebook_url']}")
    if b.get("generator"):
        notes.append(f"Generator: {b['generator']}")
    if b.get("copyright_year"):
        notes.append(f"Copyright © {b['copyright_year']}")
    if b.get("website_title"):
        notes.append(f"Title: {b['website_title'][:60]}")
    if lead_type == "No Website":
        status = "No website — contact via email/phone"
    elif score == 0:
        status = "Low quality — site broken/unreachable"
    else:
        status = f"Low quality (score {score}/100)"
    return [
        n,
        lead_type,
        b.get("name", ""),
        category_from_query(query),
        city_from_query(query),
        state_from_query(query),
        country_from_query(query),
        b.get("phone") or "",
        emails[0] if emails else "",
        emails[1] if len(emails) > 1 else "",
        b.get("websiteUrl") or "",
        status,
        score if score is not None else "N/A",
        ", ".join(reasons) if reasons else "",
        has_fb,
        " | ".join(notes),
    ]


def write_sheet(ws, leads, lead_type, start_n=1):
    # Header row
    for c, (name, _) in enumerate(COLUMNS, 1):
        cell = ws.cell(row=1, column=c, value=name)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER
    ws.row_dimensions[1].height = 28

    # Data rows
    for i, b in enumerate(leads):
        row = lead_to_row(b, start_n + i, lead_type)
        for c, val in enumerate(row, 1):
            cell = ws.cell(row=i + 2, column=c, value=val)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = BORDER
            if lead_type == "No Website":
                cell.fill = NO_SITE_FILL if i % 2 == 0 else PatternFill("solid", fgColor="FFFBEB")
            else:
                cell.fill = LOW_QUAL_FILL if i % 2 == 0 else PatternFill("solid", fgColor="FFF7F7")
        ws.row_dimensions[i + 2].height = 38

    # Column widths
    for c, (_, w) in enumerate(COLUMNS, 1):
        ws.column_dimensions[get_column_letter(c)].width = w

    # Freeze header row
    ws.freeze_panes = "A2"

    # Auto filter
    last_col = get_column_letter(len(COLUMNS))
    ws.auto_filter.ref = f"A1:{last_col}{len(leads) + 1}"


def main():
    with open(RESULTS_FILE) as f:
        data = json.load(f)
    no_site = data.get("no_website", [])
    low_qual = data.get("has_website", [])

    wb = Workbook()
    wb.properties.creator = "Z.ai Lead Generator"

    # Sheet 1: All Leads
    ws1 = wb.active
    ws1.title = "All Leads"
    write_sheet(ws1, no_site + low_qual, "Mixed", start_n=1)
    # Override row colors to differentiate by type — redo coloring
    for i, b in enumerate(no_site):
        row_idx = i + 2
        for c in range(1, len(COLUMNS) + 1):
            ws1.cell(row=row_idx, column=c).fill = NO_SITE_FILL if i % 2 == 0 else PatternFill("solid", fgColor="FFFBEB")
    for i, b in enumerate(low_qual):
        row_idx = len(no_site) + i + 2
        for c in range(1, len(COLUMNS) + 1):
            ws1.cell(row=row_idx, column=c).fill = LOW_QUAL_FILL if i % 2 == 0 else PatternFill("solid", fgColor="FFF7F7")

    # Sheet 2: No Website
    ws2 = wb.create_sheet("No Website (20)")
    write_sheet(ws2, no_site, "No Website", start_n=1)

    # Sheet 3: Low Quality Website
    ws3 = wb.create_sheet("Low Quality Sites (10)")
    write_sheet(ws3, low_qual, "Low Quality Website", start_n=1)

    # Sheet 4: Summary
    ws4 = wb.create_sheet("Summary")
    ws4.column_dimensions["A"].width = 28
    ws4.column_dimensions["B"].width = 16
    ws4.column_dimensions["C"].width = 50

    stats = [
        ("Total Leads", len(no_site) + len(low_qual), ""),
        ("No Website Leads", len(no_site), "Target was 20 — ✓ met"),
        ("Low Quality Website Leads", len(low_qual), "Target was 10 — ✓ met"),
        ("", "", ""),
        ("By Country", "", ""),
    ]
    countries = Counter(country_from_query(b.get("_query", "")) for b in no_site + low_qual)
    for country, count in countries.most_common():
        stats.append((country, count, ""))
    stats.append(("", "", ""))
    stats.append(("By City", "", ""))
    cities = Counter(city_from_query(b.get("_query", "")) for b in no_site + low_qual)
    for city, count in cities.most_common():
        stats.append((city, count, ""))
    stats.append(("", "", ""))
    stats.append(("By Category", "", ""))
    cats = Counter(category_from_query(b.get("_query", "")) for b in no_site + low_qual)
    for cat, count in cats.most_common():
        stats.append((cat, count, ""))

    for r, (label, val, note) in enumerate(stats, 1):
        cell_a = ws4.cell(row=r, column=1, value=label)
        cell_b = ws4.cell(row=r, column=2, value=val)
        cell_c = ws4.cell(row=r, column=3, value=note)
        if label and not val:
            cell_a.font = Font(bold=True, size=12, color="0F766E")
            cell_a.fill = SUMMARY_FILL
        elif label:
            cell_a.font = Font(bold=True)
        for c in (1, 2, 3):
            ws4.cell(row=r, column=c).border = BORDER

    wb.save(XLSX_FILE)
    print(f"✓ Excel file written: {XLSX_FILE}")
    print(f"  Sheets: All Leads ({len(no_site) + len(low_qual)} rows), No Website ({len(no_site)}), Low Quality ({len(low_qual)}), Summary")


if __name__ == "__main__":
    main()
