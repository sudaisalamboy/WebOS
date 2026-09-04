#!/usr/bin/env python3
"""
Lead Registry — persistent deduplication system.

Two persistent registries:
  1. master_emails.json  — every email ever discovered (across all campaigns)
  2. sent_emails.json    — every email we've ever sent a pitch to

Pipeline integration:
  - When scraping new Google Maps leads → filter out leads whose emails
    are already in master_emails.json (we've seen them before).
  - When email-finding produces new emails → add them to master_emails.json.
  - When sending pitch emails → skip any email already in sent_emails.json
    (already pitched them). After sending, add to sent_emails.json.

CLI commands:
  registry.py status                              Show counts + recent activity
  registry.py add <leads.json>                    Add discovered emails to master
  registry.py sent <sent_log.json>                Add sent emails to sent registry
  registry.py filter <leads.json> [-o out.json]   Filter leads to unique emails only
  registry.py diff <leads.json>                   Show which leads have known emails
  registry.py unsent                             List master emails not yet sent
  registry.py search <email>                      Look up an email's history
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime

REGISTRY_DIR = "/home/z/my-project/download/leads"
MASTER_FILE = os.path.join(REGISTRY_DIR, "master_emails.json")
SENT_FILE = os.path.join(REGISTRY_DIR, "sent_emails.json")


# ---------- Email normalization ----------

def norm_email(e):
    """Normalize an email: lowercase, strip, collapse dots in local part for gmail."""
    if not e:
        return None
    e = e.strip().rstrip(".").lower()
    if "@" not in e:
        return None
    local, domain = e.split("@", 1)
    if not local or not domain or "." not in domain:
        return None
    # Gmail-specific: dots in local part are ignored, so john.doe@gmail.com == johndoe@gmail.com
    # This prevents the same person from being treated as two different leads.
    if domain in ("gmail.com", "googlemail.com"):
        local = local.replace(".", "")
        # Also strip +suffix (gmail aliases)
        if "+" in local:
            local = local.split("+", 1)[0]
    return f"{local}@{domain}"


# ---------- Registry load / save ----------

def _empty_master():
    return {
        "emails": {},  # normalized email → {original, first_seen, source_query, business_name}
        "updated_at": None,
        "total_discovered": 0,
    }

def _empty_sent():
    return {
        "emails": {},  # normalized email → {recipient, subject, sent_at, lead, type}
        "updated_at": None,
        "total_sent": 0,
    }

def load_master():
    if not os.path.exists(MASTER_FILE):
        return _empty_master()
    try:
        with open(MASTER_FILE) as f:
            return json.load(f)
    except Exception:
        return _empty_master()

def save_master(master):
    master["updated_at"] = int(time.time())
    master["total_discovered"] = len(master["emails"])
    with open(MASTER_FILE, "w") as f:
        json.dump(master, f, ensure_ascii=False, indent=2)

def load_sent():
    if not os.path.exists(SENT_FILE):
        return _empty_sent()
    try:
        with open(SENT_FILE) as f:
            return json.load(f)
    except Exception:
        return _empty_sent()

def save_sent(sent):
    sent["updated_at"] = int(time.time())
    sent["total_sent"] = len(sent["emails"])
    with open(SENT_FILE, "w") as f:
        json.dump(sent, f, ensure_ascii=False, indent=2)


# ---------- Master registry operations ----------

def add_email_to_master(master, email, business_name="", source_query=""):
    """Add an email to the master registry. Returns True if it was new."""
    ne = norm_email(email)
    if not ne:
        return False
    if ne in master["emails"]:
        # Update last_seen + merge metadata
        entry = master["emails"][ne]
        entry["last_seen"] = int(time.time())
        if business_name and not entry.get("business_name"):
            entry["business_name"] = business_name
        if source_query and not entry.get("source_query"):
            entry["source_query"] = source_query
        return False
    master["emails"][ne] = {
        "original": email,
        "normalized": ne,
        "business_name": business_name,
        "source_query": source_query,
        "first_seen": int(time.time()),
        "last_seen": int(time.time()),
    }
    return True


def add_leads_file_to_master(leads_file):
    """Load a leads JSON file (any structure with 'emails' lists) and add all to master.
    Supports both the leads_with_emails.json format (with 'no_website'/'has_website' sections)
    and the raw_listings.json format (flat list)."""
    with open(leads_file) as f:
        data = json.load(f)
    master = load_master()
    added = 0
    skipped = 0

    def process_lead(lead):
        nonlocal added, skipped
        name = lead.get("name", "")
        query = lead.get("_query", "")
        emails = lead.get("emails", [])
        if isinstance(emails, str):
            emails = [emails]
        for e in emails:
            if add_email_to_master(master, e, name, query):
                added += 1
            else:
                skipped += 1

    # Detect format
    if isinstance(data, list):
        # Flat list of leads (raw_listings.json format)
        for lead in data:
            process_lead(lead)
    elif isinstance(data, dict):
        # leads_with_emails.json format with sections
        for section in ("no_website", "has_website"):
            for lead in data.get(section, []):
                process_lead(lead)
        # Also handle a "sent"/"failed" list if present (sent_log.json format)
        for section in ("sent", "failed"):
            for entry in data.get(section, []):
                if entry.get("recipient"):
                    if add_email_to_master(master, entry["recipient"], entry.get("lead", ""), ""):
                        added += 1
                    else:
                        skipped += 1

    save_master(master)
    return added, skipped


# ---------- Sent registry operations ----------

def add_sent_entry(sent, recipient, subject="", lead_name="", lead_type=""):
    """Add an email to the sent registry. Returns True if it was new."""
    ne = norm_email(recipient)
    if not ne:
        return False
    if ne in sent["emails"]:
        # Already sent before — update last_sent
        sent["emails"][ne]["last_sent"] = int(time.time())
        sent["emails"][ne]["send_count"] = sent["emails"][ne].get("send_count", 1) + 1
        return False
    sent["emails"][ne] = {
        "recipient": recipient,
        "normalized": ne,
        "subject": subject,
        "lead": lead_name,
        "type": lead_type,
        "first_sent": int(time.time()),
        "last_sent": int(time.time()),
        "send_count": 1,
    }
    return True


def add_sent_log_to_sent_registry(sent_log_file):
    """Load a sent_log.json and add all sent emails to the sent registry."""
    with open(sent_log_file) as f:
        data = json.load(f)
    sent = load_sent()
    added = 0
    skipped = 0
    for entry in data.get("sent", []):
        recipient = entry.get("recipient", "")
        if add_sent_entry(sent, recipient, entry.get("subject", ""),
                          entry.get("lead", ""), entry.get("type", "")):
            added += 1
        else:
            skipped += 1
    save_sent(sent)
    return added, skipped


# ---------- Filtering ----------

def is_email_in_master(master, email):
    return norm_email(email) in master["emails"]

def is_email_sent(sent, email):
    return norm_email(email) in sent["emails"]


def filter_leads_unique(leads_file, output_file=None):
    """Filter a leads file to only leads whose primary email is NOT in master
    AND not in sent registry. Returns (kept, dropped_master, dropped_sent) counts.
    Writes filtered leads to output_file if given."""
    with open(leads_file) as f:
        data = json.load(f)
    master = load_master()
    sent = load_sent()

    kept_no_site = []
    kept_has_site = []
    dropped_master = 0
    dropped_sent = 0

    def process(lead):
        nonlocal dropped_master, dropped_sent
        emails = lead.get("emails", [])
        if not emails:
            return None  # no email = drop
        primary = norm_email(emails[0])
        if not primary:
            return None
        if is_email_sent(sent, primary):
            dropped_sent += 1
            return None
        if is_email_in_master(master, primary):
            dropped_master += 1
            return None
        return lead

    if isinstance(data, list):
        kept = [r for r in (process(l) for l in data) if r]
        kept_no_site = kept
        kept_has_site = []
    elif isinstance(data, dict):
        for lead in data.get("no_website", []):
            r = process(lead)
            if r: kept_no_site.append(r)
        for lead in data.get("has_website", []):
            r = process(lead)
            if r: kept_has_site.append(r)

    filtered = {"no_website": kept_no_site, "has_website": kept_has_site}
    if output_file:
        with open(output_file, "w") as f:
            json.dump(filtered, f, ensure_ascii=False, indent=2)
    return len(kept_no_site) + len(kept_has_site), dropped_master, dropped_sent


# ---------- Status / reporting ----------

def print_status():
    master = load_master()
    sent = load_sent()
    print("=" * 60)
    print("  LEAD REGISTRY STATUS")
    print("=" * 60)
    print(f"  Master emails discovered : {master['total_discovered']}")
    print(f"  Emails sent             : {sent['total_sent']}")
    print(f"  Emails NOT yet sent     : {master['total_discovered'] - sent['total_sent']}")
    print()
    if master.get("updated_at"):
        print(f"  Master last updated : {datetime.fromtimestamp(master['updated_at']).strftime('%Y-%m-%d %H:%M:%S')}")
    if sent.get("updated_at"):
        print(f"  Sent last updated   : {datetime.fromtimestamp(sent['updated_at']).strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    # Recent master entries
    recent = sorted(master["emails"].values(), key=lambda x: x.get("last_seen", 0), reverse=True)[:5]
    if recent:
        print("  5 most recent discoveries:")
        for e in recent:
            ts = datetime.fromtimestamp(e.get("last_seen", 0)).strftime("%Y-%m-%d %H:%M")
            print(f"    {ts}  {e['normalized'][:40]:40s}  {e.get('business_name','')[:30]}")
    print()


def print_unsent():
    master = load_master()
    sent = load_sent()
    unsent = [e for e in master["emails"] if e not in sent["emails"]]
    print(f"Emails discovered but never sent ({len(unsent)}):")
    for ne in unsent[:50]:
        entry = master["emails"][ne]
        print(f"  {ne:45s}  {entry.get('business_name','')[:35]}")


def search_email(query_email):
    ne = norm_email(query_email)
    if not ne:
        print(f"Invalid email: {query_email}")
        return
    master = load_master()
    sent = load_sent()
    print(f"Search: {query_email}  (normalized: {ne})")
    print("-" * 60)
    if ne in master["emails"]:
        e = master["emails"][ne]
        first = datetime.fromtimestamp(e.get("first_seen", 0)).strftime("%Y-%m-%d %H:%M")
        last = datetime.fromtimestamp(e.get("last_seen", 0)).strftime("%Y-%m-%d %H:%M")
        print(f"  ✓ In master registry")
        print(f"    Business   : {e.get('business_name','')}")
        print(f"    Source     : {e.get('source_query','')}")
        print(f"    First seen : {first}")
        print(f"    Last seen  : {last}")
    else:
        print(f"  ✗ Not in master registry (never discovered)")
    if ne in sent["emails"]:
        s = sent["emails"][ne]
        first = datetime.fromtimestamp(s.get("first_sent", 0)).strftime("%Y-%m-%d %H:%M")
        print(f"  ✓ In sent registry (already pitched)")
        print(f"    Subject   : {s.get('subject','')}")
        print(f"    Lead      : {s.get('lead','')}")
        print(f"    Type      : {s.get('type','')}")
        print(f"    First sent: {first}")
        print(f"    Send count: {s.get('send_count', 1)}")
    else:
        print(f"  ✗ Not in sent registry (not yet pitched)")


def diff_leads(leads_file):
    """Show which leads in a file have emails already in master/sent."""
    with open(leads_file) as f:
        data = json.load(f)
    master = load_master()
    sent = load_sent()
    print(f"Diff: {leads_file}")
    print("=" * 70)
    new_leads = 0
    in_master = 0
    already_sent = 0

    def process(lead, section):
        nonlocal new_leads, in_master, already_sent
        name = lead.get("name", "")
        emails = lead.get("emails", [])
        if not emails:
            return
        primary = norm_email(emails[0])
        if not primary:
            return
        if is_email_sent(sent, primary):
            already_sent += 1
            status = "ALREADY-SENT"
        elif is_email_in_master(master, primary):
            in_master += 1
            status = "IN-MASTER"
        else:
            new_leads += 1
            status = "NEW"
        print(f"  [{section:11s}] {status:13s} {name[:35]:35s} → {primary}")

    if isinstance(data, dict):
        for lead in data.get("no_website", []):
            process(lead, "no-website")
        for lead in data.get("has_website", []):
            process(lead, "has-website")
    elif isinstance(data, list):
        for lead in data:
            process(lead, "lead")
    print()
    print(f"  NEW            : {new_leads}")
    print(f"  IN-MASTER      : {in_master}  (already discovered)")
    print(f"  ALREADY-SENT   : {already_sent}  (already pitched)")
    print(f"  Total          : {new_leads + in_master + already_sent}")


# ---------- CLI ----------

def main():
    p = argparse.ArgumentParser(description="Lead Registry — persistent dedup system")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="Show counts + recent activity")
    sub.add_parser("unsent", help="List discovered emails not yet pitched")

    p_add = sub.add_parser("add", help="Add discovered emails to master registry")
    p_add.add_argument("leads_file")

    p_sent = sub.add_parser("sent", help="Add sent emails to sent registry")
    p_sent.add_argument("sent_log_file")

    p_filter = sub.add_parser("filter", help="Filter leads to unique emails only")
    p_filter.add_argument("leads_file")
    p_filter.add_argument("-o", "--output", help="Output file for filtered leads")

    p_diff = sub.add_parser("diff", help="Show which leads have known/sent emails")
    p_diff.add_argument("leads_file")

    p_search = sub.add_parser("search", help="Look up an email's history")
    p_search.add_argument("email")

    args = p.parse_args()

    if args.cmd == "status":
        print_status()
    elif args.cmd == "unsent":
        print_unsent()
    elif args.cmd == "add":
        added, skipped = add_leads_file_to_master(args.leads_file)
        print(f"✓ Added {added} new emails to master registry ({skipped} already present)")
    elif args.cmd == "sent":
        added, skipped = add_sent_log_to_sent_registry(args.sent_log_file)
        print(f"✓ Added {added} new sent emails to sent registry ({skipped} already present)")
    elif args.cmd == "filter":
        out = args.output or args.leads_file.replace(".json", "_unique.json")
        kept, dm, ds = filter_leads_unique(args.leads_file, out)
        print(f"✓ Kept {kept} unique leads (dropped {dm} in-master, {ds} already-sent)")
        print(f"  Output: {out}")
    elif args.cmd == "diff":
        diff_leads(args.leads_file)
    elif args.cmd == "search":
        search_email(args.email)


if __name__ == "__main__":
    main()
