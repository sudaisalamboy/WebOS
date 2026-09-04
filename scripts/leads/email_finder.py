"""
Email finder + website quality assessor for scraped leads.

For has-website leads:
  - Visit the website
  - Find all mailto: links + emails in the text (regex)
  - Check quality signals (HTTPS, viewport meta, mobile-friendly, charset,
    page size, title length, presence of "© 2024" or older copyright, etc.)
  - Score quality 0-100 (low = bad website)

For no-website leads:
  - Search DuckDuckGo for "{name} {city}" to find their Facebook / Yelp / email
  - Visit the found page (if FB/Yelp/Insta) and look for email in the page text
  - Also try direct regex on the DDG results page itself
"""
import json
import re
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts/leads")
from cdp_driver import CDP

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
# Filter out obviously fake / placeholder emails
EMAIL_BLACKLIST = {"example@", "your@", "email@", "sentry@", "wixpress@", "domain@",
                   "feedback@", "name@", "you@", "user@", "test@", "sample@"}

# Domains that aren't real business sites (template / placeholder / aggregators)
BAD_SITE_DOMAINS = {"facebook.com", "instagram.com", "yelp.com", "yellowpages.com",
                    "bbb.org", "angi.com", "thumbtack.com", "homeadvisor.com",
                    "linkedin.com", "twitter.com", "x.com"}


def clean_email(e):
    e = e.strip().rstrip(".")
    if not EMAIL_RE.fullmatch(e):
        return None
    if e.endswith(".png") or e.endswith(".jpg") or e.endswith(".jpeg") or e.endswith(".gif"):
        return None
    if e.endswith("@sentry.io") or e.endswith("@wixpress.com"):
        return None
    local = e.split("@")[0].lower()
    if any(local.startswith(b) for b in EMAIL_BLACKLIST):
        return None
    return e.lower()


def find_emails_in_text(text):
    found = []
    for m in EMAIL_RE.findall(text or ""):
        e = clean_email(m)
        if e and e not in found:
            found.append(e)
    return found


def visit_website_for_email(cdp: CDP, url: str, timeout_sec: int = 8):
    """Visit a website, find emails, assess quality. Returns dict."""
    result = {
        "url": url,
        "emails": [],
        "quality_score": None,
        "quality_reasons": [],
        "title": None,
        "is_https": url.startswith("https://"),
        "viewport_meta": None,
        "has_ssl_errors": False,
    }
    try:
        cdp.send("Page.enable")
        cdp.send("Page.navigate", {"url": url})
        # Wait for load (or timeout)
        deadline = time.time() + timeout_sec
        loaded = False
        while time.time() < deadline:
            try:
                ready = cdp.eval_js("document.readyState", await_promise=False)
                if ready in ("complete", "interactive"):
                    loaded = True
                    # Give a tiny bit of extra time for lazy-loaded content
                    time.sleep(1.0)
                    break
            except Exception:
                pass
            time.sleep(0.4)

        if not loaded:
            result["quality_reasons"].append("slow-load")
            time.sleep(1)

        # Extract emails + quality signals
        js = r"""
        (function() {
          const emails = new Set();
          // mailto: links
          document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
            emails.add(a.getAttribute('href').slice(7).split('?')[0]);
          });
          // Emails anywhere in the body text
          const bodyText = document.body ? document.body.innerText : '';
          const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
          (bodyText.match(emailRe) || []).forEach(e => emails.add(e));

          // Quality signals
          const viewportMeta = !!document.querySelector('meta[name="viewport"]');
          const charsetMeta = !!document.querySelector('meta[charset]') || !!document.characterSet;
          const title = document.title || '';
          const titleLen = title.length;
          // Generator meta (e.g. "WordPress 5.4", "Wix.com", "Squarespace")
          const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
          // Count visible images
          const imgCount = document.querySelectorAll('img').length;
          // Count headings
          const h1Count = document.querySelectorAll('h1').length;
          // Check for "old" copyright year
          const yearMatch = bodyText.match(/©\s*(\d{4})/);
          const copyrightYear = yearMatch ? parseInt(yearMatch[1]) : null;
          // Page size (rough)
          const htmlSize = document.documentElement.outerHTML.length;
          // SSL: protocol
          const isHttps = location.protocol === 'https:';
          // Mobile check: viewport meta + narrow screen
          return {
            emails: Array.from(emails).slice(0, 8),
            viewportMeta, charsetMeta, title, titleLen, generator,
            imgCount, h1Count, copyrightYear, htmlSize, isHttps
          };
        })()
        """
        info = cdp.eval_js(js) or {}
        result["title"] = info.get("title")
        result["viewport_meta"] = info.get("viewportMeta")
        result["is_https"] = info.get("isHttps", result["is_https"])

        for e in info.get("emails", []):
            cleaned = clean_email(e)
            if cleaned and cleaned not in result["emails"]:
                result["emails"].append(cleaned)

        # Quality scoring (0-100, higher = better)
        score = 100
        reasons = []
        if not info.get("viewportMeta"):
            score -= 35; reasons.append("no-viewport-meta")
        if not info.get("isHttps"):
            score -= 30; reasons.append("no-https")
        if info.get("titleLen", 0) < 10:
            score -= 15; reasons.append("short-title")
        if info.get("copyrightYear") and info["copyrightYear"] < 2022:
            score -= 20; reasons.append(f"old-copyright-{info['copyrightYear']}")
        if info.get("generator", "").lower().startswith(("wix", "godaddy", "weebly")):
            score -= 10; reasons.append(f"generator-{info['generator']}")
        if info.get("htmlSize", 0) < 5000:
            score -= 15; reasons.append("small-page")
        result["quality_score"] = max(0, score)
        result["quality_reasons"] = reasons
        result["generator"] = info.get("generator")
        result["img_count"] = info.get("imgCount")
        result["copyright_year"] = info.get("copyrightYear")
        result["html_size"] = info.get("htmlSize")
    except Exception as e:
        result["quality_reasons"].append(f"error:{str(e)[:60]}")
        result["quality_score"] = 0
    return result


def find_email_via_ddg(cdp: CDP, query: str, timeout_sec: int = 10):
    """Search DuckDuckGo for a business, look for emails/FB links on results page."""
    result = {"query": query, "emails": [], "facebook_url": None, "yelp_url": None, "other_url": None}
    try:
        url = f"https://duckduckgo.com/?q={query.replace(' ', '+')}+email"
        cdp.send("Page.enable")
        cdp.send("Page.navigate", {"url": url})
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            ready = cdp.eval_js("document.readyState", await_promise=False)
            if ready in ("complete", "interactive"):
                time.sleep(1.5); break
            time.sleep(0.5)

        js = r"""
        (function() {
          const emails = new Set();
          const bodyText = document.body ? document.body.innerText : '';
          const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
          (bodyText.match(emailRe) || []).forEach(e => emails.add(e));
          // Also scan result link hrefs
          const links = Array.from(document.querySelectorAll('a.result__a, a[data-testid="result-title-a"]'));
          // Find facebook / yelp / instagram links in results
          let fbUrl = null, yelpUrl = null, otherUrl = null;
          for (const l of links) {
            const href = l.href || '';
            const text = l.textContent || '';
            // DuckDuckGo wraps URLs; the actual destination is in uddg= param
            const uddg = href.match(/uddg=([^&]+)/);
            const dest = uddg ? decodeURIComponent(uddg[1]) : href;
            if (!fbUrl && /facebook\.com/i.test(dest)) fbUrl = dest;
            else if (!yelpUrl && /yelp\.com|yelp\.ca|yelp\.co\.uk/i.test(dest)) yelpUrl = dest;
            else if (!otherUrl && !/duckduckgo\.com|google\.com|bing\.com/i.test(dest)) otherUrl = dest;
          }
          return { emails: Array.from(emails).slice(0,5), facebookUrl: fbUrl, yelpUrl, otherUrl };
        })()
        """
        info = cdp.eval_js(js) or {}
        result["facebook_url"] = info.get("facebookUrl")
        result["yelp_url"] = info.get("yelpUrl")
        result["other_url"] = info.get("otherUrl")
        for e in info.get("emails", []):
            cleaned = clean_email(e)
            if cleaned and cleaned not in result["emails"]:
                result["emails"].append(cleaned)

        # If we have a Facebook URL, try visiting it to extract email
        if result["facebook_url"] and not result["emails"]:
            time.sleep(1)
            cdp.send("Page.navigate", {"url": result["facebook_url"]})
            time.sleep(4)  # FB takes time
            text = cdp.eval_js("document.body ? document.body.innerText : ''", await_promise=False) or ""
            for e in find_emails_in_text(text):
                if e not in result["emails"]:
                    result["emails"].append(e)

        # If we have an "other" URL (not FB/Yelp), visit it for email
        if result["other_url"] and not result["emails"]:
            time.sleep(1)
            try:
                cdp.send("Page.navigate", {"url": result["other_url"]})
                time.sleep(3)
                text = cdp.eval_js("document.body ? document.body.innerText : ''", await_promise=False) or ""
                for e in find_emails_in_text(text):
                    if e not in result["emails"]:
                        result["emails"].append(e)
            except Exception:
                pass
    except Exception as e:
        result["error"] = str(e)[:80]
    return result


if __name__ == "__main__":
    # Smoke test on one has-website lead
    cdp = CDP()
    try:
        print("Testing visit_website_for_email on beyondwow.com…")
        r = visit_website_for_email(cdp, "https://beyondwow.com/")
        print(json.dumps(r, indent=2))
    finally:
        cdp.close()
