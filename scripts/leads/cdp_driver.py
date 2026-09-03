#!/usr/bin/env python3
"""
CDP driver for the Remote Chrome browser (port 9222).
Used for lead-generation scraping of Google Maps.

Usage:
  from cdp_driver import CDP
  cdp = CDP()
  cdp.navigate("https://www.google.com/maps/search/plumbers+in+Austin+TX")
  listings = cdp.eval_js(EXTRACT_JS)
"""
import json
import time
import requests
import websocket

CDP_HTTP = "http://127.0.0.1:9222"


def get_page_tab_ws():
    """Return the WebSocket URL of the first page-type tab."""
    tabs = requests.get(f"{CDP_HTTP}/json", timeout=5).json()
    for t in tabs:
        if t.get("type") == "page":
            return t["webSocketDebuggerUrl"]
    raise RuntimeError("No page tab in Chrome")


class CDP:
    def __init__(self, ws_url=None, timeout=20):
        self.ws_url = ws_url or get_page_tab_ws()
        self.timeout = timeout
        self.ws = websocket.create_connection(self.ws_url, timeout=timeout)
        self._id = 0

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

    def _reconnect(self):
        """Reconnect the WebSocket if it dies."""
        try: self.ws.close()
        except: pass
        self.ws = websocket.create_connection(self.ws_url, timeout=self.timeout)

    def send(self, method, params=None, retries=2):
        self._id += 1
        msg_id = self._id
        payload = {"id": msg_id, "method": method, "params": params or {}}
        last_err = None
        for attempt in range(retries + 1):
            try:
                self.ws.send(json.dumps(payload))
                while True:
                    raw = self.ws.recv()
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    if msg.get("id") == msg_id:
                        if "error" in msg:
                            raise RuntimeError(f"CDP error: {msg['error']}")
                        return msg.get("result", {})
                # not reached
            except Exception as e:
                last_err = e
                # reconnect and retry
                try: self._reconnect()
                except: pass
        raise RuntimeError(f"CDP send failed after {retries+1} attempts: {last_err}")

    def navigate(self, url, wait_sec=6):
        """Navigate to URL and wait for the page to load."""
        self.send("Page.enable")
        self.send("Page.navigate", {"url": url})
        # Give Google Maps time to render its dynamic JS
        time.sleep(wait_sec)

    def eval_js(self, expression, await_promise=True):
        """Evaluate a JS expression and return the value (or None)."""
        try:
            result = self.send("Runtime.evaluate", {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "userGesture": True,
            })
        except Exception as e:
            return {"_error": f"send-failed: {str(e)[:200]}"}
        # result["result"] should be {"type": ..., "value": ...}
        result_obj = result.get("result") or {}
        val = result_obj.get("value")
        exc = result.get("exceptionDetails")
        if exc:
            # exceptionDetails.exception might be None — be defensive
            exc_obj = exc.get("exception") or {}
            desc = exc_obj.get("description") if isinstance(exc_obj, dict) else None
            if not desc:
                desc = exc.get("text") or "unknown-exception"
            return {"_error": str(desc)[:300]}
        return val

    def click(self, x, y):
        """Simulate a mouse click at viewport coords (x, y)."""
        for evt in ("mousePressed", "mouseReleased"):
            self.send("Input.dispatchMouseEvent", {
                "type": evt, "x": x, "y": y,
                "button": "left", "clickCount": 1,
            })

    def scroll_feed(self, selector, times=5, pause=1.5):
        """Scroll an element to load more Google Maps results."""
        js = f"""
        (function() {{
          const el = document.querySelector({json.dumps(selector)});
          if (!el) return false;
          el.scrollBy(0, 1500);
          return true;
        }})()
        """
        for _ in range(times):
            self.eval_js(js, await_promise=False)
            time.sleep(pause)

    def screenshot(self, path):
        """Capture full-page screenshot to file."""
        result = self.send("Page.captureScreenshot", {"format": "png"})
        import base64
        with open(path, "wb") as f:
            f.write(base64.b64decode(result["data"]))
        return path

    def current_url(self):
        return self.eval_js("window.location.href")

    def title(self):
        return self.eval_js("document.title")


if __name__ == "__main__":
    cdp = CDP()
    print("Current URL:", cdp.current_url())
    print("Title:", cdp.title())
    cdp.close()
