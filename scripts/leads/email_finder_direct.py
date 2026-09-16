"""
Email finder using direct HTTP requests (Bing search) + Python requests.
Much faster and more reliable than driving Chrome via CDP.

For no-website leads:
  - Search Bing for "{name} {city}" + email
  - Extract emails + FB/Yelp links from Bing HTML
  - Visit FB link (if any) to find email
  - Visit business website link (if any) to find email

For has-website leads:
  - GET the website HTML
  - Find emails + assess quality (viewport, charset, title, copyright, generator)
"""
import re
import time
import urllib.parse

import requests

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
EMAIL_BLACKLIST_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    "@sentry.io", "@wixpress.com", "@example.com", "@domain.com",
    "@yourdomain.com", "@email.com", "@sentry-next.wixpress.com",
)
EMAIL_BLACKLIST_LOCAL = (
    "example", "your", "sentry", "wixpress", "domain", "sample",
    "test", "you@", "user@",
)

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}


def clean_email(e):
    if not e:
        return None
    e = e.strip().rstrip(".").lower()
    if not EMAIL_RE.fullmatch(e):
        return None
    if any(e.endswith(s) for s in EMAIL_BLACKLIST_SUFFIXES):
        return None
    local = e.split("@")[0]
    if any(local == p or local.startswith(p) for p in EMAIL_BLACKLIST_LOCAL if not p.endswith("@")):
        return None
    # Filter out emails with image-like extensions
    if re.search(r"\.(png|jpg|jpeg|gif|webp|svg)$", e):
        return None
    return e


def find_emails_in_text(text):
    found = []
    if not text:
        return found
    for m in EMAIL_RE.findall(text):
        e = clean_email(m)
        if e and e not in found:
            found.append(e)
    return found


def fetch(url, timeout=10, allow_redirects=True):
    """GET a URL with our standard headers."""
    try:
        return requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=allow_redirects)
    except Exception:
        return None


def find_email_via_bing(query, timeout_sec=15):
    """Search Bing for a business, extract emails + FB links."""
    result = {"query": query, "emails": [], "facebook_url": None,
              "other_url": None, "yelp_url": None}
    try:
        url = f"https://www.bing.com/search?q={urllib.parse.quote(query + ' email')}"
        r = fetch(url, timeout=timeout_sec)
        if not r or r.status_code != 200:
            result["error"] = f"bing status={r.status_code if r else 'no-resp'}"
            return result

        text = r.text
        # Find emails in Bing results HTML
        for e in find_emails_in_text(text):
            if e not in result["emails"]:
                result["emails"].append(e)

        # Bing result links are in <h2><a href="..."> wrappers
        # Extract all external links
        links = re.findall(r'<a[^>]+href="(https?://[^"]+)"[^>]*>', text)
        external = []
        for href in links:
            # Skip Bing-internal
            host = urllib.parse.urlparse(href).hostname or ""
            if any(host.endswith(d) for d in ("bing.com", "microsoft.com", "msn.com", "live.com")):
                continue
            if "go.msn.com" in href or "/search?" in href:
                continue
            external.append(href)

        for href in external[:50]:
            host = urllib.parse.urlparse(href).hostname or ""
            if not result["facebook_url"] and "facebook.com" in host:
                result["facebook_url"] = href
            elif not result["yelp_url"] and "yelp." in host:
                result["yelp_url"] = href
            elif not result["other_url"] and not any(d in host for d in ("facebook.com", "yelp.", "instagram.com", "twitter.com", "linkedin.com", "youtube.com", "pinterest.com", "google.com", "wikipedia.org")):
                # First non-social link is likely the business site or directory
                result["other_url"] = href

        # If we have an "other" URL but no email, fetch it for email
        if result["other_url"] and not result["emails"]:
            time.sleep(0.5)
            sub = fetch(result["other_url"], timeout=8)
            if sub and sub.status_code == 200:
                for e in find_emails_in_text(sub.text):
                    if e not in result["emails"]:
                        result["emails"].append(e)
                if not result["emails"]:
                    # Try common contact page
                    contact_url = result["other_url"].rstrip("/") + "/contact"
                    sub2 = fetch(contact_url, timeout=6)
                    if sub2 and sub2.status_code == 200:
                        for e in find_emails_in_text(sub2.text):
                            if e not in result["emails"]:
                                result["emails"].append(e)

        # If we have a Facebook URL but no email, try fetching FB (often blocked, but try)
        if result["facebook_url"] and not result["emails"]:
            time.sleep(0.3)
            fb = fetch(result["facebook_url"], timeout=6)
            if fb and fb.status_code == 200:
                for e in find_emails_in_text(fb.text):
                    if e not in result["emails"]:
                        result["emails"].append(e)
    except Exception as e:
        result["error"] = str(e)[:80]
    return result


def visit_website_for_email(url, timeout_sec=8):
    """Fetch a business website, find emails + assess quality."""
    result = {
        "url": url, "emails": [], "quality_score": None, "quality_reasons": [],
        "title": None, "is_https": url.startswith("https://"),
        "viewport_meta": None, "generator": None, "copyright_year": None,
        "html_size": None,
    }
    try:
        r = fetch(url, timeout=timeout_sec)
        if not r or r.status_code != 200:
            result["quality_reasons"].append(f"fetch-failed:{r.status_code if r else 'no-resp'}")
            result["quality_score"] = 0
            return result

        html = r.text
        result["html_size"] = len(html)
        result["is_https"] = r.url.startswith("https://")

        # Title
        title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        title = title_match.group(1).strip() if title_match else ""
        result["title"] = title

        # Viewport meta
        result["viewport_meta"] = bool(re.search(r'<meta[^>]+name=["\']viewport["\']', html, re.IGNORECASE))

        # Generator meta
        gen_match = re.search(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
        result["generator"] = gen_match.group(1) if gen_match else ""

        # Copyright year
        year_match = re.search(r"©\s*(\d{4})", html)
        result["copyright_year"] = int(year_match.group(1)) if year_match else None

        # Find emails (mailto: links + plain text)
        # mailto: links
        for m in re.findall(r'mailto:([^"\'\s?>]+)', html, re.IGNORECASE):
            e = clean_email(m)
            if e and e not in result["emails"]:
                result["emails"].append(e)
        # Plain-text emails in HTML
        # Strip tags first to get clean text
        text_only = re.sub(r"<[^>]+>", " ", html)
        text_only = re.sub(r"\s+", " ", text_only)
        for e in find_emails_in_text(text_only):
            if e not in result["emails"]:
                result["emails"].append(e)

        # Quality scoring
        score = 100
        reasons = []
        if not result["viewport_meta"]:
            score -= 35; reasons.append("no-viewport-meta")
        if not result["is_https"]:
            score -= 30; reasons.append("no-https")
        if len(title) < 10:
            score -= 15; reasons.append("short-title")
        if result["copyright_year"] and result["copyright_year"] < 2022:
            score -= 20; reasons.append(f"old-copyright-{result['copyright_year']}")
        gen = (result["generator"] or "").lower()
        if gen.startswith(("wix", "godaddy", "weebly")):
            score -= 10; reasons.append(f"generator-{result['generator']}")
        if result["html_size"] < 5000:
            score -= 15; reasons.append("small-page")
        result["quality_score"] = max(0, score)
        result["quality_reasons"] = reasons

        # Try /contact page if no email found
        if not result["emails"]:
            contact_url = url.rstrip("/") + "/contact"
            sub = fetch(contact_url, timeout=6)
            if sub and sub.status_code == 200:
                sub_text = re.sub(r"<[^>]+>", " ", sub.text)
                sub_text = re.sub(r"\s+", " ", sub_text)
                for e in find_emails_in_text(sub_text):
                    if e not in result["emails"]:
                        result["emails"].append(e)
                # Also check mailto: in contact page
                for m in re.findall(r'mailto:([^"\'\s?>]+)', sub.text, re.IGNORECASE):
                    e = clean_email(m)
                    if e and e not in result["emails"]:
                        result["emails"].append(e)
    except Exception as e:
        result["quality_reasons"].append(f"error:{str(e)[:60]}")
        result["quality_score"] = 0
    return result


if __name__ == "__main__":
    import json
    print("=== Test visit_website_for_email on beyondwow.com ===")
    r = visit_website_for_email("https://beyondwow.com/")
    print(json.dumps(r, indent=2))
    print()
    print("=== Test find_email_via_bing ===")
    r = find_email_via_bing("PGA Lawn care Asheville NC")
    print(json.dumps(r, indent=2))
