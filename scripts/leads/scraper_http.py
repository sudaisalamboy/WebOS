"""
HTTP-based scraper that uses /api/vnc/eval (reliable) instead of Python websocket.
"""
import json
import os
import subprocess
import sys
import time

COOKIE_FILE = "/tmp/webos-cookies.txt"
EVAL_URL = "http://localhost:3000/api/vnc/eval"


def eval_js(expression, await_promise=False, timeout=30):
    payload = json.dumps({"expression": expression, "awaitPromise": await_promise})
    try:
        r = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout), "-b", COOKIE_FILE,
             "-X", "POST", EVAL_URL,
             "-H", "Content-Type: application/json",
             "-d", payload],
            capture_output=True, text=True, timeout=timeout + 5,
        )
        return json.loads(r.stdout)
    except Exception as e:
        return {"ok": False, "error": str(e)[:120]}


def navigate(url, wait_sec=6):
    """Navigate Chrome to URL via window.location.href."""
    js = f"window.location.href = {json.dumps(url)};"
    eval_js(js, await_promise=False, timeout=15)
    time.sleep(wait_sec)


def wait_for_load(timeout_sec=15):
    """Wait for document.readyState to be 'complete' or 'interactive'."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        r = eval_js("document.readyState", await_promise=False, timeout=10)
        ready = r.get("value") if r.get("ok") else None
        if ready in ("complete", "interactive"):
            time.sleep(1.0)
            return True
        time.sleep(0.5)
    return False


def scroll_feed(times=3, pause=2.0):
    """Scroll the Google Maps feed to load more results."""
    for i in range(times):
        eval_js(
            '(function(){const f=document.querySelector(\'[role="feed"]\')||document.querySelector("div[role=feed]");if(f)f.scrollBy(0,2500);window.scrollBy(0,2500);})()',
            await_promise=False, timeout=10,
        )
        time.sleep(pause)
        # Quick count
        r = eval_js('document.querySelectorAll(\'[role="article"]\').length', await_promise=False, timeout=10)
        n = r.get("value") if r.get("ok") else 0
        print(f"    scroll {i+1}/{times}: {n} listings loaded")


EXTRACT_JS = r"""
(function() {
  const articles = Array.from(document.querySelectorAll('[role="article"]'));
  return articles.map(a => {
    const name = a.querySelector("[class*='fontHeadlineSmall']")?.textContent?.trim() || null;
    const ratingEl = a.querySelector("span[aria-label*='star'], span[aria-label*='顆星']");
    const ratingAria = ratingEl?.getAttribute("aria-label") || "";
    const ratingMatch = ratingAria.match(/(\d\.\d)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    const allText = a.textContent || "";
    const reviewsMatch = allText.match(/\(([\d,]+)\s*\)/);
    const reviews = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, "")) : null;
    const phoneMatch = allText.match(/\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const phone = phoneMatch ? phoneMatch[0].trim() : null;
    const links = Array.from(a.querySelectorAll("a"));
    const websiteLink = links.find(l => /Website|網站|Site web|Sitio web/i.test(l.textContent));
    const websiteUrl = websiteLink?.href || null;
    const placeLink = links.find(l => l.href.includes("/maps/place/"));
    return {
      name, rating, reviews, phone,
      hasWebsite: !!websiteUrl,
      websiteUrl,
      placeUrl: placeLink?.href || null,
    };
  }).filter(b => b.name && b.name.length > 1);
})()
"""


def scrape_query_http(query, scrolls=3, scroll_pause=2.0):
    """Scrape a Google Maps search query using HTTP-based eval."""
    url = f"https://www.google.com/maps/search/{query.replace(' ', '+')}"
    print(f"  → navigating to: {url[:90]}…")
    navigate(url, wait_sec=8)
    scroll_feed(scrolls, scroll_pause)
    r = eval_js(EXTRACT_JS, await_promise=False, timeout=20)
    listings = r.get("value", []) if r.get("ok") else []
    print(f"  ✓ extracted {len(listings)} listings from '{query}'")
    return listings


def dedupe_by_name_phone(listings):
    seen = set()
    out = []
    for b in listings:
        key = (b.get("name", ""), b.get("phone") or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(b)
    return out


if __name__ == "__main__":
    # Test
    listings = scrape_query_http("tutoring centers in Austin TX", scrolls=2)
    print(f"\nTotal: {len(listings)} (deduped: {len(dedupe_by_name_phone(listings))})")
    for b in listings[:3]:
        print(f"  - {b['name']} | rating={b.get('rating')} | hasWebsite={b.get('hasWebsite')}")
