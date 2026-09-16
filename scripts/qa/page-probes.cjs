'use strict';
/**
 * In-page instrumentation injected with `context.addInitScript`. These functions
 * are serialised by Playwright and run inside the page, before the app's own
 * scripts. They observe; they do not change app behaviour.
 *
 * installProbes: records WebSocket traffic metadata (sequence, type, asset and
 *   region ids only; no lesson text, no media) and DOM render transitions with
 *   Date.now(). Every browser context of a run shares one machine clock.
 * installFakeCapture: replaces navigator.mediaDevices.getDisplayMedia (headless
 *   Chromium denies the real one) with a canvas.captureStream of real reviewed
 *   slide PNGs, drawn as a tab, a window (toolbar, filmstrip, margins), or a
 *   whole monitor (menu bar, dock, other windows).
 */

function installProbes() {
  const probe = {
    sockets: 0,
    wsOpen: [], wsClose: [], wsSent: [], wsRecv: [],
    dom: [], pill: [], instructorStatus: [], joinMessage: [], liveMessage: [],
    securityViolations: [],
  };
  Object.defineProperty(window, '__qaProbe', { value: probe, enumerable: false });

  const summarize = (payload) => {
    const out = { kind: payload && payload.kind };
    if (payload && payload.kind === 'event' && payload.event) {
      out.seq = payload.event.sequence;
      out.type = payload.event.type;
      if (payload.event.assetId) out.assetId = payload.event.assetId;
      if (payload.event.regionId) out.regionId = payload.event.regionId;
    }
    if (payload && payload.reason) out.reason = payload.reason;
    if (payload && payload.rules) out.rules = payload.rules;
    return out;
  };

  const NativeWebSocket = window.WebSocket;
  class ProbedWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      const id = ++probe.sockets;
      const bareUrl = String(url).split('?')[0];
      const resumed = String(url).includes('capability=');
      this.addEventListener('open', () => probe.wsOpen.push({ t: Date.now(), id, url: bareUrl, resumed }));
      this.addEventListener('close', (e) => probe.wsClose.push({ t: Date.now(), id, code: e.code }));
      this.addEventListener('message', (e) => {
        const t = Date.now();
        try { probe.wsRecv.push({ t, id, ...summarize(JSON.parse(String(e.data))) }); } catch { probe.wsRecv.push({ t, id, kind: 'unparsed' }); }
      });
    }
    send(data) {
      try { probe.wsSent.push({ t: Date.now(), ...summarize(JSON.parse(String(data))) }); } catch { /* not JSON */ }
      return super.send(data);
    }
  }
  window.WebSocket = ProbedWebSocket;

  document.addEventListener('securitypolicyviolation', (e) => {
    probe.securityViolations.push({ t: Date.now(), directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, column: e.columnNumber, disposition: e.disposition });
  });

  let lastKey = null; let lastPill = null; let lastStatus = null; let lastJoin = null; let lastLive = null;
  const text = (selector) => { const el = document.querySelector(selector); return el ? el.textContent : null; };
  const sample = () => {
    const t = Date.now();
    const title = text('#structured-title');
    const region = text('.active-concept h4');
    const key = title === null ? null : `${title}|${region ?? ''}`;
    if (key !== lastKey) { lastKey = key; probe.dom.push({ t, key }); }
    const pill = text('.connection-pill');
    if (pill !== lastPill) { lastPill = pill; probe.pill.push({ t, pill }); }
    const status = text('.instructor [role="status"]');
    if (status !== lastStatus) { lastStatus = status; probe.instructorStatus.push({ t, status }); }
    const join = text('.student-experience .supporting-text');
    if (join !== lastJoin) { lastJoin = join; probe.joinMessage.push({ t, text: join }); }
    const live = text('.student-experience .live-message');
    if (live !== lastLive) { lastLive = live; probe.liveMessage.push({ t, text: live }); }
  };
  new MutationObserver(sample).observe(document, { subtree: true, childList: true, characterData: true });
}

function installFakeCapture(images) {
  const loaded = {};
  const ready = Promise.all(Object.entries(images).map(([name, src]) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { loaded[name] = img; resolve(); };
    img.onerror = () => reject(new Error(`could not decode ${name}`));
    img.src = src;
  })));

  const SIZES = { tab: [1280, 720], window: [1600, 1000], monitor: [1920, 1080] };
  const state = { slide: 'cell-slide-01', layout: 'tab', surface: 'browser', deny: false };
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let timer = null;
  let track = null;
  const calls = [];

  function rect(color, x, y, w, h) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
  function textLines(x, y, w, rows, color) { for (let i = 0; i < rows; i++) rect(color, x, y + i * 18, w * (0.55 + 0.4 * ((i * 37) % 10) / 10), 8); }

  function draw() {
    const img = loaded[state.slide];
    if (!img) return;
    const [W, H] = SIZES[state.layout];
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (state.layout === 'tab') { ctx.drawImage(img, 0, 0, W, H); return; }
    if (state.layout === 'window') {
      // A presentation viewer window: title bar, toolbar with URL box, a
      // filmstrip of placeholder thumbnails, grey margins, a status bar.
      rect('#2b2b2b', 0, 0, W, H);
      rect('#3a3a3a', 0, 0, W, 36);
      ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(22 + i * 22, 18, 7, 0, Math.PI * 2); ctx.fill(); });
      rect('#f1f3f4', 0, 36, W, 56);
      for (let i = 0; i < 6; i++) rect('#5f6368', 16 + i * 40, 52, 24, 24);
      rect('#ffffff', 280, 48, 900, 32);
      textLines(300, 60, 300, 1, '#9aa0a6');
      rect('#e8eaed', 0, 92, W, H - 132);
      for (let i = 0; i < 6; i++) {
        rect('#ffffff', 24, 120 + i * 136, 208, 117);
        rect('#dadce0', 24, 120 + i * 136, 208, 4);
        textLines(40, 140 + i * 136, 150, 3, '#bdc1c6');
      }
      ctx.drawImage(img, 300, 180, 1180, 664);
      rect('#dadce0', 0, H - 40, W, 40);
      textLines(20, H - 26, 240, 1, '#80868b');
      return;
    }
    // Whole monitor: desktop, menu bar, dock, a notes window, and the viewer window with the slide.
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1d3557'); g.addColorStop(1, '#457b9d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    rect('#ececec', 0, 0, W, 28);
    for (let i = 0; i < 7; i++) rect('#333333', 40 + i * 70, 10, 44, 8);
    rect('#ffffff', 60, 90, 680, 760);
    rect('#dddddd', 60, 90, 680, 30);
    textLines(90, 150, 600, 30, '#555555');
    rect('#202124', 820, 140, 1040, 700);
    rect('#3c4043', 820, 140, 1040, 44);
    ctx.drawImage(img, 860, 220, 960, 540);
    rect('rgba(255,255,255,0.35)', 560, 990, 800, 76);
    for (let i = 0; i < 10; i++) rect(['#e76f51', '#2a9d8f', '#e9c46a', '#f4a261', '#264653'][i % 5], 580 + i * 78, 1000, 60, 56);
  }

  Object.defineProperty(window, '__qaCapture', {
    enumerable: false,
    value: {
      calls,
      configure(options) { Object.assign(state, options); draw(); },
      setSlide(name) { state.slide = name; draw(); return Date.now(); },
      /** What the browser does when the user clicks "Stop sharing": the track ends. */
      endShare() {
        if (!track) return false;
        clearInterval(timer);
        track.dispatchEvent(new Event('ended'));
        track.stop();
        return true;
      },
      get trackState() { return track ? track.readyState : null; },
    },
  });

  navigator.mediaDevices.getDisplayMedia = async function fakeGetDisplayMedia(options) {
    calls.push({ t: Date.now(), userActivation: !!(navigator.userActivation && navigator.userActivation.isActive), options: JSON.parse(JSON.stringify(options || {})), denied: state.deny });
    if (state.deny) throw new DOMException('Permission denied by user', 'NotAllowedError');
    await ready;
    draw();
    const stream = canvas.captureStream(5);
    track = stream.getVideoTracks()[0];
    const surface = state.surface;
    const settings = track.getSettings.bind(track);
    track.getSettings = () => ({ ...settings(), displaySurface: surface });
    clearInterval(timer);
    timer = setInterval(draw, 100);
    return stream;
  };
}

module.exports = { installProbes, installFakeCapture };
