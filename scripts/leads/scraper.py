"""
Google Maps business scraper — extracts listings via CDP from Remote Chrome.

For each listing returns:
  name, rating, reviews, phone, address, has_website, website_url,
  booking_url, place_url, plus_url (gmaps place id link)
"""
import json
import re
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts/leads")
from cdp_driver import CDP


EXTRACT_JS = r"""
(function() {
  const articles = Array.from(document.querySelectorAll('[role="article"]'));
  return articles.map(a => {
    const name = a.querySelector("[class*='fontHeadlineSmall']")?.textContent?.trim() || null;
    // Rating: e.g. "4.9 顆星" / "4.9 stars"
    const ratingEl = a.querySelector("span[aria-label*='star'], span[aria-label*='顆星']");
    const ratingAria = ratingEl?.getAttribute("aria-label") || "";
    const ratingMatch = ratingAria.match(/(\d\.\d)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    // Review count: "(2,577)"
    const allText = a.textContent || "";
    const reviewsMatch = allText.match(/\(([\d,]+)\s*\)/);
    const reviews = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, "")) : null;
    // Phone: +1 XXX-XXX-XXXX or (XXX) XXX-XXXX
    const phoneMatch = allText.match(/\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const phone = phoneMatch ? phoneMatch[0].trim() : null;
    // Links
    const links = Array.from(a.querySelectorAll("a"));
    // Website link: anchor text matches "Website" / "網站" / "Site web" / "Sitio web" etc.
    // The href is the actual destination URL (Google wraps it but the href is direct)
    const websiteLink = links.find(l => /Website|網站|Site web|Sitio web|Webseite|Sito web|サイト|Веб-сайт|Strona|Vebez/i.test(l.textContent));
    const websiteUrl = websiteLink?.href || null;
    // Booking link
    const bookingLink = links.find(l => /Book|預訂|Reserv|Réserv|Buchen|Prenota/i.test(l.textContent) && l !== websiteLink);
    // Place page link (contains /maps/place/)
    const placeLink = links.find(l => l.href.includes("/maps/place/"));
    // Address: text between rating block and phone. Heuristic: look for street-number pattern.
    const addrMatch = allText.match(/(\d+\s+[A-Z][A-Za-z0-9\s.'-]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Pl|Place|Ct|Court|Pkwy|Highway|Hwy)\b[^\n,+]*[,\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*[A-Z]{2}\s+\d{5})/);
    const address = addrMatch ? addrMatch[1].trim() : null;

    return {
      name, rating, reviews, phone, address,
      hasWebsite: !!websiteUrl,
      websiteUrl,
      bookingUrl: bookingLink?.href || null,
      placeUrl: placeLink?.href || null,
    };
  }).filter(b => b.name && b.name.length > 1);
})()
"""


def scrape_query(cdp: CDP, query: str, scrolls: int = 8, scroll_pause: float = 2.0):
    """Scrape a Google Maps search query. Returns list of business dicts."""
    url = f"https://www.google.com/maps/search/{query.replace(' ', '+')}"
    print(f"  → navigating to: {url[:90]}…")
    cdp.navigate(url, wait_sec=8)

    # Scroll the feed to load more results
    for i in range(scrolls):
        cdp.eval_js(
            "(function(){const f=document.querySelector('[role=\"feed\"]')||"
            "document.querySelector('div[role=\"feed\"]');if(f)f.scrollBy(0,2500);"
            "window.scrollBy(0,2500);})()",
            await_promise=False,
        )
        time.sleep(scroll_pause)
        # Quick count check
        n = cdp.eval_js("document.querySelectorAll('[role=\"article\"]').length", await_promise=False)
        print(f"    scroll {i+1}/{scrolls}: {n} listings loaded")

    raw = cdp.eval_js(EXTRACT_JS) or []
    print(f"  ✓ extracted {len(raw)} listings from '{query}'")
    return raw


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
    cdp = CDP()
    try:
        results = scrape_query(cdp, "plumbers in Austin TX", scrolls=4)
        print(json.dumps(results[:3], indent=2, ensure_ascii=False))
        print(f"\nTotal: {len(results)} (deduped: {len(dedupe_by_name_phone(results))})")
    finally:
        cdp.close()
