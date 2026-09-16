#!/usr/bin/env node
'use strict';
/**
 * AccessLens unpacked-extension load check.
 *
 * Rerun (one command, from the repo root):
 *   export PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH
 *   node scripts/qa/extension-load.cjs
 *
 * Options:
 *   --relay wss://...   relay URL baked into the build (default: the deployed demo relay)
 *   --skip-build        reuse .cache/qa/extension-build
 *   --headed            show the browser (extensions also load headless with channel "chromium")
 *   --no-write          print results, do not touch docs/qa/
 *
 * Builds the MV3 extension with VITE_ACCESSLENS_WS_URL into
 * .cache/qa/extension-build (manifest.json and service-worker.js are copied in
 * by scripts/qa/vite.qa.config.mjs), loads it unpacked into a throwaway
 * Chromium profile, and opens chrome-extension://<id>/index.html. Records
 * console errors, CSP violations, failed requests, font loading, the relay
 * WebSocket, and whether the instructor and student views render. The side
 * panel itself cannot be opened by automation (it needs a toolbar click), so
 * the same page is exercised as a full extension tab.
 * Results go to docs/qa/live-bench-results.md and .json (section "extension-load").
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const common = require('./common.cjs');
const { installProbes, installFakeCapture } = require('./page-probes.cjs');

const { sleep } = common;
const args = common.parseArgs(process.argv.slice(2), {
  relay: process.env.ACCESSLENS_WS_URL || common.DEFAULT_RELAY,
  skipBuild: false,
  headed: false,
  noWrite: false,
  controlPort: 5185,
});
const BUILD = path.join(common.REPO, '.cache/qa/extension-build');

const checks = [];
const metrics = {};
const notes = [];
function check(id, name, result, detail) {
  checks.push({ id, name, result, detail });
  console.log(`  ${result.padEnd(8)} ${id} ${name}${detail ? ` -- ${detail}` : ''}`);
}
const pass = ok => (ok ? 'PASS' : 'FAIL');
const button = (page, text) => page.locator('button', { hasText: new RegExp(`^\\s*${text}\\s*$`) });

async function waitIn(page, fn, arg, timeout) {
  const t0 = Date.now();
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); return { ok: true, ms: Date.now() - t0 }; } catch { return { ok: false, ms: Date.now() - t0 }; }
}

/** Console errors, CSP reports, failed and HTTP-error requests, and WebSockets for one page. */
function watch(page, label, sink) {
  page.on('console', m => {
    const text = m.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text)) sink.csp.push({ page: label, text });
    if (m.type() === 'error') sink.consoleErrors.push({ page: label, text: common.redact(text) });
  });
  page.on('pageerror', e => sink.pageErrors.push({ page: label, text: common.redact(e.message) }));
  page.on('requestfailed', r => sink.failedRequests.push({ page: label, url: common.redact(r.url()), error: r.failure()?.errorText }));
  page.on('response', r => {
    sink.responses.push({ page: label, url: common.redact(r.url()), status: r.status() });
    if (r.status() >= 400) sink.failedRequests.push({ page: label, url: common.redact(r.url()), error: `HTTP ${r.status()}` });
  });
  page.on('websocket', ws => {
    const entry = { page: label, url: ws.url().split('?')[0], opened: Date.now(), framesSent: 0, framesReceived: 0, closed: null, error: null };
    sink.websockets.push(entry);
    ws.on('framesent', () => { entry.framesSent += 1; });
    ws.on('framereceived', () => { entry.framesReceived += 1; });
    ws.on('socketerror', e => { entry.error = String(e); });
    ws.on('close', () => { entry.closed = Date.now(); });
  });
}

/**
 * Which fonts actually render text, not just which can load: the computed
 * family and size of representative text elements, plus FontFace status.
 * Nothing forces a load, so a face counts as loaded only if the page used it.
 */
async function fontReport(page) {
  await page.evaluate(() => document.fonts.ready);
  await sleep(500);
  return page.evaluate(async () => {
    await document.fonts.ready;
    const families = ['IBM Plex Sans', 'IBM Plex Mono', 'OpenDyslexic'];
    const faces = [...document.fonts].map(f => ({ family: f.family.replace(/["']/g, ''), weight: f.weight, status: f.status }));
    const out = {};
    for (const family of families) {
      const mine = faces.filter(f => f.family === family);
      out[family] = { declaredFaces: mine.length, loadedFaces: mine.filter(f => f.status === 'loaded').length, check: document.fonts.check(`16px "${family}"`) };
    }
    const sample = {
      'body': document.body,
      'p.muted (pack line)': document.querySelector('.instructor .muted'),
      'p[role=status] (instructor status)': document.querySelector('.instructor [role="status"]'),
      'ol.steps li (how this works)': document.querySelector('ol.steps li'),
      'h2 (heading)': document.querySelector('#instructor-heading'),
      'button (Start)': [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start') ?? null,
    };
    const elements = {};
    for (const [name, el] of Object.entries(sample)) {
      if (!el) { elements[name] = null; continue; }
      const cs = getComputedStyle(el);
      elements[name] = { family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: cs.fontSize };
    }
    return { faces: out, elements, reading: document.documentElement.dataset.reading ?? null };
  });
}
const BODY_TEXT = ['body', 'p.muted (pack line)', 'p[role=status] (instructor status)', 'ol.steps li (how this works)'];
const describeFonts = r => Object.entries(r.elements).map(([k, v]) => `${k}: ${v ? `${v.family} ${v.size}` : 'absent'}`).join('; ');

async function main() {
  const startedAt = new Date();
  const git = common.gitInfo();
  console.log(`AccessLens extension load check -> relay ${args.relay}`);
  let buildInfo = { skipped: true };
  if (!args.skipBuild) buildInfo = common.build(args.relay, BUILD);
  const manifestPath = path.join(BUILD, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const hasWorker = fs.existsSync(path.join(BUILD, manifest.background?.service_worker ?? 'service-worker.js'));
  check('X01', 'Build output is a loadable MV3 directory', pass(manifest.manifest_version === 3 && hasWorker && fs.existsSync(path.join(BUILD, 'index.html'))),
    `${path.relative(common.REPO, BUILD)}: manifest_version ${manifest.manifest_version}, service worker ${hasWorker ? 'present' : 'MISSING'}, side_panel ${manifest.side_panel?.default_path}, permissions ${JSON.stringify(manifest.permissions)}, relay URL baked in: ${buildInfo.relayUrlBaked ?? 'not rebuilt'}`);

  const { chromium } = common.loadPlaywright();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'accesslens-ext-profile-'));
  const sink = { consoleErrors: [], pageErrors: [], csp: [], failedRequests: [], responses: [], websockets: [] };
  let context;
  let browserVersion = 'unknown';
  try {
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', // the headless shell cannot load extensions; full Chromium in new headless mode can
        headless: !args.headed,
        args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
        viewport: { width: 1280, height: 900 },
      });
      browserVersion = context.browser()?.version() ?? 'unknown';
    } catch (error) {
      check('X02', 'Chromium launches with the unpacked extension', 'FAIL', `launchPersistentContext threw: ${String(error.message).split('\n')[0]}`);
      throw error;
    }

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
    if (!worker) {
      check('X02', 'Extension service worker registers', 'FAIL', `no service worker appeared within 20 s (${args.headed ? 'headed' : 'headless'}); extension did not load`);
      throw new Error('extension did not load');
    }
    const extensionId = new URL(worker.url()).host;
    metrics.extensionId = extensionId;
    const swInfo = await worker.evaluate(async () => {
      const m = chrome.runtime.getManifest();
      let behavior = null;
      try { behavior = await chrome.sidePanel.getPanelBehavior(); } catch (e) { behavior = { error: String(e) }; }
      return { name: m.name, version: m.version, behavior, userAgent: navigator.userAgent };
    }).catch(e => ({ error: String(e) }));
    metrics.serviceWorker = { url: worker.url(), ...swInfo };
    browserVersion = (/Chrome\/([\d.]+)/.exec(swInfo.userAgent || '') || [])[1] || browserVersion;
    check('X02', 'Extension service worker registers and runs onInstalled', pass(!!swInfo.behavior && swInfo.behavior.openPanelOnActionClick === true),
      `id ${extensionId}; ${swInfo.name} ${swInfo.version}; sidePanel.getPanelBehavior() = ${JSON.stringify(swInfo.behavior ?? swInfo.error)}`);

    const base = `chrome-extension://${extensionId}/index.html`;
    await context.addInitScript(installProbes);
    await context.addInitScript(installFakeCapture, common.slidesAsDataUrls());

    // ---- Instructor tab
    const ins = await context.newPage();
    watch(ins, 'instructor', sink);
    const tLoad = Date.now();
    await ins.goto(base, { waitUntil: 'load' });
    const rendered = await waitIn(ins, () => !!document.querySelector('#instructor-heading') && !!document.querySelector('#pack-choice'), null, 15000);
    const probesInstalled = await ins.evaluate(() => !!window.__qaProbe && !!window.__qaCapture);
    if (!probesInstalled) {
      notes.push('context.addInitScript did not reach the chrome-extension:// page; probes were installed after load instead.');
      await ins.evaluate(`(${installProbes})()`);
      await ins.evaluate(`(${installFakeCapture})(${JSON.stringify(common.slidesAsDataUrls())})`);
    }
    const fullTabLink = await ins.locator('a.full-tab-link').getAttribute('href').catch(() => null);
    check('X03', 'Instructor view renders in the extension page', pass(rendered.ok && !!fullTabLink),
      `${rendered.ok ? `rendered ${Date.now() - tLoad} ms after navigation` : 'instructor heading or pack picker missing'}; "Open in a full tab" -> ${fullTabLink ?? 'absent (chrome.runtime.getURL unavailable)'}; init scripts reached the page: ${probesInstalled}`);

    const fontsDefault = await fontReport(ins);
    metrics.fontsDefault = fontsDefault;
    await button(ins, 'Dyslexia-friendly text').click({ timeout: 5000 });
    const fontsDyslexic = await fontReport(ins);
    metrics.fontsDyslexic = fontsDyslexic;
    await button(ins, 'Dyslexia-friendly text').click({ timeout: 5000 });
    const fontFiles = sink.responses.filter(r => /\.(woff2?|ttf|otf)(\?|$)/.test(r.url)).map(r => ({ file: r.url.split('/').pop(), status: r.status, local: r.url.startsWith('chrome-extension://') }));
    metrics.fontFiles = fontFiles;

    // Control: the same build served over http in the same browser.
    let control = null;
    let server = null;
    try {
      server = await common.serve(BUILD, args.controlPort);
      const web = await context.newPage();
      await web.goto(server.url, { waitUntil: 'load' });
      await web.waitForSelector('#instructor-heading', { timeout: 15000 });
      const webDefault = await fontReport(web);
      await button(web, 'Dyslexia-friendly text').click({ timeout: 5000 });
      const webDyslexic = await fontReport(web);
      await web.evaluate(() => { try { localStorage.removeItem('accesslens-reading-font'); } catch { /* ignore */ } });
      await web.close();
      control = { default: webDefault, dyslexic: webDyslexic };
    } catch (error) {
      control = { error: String(error.message).split('\n')[0] };
    } finally {
      server?.stop();
    }
    metrics.fontsHttpControl = control;

    const bodyTextIs = (r, family) => BODY_TEXT.every(k => r.elements[k] && r.elements[k].family === family);
    const plex = fontsDefault.faces['IBM Plex Sans'];
    const dys = fontsDyslexic.faces.OpenDyslexic;
    check('X04', 'IBM Plex renders the page text in the extension (fonts bundled, no network)', pass(plex.loadedFaces > 0 && fontFiles.length > 0 && fontFiles.every(f => f.local) && bodyTextIs(fontsDefault, 'IBM Plex Sans')),
      `extension page: ${describeFonts(fontsDefault)}. IBM Plex Sans ${plex.loadedFaces}/${plex.declaredFaces} faces used; ${fontFiles.length} font files, all from chrome-extension://: ${fontFiles.every(f => f.local)}. Same build over http: ${control?.default ? describeFonts(control.default) : control?.error}. See bug BUG-6`);
    check('X05', 'OpenDyslexic renders the page text when "Dyslexia-friendly text" is on', pass(fontsDyslexic.reading === 'dyslexic' && dys.loadedFaces > 0 && bodyTextIs(fontsDyslexic, 'OpenDyslexic')),
      `data-reading="${fontsDyslexic.reading}"; OpenDyslexic ${dys.loadedFaces}/${dys.declaredFaces} faces used; extension page: ${describeFonts(fontsDyslexic)}. Same build over http: ${control?.dyslexic ? describeFonts(control.dyslexic) : control?.error}. See bug BUG-6`);

    // Relay: Start (fake capture) opens the WebSocket and creates a session.
    await ins.evaluate(() => window.__qaCapture.configure({ layout: 'tab', surface: 'browser', slide: 'cell-slide-03' }));
    await button(ins, 'Start').click({ timeout: 5000 });
    const code = await waitIn(ins, () => /^[A-Z0-9]{6}$/.test(document.querySelector('.join code')?.textContent ?? ''), null, 20000);
    const matched = await waitIn(ins, () => (document.querySelector('.instructor [role="status"]')?.textContent ?? '').includes('Current slide: Mitochondria and Energy.'), null, 20000);
    const joinCode = code.ok ? await ins.textContent('.join code') : null;
    const insWs = await ins.evaluate(() => window.__qaProbe.wsOpen.map(o => o.url));
    const relayWs = sink.websockets.filter(w => w.page === 'instructor' && w.url === args.relay);
    check('X06', 'WebSocket to the relay opens from the extension origin', pass(relayWs.length > 0 && relayWs[0].framesReceived > 0 && code.ok),
      `sockets opened: ${JSON.stringify(insWs)}; frames sent/received on the first: ${relayWs[0] ? `${relayWs[0].framesSent}/${relayWs[0].framesReceived}` : 'n/a'}; relay issued join code ${joinCode ?? 'NONE'} in ${code.ms} ms; slide matched: ${matched.ok}`);

    // ---- Student tab (same profile, its own page and client)
    const stu = await context.newPage();
    watch(stu, 'student', sink);
    await stu.goto(base, { waitUntil: 'load' });
    await button(stu, 'Student').click({ timeout: 5000 });
    const tabs = await stu.locator('[role="tab"]').allTextContents();
    await stu.click('#mode-tab-structured-text');
    let live = { ok: false };
    let followed = { ok: false };
    if (joinCode) {
      await stu.fill('#session-code', joinCode);
      await button(stu, 'Join').click({ timeout: 5000 });
      live = await waitIn(stu, () => document.querySelector('.connection-pill')?.textContent === 'live', null, 20000);
      if (matched.ok) {
        await ins.selectOption('#indicate-region', 'mitochondrion');
        await button(ins, 'Indicate region').click({ timeout: 5000 });
        followed = await waitIn(stu, () => document.querySelector('.active-concept h4')?.textContent === 'mitochondrion', null, 15000);
      }
    }
    await stu.click('#mode-tab-ar');
    const ar = await waitIn(stu, () => !!document.querySelector('#ar-title') && (!!document.querySelector('.ar-canvas canvas') || /WebGL is unavailable/.test(document.body.textContent)), null, 20000);
    const arDetail = await stu.evaluate(() => ({ canvas: !!document.querySelector('.ar-canvas canvas'), webglUnavailable: /WebGL is unavailable/.test(document.body.textContent), concept: document.querySelector('.ar-view .active-concept strong')?.textContent ?? null }));
    check('X07', 'Student view renders, joins through the relay, and follows the instructor', pass(tabs.length === 4 && live.ok && followed.ok),
      `mode tabs ${JSON.stringify(tabs)}; pill live: ${live.ok}; Read mode showed "mitochondrion" after the instructor indicated it: ${followed.ok}`);
    check('X08', 'AR mode loads its lazy chunk under the extension CSP', pass(ar.ok),
      ar.ok ? `AR view rendered with ${arDetail.canvas ? 'a WebGL canvas' : 'the WebGL-unavailable fallback'}; highlighted "${arDetail.concept}"` : 'AR view did not render within 20 s');

    // Preferences persist through chrome.storage.local in the extension.
    await stu.click('#mode-tab-structured-text');
    await sleep(500);
    await stu.reload({ waitUntil: 'load' });
    await button(stu, 'Student').click({ timeout: 5000 });
    const persisted = await waitIn(stu, () => document.querySelector('#mode-tab-structured-text')?.getAttribute('aria-selected') === 'true', null, 5000);
    const stored = await stu.evaluate(() => new Promise(r => chrome.storage.local.get('accesslens.studentPreferences', v => r(v)))).catch(e => ({ error: String(e) }));
    check('X09', 'Student mode choice persists in chrome.storage.local across a reload', pass(persisted.ok), `Read tab selected after reload: ${persisted.ok}; stored ${JSON.stringify(stored)}`);

    await button(ins, 'End Session').click({ timeout: 5000 }).catch(() => {});
    await sleep(1000);

    const cspFromProbe = [];
    for (const p of [ins, stu]) {
      const v = await p.evaluate(() => (window.__qaProbe ? window.__qaProbe.securityViolations : [])).catch(() => []);
      cspFromProbe.push(...v);
    }
    metrics.errors = { consoleErrors: sink.consoleErrors, pageErrors: sink.pageErrors, csp: sink.csp, cspViolationEvents: cspFromProbe, failedRequests: sink.failedRequests };
    metrics.websockets = sink.websockets;
    check('X10', 'No console errors or uncaught page errors', pass(sink.consoleErrors.length === 0 && sink.pageErrors.length === 0),
      sink.consoleErrors.length + sink.pageErrors.length === 0 ? 'none in the instructor or student tab' : [...sink.pageErrors, ...sink.consoleErrors].slice(0, 6).map(e => `${e.page}: ${e.text.slice(0, 200)}`).join(' | '));
    // Attribute each violation to the bundle code at its line and column.
    const bundles = fs.readdirSync(path.join(BUILD, 'assets')).filter(f => f.endsWith('.js')).map(f => ({ f, lines: fs.readFileSync(path.join(BUILD, 'assets', f), 'utf8').split('\n') }));
    const attributed = cspFromProbe.map(v => {
      const hit = bundles.map(b => ({ f: b.f, code: (b.lines[v.line - 1] || '').slice(Math.max(0, v.column - 120), v.column + 60) })).find(x => /jitless/.test(x.code));
      return { ...v, bundle: hit ? hit.f : null, zodAllowsEvalProbe: !!hit };
    });
    metrics.errors.cspViolationEvents = attributed;
    const allZod = attributed.length > 0 && attributed.every(v => v.zodAllowsEvalProbe);
    check('X11', 'No CSP violations', pass(sink.csp.length === 0 && cspFromProbe.length === 0),
      sink.csp.length + cspFromProbe.length === 0 ? `none (securitypolicyviolation events and console both checked)`
        : `${cspFromProbe.length} securitypolicyviolation events (${[...new Set(attributed.map(v => `${v.directive} blocked ${v.blocked} at ${v.bundle ?? 'unknown bundle'}:${v.line}:${v.column}`))].join('; ')})${allZod ? ": all from Zod v4's allowsEval probe (a caught `Function('')`); schema parsing falls back and still works (X07). See bug BUG-7" : ''}; console CSP messages: ${sink.csp.length}`);
    check('X12', 'No failed requests', pass(sink.failedRequests.length === 0),
      sink.failedRequests.length === 0 ? `${sink.responses.length} responses, none failed` : sink.failedRequests.slice(0, 6).map(f => `${f.url.slice(0, 120)} (${f.error})`).join(' | '));
  } catch (error) {
    notes.push(`Run stopped early: ${String(error.message).split('\n')[0]}`);
    console.error(error);
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
    const finishedAt = new Date();
    const summary = { pass: checks.filter(c => c.result === 'PASS').length, fail: checks.filter(c => c.result === 'FAIL').length };
    const json = {
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationS: Math.round((finishedAt - startedAt) / 1000),
      git, relay: args.relay, build: buildInfo, options: args,
      environment: common.environment({ chromium: browserVersion, headless: !args.headed, launch: 'launchPersistentContext, channel "chromium", --load-extension' }),
      summary, checks, metrics, notes,
    };
    console.log(`\n${summary.pass} PASS, ${summary.fail} FAIL`);
    if (!args.noWrite) {
      common.writeResults('extension-load', json, renderMarkdown(json));
      console.log(`Wrote ${common.RESULTS_MD} and ${common.RESULTS_JSON}`);
    }
    process.exitCode = summary.fail > 0 || notes.some(n => n.startsWith('Run stopped')) ? 1 : 0;
  }
}

function renderMarkdown(r) {
  const lines = [];
  lines.push('## Extension load (unpacked MV3 build)');
  lines.push('');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Date | ${r.startedAt} (${r.durationS} s) |`);
  lines.push(`| Git HEAD | \`${r.git.head}\` on \`${r.git.branch}\` |`);
  lines.push(`| App source commit | \`${r.git.appSourceSha}\`${r.git.appSourceDirty ? ' (**uncommitted app changes present**)' : ''} |`);
  lines.push(`| Relay | \`${r.relay}\` |`);
  lines.push(`| Environment | ${r.environment.os}; Node ${r.environment.node}; Playwright ${r.environment.playwright}; Chromium ${r.environment.chromium} (${r.environment.headless ? 'headless' : 'headed'}); ${r.environment.launch} |`);
  lines.push(`| Extension id | \`${r.metrics.extensionId ?? 'not loaded'}\` |`);
  lines.push(`| Result | **${r.summary.pass} PASS, ${r.summary.fail} FAIL** |`);
  lines.push('');
  lines.push('Rerun: `node scripts/qa/extension-load.cjs`.');
  lines.push('');
  if (r.notes.length) { lines.push(...r.notes.map(n => `> ${n}`)); lines.push(''); }
  lines.push('### Checks', '', common.checksTable(r.checks), '');
  const byId = Object.fromEntries(r.checks.map(c => [c.id, c.result]));
  const bugs = EXTENSION_BUGS.filter(b => b.checks.some(id => byId[id] === 'FAIL'));
  lines.push('### Bugs reproduced in this run', '');
  lines.push(bugs.length ? bugs.map(b => b.text).join('\n\n') : 'None of the known extension bugs reproduced.');
  const cleared = EXTENSION_BUGS.filter(b => b.checks.every(id => byId[id] === 'PASS'));
  if (cleared.length) lines.push('', `Known bugs whose checks all passed in this run: ${cleared.map(b => `${b.id} (${b.checks.join(', ')})`).join('; ')}.`);
  lines.push('');
  lines.push('Not covered: the side panel opened from the toolbar button (automation cannot click browser UI), and real `getDisplayMedia` from the side panel. The page is the same `index.html`, opened as a full extension tab; capture uses the same fake canvas stream as the live bench.');
  return lines.join('\n');
}

// Printed only when one of their checks fails in the run being reported.
const EXTENSION_BUGS = [
  { id: 'BUG-6', checks: ['X04', 'X05'], text: `**BUG-6: In the installed extension, page text is not IBM Plex, and the dyslexia-friendly font does not reach it (checks X04, X05).**
Steps: load the unpacked build, open the side panel or \`chrome-extension://<id>/index.html\`; then switch on "Dyslexia-friendly text".
Expected: running text (the pack line, the status sentence, the step list, student text) renders in IBM Plex Sans at the
15 px base size, and in OpenDyslexic once the switch is on, as it does when the same build is served over http.
Actual: in the extension page \`body\` computes to \`system-ui, sans-serif\` at 11.25 px, and every element that
inherits its font from \`body\` renders in the system font, with or without the switch. Only elements that set
\`font-family\` themselves (headings, buttons) get Plex or OpenDyslexic. Over http the same elements compute to IBM Plex Sans
and OpenDyslexic (X04/X05 detail). Likely cause, read from those computed values (no such rule is in the app CSS): Chrome applies its built-in extension-page stylesheet (in Chromium, \`extension_fonts.css\`),
\`body { font-family: system-ui, sans-serif; font-size: 75% }\`. \`apps/extension/src/style.css\` sets the font on
\`:root\` (\`font: 400 15px/1.5 var(--sans)\`) and relies on inheritance, which that \`body\` rule interrupts. Setting
\`font\` on \`body\` as well would fix it. For the dyslexia switch this matters most: the text people read does not change.` },
  { id: 'BUG-7', checks: ['X11'], text: `**BUG-7 (low): Zod reports CSP violations on every extension page load (check X11).**
Steps: load the unpacked build and open \`index.html\` with a \`securitypolicyviolation\` listener (or DevTools Issues).
Expected: no CSP violations under the MV3 default policy.
Actual: \`script-src\` violations with blocked URI \`eval\`, all at the bundled Zod v4 \`allowsEval\` probe, which runs
\`new Function('')\` and swallows the error. Parsing still works (X07), so the impact is noise that looks alarming in a
review or a CSP report. \`z.config({ jitless: true })\` before any schema is used (for example in
\`apps/extension/src/shared/contracts.ts\`) skips the probe.` },
];

main().catch(error => { console.error(error); process.exit(2); });
