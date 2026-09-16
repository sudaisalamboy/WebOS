/**
 * Anti-Detect Script — hides automation/sandbox fingerprints.
 */
export const ANTI_DETECT_JS = `
(function() {
  if (window.__antiDetectInstalled) return;
  window.__antiDetectInstalled = true;

  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch (e) {}
  try {
    var fakePlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 }
    ];
    Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });
    Object.defineProperty(navigator, 'mimeTypes', { get: () => [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }], configurable: true });
  } catch (e) {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true }); } catch (e) {}
  try {
    if (navigator.permissions && navigator.permissions.query) {
      var origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(params) {
        if (params.name === 'notifications') return Promise.resolve({ state: Notification.permission, onchange: null, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){return false;} });
        return origQuery(params);
      };
    }
  } catch (e) {}
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = { id: undefined, connect: function(){return {onDisconnect:{addListener:function(){}},onMessage:{addListener:function(){}},postMessage:function(){},disconnect:function(){}};}, sendMessage: function(){} };
    }
    if (!window.chrome.app) window.chrome.app = { isInstalled: false, getDetails: function(){return null;}, getIsInstalled: function(){return false;} };
    if (!window.chrome.csi) window.chrome.csi = function(){return {onloadT:Date.now(),startE:Date.now(),pageT:1000,tran:15};};
    if (!window.chrome.loadTimes) window.chrome.loadTimes = function(){return {commitLoadTime:Date.now()/1000,connectionInfo:'h2',finishDocumentLoadTime:Date.now()/1000,finishLoadTime:Date.now()/1000,firstPaintTime:Date.now()/1000,navigationType:'Other',npnNegotiatedProtocol:'h2',requestTime:Date.now()/1000,startLoadTime:Date.now()/1000,wasAlternateProtocolAvailable:false,wasFetchedViaSpdy:true,wasNpnNegotiated:true};};
  } catch (e) {}
  try {
    var getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, param);
    };
    if (window.WebGL2RenderingContext) {
      var getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return 'Intel Inc.';
        if (param === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter2.call(this, param);
      };
    }
  } catch (e) {}
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true }); } catch (e) {}
  try { delete window.$cdc_; delete window.cdc_; delete window._selenium; delete window._phantom; } catch (e) {}
  try { Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64', configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true }); } catch (e) {}
  try {
    var ua = navigator.userAgent;
    if (ua.includes('Headless')) {
      Object.defineProperty(navigator, 'userAgent', { get: () => ua.replace(/HeadlessChrome/g, 'Chrome'), configurable: true });
    }
  } catch (e) {}
  console.log('[AntiDetect] All fingerprints masked');
})();
`;
