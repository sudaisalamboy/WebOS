(function() {
  // Read config from the script element's data attribute
  var scriptEl = document.currentScript || document.getElementById('vcam-config-script');
  var configJSON = scriptEl ? scriptEl.getAttribute('data-config') : null;
  if (!configJSON) return;

  var CFG = JSON.parse(configJSON);
  if (!CFG.enabled) return;

  if (!window._vcam) {
    window._vcam = { zoom: 1.0, panX: 0, panY: 0, brightness: 100, contrast: 100, saturation: 100, hue: 0, mirror: false, flip: false, grayscale: false, sepia: false, invert: false, width: 640, height: 480, fps: 15, sourceType: 'test-pattern', sourceUrl: '', stretchX: 1.0, stretchY: 1.0 };
  }
  try { for (var k in CFG) { if (CFG.hasOwnProperty(k)) window._vcam[k] = CFG[k]; } } catch(e) {}
  if (window._cameraOverrideActive) return;
  window._cameraOverrideActive = true;

  if (!window._originalGetUserMedia) {
    window._originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    window._originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  }

  navigator.mediaDevices.enumerateDevices = function() {
    return Promise.resolve([
      { deviceId: 'vcam-front-001', kind: 'videoinput', label: 'Virtual Camera (Front HD)', groupId: 'g1' },
      { deviceId: 'vcam-back-001', kind: 'videoinput', label: 'Virtual Camera (Back HD)', groupId: 'g1' },
      { deviceId: 'vmic-001', kind: 'audioinput', label: 'Virtual Microphone', groupId: 'g2' },
      { deviceId: 'vspk-001', kind: 'audiooutput', label: 'Virtual Speaker', groupId: 'g3' }
    ]);
  };

  var canvas = document.createElement('canvas');
  canvas.width = window._vcam.width || 640;
  canvas.height = window._vcam.height || 480;
  canvas.style.display = 'none';
  if (document.body) document.body.appendChild(canvas);
  else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(canvas); });

  var ctx = canvas.getContext('2d');
  var mediaEl = null, mediaReady = false, imgReady = false, startTime = Date.now();

  if (window._vcam.sourceType === 'video' && window._vcam.sourceUrl) {
    mediaEl = document.createElement('video');
    mediaEl.src = window._vcam.sourceUrl; mediaEl.loop = true; mediaEl.muted = true;
    mediaEl.playsInline = true; mediaEl.autoplay = true; mediaEl.style.display = 'none';
    if (document.body) document.body.appendChild(mediaEl);
    else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(mediaEl); });
    mediaEl.play().catch(function(){});
    mediaEl.addEventListener('loadeddata', function(){ mediaReady = true; });
    mediaEl.addEventListener('canplay', function(){ mediaReady = true; });
  } else if (window._vcam.sourceType === 'image' && window._vcam.sourceUrl) {
    mediaEl = new Image();
    mediaEl.src = window._vcam.sourceUrl;
    mediaEl.onload = function(){ imgReady = true; };
  }

  function drawZoomed(srcEl, srcW, srcH, cw, ch, v, autoBrightness) {
    var zoom = Math.max(1.0, v.zoom || 1.0);
    var cropW = srcW / zoom, cropH = srcH / zoom;
    var sx = (srcW - cropW) / 2 + (v.panX || 0) * ((srcW - cropW) / 2);
    var sy = (srcH - cropH) / 2 + (v.panY || 0) * ((srcH - cropH) / 2);
    sx = Math.max(0, Math.min(srcW - cropW, sx));
    sy = Math.max(0, Math.min(srcH - cropH, sy));

    // Build filter string — include auto brightness for images (subtle living effect)
    var filters = [];
    var br = v.brightness || 100;
    if (autoBrightness) br += autoBrightness; // ±2 oscillation for images
    if (br !== 100) filters.push('brightness(' + br + '%)');
    if (v.contrast !== 100) filters.push('contrast(' + v.contrast + '%)');
    if (v.saturation !== 100) filters.push('saturate(' + v.saturation + '%)');
    if (v.hue !== 0) filters.push('hue-rotate(' + v.hue + 'deg)');
    if (v.grayscale) filters.push('grayscale(100%)');
    if (v.sepia) filters.push('sepia(100%)');
    if (v.invert) filters.push('invert(100%)');
    ctx.filter = filters.length ? filters.join(' ') : 'none';

    // Save + apply mirror/flip + stretch transforms
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    // Mirror/flip
    ctx.scale(v.mirror ? -1 : 1, v.flip ? -1 : 1);
    // Stretch (compress/expand) — stretchX < 1 = thinner, > 1 = wider
    var sx2 = v.stretchX || 1.0;
    var sy2 = v.stretchY || 1.0;
    ctx.scale(sx2, sy2);
    ctx.translate(-cw / 2, -ch / 2);
    // Draw with zoom crop
    ctx.drawImage(srcEl, sx, sy, cropW, cropH, 0, 0, cw, ch);
    ctx.restore();
    ctx.filter = 'none';
  }

  var fps = window._vcam.fps || 15;

  function drawFrame() {
    try {
      var v = window._vcam; if (!v) return;
      var cw = canvas.width, ch = canvas.height, elapsed = (Date.now() - startTime) / 1000;

      if (v.sourceType === 'video' && mediaEl) {
        if (mediaReady && mediaEl.videoWidth > 0) {
          // Video: no auto-brightness needed (frames already change)
          drawZoomed(mediaEl, mediaEl.videoWidth, mediaEl.videoHeight, cw, ch, v, 0);
        } else { ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, cw, ch); }
      } else if (v.sourceType === 'image' && mediaEl) {
        if (imgReady && mediaEl.naturalWidth > 0) {
          // IMAGE: add subtle auto-lighting effect (±2% brightness oscillation)
          // This is invisible to human eyes but makes every frame unique
          // so automation/websites cannot detect it as "static image"
          var autoBr = Math.sin(elapsed * 0.8) * 2; // ±2, period ~8s, very smooth
          drawZoomed(mediaEl, mediaEl.naturalWidth, mediaEl.naturalHeight, cw, ch, v, autoBr);
        } else { ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, cw, ch); }
      } else {
        // Test pattern
        var colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#ffffff'];
        var bw = cw / colors.length;
        for (var i = 0; i < colors.length; i++) { ctx.fillStyle = colors[i]; ctx.fillRect(i*bw, 0, bw, ch); }
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, ch-30, cw, 30);
        ctx.fillStyle = '#fff'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
        ctx.fillText('VIRTUAL CAMERA', cw/2, ch-10);
        var x = (Math.sin(elapsed*2)*0.5+0.5)*cw, y = (Math.cos(elapsed*1.5)*0.5+0.5)*ch;
        ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
      }

      // === LIVE indicator (subtle, for all source types) ===
      // Small pulsing dot top-right corner — barely visible but changes pixels
      var pulse = Math.sin(elapsed * 2.5) * 0.5 + 0.5;
      ctx.save();
      ctx.globalAlpha = 0.15 + pulse * 0.15; // very subtle (0.15-0.30)
      ctx.fillStyle = '#ff0000';
      ctx.beginPath(); ctx.arc(cw - 12, 12, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Tiny timestamp (bottom-right) — changes every frame, very low opacity
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#ffffff';
      ctx.font = '7px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(Date.now().toString().slice(-6), cw - 3, ch - 3);
      ctx.restore();
    } catch(e) {
      try { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); } catch(e2) {}
    }
  }

  setInterval(drawFrame, 1000 / fps);
  drawFrame();

  // === LIVE CONFIG POLLING ===
  // Poll the API every 2 seconds for config changes (zoom, pan, filters, source)
  // This makes slider changes apply LIVE without needing CDP patch or page reload
  var lastConfigStr = JSON.stringify(CFG);
  setInterval(function() {
    fetch('http://127.0.0.1:3000/api/camera-inject/extension-config', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.config) return;
        var newStr = JSON.stringify(data.config);
        if (newStr !== lastConfigStr) {
          lastConfigStr = newStr;
          var newCfg = data.config;
          // Update vcam properties
          for (var k in newCfg) {
            if (newCfg.hasOwnProperty(k)) {
              try { window._vcam[k] = newCfg[k]; } catch(e) {}
            }
          }
          // If source changed, reload the media element
          if (newCfg.sourceType !== CFG.sourceType || newCfg.sourceUrl !== CFG.sourceUrl) {
            CFG.sourceType = newCfg.sourceType;
            CFG.sourceUrl = newCfg.sourceUrl;
            // Reload media
            mediaReady = false; imgReady = false;
            if (newCfg.sourceType === 'video' && newCfg.sourceUrl) {
              if (!mediaEl || mediaEl.tagName !== 'VIDEO') {
                mediaEl = document.createElement('video');
                mediaEl.loop = true; mediaEl.muted = true;
                mediaEl.playsInline = true; mediaEl.autoplay = true;
                mediaEl.style.display = 'none';
                if (document.body) document.body.appendChild(mediaEl);
              }
              mediaEl.src = newCfg.sourceUrl;
              mediaEl.play().catch(function(){});
              mediaEl.addEventListener('loadeddata', function(){ mediaReady = true; });
              mediaEl.addEventListener('canplay', function(){ mediaReady = true; });
            } else if (newCfg.sourceType === 'image' && newCfg.sourceUrl) {
              if (!mediaEl || mediaEl.tagName !== 'IMG') {
                mediaEl = new Image();
              }
              mediaEl.onload = function(){ imgReady = true; };
              mediaEl.src = newCfg.sourceUrl;
            } else {
              mediaEl = null;
            }
          }
          console.log('[VCam] Config updated: zoom=' + window._vcam.zoom + ' stretchX=' + window._vcam.stretchX);
        }
      })
      .catch(function(e) {});
  }, 2000);

  // Override getUserMedia
  var sharedVS = null, sharedAC = null, sharedAD = null;
  function getVS() { if (sharedVS && sharedVS.active) return sharedVS; try { sharedVS = canvas.captureStream(fps); return sharedVS; } catch(e) { return null; } }
  function getAT() {
    if (sharedAD && sharedAC) { try { var t = sharedAD.stream.getAudioTracks(); if (t.length > 0) return t[0].clone(); } catch(e) {} }
    try {
      if (!sharedAC) sharedAC = new (window.AudioContext || window.webkitAudioContext)();
      if (sharedAC.state === 'suspended') sharedAC.resume().catch(function(){});
      var osc = sharedAC.createOscillator(), gain = sharedAC.createGain();
      gain.gain.value = 0.001; osc.connect(gain);
      if (!sharedAD) sharedAD = sharedAC.createMediaStreamDestination();
      gain.connect(sharedAD); osc.start();
      return sharedAD.stream.getAudioTracks()[0];
    } catch(e) { return null; }
  }

  navigator.mediaDevices.getUserMedia = function(constraints) {
    window._gumCallCount = (window._gumCallCount || 0) + 1;
    var tracks = [];
    var wantVideo = !constraints || constraints.video !== false;
    var wantAudio = !constraints || constraints.audio !== false;

    // Detect if website wants front or back camera
    var facingMode = 'user'; // default = front
    if (constraints && constraints.video && typeof constraints.video === 'object') {
      if (constraints.video.facingMode) {
        if (typeof constraints.video.facingMode === 'string') facingMode = constraints.video.facingMode;
        else if (Array.isArray(constraints.video.facingMode) && constraints.video.facingMode.length > 0) facingMode = constraints.video.facingMode[0];
        else if (constraints.video.facingMode.exact) facingMode = constraints.video.facingMode.exact;
        else if (constraints.video.facingMode.ideal) facingMode = constraints.video.facingMode.ideal;
      }
      // Check deviceId constraint too
      if (constraints.video.deviceId) {
        var devId = typeof constraints.video.deviceId === 'string' ? constraints.video.deviceId :
                    constraints.video.deviceId.exact || constraints.video.deviceId.ideal ||
                    (Array.isArray(constraints.video.deviceId) ? constraints.video.deviceId[0] : null);
        if (devId && devId.indexOf('back') !== -1) facingMode = 'environment';
      }
    }
    var isBackCamera = facingMode === 'environment' || facingMode === 'rear';
    var cameraLabel = isBackCamera ? 'Virtual Camera (Back HD)' : 'Virtual Camera (Front HD)';

    if (wantVideo) {
      try {
        var vs = getVS();
        if (vs) {
          var vt = vs.getVideoTracks();
          if (vt.length > 0) {
            var t = vt[0].clone();
            try { Object.defineProperty(t, 'label', { value: cameraLabel, configurable: true }); } catch(e) {}
            tracks.push(t);
          }
        }
      } catch(e) {}
    }
    if (wantAudio) { try { var at = getAT(); if (at) tracks.push(at.clone()); } catch(e) {} }
    if (tracks.length === 0) return Promise.resolve(new MediaStream());
    console.log('[VCam] getUserMedia: ' + (isBackCamera ? 'BACK' : 'FRONT') + ' camera → ' + tracks.length + ' tracks');
    return Promise.resolve(new MediaStream(tracks));
  };
  if (navigator.getUserMedia) { navigator.getUserMedia = function(c, s, e) { try { navigator.mediaDevices.getUserMedia(c).then(s).catch(e); } catch(err) { if (e) e(err); } }; }
  setTimeout(function() { try { navigator.mediaDevices.dispatchEvent(new Event('devicechange')); } catch(e) {} }, 50);
  console.log('[VCam] Camera active: ' + window._vcam.sourceType + ' (stretchX:' + (window._vcam.stretchX||1) + ' stretchY:' + (window._vcam.stretchY||1) + ')');
})();
