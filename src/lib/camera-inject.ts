/**
 * Unified Camera Injection Library
 * --------------------------------
 * The virtual camera override script that makes websites see our
 * video/image as a live camera feed via getUserMedia().
 */

export interface CameraConfig {
  sourceType: 'test-pattern' | 'video' | 'image'
  sourceUrl?: string
  zoom: number
  panX: number
  panY: number
  brightness: number
  contrast: number
  saturation: number
  hue: number
  mirror: boolean
  flip: boolean
  grayscale: boolean
  sepia: boolean
  invert: boolean
  width: number
  height: number
  fps: number
  stretchX: number  // 0.3-3.0 — compress/expand horizontally (thin/fat)
  stretchY: number  // 0.3-3.0 — compress/expand vertically
}

export const DEFAULT_CONFIG: CameraConfig = {
  sourceType: 'test-pattern',
  zoom: 1.0,
  panX: 0,
  panY: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  mirror: false,
  flip: false,
  grayscale: false,
  sepia: false,
  invert: false,
  width: 640,
  height: 480,
  fps: 15,
  stretchX: 1.0,
  stretchY: 1.0,
}

export function buildCameraScript(config: Partial<CameraConfig> = {}): string {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const configJSON = JSON.stringify(cfg)

  return `
(function() {
  var CFG = ${configJSON};

  if (!window._vcam) {
    window._vcam = {
      zoom: 1.0, panX: 0, panY: 0,
      brightness: 100, contrast: 100, saturation: 100, hue: 0,
      mirror: false, flip: false,
      grayscale: false, sepia: false, invert: false,
      width: 640, height: 480, fps: 15,
      sourceType: 'test-pattern', sourceUrl: ''
    };
  }

  try {
    for (var k in CFG) {
      if (CFG.hasOwnProperty(k)) window._vcam[k] = CFG[k];
    }
  } catch(e) {}

  if (window._cameraOverrideActive) {
    return 'camera updated: ' + JSON.stringify({ zoom: window._vcam.zoom, sourceType: window._vcam.sourceType });
  }
  window._cameraOverrideActive = true;

  if (!window._originalGetUserMedia) {
    window._originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    window._originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  }

  var fakeCamera = { deviceId: 'virtual-camera-001', kind: 'videoinput', label: 'Virtual Camera (HD)', groupId: 'grp-001' };
  var fakeMic = { deviceId: 'virtual-mic-001', kind: 'audioinput', label: 'Virtual Microphone', groupId: 'grp-002' };

  navigator.mediaDevices.enumerateDevices = function() {
    return Promise.resolve([fakeCamera, fakeMic, { deviceId: 'spk-001', kind: 'audiooutput', label: 'Virtual Speaker', groupId: 'grp-003' }]);
  };

  var canvas = document.createElement('canvas');
  canvas.width = window._vcam.width || 640;
  canvas.height = window._vcam.height || 480;
  canvas.style.display = 'none';
  if (document.body) document.body.appendChild(canvas);
  else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(canvas); });

  var ctx = canvas.getContext('2d');
  var mediaElement = null;
  var mediaReady = false;
  var imgReady = false;
  var startTime = Date.now();

  if (window._vcam.sourceType === 'video' && window._vcam.sourceUrl) {
    mediaElement = document.createElement('video');
    mediaElement.src = window._vcam.sourceUrl;
    mediaElement.loop = true;
    mediaElement.muted = true;
    mediaElement.playsInline = true;
    mediaElement.autoplay = true;
    mediaElement.crossOrigin = 'anonymous';
    mediaElement.style.display = 'none';
    if (document.body) document.body.appendChild(mediaElement);
    else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(mediaElement); });
    mediaElement.play().catch(function(){});
    mediaElement.addEventListener('loadeddata', function(){ mediaReady = true; });
    mediaElement.addEventListener('canplay', function(){ mediaReady = true; });
  } else if (window._vcam.sourceType === 'image' && window._vcam.sourceUrl) {
    mediaElement = new Image();
    mediaElement.src = window._vcam.sourceUrl;
    mediaElement.crossOrigin = 'anonymous';
    mediaElement.onload = function(){ imgReady = true; };
  }

  function drawZoomed(srcEl, srcW, srcH, cw, ch, v) {
    var zoom = Math.max(1.0, v.zoom || 1.0);
    var cropW = srcW / zoom;
    var cropH = srcH / zoom;
    var maxPanX = (srcW - cropW) / 2;
    var maxPanY = (srcH - cropH) / 2;
    var sx = (srcW - cropW) / 2 + (v.panX || 0) * maxPanX;
    var sy = (srcH - cropH) / 2 + (v.panY || 0) * maxPanY;
    sx = Math.max(0, Math.min(srcW - cropW, sx));
    sy = Math.max(0, Math.min(srcH - cropH, sy));

    var filters = [];
    if (v.brightness !== 100) filters.push('brightness(' + v.brightness + '%)');
    if (v.contrast !== 100) filters.push('contrast(' + v.contrast + '%)');
    if (v.saturation !== 100) filters.push('saturate(' + v.saturation + '%)');
    if (v.hue !== 0) filters.push('hue-rotate(' + v.hue + 'deg)');
    if (v.grayscale) filters.push('grayscale(100%)');
    if (v.sepia) filters.push('sepia(100%)');
    if (v.invert) filters.push('invert(100%)');
    ctx.filter = filters.length ? filters.join(' ') : 'none';

    ctx.save();
    if (v.mirror || v.flip) {
      ctx.translate(cw/2, ch/2);
      ctx.scale(v.mirror ? -1 : 1, v.flip ? -1 : 1);
      ctx.translate(-cw/2, -ch/2);
    }
    ctx.drawImage(srcEl, sx, sy, cropW, cropH, 0, 0, cw, ch);
    ctx.restore();
    ctx.filter = 'none';
  }

  function drawFrame() {
    try {
      var v = window._vcam;
      if (!v) return;
      var cw = canvas.width;
      var ch = canvas.height;

      if (v.sourceType === 'video' && mediaElement) {
        if (mediaReady && mediaElement.videoWidth > 0) {
          drawZoomed(mediaElement, mediaElement.videoWidth, mediaElement.videoHeight, cw, ch, v);
        } else {
          drawLoadingPattern(cw, ch, 'Loading video...');
        }
      } else if (v.sourceType === 'image' && mediaElement) {
        if (imgReady && mediaElement.naturalWidth > 0) {
          drawZoomed(mediaElement, mediaElement.naturalWidth, mediaElement.naturalHeight, cw, ch, v);
        } else {
          drawLoadingPattern(cw, ch, 'Loading image...');
        }
      } else {
        drawTestPattern(cw, ch);
      }
    } catch(e) {
      try {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Camera Error', canvas.width/2, canvas.height/2);
      } catch(e2) {}
    }
    requestAnimationFrame(drawFrame);
  }

  function drawLoadingPattern(cw, ch, msg) {
    var elapsed = (Date.now() - startTime) / 1000;
    var grad = ctx.createLinearGradient(0, 0, cw, ch);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(0.5, '#16213e');
    grad.addColorStop(1, '#0f3460');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, cw, ch);
    var pulse = Math.sin(elapsed * 3) * 0.3 + 0.7;
    ctx.beginPath(); ctx.arc(cw/2, ch/2, 30 * pulse, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,' + (pulse * 0.6) + ')'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(msg, cw/2, ch/2 + 60);
  }

  function drawTestPattern(cw, ch) {
    var elapsed = (Date.now() - startTime) / 1000;
    var colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#ffffff'];
    var bw = cw / colors.length;
    for (var i = 0; i < colors.length; i++) { ctx.fillStyle = colors[i]; ctx.fillRect(i*bw, 0, bw, ch); }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, ch-40, cw, 40);
    ctx.fillStyle = '#fff'; ctx.font = '16px monospace'; ctx.textAlign = 'center';
    ctx.fillText('VIRTUAL CAMERA - ' + new Date().toLocaleTimeString(), cw/2, ch-15);
    var x = (Math.sin(elapsed*2)*0.5+0.5)*cw;
    var y = (Math.cos(elapsed*1.5)*0.5+0.5)*ch;
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
  }

  drawFrame();

  // === Reuse single stream + AudioContext ===
  var sharedVideoStream = null;
  var sharedAudioCtx = null;
  var sharedAudioDest = null;

  function getVideoStream() {
    if (sharedVideoStream && sharedVideoStream.active) return sharedVideoStream;
    try {
      sharedVideoStream = canvas.captureStream(window._vcam.fps || 15);
      return sharedVideoStream;
    } catch(e) { return null; }
  }

  function getAudioTrack() {
    if (sharedAudioDest && sharedAudioCtx) {
      try {
        var existingTracks = sharedAudioDest.stream.getAudioTracks();
        if (existingTracks.length > 0) return existingTracks[0].clone();
      } catch(e) {}
    }
    try {
      if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(function(){});
      var osc = sharedAudioCtx.createOscillator();
      var gain = sharedAudioCtx.createGain();
      gain.gain.value = 0.001;
      osc.connect(gain);
      if (!sharedAudioDest) sharedAudioDest = sharedAudioCtx.createMediaStreamDestination();
      gain.connect(sharedAudioDest);
      osc.start();
      return sharedAudioDest.stream.getAudioTracks()[0];
    } catch(e) { return null; }
  }

  navigator.mediaDevices.getUserMedia = function(constraints) {
    window._gumCallCount = (window._gumCallCount || 0) + 1;
    var tracks = [];
    var wantVideo = !constraints || constraints.video !== false;
    var wantAudio = !constraints || constraints.audio !== false;

    if (wantVideo) {
      try {
        var videoStream = getVideoStream();
        if (videoStream) {
          var videoTracks = videoStream.getVideoTracks();
          if (videoTracks.length > 0) {
            var videoTrack = videoTracks[0].clone();
            try { Object.defineProperty(videoTrack, 'label', { value: 'Virtual Camera (HD)', configurable: true }); } catch(e) {}
            try { Object.defineProperty(videoTrack, 'id', { value: 'vcam-' + Date.now() + '-' + Math.random().toString(36).slice(2,8), configurable: true }); } catch(e) {}
            tracks.push(videoTrack);
          }
        }
      } catch(e) {}
    }

    if (wantAudio) {
      try {
        var audioTrack = getAudioTrack();
        if (audioTrack) {
          var audioTrackClone = audioTrack.clone();
          try { Object.defineProperty(audioTrackClone, 'label', { value: 'Virtual Microphone', configurable: true }); } catch(e) {}
          tracks.push(audioTrackClone);
        }
      } catch(e) {}
    }

    if (tracks.length === 0) return Promise.resolve(new MediaStream());
    var stream = new MediaStream(tracks);
    return Promise.resolve(stream);
  };

  if (navigator.getUserMedia) {
    navigator.getUserMedia = function(c, s, e) {
      try { navigator.mediaDevices.getUserMedia(c).then(s).catch(e); }
      catch(err) { if (e) e(err); }
    };
  }

  setTimeout(function() { try { navigator.mediaDevices.dispatchEvent(new Event('devicechange')); } catch(e) {} }, 50);
  return 'camera active: ' + window._vcam.sourceType + (window._vcam.sourceUrl ? ' (' + window._vcam.sourceUrl + ')' : '');
})();
`
}

export function buildPatchScript(config: Partial<CameraConfig>): string {
  const patches = Object.entries(config)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `window._vcam.${k} = ${JSON.stringify(v)};`)
    .join('\n  ')
  return `(function(){
  if (!window._vcam) return 'not active';
  ${patches}
  return 'updated: ' + JSON.stringify({ zoom: window._vcam.zoom, sourceType: window._vcam.sourceType });
})();`
}

export function buildDisableScript(): string {
  return `(function(){
  if (window._originalGetUserMedia) {
    try {
      navigator.mediaDevices.enumerateDevices = window._originalEnumerateDevices;
      navigator.mediaDevices.getUserMedia = window._originalGetUserMedia;
    } catch(e) {}
    window._cameraOverrideActive = false;
    window._vcam = null;
    return 'disabled';
  }
  return 'no override active';
})();`
}
