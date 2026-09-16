/**
 * Auto-Allow Script — makes permissions.query() return 'granted' for camera/mic.
 * Does NOT touch window.confirm or window.alert.
 */
export const AUTO_ALLOW_JS = `
(function() {
  if (window.__autoAllowInstalled) return;
  window.__autoAllowInstalled = true;

  try {
    if (navigator.permissions && navigator.permissions.query) {
      var origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(desc) {
        if (desc && (desc.name === 'camera' || desc.name === 'microphone' || desc.name === 'video' || desc.name === 'audio' || desc.name === 'videoCapture' || desc.name === 'audioCapture')) {
          return Promise.resolve({ state: 'granted', onchange: null, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){return false;} });
        }
        return origQuery(desc);
      };
    }
  } catch (e) {}
  console.log('[AutoAllow] Installed — permissions.query() returns granted for camera/mic');
})();
`;
