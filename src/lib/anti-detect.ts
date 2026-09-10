/**
 * Anti-detection JavaScript for VNC sessions
 * Hides browser automation traces
 */

export const ANTI_DETECT_JS = `
(function() {
  // Hide webdriver property
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });
  
  // Override plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5]
  });
  
  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en']
  });
  
  // Override platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32'
  });
  
  // Add chrome object
  window.chrome = {
    runtime: {}
  };
  
  // Override permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );
})();
`;
