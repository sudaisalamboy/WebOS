/**
 * Content Script (ISOLATED world) — loads camera-main.js as extension resource
 * Extension resources bypass page CSP.
 */
(async function() {
  var config = null;
  var retries = 0;
  while (retries < 30) {
    try {
      if (retries === 0) {
        try { await chrome.runtime.sendMessage({ type: 'SYNC_NOW' }); } catch(e) {}
        await new Promise(r => setTimeout(r, 500));
      }
      config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      if (config && config.enabled) break;
    } catch (e) {}
    config = null;
    retries++;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!config || !config.enabled) return;

  // Load camera-main.js as an extension resource (bypasses CSP)
  var s = document.createElement('script');
  s.src = chrome.runtime.getURL('camera-main.js');
  s.id = 'vcam-config-script';
  s.setAttribute('data-config', JSON.stringify(config));
  s.onload = function() { this.remove(); };
  (document.head || document.documentElement).appendChild(s);
})();
