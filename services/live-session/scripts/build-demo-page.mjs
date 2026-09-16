#!/usr/bin/env node
/**
 * Generate `demo/index.html` — a browser page that talks to the deployed relay.
 *
 * Why this exists: the relay's endpoint is `wss://`, which a browser cannot open
 * from the address bar. "Paste the link in a browser" is a completely reasonable
 * thing to expect and it fails with a blank page, so the honest answer is a page
 * that does the connecting. It also demonstrates the multi-device story without
 * the extension: open it in two windows, or on a laptop and a phone, and an
 * instructor drives a student over real AWS.
 *
 * This is a **Part 4 diagnostic**, not the product. AccessLens is a browser
 * extension with Focus, Read, Hear and AR modes; this page renders the reviewed
 * text so you can see events arriving, and deliberately implements none of the
 * accessibility modes — Part 3 owns those, and a second half-built renderer
 * would be a liability.
 *
 * The slide and region text is inlined from Part 5's reviewed pack at build
 * time rather than hand-copied, so it cannot drift from what the pack says, and
 * a `file://` page needs no fetch to show it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const packDir = join(repoRoot, 'packages/access-packs/bio-cell-demo');
const target = join(here, '../demo/index.html');

const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
const happy = JSON.parse(readFileSync(join(packDir, 'fixtures/happy-path.json'), 'utf8'));

// Only what the page displays: titles and the reviewed wording per region.
const display = {
  packId: pack.packId,
  version: pack.version,
  title: pack.title,
  assets: Object.fromEntries(
    pack.assets.map(asset => [
      asset.assetId,
      {
        title: asset.title,
        regions: Object.fromEntries(
          asset.regions.map(region => [
            region.regionId,
            { short: region.shortDescription, plain: region.plainLanguage },
          ]),
        ),
      },
    ]),
  ),
};

const DEFAULT_URL = 'wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>AccessLens relay — live check</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1216; --panel: #171c22; --line: #2a323c; --ink: #e8edf3;
    --muted: #97a3b2; --accent: #6ea8fe; --ok: #57d9a3; --bad: #ff8087;
    --pad: clamp(12px, 3vw, 24px);
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f8fa; --panel:#fff; --line:#d8dee6; --ink:#12171d; --muted:#5b6673; --accent:#0b62d6; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: var(--pad);
    padding-top: calc(var(--pad) + env(safe-area-inset-top, 0px));
    padding-bottom: calc(var(--pad) + env(safe-area-inset-bottom, 0px));
    background: var(--bg); color: var(--ink);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .sub { color: var(--muted); margin: 0 0 1rem; font-size: .9rem; }
  .wrap { max-width: 1040px; margin: 0 auto; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: var(--pad); margin-bottom: 14px; }
  label { display:block; font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:.3rem; }
  input, select, button {
    font: inherit; color: inherit; background: var(--bg);
    border: 1px solid var(--line); border-radius: 7px; padding: .5rem .7rem;
  }
  input, select { width: 100%; }
  button { cursor: pointer; background: var(--accent); color: #fff; border-color: transparent; font-weight: 600; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.ghost { background: transparent; color: var(--ink); border-color: var(--line); font-weight: 500; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
  .row > div { flex: 1 1 210px; min-width: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .dot { display:inline-block; width:.6rem; height:.6rem; border-radius:50%; background:var(--muted); margin-right:.45rem; }
  .dot.on { background: var(--ok); } .dot.off { background: var(--bad); }
  .status { font-size: .9rem; color: var(--muted); }
  .slide { font-size: 1.3rem; font-weight: 650; margin: 0 0 .2rem; }
  .region { color: var(--accent); font-weight: 600; }
  .plain { margin: .5rem 0 0; }
  .muted { color: var(--muted); }
  pre { margin:0; padding:10px; background:var(--bg); border:1px solid var(--line); border-radius:7px;
        max-height: 260px; overflow:auto; font-size:.78rem; line-height:1.45; }
  .grid { display:grid; gap:14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  code { background: var(--bg); padding: .1rem .3rem; border-radius: 4px; font-size: .85em; }
  .note { font-size:.85rem; color:var(--muted); border-left:3px solid var(--line); padding-left:.7rem; margin-top:.8rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1>AccessLens relay — live check</h1>
  <p class="sub">A Part 4 diagnostic. Open this in two windows (or a laptop and a phone):
     make one an <strong>instructor</strong>, one a <strong>student</strong> with the same session code.</p>

  <div class="card">
    <div class="row">
      <div style="flex:2 1 320px">
        <label for="url">Relay endpoint</label>
        <input id="url" value="${DEFAULT_URL}" spellcheck="false">
      </div>
      <div>
        <label for="role">Role</label>
        <select id="role"><option value="instructor">Instructor</option><option value="student">Student</option></select>
      </div>
      <div>
        <label for="session">Session code</label>
        <input id="session" value="" spellcheck="false" placeholder="e.g. demo-1234">
      </div>
    </div>
    <div class="actions">
      <button id="connect">Connect</button>
      <button id="disconnect" class="ghost" disabled>Disconnect</button>
    </div>
    <p class="status" style="margin:.8rem 0 0"><span id="dot" class="dot"></span><span id="status">Not connected.</span></p>
    <p class="note">The endpoint is <code>wss://</code>, so it cannot be opened from a browser address bar —
       that is what this page is for. It lives in a temporary hackathon AWS account and will stop existing when the event ends.</p>
  </div>

  <div class="grid">
    <div class="card">
      <h2 style="font-size:.95rem;margin:0 0 .6rem">Current view</h2>
      <p class="slide" id="slide">—</p>
      <p id="regionLine" class="muted">Waiting for the instructor.</p>
      <p class="plain" id="plain"></p>
    </div>

    <div class="card" id="instructorPanel" hidden>
      <h2 style="font-size:.95rem;margin:0 0 .6rem">Instructor controls</h2>
      <p class="status" id="progress">Not started.</p>
      <div class="actions">
        <button id="next">Send next event</button>
        <button id="playAll" class="ghost">Play whole lesson</button>
        <button id="endSession" class="ghost">End session</button>
      </div>
      <p class="note">These replay the reviewed <code>happy-path</code> fixture — the same events the
         instructor extension will emit. The relay validates every one and refuses anything off-contract.</p>
    </div>
  </div>

  <div class="card">
    <h2 style="font-size:.95rem;margin:0 0 .6rem">Relay log</h2>
    <pre id="log">Nothing yet.</pre>
  </div>
</div>

<script>
const PACK = ${JSON.stringify(display)};
const EVENTS = ${JSON.stringify(happy.events)};

const $ = id => document.getElementById(id);
const logEl = $('log');
let socket = null, sent = 0, sessionId = '', role = 'instructor';

// A short, readable code. The session id is the only secret this demo has, so
// a guessable one would let anyone join — random beats a fixed default.
if (!$('session').value) {
  $('session').value = 'demo-' + Math.random().toString(36).slice(2, 6);
}

function log(line, kind) {
  const stamp = new Date().toLocaleTimeString();
  const prefix = kind === 'err' ? '!' : kind === 'in' ? '<' : '>';
  logEl.textContent = (logEl.textContent === 'Nothing yet.' ? '' : logEl.textContent + '\\n')
    + stamp + ' ' + prefix + ' ' + line;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text, state) {
  $('status').textContent = text;
  $('dot').className = 'dot' + (state ? ' ' + state : '');
}

function render(event) {
  const asset = PACK.assets[event.assetId];
  if (event.type === 'asset.changed' && asset) {
    $('slide').textContent = asset.title;
    $('regionLine').textContent = 'Slide showing. No region highlighted yet.';
    $('plain').textContent = '';
  } else if (event.type === 'region.changed' && asset) {
    const region = asset.regions[event.regionId];
    $('slide').textContent = asset.title;
    if (region) {
      $('regionLine').innerHTML = '<span class="region">' + event.regionId + '</span> — ' + region.short;
      $('plain').textContent = region.plain;
    }
  } else if (event.type === 'source.unmatched') {
    $('regionLine').textContent = 'The instructor is showing something outside the approved pack.';
    $('plain').textContent = '';
  } else if (event.type === 'session.ended') {
    $('regionLine').textContent = 'Session ended.';
  }
}

$('connect').onclick = () => {
  role = $('role').value;
  sessionId = $('session').value.trim();
  if (!sessionId) { setStatus('Enter a session code first.', 'off'); return; }

  try { socket = new WebSocket($('url').value.trim()); }
  catch (e) { setStatus('That endpoint is not a valid WebSocket URL.', 'off'); return; }

  setStatus('Connecting…');

  socket.onopen = () => {
    const message = role === 'instructor'
      ? { kind: 'create', sessionId }
      : { kind: 'join', sessionId, role: 'student' };
    socket.send(JSON.stringify(message));
    log(message.kind + ' ' + sessionId);
  };

  socket.onmessage = e => {
    const payload = JSON.parse(e.data);
    if (payload.kind === 'capability') {
      setStatus('Connected as ' + payload.capability.role + ' — session ' + sessionId, 'on');
      $('instructorPanel').hidden = payload.capability.role !== 'instructor';
      $('connect').disabled = true; $('disconnect').disabled = false;
      log('capability: ' + payload.capability.role + ', expires ' + payload.capability.expiresAt, 'in');
    } else if (payload.kind === 'event') {
      render(payload.event);
      log('event #' + payload.event.sequence + ' ' + payload.event.type, 'in');
    } else if (payload.kind === 'rejected') {
      log('REJECTED: ' + payload.rules.join(', '), 'err');
    } else if (payload.kind === 'error') {
      log('ERROR: ' + payload.reason, 'err');
      setStatus('Relay refused: ' + payload.reason, 'off');
    } else if (payload.kind === 'accepted') {
      log('accepted', 'in');
    } else if (payload.kind === 'closed') {
      log('session closed', 'in');
    }
  };

  socket.onerror = () => { if (!socket || socket.readyState !== 1) setStatus('Could not reach the relay.', 'off'); };
  socket.onclose = () => {
    setStatus('Disconnected.', 'off');
    $('connect').disabled = false; $('disconnect').disabled = true; $('instructorPanel').hidden = true;
  };
};

$('disconnect').onclick = () => socket && socket.close();

function sendNext() {
  if (!socket || socket.readyState !== 1) return false;
  if (sent >= EVENTS.length) { $('progress').textContent = 'Lesson complete.'; return false; }
  const event = { ...EVENTS[sent], sessionId };
  socket.send(JSON.stringify({ kind: 'event', event }));
  log('event #' + event.sequence + ' ' + event.type);
  render(event);
  sent += 1;
  $('progress').textContent = sent + ' of ' + EVENTS.length + ' events sent.';
  return true;
}

$('next').onclick = sendNext;
$('playAll').onclick = () => {
  const tick = () => { if (sendNext()) setTimeout(tick, 900); };
  tick();
};
$('endSession').onclick = () => {
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ kind: 'close', sessionId }));
    log('close ' + sessionId);
  }
};
</script>
</body>
</html>
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, html, 'utf8');
console.log(`demo page: ${target} (${EVENTS_COUNT(happy)} events, ${Object.keys(display.assets).length} slides)`);

function EVENTS_COUNT(fixture) {
  return fixture.events.length;
}
