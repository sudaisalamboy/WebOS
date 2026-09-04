"""
Aggressive email finder for business leads.

For has-website leads:
  - Visit homepage, /contact, /contact-us, /about, /about-us
  - Extract emails from mailto: links + plain text + JSON-LD
  - Assess website quality (viewport, https, title, copyright, generator)
  - Stop at 10 with email + low quality

For no-website leads:
  - Use Google search via direct HTTP (parse result links)
  - Visit any found Facebook/Yelp/business directory pages
  - Stop at 20 with email
"""
import json
import os
import re
import sys
import time
import urllib.parse

import requests

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
EMAIL_BAD_PATTERNS = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    "sentry.io", "sentry-next.wixpress.com", "wixpress.com",
    "@example.com", "@domain.com", "@yourdomain.com", "@email.com",
    "@google.com", "@bing.com", "@facebook.com", "@instagram.com",
    "example@", "your@", "sentry@", "wixpress@", "domain@", "sample@",
    "test@", "you@", "user@", "@example.", "@yoursite.",
    "googletagmanager", "google-analytics", "schema.org",
    "@2x.png", "@3x.png", "ingest.", "o113786",  # Sentry ingest URLs
)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
           "Accept": "text/html,application/xhtml+xml"}

# Common contact page paths to try
CONTACT_PATHS = ["", "/contact", "/contact-us", "/contact-us/", "/contact/",
                 "/about", "/about-us", "/about/", "/about-us/",
                 "/connect", "/reach-us", "/email-us", "/get-in-touch"]


def clean_email(e):
    if not e:
        return None
    e = e.strip().rstrip(".").lower()
    if not EMAIL_RE.fullmatch(e):
        return None
    if any(p in e for p in EMAIL_BAD_PATTERNS):
        return None
    if re.search(r"\.(png|jpg|jpeg|gif|webp|svg)$", e):
        return None
    # Filter emails with invalid local parts (too short, starts/ends with .)
    local = e.split("@")[0]
    if len(local) < 2 or local.startswith(".") or local.endswith("."):
        return None
    return e


def find_emails_in_html(html):
    """Find emails in HTML — mailto: links + plain text + JSON-LD email field."""
    found = []
    # mailto: links
    for m in re.findall(r"mailto:([^\"'\s?>]+)", html, re.IGNORECASE):
        e = clean_email(m)
        if e and e not in found:
            found.append(e)
    # Plain-text emails (strip tags first)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    for m in EMAIL_RE.findall(text):
        e = clean_email(m)
        if e and e not in found:
            found.append(e)
    # JSON-LD "email" field
    for m in re.findall(r'"email"\s*:\s*"([^"]+)"', html):
        e = clean_email(m)
        if e and e not in found:
            found.append(e)
    return found


def fetch(url, timeout=8):
    try:
        return requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
    except Exception:
        return None


def assess_quality(html, final_url):
    """Score website quality 0-100 (higher = better)."""
    score = 100
    reasons = []
    is_https = final_url.startswith("https://")
    viewport = bool(re.search(r'<meta[^>]+name=["\']viewport["\']', html, re.IGNORECASE))
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else ""
    gen_match = re.search(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
    generator = gen_match.group(1) if gen_match else ""
    year_match = re.search(r"©\s*(\d{4})", html)
    copyright_year = int(year_match.group(1)) if year_match else None

    if not viewport:
        score -= 35; reasons.append("no-viewport-meta")
    if not is_https:
        score -= 30; reasons.append("no-https")
    if len(title) < 10:
        score -= 15; reasons.append("short-title")
    if copyright_year and copyright_year < 2022:
        score -= 20; reasons.append(f"old-copyright-{copyright_year}")
    gen = generator.lower()
    if gen.startswith(("wix", "godaddy", "weebly")):
        score -= 10; reasons.append(f"generator-{generator}")
    if len(html) < 5000:
        score -= 15; reasons.append("small-page")
    return {
        "score": max(0, score), "reasons": reasons,
        "viewport_meta": viewport, "is_https": is_https,
        "title": title, "generator": generator,
        "copyright_year": copyright_year, "html_size": len(html),
    }


def visit_website_for_email(url, max_paths=4):
    """Visit homepage + contact pages to find emails + assess quality."""
    result = {
        "url": url, "emails": [], "quality_score": None, "quality_reasons": [],
        "title": None, "is_https": url.startswith("https://"),
        "viewport_meta": None, "generator": None, "copyright_year": None,
        "html_size": None,
    }
    base_url = url.rstrip("/") if url.endswith("/") else url
    if not base_url.startswith("http"):
        base_url = "https://" + base_url

    homepage_html = None
    final_url = base_url

    try:
        r = fetch(base_url, timeout=8)
        if not r or r.status_code != 200:
            # Try http:// fallback if https failed
            if base_url.startswith("https://"):
                r = fetch("http://" + base_url[8:], timeout=8)
            if not r or r.status_code != 200:
                result["quality_reasons"].append(f"fetch-failed:{r.status_code if r else 'no-resp'}")
                result["quality_score"] = 0
                return result
        homepage_html = r.text
        final_url = r.url

        # Assess quality from homepage
        q = assess_quality(homepage_html, final_url)
        result["quality_score"] = q["score"]
        result["quality_reasons"] = q["reasons"]
        result["title"] = q["title"]
        result["is_https"] = q["is_https"]
        result["viewport_meta"] = q["viewport_meta"]
        result["generator"] = q["generator"]
        result["copyright_year"] = q["copyright_year"]
        result["html_size"] = q["html_size"]

        # Find emails in homepage
        result["emails"] = find_emails_in_html(homepage_html)

        # If no emails, try contact pages
        paths_tried = 1
        for path in CONTACT_PATHS[1:]:  # skip "" (homepage already done)
            if result["emails"] or paths_tried >= max_paths:
                break
            time.sleep(0.3)
            test_url = base_url + path
            sub = fetch(test_url, timeout=6)
            if sub and sub.status_code == 200:
                paths_tried += 1
                for e in find_emails_in_html(sub.text):
                    if e not in result["emails"]:
                        result["emails"].append(e)
    except Exception as e:
        result["quality_reasons"].append(f"error:{str(e)[:60]}")
        result["quality_score"] = 0
    return result


def find_email_via_google(query, timeout_sec=12):
    """Search Google for a business, extract emails + FB links from results."""
    result = {"query": query, "emails": [], "facebook_url": None,
              "yelp_url": None, "other_url": None}
    try:
        url = f"https://www.google.com/search?q={urllib.parse.quote(query)}&num=10"
        r = fetch(url, timeout=timeout_sec)
        if not r or r.status_code != 200:
            result["error"] = f"google status={r.status_code if r else 'no-resp'}"
            return result

        html = r.text
        # Find emails directly in Google's results page
        result["emails"] = find_emails_in_html(html)

        # Google result links: <a href="/url?q=..." or <a href="https://...">
        # Try /url?q= pattern
        raw_links = re.findall(r'/url\?q=([^&"]+)', html)
        if not raw_links:
            # Try direct https links that aren't google-internal
            all_links = re.findall(r'<a[^>]+href="(https?://[^"]+)"', html)
            raw_links = [l for l in all_links if not any(d in l for d in (
                "google.", "gstatic.", "googleapis.", "youtube.com",
                "wikipedia.org", "ggpht.", "schema.org"))]

        for href in raw_links[:30]:
            actual = urllib.parse.unquote(href)
            host = urllib.parse.urlparse(actual).hostname or ""
            if not result["facebook_url"] and "facebook.com" in host:
                result["facebook_url"] = actual
            elif not result["yelp_url"] and "yelp." in host:
                result["yelp_url"] = actual
            elif not result["other_url"] and not any(d in host for d in (
                "google.", "youtube.", "wikipedia.", "facebook.com",
                "instagram.com", "twitter.com", "linkedin.com", "yelp.")):
                result["other_url"] = actual

        # Visit the "other" URL (likely the business directory/site) for email
        if result["other_url"] and not result["emails"]:
            time.sleep(0.5)
            sub = fetch(result["other_url"], timeout=6)
            if sub and sub.status_code == 200:
                for e in find_emails_in_html(sub.text):
                    if e not in result["emails"]:
                        result["emails"].append(e)
    except Exception as e:
        result["error"] = str(e)[:80]
    return result


if __name__ == "__main__":
    print("=== Test visit_website_for_email on jaspersmark.com ===")
    r = visit_website_for_email("https://jaspersmark.com/")
    print(json.dumps(r, indent=2))
    print()
    print("=== Test find_email_via_google ===")
    r = find_email_via_google("PGA Lawn care Asheville NC email")
    print(json.dumps(r, indent=2))
