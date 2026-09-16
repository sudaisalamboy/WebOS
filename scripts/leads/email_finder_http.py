"""
Email finder + website quality assessor — uses /api/vnc/eval (HTTP wrapper
around CDP) instead of raw WebSocket. Much more reliable in this environment.
"""
import json
import os
import re
import subprocess
import sys
import time

COOKIE_FILE = "/tmp/webos-cookies.txt"
EVAL_URL = "http://localhost:3000/api/vnc/eval"
NAV_URL = "http://localhost:3000/api/vnc/control"  # for reload/navigation


EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
EMAIL_BLACKLIST_PREFIXES = ("example", "your", "email", "sentry", "wixpress",
                            "domain", "feedback", "name", "you", "user", "test",
                            "sample", "support@", "noreply", "no-reply")
EMAIL_BLACKLIST_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp",
                            "@sentry.io", "@wixpress.com", "@example.com",
                            "@domain.com", "@yourdomain.com", "@email.com")


def clean_email(e):
    if not e:
        return None
    e = e.strip().rstrip(".").lower()
    if not EMAIL_RE.fullmatch(e):
        return None
    if any(e.endswith(s) for s in EMAIL_BLACKLIST_SUFFIXES):
        return None
    local = e.split("@")[0]
    if any(local.startswith(p.rstrip("@")) for p in EMAIL_BLACKLIST_PREFIXES if p.endswith("@")):
        return None
    if any(local == p for p in EMAIL_BLACKLIST_PREFIXES if not p.endswith("@")):
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


def eval_js(expression: str, await_promise: bool = True, timeout: int = 25):
    """Evaluate JS in remote Chrome via the /api/vnc/eval HTTP wrapper."""
    payload = json.dumps({"expression": expression, "awaitPromise": await_promise})
    try:
        r = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout), "-b", COOKIE_FILE,
             "-X", "POST", EVAL_URL,
             "-H", "Content-Type: application/json",
             "-d", payload],
            capture_output=True, text=True, timeout=timeout + 5,
        )
        if r.returncode != 0:
            return {"_error": f"curl failed: {r.stderr[:100]}"}
        try:
            return json.loads(r.stdout)
        except Exception:
            return {"_error": f"non-JSON: {r.stdout[:100]}"}
    except subprocess.TimeoutExpired:
        return {"_error": "curl-timeout"}
    except Exception as e:
        return {"_error": str(e)[:100]}


def navigate(url: str, wait_sec: int = 4):
    """Navigate Chrome to URL via CDP Page.navigate."""
    # We use eval_js to do Page.navigate (we can't via control API which has fixed actions)
    # Instead: set window.location.href (works for same-origin navigation, but for cross-origin
    # we need CDP. Use eval_js with a side-effect that triggers navigation.)
    # Actually the cleanest is to call our eval endpoint with a navigate expression.
    # CDP doesn't allow Page.navigate via Runtime.evaluate, but window.location.href = url works.
    js = f"window.location.href = {json.dumps(url)};"
    eval_js(js, await_promise=False, timeout=10)
    time.sleep(wait_sec)


def visit_website_for_email(url: str, timeout_sec: int = 8):
    """Visit a website, find emails, assess quality."""
    result = {
        "url": url, "emails": [], "quality_score": None, "quality_reasons": [],
        "title": None, "is_https": url.startswith("https://"),
        "viewport_meta": None, "generator": None, "copyright_year": None,
        "html_size": None,
    }
    try:
        navigate(url, wait_sec=2)
        # Wait for readyState
        deadline = time.time() + timeout_sec
        loaded = False
        while time.time() < deadline:
            r = eval_js("document.readyState", await_promise=False, timeout=5)
            ready = r.get("value") if isinstance(r, dict) else None
            if ready in ("complete", "interactive"):
                loaded = True
                time.sleep(1.0)
                break
            time.sleep(0.4)
        if not loaded:
            result["quality_reasons"].append("slow-load")

        # Single big eval to get everything we need
        js = r"""
        (function() {
          const emails = new Set();
          document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
            const href = a.getAttribute('href') || '';
            emails.add(href.slice(7).split('?')[0]);
          });
          const bodyText = document.body ? document.body.innerText : '';
          const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
          (bodyText.match(emailRe) || []).forEach(e => emails.add(e));

          const viewportMeta = !!document.querySelector('meta[name="viewport"]');
          const charsetMeta = !!document.querySelector('meta[charset]') || !!document.characterSet;
          const title = document.title || '';
          const titleLen = title.length;
          const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
          const imgCount = document.querySelectorAll('img').length;
          const h1Count = document.querySelectorAll('h1').length;
          const yearMatch = bodyText.match(/©\s*(\d{4})/);
          const copyrightYear = yearMatch ? parseInt(yearMatch[1]) : null;
          const htmlSize = document.documentElement.outerHTML.length;
          const isHttps = location.protocol === 'https:';
          return {
            emails: Array.from(emails).slice(0, 10),
            viewportMeta, charsetMeta, title, titleLen, generator,
            imgCount, h1Count, copyrightYear, htmlSize, isHttps
          };
        })()
        """
        r = eval_js(js, timeout=15)
        info = r.get("value", {}) if isinstance(r, dict) and r.get("ok") else {}
        if not info and r.get("error"):
            result["quality_reasons"].append(f"eval-error:{r['error'][:50]}")

        result["title"] = info.get("title")
        result["viewport_meta"] = info.get("viewportMeta")
        result["is_https"] = info.get("isHttps", result["is_https"])
        result["generator"] = info.get("generator")
        result["copyright_year"] = info.get("copyrightYear")
        result["html_size"] = info.get("htmlSize")

        for e in info.get("emails", []):
            cleaned = clean_email(e)
            if cleaned and cleaned not in result["emails"]:
                result["emails"].append(cleaned)

        # Quality scoring
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
        gen = (info.get("generator") or "").lower()
        if gen.startswith(("wix", "godaddy", "weebly")):
            score -= 10; reasons.append(f"generator-{info['generator']}")
        if info.get("htmlSize", 0) < 5000:
            score -= 15; reasons.append("small-page")
        result["quality_score"] = max(0, score)
        result["quality_reasons"] = reasons
    except Exception as e:
        result["quality_reasons"].append(f"error:{str(e)[:60]}")
        result["quality_score"] = 0
    return result


def find_email_via_ddg(query: str, timeout_sec: int = 12):
    """Search DuckDuckGo for a business, look for emails/FB links."""
    result = {"query": query, "emails": [], "facebook_url": None,
              "yelp_url": None, "other_url": None}
    try:
        url = f"https://html.duckduckgo.com/html/?q={query.replace(' ', '+')}+email"
        navigate(url, wait_sec=3)
        # Wait for readyState
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            r = eval_js("document.readyState", await_promise=False, timeout=5)
            ready = r.get("value") if isinstance(r, dict) else None
            if ready in ("complete", "interactive"):
                time.sleep(1.0)
                break
            time.sleep(0.4)

        # Extract emails + result links
        js = r"""
        (function() {
          const emails = new Set();
          const bodyText = document.body ? document.body.innerText : '';
          const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
          (bodyText.match(emailRe) || []).forEach(e => emails.add(e));
          // Also scan mailto: links
          document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
            const href = a.getAttribute('href') || '';
            emails.add(href.slice(7).split('?')[0]);
          });
          // Find result links — DDG html endpoint uses .result__a
          const links = Array.from(document.querySelectorAll('a.result__a, a.result__url, h2.result__title a'));
          let fbUrl = null, yelpUrl = null, otherUrl = null;
          for (const l of links) {
            const href = l.href || '';
            if (!fbUrl && /facebook\.com/i.test(href)) fbUrl = href;
            else if (!yelpUrl && /yelp\./i.test(href)) yelpUrl = href;
            else if (!otherUrl && !/duckduckgo\.com|google\.com|bing\.com/i.test(href)) otherUrl = href;
          }
          return { emails: Array.from(emails).slice(0, 5), facebookUrl: fbUrl, yelpUrl, otherUrl };
        })()
        """
        r = eval_js(js, timeout=15)
        info = r.get("value", {}) if isinstance(r, dict) and r.get("ok") else {}

        result["facebook_url"] = info.get("facebookUrl")
        result["yelp_url"] = info.get("yelpUrl")
        result["other_url"] = info.get("otherUrl")
        for e in info.get("emails", []):
            cleaned = clean_email(e)
            if cleaned and cleaned not in result["emails"]:
                result["emails"].append(cleaned)

        # If we have an "other" URL (the business's actual site or directory page),
        # visit it for emails
        if result["other_url"] and not result["emails"]:
            time.sleep(0.5)
            navigate(result["other_url"], wait_sec=3)
            r = eval_js("document.body ? document.body.innerText : ''", await_promise=False, timeout=10)
            text = r.get("value", "") if isinstance(r, dict) else ""
            for e in find_emails_in_text(text):
                if e not in result["emails"]:
                    result["emails"].append(e)
    except Exception as e:
        result["error"] = str(e)[:80]
    return result


if __name__ == "__main__":
    print("=== Testing visit_website_for_email on beyondwow.com ===")
    r = visit_website_for_email("https://beyondwow.com/")
    print(json.dumps(r, indent=2))
    print()
    print("=== Testing find_email_via_ddg ===")
    r = find_email_via_ddg("PGA Lawn care Asheville NC")
    print(json.dumps(r, indent=2))
