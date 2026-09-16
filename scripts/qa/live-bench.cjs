#!/usr/bin/env node
'use strict';
/**
 * AccessLens live quality bench: AL-004 (automated half) + automatable AL-001.
 *
 * Rerun (one command, from the repo root):
 *   export PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH
 *   node scripts/qa/live-bench.cjs
 *
 * Options:
 *   --relay wss://...     relay URL (default: the deployed demo relay, or $ACCESSLENS_WS_URL)
 *   --events 30           ordered region changes to emit
 *   --interval-ms 750     spacing between region changes
 *   --port 5180           vite preview port
 *   --skip-build          reuse .cache/qa/build (must have been built for the same relay)
 *   --headed              show the three browser windows
 *   --no-write            print results, do not touch docs/qa/
 *
 * What it does: builds the extension UI with VITE_ACCESSLENS_WS_URL into
 * .cache/qa/build (gitignored), serves it with `vite preview`, and drives three
 * separate browser contexts (separate profiles) with Playwright: one instructor
 * and students A and B. getDisplayMedia is replaced by a canvas stream of the
 * real reviewed slide PNGs (headless Chromium denies the real chooser). Students
 * A and B each route through their own local CONNECT proxy so a real network
 * drop can be simulated per student. Results go to docs/qa/live-bench-results.md
 * and .json (section "live-bench").
 *
 * Measurement: all contexts run on one machine, so Date.now() in every page is
 * one clock. Latency is instructor click (in-page timestamp immediately before
 * the Indicate region button is clicked) to the student's DOM commit of the new
 * region (MutationObserver in Read mode). Paint adds at most one frame.
 */
const fs = require('node:fs');
const path = require('node:path');
const common = require('./common.cjs');
const { installProbes, installFakeCapture } = require('./page-probes.cjs');

const { sleep, stats } = common;

const args = common.parseArgs(process.argv.slice(2), {
  relay: process.env.ACCESSLENS_WS_URL || common.DEFAULT_RELAY,
  events: 30,
  intervalMs: 750,
  port: 5180,
  skipBuild: false,
  headed: false,
  noWrite: false,
});

const pack = common.loadPack();
const titleOf = Object.fromEntries(pack.assets.map(a => [a.assetId, a.title]));

const checks = [];
const metrics = {};
const notes = [];
function check(id, name, result, detail, data) {
  const row = { id, name, result, detail };
  if (data !== undefined) row.data = data;
  checks.push(row);
  const pad = result.padEnd(8);
  console.log(`  ${pad} ${id} ${name}${detail ? ` -- ${detail}` : ''}`);
  return result === 'PASS';
}
const pass = ok => (ok ? 'PASS' : 'FAIL');
const ms = v => (v === null || v === undefined ? 'n/a' : `${Math.round(v)} ms`);

/** Waits for a predicate in the page; never throws. Returns { ok, ms }. */
async function waitIn(page, fn, arg, timeout) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    return { ok: true, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

/**
 * A button by its visible text. Not getByRole: some buttons get a decorative
 * glyph from CSS `content` (button.stop::before is "■ "), which Chromium puts in
 * the accessible name, so role+name lookups miss them.
 */
const button = (page, text) => page.locator('button', { hasText: new RegExp(`^\\s*${text}\\s*$`) });
const probe = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__qaProbe)));
const pillOf = page => page.evaluate(() => document.querySelector('.connection-pill')?.textContent ?? null);
const keyOf = page => page.evaluate(() => {
  const title = document.querySelector('#structured-title')?.textContent;
  return title === undefined ? null : `${title}|${document.querySelector('.active-concept h4')?.textContent ?? ''}`;
});
const statusOf = page => page.evaluate(() => document.querySelector('.instructor [role="status"]')?.textContent ?? null);
const hasStatus = (page, fragment, timeout) => waitIn(page, f => (document.querySelector('.instructor [role="status"]')?.textContent ?? '').includes(f), fragment, timeout);
const pillIs = (page, value, timeout) => waitIn(page, v => document.querySelector('.connection-pill')?.textContent === v, value, timeout);
const keyIs = (page, key, timeout) => waitIn(page, k => {
  const title = document.querySelector('#structured-title')?.textContent;
  return `${title}|${document.querySelector('.active-concept h4')?.textContent ?? ''}` === k;
}, key, timeout);

async function newContext(browser, name, { images, proxy } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(proxy ? { proxy: { server: proxy.server, bypass: '127.0.0.1,localhost' } } : {}),
  });
  await context.addInitScript(installProbes);
  if (images) await context.addInitScript(installFakeCapture, images);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push({ t: Date.now(), kind: 'pageerror', text: common.redact(e.message) }));
  page.on('console', m => { if (m.type() === 'error') errors.push({ t: Date.now(), kind: 'console', text: common.redact(m.text()) }); });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await button(page, 'Instructor').waitFor({ timeout: 15000 });
  return { name, context, page, errors, proxy };
}

async function startSharing(ins, capture) {
  await ins.page.evaluate(c => window.__qaCapture.configure(c), capture);
  const tClick = Date.now();
  await button(ins.page, 'Start').click();
  return tClick;
}

async function joinAsStudent(student, code) {
  const page = student.page;
  await button(page, 'Student').click();
  await page.click('#mode-tab-structured-text');
  await page.fill('#session-code', code);
  const t0 = Date.now();
  await button(page, 'Join').click();
  const live = await pillIs(page, 'live', 20000);
  return { ...live, t0 };
}

/** Selects a region and clicks "Indicate region" in-page, timestamping immediately before the click. */
async function indicate(ins, regionId) {
  await ins.page.selectOption('#indicate-region', regionId);
  return ins.page.evaluate((regionId) => {
    const select = document.querySelector('#indicate-region');
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Indicate region');
    if (!select || !button) return { error: 'Indicate region form is not rendered' };
    if (select.value !== regionId) return { error: `select holds ${select.value}, wanted ${regionId}` };
    const before = window.__qaProbe.wsSent.length;
    const t = Date.now();
    button.click();
    const sent = window.__qaProbe.wsSent.slice(before).find(s => s.type === 'region.changed');
    return { t, seq: sent ? sent.seq : null, tSend: sent ? sent.t : null, queued: !sent };
  }, regionId);
}

async function switchSlide(ins, assetId, timeout = 15000) {
  const t0 = await ins.page.evaluate(id => window.__qaCapture.setSlide(id), assetId);
  const r = await hasStatus(ins.page, `Current slide: ${titleOf[assetId]}.`, timeout);
  return { ok: r.ok, ms: Date.now() - t0 };
}

async function currentInstructorKey(ins) {
  const status = await statusOf(ins.page);
  const m = /Current slide: (.+?)\. Region: ([^.]+)\./.exec(status || '');
  return m ? `${m[1]}|${m[2] === 'none' ? '' : m[2]}` : null;
}

let baseUrl;

async function main() {
  const startedAt = new Date();
  console.log(`AccessLens live bench -> relay ${args.relay}`);
  const git = common.gitInfo();
  let buildInfo = { skipped: true };
  if (!args.skipBuild) {
    console.log('Building with VITE_ACCESSLENS_WS_URL into .cache/qa/build ...');
    buildInfo = common.build(args.relay);
  }
  const server = await common.serve(common.BUILD_DIR, args.port);
  baseUrl = server.url;
  const { chromium } = common.loadPlaywright();
  const browser = await chromium.launch({ headless: !args.headed });
  const proxyA = await common.startProxy();
  const proxyB = await common.startProxy();
  const images = common.slidesAsDataUrls();
  const contexts = [];
  let sessionCode = null;

  try {
    // ------------------------------------------------------------------ P1
    console.log('\nP1 session setup');
    const ins = await newContext(browser, 'instructor', { images });
    const A = await newContext(browser, 'studentA', { proxy: proxyA });
    const B = await newContext(browser, 'studentB', { proxy: proxyB });
    contexts.push(ins, A, B);

    await sleep(1500);
    const callsBeforeStart = await ins.page.evaluate(() => window.__qaCapture.calls.length);
    check('C01', 'No capture before Start (charter A1)', pass(callsBeforeStart === 0), `getDisplayMedia calls before any click: ${callsBeforeStart}`);

    await startSharing(ins, { deny: true, layout: 'tab', surface: 'browser', slide: 'cell-slide-01' });
    const denied = await hasStatus(ins.page, 'Sharing is required for live sync', 20000);
    const codeAfterDeny = await ins.page.$('.join code');
    const startBack = await button(ins.page, 'Start').isVisible().catch(() => false);
    check('C02', 'Permission denial is handled', pass(denied.ok && !codeAfterDeny && startBack),
      denied.ok ? `status "${await statusOf(ins.page)}"; join code shown: ${!!codeAfterDeny}; Start offered again: ${startBack}` : `denial message not shown within 20 s; status "${await statusOf(ins.page)}"`);

    const tStart = await startSharing(ins, { deny: false, layout: 'tab', surface: 'browser', slide: 'cell-slide-01' });
    const codeShown = await waitIn(ins.page, () => /^[A-Z0-9]{6}$/.test(document.querySelector('.join code')?.textContent ?? ''), null, 20000);
    sessionCode = codeShown.ok ? await ins.page.textContent('.join code') : null;
    const matched = await hasStatus(ins.page, `Sharing a tab. Current slide: ${titleOf['cell-slide-01']}.`, 20000);
    const calls = await ins.page.evaluate(() => window.__qaCapture.calls);
    const grantCall = calls[calls.length - 1];
    metrics.startToJoinCodeMs = codeShown.ok ? codeShown.ms : null;
    metrics.startToFirstMatchMs = matched.ok ? Date.now() - tStart - 0 : null;
    check('C03', 'Tab share: join code issued and first slide matched', pass(!!sessionCode && matched.ok),
      `code ${sessionCode ?? 'none'} after ${ms(codeShown.ms)}; "${titleOf['cell-slide-01']}" matched ${matched.ok ? `${ms(metrics.startToFirstMatchMs)} after Start` : 'NOT within 20 s'}; status "${await statusOf(ins.page)}"`);
    metrics.clickToGetDisplayMediaMs = grantCall ? grantCall.t - tStart : null;
    check('C04', 'getDisplayMedia runs inside the Start click\'s user activation', pass(!!grantCall && grantCall.userActivation),
      grantCall ? `userActivation.isActive=${grantCall.userActivation}; called ${ms(metrics.clickToGetDisplayMediaMs)} after the click (the relay create() round trip runs first); options ${JSON.stringify(grantCall.options)}` : 'getDisplayMedia was never called');
    if (!sessionCode || !matched.ok) throw new Error('No session to bench: instructor did not reach a matched share.');

    const [joinA, joinB] = await Promise.all([joinAsStudent(A, sessionCode), joinAsStudent(B, sessionCode)]);
    const keyA0 = await keyOf(A.page);
    const keyB0 = await keyOf(B.page);
    metrics.joinToLiveMs = { A: joinA.ok ? joinA.ms : null, B: joinB.ok ? joinB.ms : null };
    check('C05', 'Students A and B join with the code and reach live', pass(joinA.ok && joinB.ok),
      `A ${joinA.ok ? `live in ${ms(joinA.ms)}` : `pill "${await pillOf(A.page)}"`}, B ${joinB.ok ? `live in ${ms(joinB.ms)}` : `pill "${await pillOf(B.page)}"`}; caught-up view A "${keyA0}", B "${keyB0}"`);
    if (!joinA.ok || !joinB.ok) throw new Error('Students did not reach live; ordered-delivery bench cannot run.');

    // ------------------------------------------------------------------ P2
    console.log(`\nP2 ${args.events} ordered region changes, ${args.intervalMs} ms apart`);
    const cycle = pack.assets.flatMap(a => a.regions.map(r => ({ assetId: a.assetId, regionId: r.regionId })));
    const plan = Array.from({ length: args.events }, (_, i) => cycle[i % cycle.length]);
    const sent = [];
    const slideSwitches = [];
    let currentAsset = 'cell-slide-01';
    let lastAction = 0;
    let p2Error = null;
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      if (step.assetId !== currentAsset) {
        const sw = await switchSlide(ins, step.assetId);
        slideSwitches.push({ to: step.assetId, ...sw });
        if (!sw.ok) { p2Error = `instructor did not match ${step.assetId} within 15 s`; break; }
        currentAsset = step.assetId;
      }
      const wait = lastAction + args.intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      const r = await indicate(ins, step.regionId);
      if (r.error) { p2Error = `event ${i + 1}: ${r.error}`; break; }
      lastAction = r.t;
      sent.push({ i: i + 1, ...step, key: `${titleOf[step.assetId]}|${step.regionId}`, tAction: r.t, seq: r.seq, tSend: r.tSend });
    }
    await sleep(6000);
    const [pA, pB, pI] = await Promise.all([probe(A.page), probe(B.page), probe(ins.page)]);

    function analyse(p) {
      const perEvent = sent.map((e, idx) => {
        const recv = p.wsRecv.find(r => r.kind === 'event' && r.seq === e.seq);
        const nextAction = sent[idx + 1] ? sent[idx + 1].tAction : Infinity;
        // The same slide+region recurs once per cycle; a render after its next occurrence belongs to that one.
        const nextSame = sent.slice(idx + 1).find(x => x.key === e.key);
        const bound = nextSame ? nextSame.tAction : Infinity;
        const render = p.dom.find(d => d.t >= e.tAction && d.t < bound && d.key === e.key);
        return {
          i: e.i, seq: e.seq, key: e.key,
          received: !!recv, rendered: !!render,
          sendToRecvMs: recv && e.tSend ? recv.t - e.tSend : null,
          recvToRenderMs: recv && render ? render.t - recv.t : null,
          latencyMs: render ? render.t - e.tAction : null,
          renderedAfterNextAction: render ? render.t > nextAction : null,
          tRender: render ? render.t : null,
        };
      });
      const seqs = sent.map(e => e.seq);
      const arrival = p.wsRecv.filter(r => r.kind === 'event' && seqs.includes(r.seq)).map(r => r.seq);
      const arrivalOrdered = arrival.every((s, k) => k === 0 || s > arrival[k - 1]);
      const renderTimes = perEvent.filter(e => e.rendered).map(e => e.tRender);
      const renderOrdered = renderTimes.every((t, k) => k === 0 || t >= renderTimes[k - 1]);
      const duplicates = arrival.length - new Set(arrival).size;
      return {
        perEvent,
        received: perEvent.filter(e => e.received).length,
        rendered: perEvent.filter(e => e.rendered).length,
        arrivalOrdered, renderOrdered, duplicates,
        latency: stats(perEvent.map(e => e.latencyMs)),
        network: stats(perEvent.map(e => e.sendToRecvMs)),
        app: stats(perEvent.map(e => e.recvToRenderMs)),
      };
    }
    const aA = analyse(pA);
    const aB = analyse(pB);
    const skews = sent.map((e, k) => (aA.perEvent[k].tRender && aB.perEvent[k].tRender ? Math.abs(aA.perEvent[k].tRender - aB.perEvent[k].tRender) : null));
    const rejected = pI.wsRecv.filter(r => r.kind === 'rejected' || r.kind === 'error');
    metrics.orderedDelivery = {
      planned: args.events, emitted: sent.length, intervalMs: args.intervalMs, error: p2Error,
      instructorRejectedOrErrors: rejected,
      slideRecognitionMs: stats(slideSwitches.map(s => s.ms)), slideSwitches,
      A: { received: aA.received, rendered: aA.rendered, arrivalOrdered: aA.arrivalOrdered, renderOrdered: aA.renderOrdered, duplicates: aA.duplicates, latency: aA.latency, network: aA.network, app: aA.app },
      B: { received: aB.received, rendered: aB.rendered, arrivalOrdered: aB.arrivalOrdered, renderOrdered: aB.renderOrdered, duplicates: aB.duplicates, latency: aB.latency, network: aB.network, app: aB.app },
      skew: stats(skews),
      perEvent: sent.map((e, k) => ({ i: e.i, seq: e.seq, key: e.key, A: aA.perEvent[k].latencyMs, B: aB.perEvent[k].latencyMs, skew: skews[k] })),
    };
    const n = args.events;
    check('D01', `Delivery: ${n} ordered region changes reach both students`, pass(!p2Error && aA.rendered === n && aB.rendered === n),
      `${p2Error ? `run stopped: ${p2Error}; ` : ''}emitted ${sent.length}/${n}; A rendered ${aA.rendered}/${n} (received ${aA.received}); B rendered ${aB.rendered}/${n} (received ${aB.received}); relay rejections/errors to instructor: ${rejected.length}`);
    check('D02', 'Order preserved (arrival and render)', pass(aA.arrivalOrdered && aB.arrivalOrdered && aA.renderOrdered && aB.renderOrdered && aA.duplicates === 0 && aB.duplicates === 0),
      `A arrival ordered ${aA.arrivalOrdered}, render ordered ${aA.renderOrdered}, duplicates ${aA.duplicates}; B arrival ordered ${aB.arrivalOrdered}, render ordered ${aB.renderOrdered}, duplicates ${aB.duplicates}`);
    check('D03', 'Event-to-render latency, student A (click to DOM commit)', 'MEASURED', `p50 ${ms(aA.latency.p50)}, p95 ${ms(aA.latency.p95)}, max ${ms(aA.latency.max)} (n=${aA.latency.n}); network share p50 ${ms(aA.network.p50)}, app share p50 ${ms(aA.app.p50)}`);
    check('D04', 'Event-to-render latency, student B (click to DOM commit)', 'MEASURED', `p50 ${ms(aB.latency.p50)}, p95 ${ms(aB.latency.p95)}, max ${ms(aB.latency.max)} (n=${aB.latency.n}); network share p50 ${ms(aB.network.p50)}, app share p50 ${ms(aB.app.p50)}`);
    const sk = stats(skews);
    check('D05', 'Inter-student render skew |A - B|', 'MEASURED', `p50 ${ms(sk.p50)}, p95 ${ms(sk.p95)}, max ${ms(sk.max)} (n=${sk.n})`);
    const rec = metrics.orderedDelivery.slideRecognitionMs;
    check('D06', 'Tab share: slide change to instructor match', 'MEASURED', `${slideSwitches.length} switches; p50 ${ms(rec.p50)}, max ${ms(rec.max)} (sampler runs every 500 ms)`);

    // ------------------------------------------------------------------ P3
    console.log('\nP3 reconnect');
    const regionsOf = assetId => pack.assets.find(a => a.assetId === assetId).regions.map(r => r.regionId);
    let toggle = 0;
    /** Emits alternating regions on the current slide every `every` ms for `durationMs`. */
    async function emitDuring(durationMs, every = 1000, avoidFinalKey = null) {
      const regions = regionsOf(currentAsset);
      const out = [];
      const end = Date.now() + durationMs;
      const emitOne = async () => {
        const current = await currentInstructorKey(ins);
        let chosen = regions[toggle++ % regions.length];
        if (current && current.endsWith(`|${chosen}`)) chosen = regions[toggle++ % regions.length];
        const r = await indicate(ins, chosen);
        if (!r.error) out.push({ t: r.t, seq: r.seq, key: `${titleOf[currentAsset]}|${chosen}` });
        return r;
      };
      while (Date.now() < end) {
        const r = await emitOne();
        await sleep(Math.max(0, every - (Date.now() - r.t)));
      }
      // A convergence check is only meaningful if the instructor ends somewhere
      // other than where the dropped student already is.
      if (avoidFinalKey && (await currentInstructorKey(ins)) === avoidFinalKey) await emitOne();
      return out;
    }
    const firstAfter = (list, t, pred) => list.find(x => x.t >= t && pred(x));
    const pillsBetween = (p, t0, t1) => {
      const before = p.pill.filter(x => x.t <= t0).pop();
      return [...(before ? [before.pill] : []), ...p.pill.filter(x => x.t > t0 && x.t <= t1).map(x => x.pill)];
    };
    const liveMsWithin = (p, t0, t1) => {
      // Milliseconds inside [t0, t1] during which the pill read "live".
      const timeline = p.pill.filter(x => x.t <= t1);
      let total = 0;
      for (let k = 0; k < timeline.length; k++) {
        const from = Math.max(timeline[k].t, t0);
        const to = Math.min(k + 1 < timeline.length ? timeline[k + 1].t : t1, t1);
        if (timeline[k].pill === 'live' && to > from) total += to - from;
      }
      return total;
    };

    // R: silent stall via Playwright's context.setOffline. In Chromium this does
    // not close an open WebSocket; it holds its traffic until the context is
    // online again. Occasionally it does not affect the open socket at all, so
    // a run where nothing was held is retried once and otherwise reported as
    // INCONCLUSIVE rather than graded.
    {
      const attempts = [];
      let s = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const preKey = await keyOf(B.page);
        const tOff = Date.now();
        await B.context.setOffline(true);
        const emitted = await emitDuring(5000, 1000, preKey);
        const tOn = Date.now();
        await B.context.setOffline(false);
        const target = await currentInstructorKey(ins);
        const back0 = await pillIs(B.page, 'live', 15000);
        const converged0 = await keyIs(B.page, target, 15000);
        const pb = await probe(B.page);
        const pa = await probe(A.page);
        const received = emitted.filter(e => pb.wsRecv.some(r => r.kind === 'event' && r.seq === e.seq && r.t <= tOn));
        const held = emitted.filter(e => !received.includes(e));
        const liveAt = firstAfter(pb.pill, tOn, x => x.pill === 'live');
        const convAt = firstAfter(pb.dom, tOn, x => x.key === target);
        const heldRecv = pb.wsRecv.filter(r => r.t > tOn && r.kind === 'event' && held.some(e => e.seq === r.seq));
        s = {
          attempt, preOutageKey: preKey, target, offlineMs: tOn - tOff, emitted: emitted.length,
          receivedWhileOffline: received.length, held: held.length,
          socketClosesWhileOffline: pb.wsClose.filter(c => c.t > tOff && c.t <= tOn).length,
          pillsWhileOffline: pillsBetween(pb, tOff, tOn),
          // From one second after the first held event was sent until the network returned.
          liveMsWhileHeld: held.length ? liveMsWithin(pb, held[0].t + 1000, tOn) : 0,
          heldWindowMs: held.length ? Math.max(0, tOn - held[0].t - 1000) : 0,
          heldDeliveredAfterRestore: heldRecv.length,
          firstHeldDeliveredMsAfterRestore: heldRecv[0] ? heldRecv[0].t - tOn : null,
          liveAfterRestore: back0.ok, liveMsAfterRestore: back0.ok ? (liveAt ? liveAt.t - tOn : 0) : null,
          converged: converged0.ok, convergeMsAfterRestore: convAt ? convAt.t - tOn : null,
          aRendered: emitted.filter(e => pa.dom.some(d => d.t >= e.t && d.key === e.key)).length,
        };
        attempts.push(s);
        if (s.held > 0) break;
      }
      metrics.silentStall = { attempts };
      const took = s.held > 0;
      const why = 'Chromium offline emulation did not hold any traffic on the open socket in either attempt, so there was no outage to observe';
      check('R01', 'Silent stall (context.setOffline 5 s): B pill shows a non-live state', took ? pass(s.pillsWhileOffline.some(v => v !== 'live')) : 'INCONCLUSIVE',
        took ? `pill values while offline: ${JSON.stringify(s.pillsWhileOffline)}; socket closes: ${s.socketClosesWhileOffline}; ${s.held} of ${s.emitted} instructor events were held (not delivered) while offline${attempts.length > 1 ? `; attempt ${s.attempt} (attempt 1 held nothing)` : ''}` : `${why}: B received ${s.receivedWhileOffline}/${s.emitted} live`);
      check('R02', 'Silent stall: no false "live" while offline', took ? pass(s.liveMsWhileHeld === 0) : 'INCONCLUSIVE',
        took ? `B's pill read "live" for ${s.liveMsWhileHeld} of ${s.heldWindowMs} ms while ${s.held} events were held back. The socket never closed and the client has no heartbeat, so nothing noticed. See bug BUG-1` : why);
      check('R03', 'Silent stall: pill is live after restore', pass(s.liveAfterRestore), s.liveAfterRestore ? `live ${ms(s.liveMsAfterRestore)} after restore${s.pillsWhileOffline.every(v => v === 'live') ? ' (it never left live)' : ''}` : `pill "${await pillOf(B.page)}" 15 s after restore`);
      check('R04', 'Silent stall: B converges to the instructor\'s current region after restore', pass(s.converged),
        s.converged ? `B went from "${s.preOutageKey}" to the instructor's "${s.target}" ${ms(s.convergeMsAfterRestore)} after restore; ${s.heldDeliveredAfterRestore} held events arrived late, first ${ms(s.firstHeldDeliveredMsAfterRestore)} after restore` : `B shows "${await keyOf(B.page)}", instructor at "${s.target}"`);
      check('R05', 'Silent stall: student A unaffected', pass(s.aRendered === s.emitted), `A rendered ${s.aRendered}/${s.emitted} events emitted during B's outage`);
    }

    // H: hard drop. B's proxy resets its TCP connection and refuses new ones for 5 s.
    {
      const preKey = await keyOf(B.page);
      const tDown = Date.now();
      proxyB.setDown(true);
      const staleSeen = pillIs(B.page, 'stale', 5000);
      const emitted = await emitDuring(5000, 1000, preKey);
      const stale = await staleSeen;
      const tUp = Date.now();
      proxyB.setDown(false);
      const target = await currentInstructorKey(ins);
      const back0 = await pillIs(B.page, 'live', 20000);
      const tBack = Date.now();
      const converged0 = await keyIs(B.page, target, 15000);
      const keyAfter = await keyOf(B.page);
      const pb0 = await probe(B.page);
      const liveAt = firstAfter(pb0.pill, tUp, x => x.pill === 'live');
      const back = { ok: back0.ok, ms: liveAt ? liveAt.t - tUp : null };
      const convAt = firstAfter(pb0.dom, tUp, x => x.key === target);
      const converged = { ok: converged0.ok, ms: convAt && liveAt ? convAt.t - liveAt.t : null };
      const pa = await probe(A.page);
      const pills = pillsBetween(pb0, tDown, tUp);
      const liveMs = liveMsWithin(pb0, tDown + 1000, tUp); // allow the close to surface
      const reopened = pb0.wsOpen.filter(o => o.t > tUp);
      const catchUp = pb0.wsRecv.filter(r => r.t > tUp && r.kind === 'event');
      const aFollowed = emitted.every(e => pa.dom.some(d => d.t >= e.t && d.key === e.key));
      // Then one more instructor event: does live delivery resume?
      // It must change what B shows: not B's current (possibly stale) region; preferably not the instructor's either.
      const shows = r => `${titleOf[currentAsset]}|${r}` === keyAfter;
      const nextRegion = regionsOf(currentAsset).find(r => !shows(r) && !target.endsWith(`|${r}`)) ?? regionsOf(currentAsset).find(r => !shows(r));
      const follow = await indicate(ins, nextRegion);
      const followed0 = await keyIs(B.page, `${titleOf[currentAsset]}|${nextRegion}`, 10000);
      const pb = await probe(B.page);
      const followAt = firstAfter(pb.dom, follow.t, x => x.key === `${titleOf[currentAsset]}|${nextRegion}`);
      const followed = { ok: followed0.ok, ms: followAt ? followAt.t - follow.t : null };
      metrics.hardDrop = { preOutageKey: preKey, downMs: tUp - tDown, emitted: emitted.length, staleAfterMs: stale.ok ? stale.ms : null, pillsWhileDown: pills, liveMsWhileDown: liveMs, reconnectMsAfterRestore: back.ok ? back.ms : null, reopenedSockets: reopened, eventsReceivedAfterReconnectBeforeNextEmit: catchUp.filter(r => r.t < follow.t).map(r => ({ seq: r.seq, type: r.type })), target, keyAfterWait: keyAfter, converged: converged.ok, followedNextEvent: followed.ok, followMs: followed.ok ? followed.ms : null, aFollowedAll: aFollowed, proxyLog: proxyB.log.filter(l => l.t >= tDown).map(l => ({ dt: l.t - tDown, refused: l.refused })) };
      check('H01', 'Hard drop (TCP reset, 5 s): B pill shows a non-live state', pass(stale.ok), stale.ok ? `"stale" ${ms(stale.ms)} after the drop; pill values while down: ${JSON.stringify(pills)}` : `pill values while down: ${JSON.stringify(pills)}`);
      check('H02', 'Hard drop: no false "live" while down', pass(liveMs === 0), `pill read "live" for ${liveMs} ms of the outage (after the first second)`);
      check('H03', 'Hard drop: B reconnects and returns to live', pass(back.ok), back.ok ? `live ${ms(back.ms)} after the network returned; resumed socket: ${reopened.some(o => o.resumed)}` : `pill "${await pillOf(B.page)}" 20 s after restore; reconnect attempts refused by proxy while down: ${metrics.hardDrop.proxyLog.filter(l => l.refused).length}`);
      check('H04', 'Hard drop: B converges to the instructor\'s current region with no new event (latest-state catch-up)', pass(converged.ok),
        converged.ok ? `B shows "${target}" ${ms(converged.ms)} after reconnect` : `15 s after reconnect B still shows "${keyAfter}" while the instructor is at "${target}"; events received after reconnect: ${catchUp.filter(r => r.t < follow.t).length}. See bug BUG-2`);
      check('H05', 'Hard drop: live delivery resumes on the next instructor event', pass(followed.ok), followed.ok ? `B rendered the next region ${ms(followed.ms)} after it was sent` : `B did not render "${nextRegion}" within 10 s`);
      check('H06', 'Hard drop: student A unaffected', pass(aFollowed), `A rendered ${emitted.filter(e => pa.dom.some(d => d.t >= e.t && d.key === e.key)).length}/${emitted.length} events emitted during B's outage`);
      await sleep(Math.max(0, args.intervalMs - (Date.now() - tBack)));
    }

    // E: extended hard drop (15 s), longer than the client's five-step backoff.
    {
      const tDown = Date.now();
      proxyB.setDown(true);
      const stale = await pillIs(B.page, 'stale', 5000);
      await sleep(15000 - (Date.now() - tDown));
      const tUp = Date.now();
      proxyB.setDown(false);
      const back = await pillIs(B.page, 'live', 30000);
      const pb = await probe(B.page);
      const attempts = proxyB.log.filter(l => l.t > tDown);
      const lastAttempt = attempts[attempts.length - 1];
      metrics.extendedDrop = { downMs: tUp - tDown, staleSeen: stale.ok, recoveredAutomatically: back.ok, recoverMs: back.ok ? back.ms : null, connectAttempts: attempts.map(l => ({ dt: l.t - tDown, refused: l.refused })), lastAttemptMsAfterDrop: lastAttempt ? lastAttempt.t - tDown : null, pillAfter30s: await pillOf(B.page), socketsOpenedAfterRestore: pb.wsOpen.filter(o => o.t > tUp).length };
      check('E01', 'Extended drop (15 s): B reconnects on its own after the network returns', pass(back.ok),
        back.ok ? `live ${ms(back.ms)} after restore` : `still "${metrics.extendedDrop.pillAfter30s}" 30 s after restore; ${attempts.length} connection attempts, the last ${ms(metrics.extendedDrop.lastAttemptMsAfterDrop)} after the drop, none after the network returned. See bug BUG-3`);
      let rejoined = { ok: back.ok, ms: 0 };
      if (!back.ok) {
        const target = await currentInstructorKey(ins);
        await button(B.page, 'Join').click();
        rejoined = await pillIs(B.page, 'live', 15000);
        const conv = await keyIs(B.page, target, 10000);
        metrics.extendedDrop.manualRejoin = { live: rejoined.ok, liveMs: rejoined.ms, converged: conv.ok, target };
        check('E02', 'Extended drop: pressing Join again recovers B', pass(rejoined.ok && conv.ok), `live ${rejoined.ok ? ms(rejoined.ms) : 'NOT reached'}; converged to "${target}": ${conv.ok}`);
      }
      if (!rejoined.ok) throw new Error('Student B could not be recovered; lifecycle checks need both students.');
    }

    // P: the relay's resume path, at protocol level (no browser), to pin down H04.
    {
      const r = await relayResumeProbe(args.relay);
      metrics.relayResumeProbe = r;
      check('P01', 'Relay: a student resuming with its capability gets the latest state', pass(r.catchUpOnResume),
        `join catch-up: ${r.catchUpOnJoin ? `${r.catchUpOnJoin.type} (sent via $default)` : 'none'}; resume catch-up within 8 s: ${r.catchUpOnResume ? r.catchUpOnResume.type : 'NONE'}; next live event on resumed socket: ${r.liveAfterResume}`);
      const allow = await relayAllowlistProbe(args.relay);
      metrics.relayAllowlistProbe = allow;
      const refused = allow.results.filter(x => x.reply !== 'accepted');
      check('P02', 'Relay accepts every event type the extension emits', pass(refused.length === 0),
        refused.length === 0 ? `all ${allow.results.length} accepted: ${allow.results.map(x => x.type).join(', ')}` : `refused: ${refused.map(x => `${x.type} -> ${x.reply}`).join('; ')}; accepted: ${allow.results.filter(x => x.reply === 'accepted').map(x => x.type).join(', ')}. See bug BUG-4`);
      const race = await relayEndRaceProbe(args.relay, 6);
      metrics.relayEndRaceProbe = race;
      const delivered = race.trials.filter(t => t.studentGotEnded).length;
      check('P03', 'Relay: session.ended reaches students when the client closes right after sending it (End Session)', pass(delivered === race.trials.length),
        `${delivered}/${race.trials.length} trials delivered session.ended to the student; the other trials' events were lost to the close that follows in the same tick. See bug BUG-5`);
    }

    // ------------------------------------------------------------------ P4
    console.log('\nP4 window and screen shares');
    for (const [surface, layout, label] of [['window', 'window', 'a window'], ['monitor', 'monitor', 'your screen']]) {
      const si = await newContext(browser, `instructor-${surface}`, { images });
      contexts.push(si);
      await startSharing(si, { deny: false, layout, surface, slide: 'cell-slide-01' });
      const code = await waitIn(si.page, () => /^[A-Z0-9]{6}$/.test(document.querySelector('.join code')?.textContent ?? ''), null, 20000);
      const t0 = Date.now();
      const first = await hasStatus(si.page, `Sharing ${label}. Current slide: ${titleOf['cell-slide-01']}.`, 20000);
      const firstMs = Date.now() - t0;
      const statusFirst = await statusOf(si.page);
      const second = await switchSlide(si, 'cell-slide-04', 20000);
      const statusSecond = await statusOf(si.page);
      const tU = await si.page.evaluate(() => window.__qaCapture.setSlide('unapproved-photosynthesis'));
      const unmatched = await hasStatus(si.page, 'Unmatched: the shared screen is not a reviewed slide.', 20000);
      const statusUnmatched = await statusOf(si.page);
      const ps = await probe(si.page);
      const falseMatch = ps.instructorStatus.filter(s => s.t > tU && /Current slide:/.test(s.status || '') && !(s.status || '').includes(titleOf['cell-slide-04']));
      const rejected = ps.wsRecv.filter(r => r.kind === 'rejected' || r.kind === 'error');
      const assetEvents = ps.wsSent.filter(s => s.type === 'asset.changed').map(s => s.assetId);
      metrics[`${surface}Share`] = { firstMatchMs: first.ok ? firstMs : null, switchMatchMs: second.ok ? second.ms : null, unmatchedMs: unmatched.ok ? unmatched.ms : null, assetEventsSent: assetEvents, relayRejections: rejected, statuses: [statusFirst, statusSecond, statusUnmatched] };
      const id = surface === 'window' ? 'S0' : 'S1';
      check(`${id}1`, `${surface === 'window' ? 'Window' : 'Whole-screen'} share: slide found inside ${surface === 'window' ? 'toolbar and margins' : 'desktop, menu bar, dock, other window'}`, pass(code.ok && first.ok),
        first.ok ? `"${titleOf['cell-slide-01']}" matched ${ms(firstMs)} after the share started; status "${statusFirst}"` : `no match within 20 s; status "${statusFirst}"`);
      check(`${id}2`, `${surface === 'window' ? 'Window' : 'Whole-screen'} share: slide change followed`, pass(second.ok), second.ok ? `"${titleOf['cell-slide-04']}" matched ${ms(second.ms)} after the change; asset.changed sent for ${JSON.stringify(assetEvents)}; relay rejections ${rejected.length}` : `status "${statusSecond}"`);
      check(`${id}3`, `${surface === 'window' ? 'Window' : 'Whole-screen'} share: unreviewed slide reads Unmatched, no invented match`, pass(unmatched.ok && falseMatch.length === 0),
        unmatched.ok ? `Unmatched ${ms(unmatched.ms)} after the change; false matches: ${falseMatch.length}; status "${statusUnmatched}"` : `status "${statusUnmatched}"`);
      await button(si.page, 'End Session').click().catch(() => {});
      await sleep(500);
    }

    // ------------------------------------------------------------------ P5
    console.log('\nP5 unmatched, correction, pause, source closure, stop, end');
    {
      const both = async (fn) => Promise.all([fn(A), fn(B)]);
      const pills = async () => `A "${await pillOf(A.page)}", B "${await pillOf(B.page)}"`;
      const click = (page, name) => button(page, name).click({ timeout: 5000 });
      /** Relay replies to the instructor since `t` (accepted / rejected with rules / error). */
      const repliesSince = async (t) => (await probe(ins.page)).wsRecv.filter(r => r.t >= t && r.kind !== 'event').map(r => r.kind + (r.rules ? `:${r.rules.join(',')}` : '') + (r.reason ? `:${r.reason}` : ''));
      const sentSince = async (t) => (await probe(ins.page)).wsSent.filter(s => s.t >= t && s.kind === 'event').map(s => `${s.seq}:${s.type}`);
      /** Runs one lifecycle step; a thrown error becomes a FAIL row with what the instructor page showed. */
      async function step(id, name, fn) {
        try {
          await fn();
        } catch (error) {
          const status = await statusOf(ins.page).catch(() => null);
          const buttons = await ins.page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim())).catch(() => []);
          const shot = path.join(common.REPO, `.cache/qa/artifacts/${id}-instructor.png`);
          fs.mkdirSync(path.dirname(shot), { recursive: true });
          await ins.page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          check(id, name, 'FAIL', `step could not run: ${String(error.message).split('\n')[0]}; instructor status "${status}"; buttons [${buttons.join(', ')}]; ${await pills()}; screenshot ${path.relative(common.REPO, shot)}`);
        }
      }

      await step('L01', 'Tab share: unreviewed slide -> instructor Unmatched, both students "unmatched"', async () => {
        await ins.page.evaluate(() => window.__qaCapture.setSlide('unapproved-photosynthesis'));
        const insUnmatched = await hasStatus(ins.page, 'Unmatched: the shared screen is not a reviewed slide.', 15000);
        const [uA, uB] = await both(s => pillIs(s.page, 'unmatched', 10000));
        check('L01', 'Tab share: unreviewed slide -> instructor Unmatched, both students "unmatched"', pass(insUnmatched.ok && uA.ok && uB.ok), `instructor ${insUnmatched.ok ? `Unmatched in ${ms(insUnmatched.ms)}` : `"${await statusOf(ins.page)}"`}; ${await pills()}`);
      });

      await step('L02', 'Correction: both students follow the corrected slide and region; correction sticks', async () => {
        await ins.page.selectOption('#correct-asset', 'cell-slide-02', { timeout: 5000 });
        await ins.page.selectOption('#correct-region', 'nucleolus', { timeout: 5000 });
        await click(ins.page, 'Apply correction');
        const target = `${titleOf['cell-slide-02']}|nucleolus`;
        const [cA, cB] = await both(s => keyIs(s.page, target, 10000));
        const liveAgain = await both(s => pillIs(s.page, 'live', 5000));
        await sleep(2000);
        const stillCorrected = (await statusOf(ins.page)).includes(`Current slide: ${titleOf['cell-slide-02']}. Region: nucleolus.`);
        check('L02', 'Correction: both students follow the corrected slide and region; correction sticks', pass(cA.ok && cB.ok && liveAgain.every(x => x.ok) && stillCorrected),
          `A ${cA.ok ? ms(cA.ms) : `"${await keyOf(A.page)}"`}, B ${cB.ok ? ms(cB.ms) : `"${await keyOf(B.page)}"`}; ${await pills()}; instructor still on the correction 2 s later with the unreviewed slide on screen: ${stillCorrected}`);
      });

      await step('L03', 'After a correction, moving to a reviewed slide resumes automatic matching', async () => {
        const resumeAuto = await switchSlide(ins, 'cell-slide-03');
        const [mA, mB] = await both(s => keyIs(s.page, `${titleOf['cell-slide-03']}|`, 10000));
        check('L03', 'After a correction, moving to a reviewed slide resumes automatic matching', pass(resumeAuto.ok && mA.ok && mB.ok), `instructor matched "${titleOf['cell-slide-03']}" ${resumeAuto.ok ? ms(resumeAuto.ms) : 'NOT within 15 s'}; A ${mA.ok}, B ${mB.ok}`);
      });

      await step('L04', 'Pause: both students show "paused"; slide changes are not sent while paused', async () => {
        const t = Date.now();
        await click(ins.page, 'Pause');
        const [pA2, pB2] = await both(s => pillIs(s.page, 'paused', 10000));
        const insPaused = await hasStatus(ins.page, 'Paused.', 5000);
        const tSlide = Date.now();
        await ins.page.evaluate(() => window.__qaCapture.setSlide('cell-slide-05'));
        await sleep(2500);
        const sentWhilePaused = await sentSince(tSlide);
        check('L04', 'Pause: both students show "paused"; slide changes are not sent while paused', pass(pA2.ok && pB2.ok && insPaused.ok && sentWhilePaused.length === 0), `${await pills()}; instructor paused: ${insPaused.ok}; events sent after a slide change while paused: ${sentWhilePaused.length}; relay replies: ${JSON.stringify(await repliesSince(t))}`);
      });

      await step('L05', 'Resume: both students live again and follow the slide changed during pause', async () => {
        await click(ins.page, 'Resume');
        const [rA, rB] = await both(s => pillIs(s.page, 'live', 10000));
        const caught = await both(s => keyIs(s.page, `${titleOf['cell-slide-05']}|`, 10000));
        check('L05', 'Resume: both students live again and follow the slide changed during pause', pass(rA.ok && rB.ok && caught.every(x => x.ok)), `${await pills()}; A on "${await keyOf(A.page)}", B on "${await keyOf(B.page)}"`);
      });

      const codeBefore = await ins.page.textContent('.join code', { timeout: 2000 }).catch(() => null);

      await step('L06', 'Source closed by the browser ("Stop sharing" bar): students leave "live", session stays open', async () => {
        const t = Date.now();
        await ins.page.evaluate(() => window.__qaCapture.endShare());
        const insStopped = await hasStatus(ins.page, 'Stopped sharing. The session is still open', 10000);
        const [sA, sB] = await both(s => pillIs(s.page, 'stopped', 10000));
        const codeKept = (await ins.page.$('.join code')) ? await ins.page.textContent('.join code') : null;
        const replies = await repliesSince(t);
        metrics.sourceClosure = { sent: await sentSince(t), relayReplies: replies, A: await pillOf(A.page), B: await pillOf(B.page) };
        check('L06', 'Source closed by the browser ("Stop sharing" bar): students leave "live", session stays open', pass(insStopped.ok && sA.ok && sB.ok && codeKept === codeBefore),
          `instructor "${await statusOf(ins.page)}"; ${await pills()} 10 s later; sent ${JSON.stringify(metrics.sourceClosure.sent)}; relay replied ${JSON.stringify(replies)}; join code kept: ${codeKept === codeBefore}`);
      });

      await step('L07', 'Start again on the same code: students follow without rejoining', async () => {
        const tRestart = await startSharing(ins, { deny: false, layout: 'tab', surface: 'browser', slide: 'cell-slide-02' });
        const rematch = await hasStatus(ins.page, `Current slide: ${titleOf['cell-slide-02']}.`, 20000);
        const matchMs = Date.now() - tRestart;
        const [lA, lB] = await both(s => pillIs(s.page, 'live', 10000));
        const [kA, kB] = await both(s => keyIs(s.page, `${titleOf['cell-slide-02']}|`, 10000));
        const codeSame = (await ins.page.textContent('.join code', { timeout: 2000 }).catch(() => null)) === codeBefore;
        check('L07', 'Start again on the same code: students follow without rejoining', pass(rematch.ok && lA.ok && lB.ok && kA.ok && kB.ok && codeSame), `matched ${rematch.ok ? `${ms(matchMs)} after Start` : 'NO'}; same code: ${codeSame}; ${await pills()}; instructor now "${await statusOf(ins.page)}"`);
      });

      await step('L08', 'Stop button: students leave "live" (show "stopped")', async () => {
        metrics.captureControlsAria = await ins.page.locator('[aria-label="Capture controls"]').ariaSnapshot({ timeout: 2000 }).catch(() => null);
        const t = Date.now();
        await click(ins.page, 'Stop');
        const insStopped = await hasStatus(ins.page, 'Stopped sharing.', 5000);
        const [tA, tB] = await both(s => pillIs(s.page, 'stopped', 10000));
        const replies = await repliesSince(t);
        metrics.stopButton = { sent: await sentSince(t), relayReplies: replies, A: await pillOf(A.page), B: await pillOf(B.page) };
        check('L08', 'Stop button: students leave "live" (show "stopped")', pass(insStopped.ok && tA.ok && tB.ok), `instructor "${await statusOf(ins.page)}"; ${await pills()} 10 s later; sent ${JSON.stringify(metrics.stopButton.sent)}; relay replied ${JSON.stringify(replies)}`);
      });

      await step('L09', 'End Session: both students "ended"', async () => {
        const t = Date.now();
        await click(ins.page, 'End Session');
        const insEnded = await hasStatus(ins.page, 'Session ended.', 5000);
        const [eA, eB] = await both(s => pillIs(s.page, 'ended', 15000));
        const [pA3, pB3] = await Promise.all([probe(A.page), probe(B.page)]);
        metrics.endSession = { sent: await sentSince(t), instructorEnded: insEnded.ok, A: await pillOf(A.page), B: await pillOf(B.page), aReceived: pA3.wsRecv.filter(r => r.t >= t).map(r => r.type || r.kind), bReceived: pB3.wsRecv.filter(r => r.t >= t).map(r => r.type || r.kind) };
        check('L09', 'End Session: both students "ended"', pass(insEnded.ok && eA.ok && eB.ok), `instructor ended: ${insEnded.ok}; sent ${JSON.stringify(metrics.endSession.sent)}; ${await pills()}; A received ${JSON.stringify(metrics.endSession.aReceived)}, B received ${JSON.stringify(metrics.endSession.bReceived)}`);
      });

      await step('L10', 'A late join to the ended code is refused', async () => {
        const late = await newContext(browser, 'late-student');
        contexts.push(late);
        await click(late.page, 'Student');
        await late.page.fill('#session-code', codeBefore ?? sessionCode);
        await click(late.page, 'Join');
        const refused = await waitIn(late.page, () => (document.querySelector('.student-experience .supporting-text')?.textContent ?? '').startsWith('Could not join'), null, 15000);
        check('L10', 'A late join to the ended code is refused', pass(refused.ok), `join message "${await late.page.textContent('.student-experience .supporting-text')}"; pill "${await pillOf(late.page)}"`);
      });
    }
  } catch (error) {
    notes.push(`Run aborted: ${error.message}`);
    console.error(`\nABORTED: ${error.stack}`);
  } finally {
    const pageErrors = [];
    for (const c of contexts) for (const e of c.errors) pageErrors.push({ context: c.name, ...e });
    metrics.pageErrors = pageErrors;
    const browserVersion = browser.version();
    await browser.close().catch(() => {});
    proxyA.close();
    proxyB.close();
    server.stop();

    const finishedAt = new Date();
    const summary = { pass: checks.filter(c => c.result === 'PASS').length, fail: checks.filter(c => c.result === 'FAIL').length, measured: checks.filter(c => c.result === 'MEASURED').length, inconclusive: checks.filter(c => c.result === 'INCONCLUSIVE').length };
    const json = {
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationS: Math.round((finishedAt - startedAt) / 1000),
      git, relay: args.relay, build: buildInfo, options: args,
      environment: common.environment({ chromium: browserVersion, headless: !args.headed, contexts: 'instructor, studentA (own proxy), studentB (own proxy), plus window/screen instructors and a late student' }),
      summary, checks, metrics, notes,
    };
    console.log(`\n${summary.pass} PASS, ${summary.fail} FAIL, ${summary.measured} MEASURED, ${summary.inconclusive} INCONCLUSIVE`);
    if (!args.noWrite) {
      common.writeResults('live-bench', json, renderMarkdown(json));
      console.log(`Wrote ${common.RESULTS_MD} and ${common.RESULTS_JSON}`);
    }
    process.exitCode = summary.fail > 0 || notes.length > 0 ? 1 : 0;
  }
}

/** Protocol-level repro for the reconnect catch-up: create, publish, join, drop, resume with capability. */
async function relayResumeProbe(url) {
  const sessionId = `QA${Date.now().toString(36).toUpperCase().slice(-4)}`;
  const base = { schemaVersion: '1.0', sessionId, packId: pack.packId, packVersion: pack.version };
  const open = (u) => new Promise((resolve, reject) => {
    const ws = new WebSocket(u);
    const msgs = [];
    ws.addEventListener('message', e => { try { msgs.push(JSON.parse(e.data)); } catch { /* ignore */ } });
    ws.addEventListener('open', () => resolve({ ws, msgs }));
    ws.addEventListener('error', () => reject(new Error('relay connect failed')));
  });
  const next = async (c, pred, timeout) => { const end = Date.now() + timeout; while (Date.now() < end) { const m = c.msgs.find(pred); if (m) return m; await sleep(50); } return null; };
  const event = (sequence, extra) => JSON.stringify({ kind: 'event', event: { ...base, sequence, sentAt: new Date().toISOString(), ...extra } });
  const inst = await open(url);
  inst.ws.send(JSON.stringify({ kind: 'create', sessionId }));
  await next(inst, m => m.kind === 'capability', 10000);
  inst.ws.send(event(1, { type: 'session.started' }));
  await next(inst, m => m.kind === 'accepted', 10000);
  inst.ws.send(event(2, { type: 'asset.changed', assetId: 'cell-slide-01' }));
  await sleep(1000);
  const student = await open(url);
  student.ws.send(JSON.stringify({ kind: 'join', sessionId, role: 'student' }));
  const capability = await next(student, m => m.kind === 'capability', 10000);
  const joinCatch = await next(student, m => m.kind === 'event', 3000);
  student.ws.close();
  await sleep(1500);
  inst.ws.send(event(3, { type: 'region.changed', assetId: 'cell-slide-01', regionId: 'nucleus' }));
  await sleep(1500);
  const encoded = Buffer.from(JSON.stringify(capability.capability), 'utf8').toString('base64url');
  const resumed = await open(`${url}?sessionId=${encodeURIComponent(sessionId)}&capability=${encoded}`);
  const resumeCatch = await next(resumed, m => m.kind === 'event', 8000);
  inst.ws.send(event(4, { type: 'region.changed', assetId: 'cell-slide-01', regionId: 'cytoplasm' }));
  const live = await next(resumed, m => m.kind === 'event' && m.event.sequence === 4, 8000);
  inst.ws.send(JSON.stringify({ kind: 'close', sessionId }));
  await sleep(500);
  inst.ws.close();
  resumed.ws.close();
  const describe = m => (m ? { type: m.event.type, sequence: m.event.sequence, regionId: m.event.regionId } : null);
  return { sessionId, catchUpOnJoin: describe(joinCatch), catchUpOnResume: describe(resumeCatch), liveAfterResume: !!live };
}

/**
 * Sends one of each event type the instructor controller can emit
 * (apps/extension/src/instructor/captureController.ts, `Emittable`) through a
 * fresh session, in a valid order, and records the relay's reply to each.
 */
async function relayAllowlistProbe(url) {
  const sessionId = `QB${Date.now().toString(36).toUpperCase().slice(-4)}`;
  const base = { schemaVersion: '1.0', sessionId, packId: pack.packId, packVersion: pack.version };
  const ws = new WebSocket(url);
  const msgs = [];
  ws.addEventListener('message', e => { try { msgs.push(JSON.parse(e.data)); } catch { /* ignore */ } });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', () => reject(new Error('relay connect failed'))); });
  const reply = async (from, timeout = 10000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (msgs.length > from) return msgs[from]; await sleep(25); } return null; };
  let cursor = msgs.length;
  ws.send(JSON.stringify({ kind: 'create', sessionId }));
  await reply(cursor);
  const sequence = [
    { type: 'session.started' },
    { type: 'asset.changed', assetId: 'cell-slide-01' },
    { type: 'region.changed', assetId: 'cell-slide-01', regionId: 'nucleus' },
    { type: 'source.unmatched' },
    { type: 'capture.paused' },
    { type: 'capture.resumed' },
    { type: 'capture.stopped' },
    { type: 'session.ended' },
  ];
  const results = [];
  let seq = 0;
  for (const extra of sequence) {
    cursor = msgs.length;
    ws.send(JSON.stringify({ kind: 'event', event: { ...base, sequence: ++seq, sentAt: new Date().toISOString(), ...extra } }));
    const r = await reply(cursor);
    results.push({ type: extra.type, reply: r ? r.kind + (r.rules ? `:${r.rules.join(',')}` : '') + (r.reason ? `:${r.reason}` : '') : 'no reply in 10 s' });
    if (r && r.kind !== 'accepted') seq -= 1; // a refused event does not advance the relay's sequence
  }
  ws.close();
  return { sessionId, results };
}

/**
 * What `CaptureController.endSession()` does on the wire: send `session.ended`,
 * then `WebSocketSessionClient.close()` sends `{kind: 'close'}` and closes the
 * socket, all in one tick. Repeated because the outcome is a race.
 */
async function relayEndRaceProbe(url, trials) {
  const results = [];
  const open = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs = [];
    ws.addEventListener('message', e => { try { msgs.push(JSON.parse(e.data)); } catch { /* ignore */ } });
    ws.addEventListener('open', () => resolve({ ws, msgs }));
    ws.addEventListener('error', () => reject(new Error('relay connect failed')));
  });
  const next = async (c, pred, timeout) => { const end = Date.now() + timeout; while (Date.now() < end) { const m = c.msgs.find(pred); if (m) return m; await sleep(25); } return null; };
  for (let i = 0; i < trials; i++) {
    const sessionId = `QE${Date.now().toString(36).toUpperCase().slice(-4)}`;
    const base = { schemaVersion: '1.0', sessionId, packId: pack.packId, packVersion: pack.version };
    const inst = await open();
    inst.ws.send(JSON.stringify({ kind: 'create', sessionId }));
    await next(inst, m => m.kind === 'capability', 10000);
    inst.ws.send(JSON.stringify({ kind: 'event', event: { ...base, type: 'session.started', sequence: 1, sentAt: new Date().toISOString() } }));
    await next(inst, m => m.kind === 'accepted', 10000);
    const student = await open();
    student.ws.send(JSON.stringify({ kind: 'join', sessionId, role: 'student' }));
    await next(student, m => m.kind === 'capability', 10000);
    const t = Date.now();
    inst.ws.send(JSON.stringify({ kind: 'event', event: { ...base, type: 'session.ended', sequence: 2, sentAt: new Date().toISOString() } }));
    inst.ws.send(JSON.stringify({ kind: 'close', sessionId }));
    inst.ws.close();
    const ended = await next(student, m => m.kind === 'event' && m.event.type === 'session.ended', 6000);
    results.push({ sessionId, studentGotEnded: !!ended, ms: ended ? Date.now() - t : null });
    student.ws.close();
    await sleep(300);
  }
  return { trials: results };
}

function renderMarkdown(r) {
  const od = r.metrics.orderedDelivery;
  const statRow = (label, s) => (s ? `| ${label} | ${s.n} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.max)} |` : `| ${label} | 0 | n/a | n/a | n/a |`);
  const lines = [];
  lines.push('## Live bench (AL-004 automated half, AL-001 automatable parts)');
  lines.push('');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Date | ${r.startedAt} (${r.durationS} s) |`);
  lines.push(`| Git HEAD | \`${r.git.head}\` on \`${r.git.branch}\` |`);
  lines.push(`| App source commit | \`${r.git.appSourceSha}\`${r.git.appSourceDirty ? ' (**uncommitted app changes present**)' : ''} |`);
  lines.push(`| Relay | \`${r.relay}\` |`);
  lines.push(`| Environment | ${r.environment.os}; ${r.environment.cpus}; Node ${r.environment.node}; Playwright ${r.environment.playwright}; Chromium ${r.environment.chromium} (${r.environment.headless ? 'headless' : 'headed'}) |`);
  lines.push(`| Contexts | ${r.environment.contexts} |`);
  lines.push(`| Capture | Fake \`getDisplayMedia\`: \`canvas.captureStream(5)\` of the reviewed PNGs; \`displaySurface\` reported as browser / window / monitor |`);
  lines.push(`| Result | **${r.summary.pass} PASS, ${r.summary.fail} FAIL, ${r.summary.measured} MEASURED, ${r.summary.inconclusive} INCONCLUSIVE** |`);
  lines.push('');
  lines.push('Rerun: `node scripts/qa/live-bench.cjs` (see the top of this file for setup).');
  lines.push('');
  if (r.notes.length) { lines.push(...r.notes.map(n => `> **${n}**`)); lines.push(''); }
  lines.push('### Checks', '', common.checksTable(r.checks), '');
  lines.push('MEASURED rows have no pass/fail budget: neither AL-004 nor `docs/SYSTEM_DESIGN.md` defines a latency or skew target, so the numbers are recorded, not graded. INCONCLUSIVE means the simulated condition did not take effect, so there was nothing to grade.');
  lines.push('');
  lines.push('How the network is shaped: students A and B each reach the relay through their own local CONNECT proxy (loopback, adds well under 1 ms and is the same for both), so B can be given a real TCP reset (H, E rows). The R rows use Playwright\'s `context.setOffline`, which in Chromium holds traffic on an open WebSocket instead of closing it.');
  lines.push('');
  if (od) {
    lines.push(`### Ordered delivery: ${od.emitted}/${od.planned} region changes, ${od.intervalMs} ms apart`, '');
    lines.push('| Series | n | p50 | p95 | max |', '| --- | --- | --- | --- | --- |');
    lines.push(statRow('Student A: click to render', od.A.latency));
    lines.push(statRow('Student B: click to render', od.B.latency));
    lines.push(statRow('Student A: instructor send to socket receive', od.A.network));
    lines.push(statRow('Student B: instructor send to socket receive', od.B.network));
    lines.push(statRow('Student A: socket receive to render', od.A.app));
    lines.push(statRow('Student B: socket receive to render', od.B.app));
    lines.push(statRow('Skew between A and B renders', od.skew));
    lines.push(statRow('Tab share: slide change to instructor match', od.slideRecognitionMs));
    lines.push('');
    lines.push(`Delivered: A ${od.A.rendered}/${od.planned}, B ${od.B.rendered}/${od.planned}. Order preserved: A ${od.A.arrivalOrdered && od.A.renderOrdered}, B ${od.B.arrivalOrdered && od.B.renderOrdered}. Per-event numbers are in the JSON (\`liveBench.metrics.orderedDelivery.perEvent\`).`);
    lines.push('');
  }
  const byId = Object.fromEntries(r.checks.map(c => [c.id, c.result]));
  const reproduced = BUGS.filter(b => b.checks.some(id => byId[id] === 'FAIL'));
  const cleared = BUGS.filter(b => b.checks.every(id => byId[id] === 'PASS'));
  const unexercised = BUGS.filter(b => !reproduced.includes(b) && !cleared.includes(b));
  lines.push('### Bugs reproduced in this run', '');
  lines.push(reproduced.length ? reproduced.map(b => b.text).join('\n\n') : 'None of the known bugs reproduced.');
  lines.push('');
  if (cleared.length) lines.push(`Known bugs whose checks all passed in this run: ${cleared.map(b => `${b.id}, ${b.title} (${b.checks.join(', ')})${b.history ? `; ${b.history}` : ''}`).join('. ')}.`, '');
  if (unexercised.length) lines.push(`Known bugs not exercised in this run: ${unexercised.map(b => `${b.id} (${b.checks.join(', ')})`).join('; ')}.`, '');
  lines.push('### Observations', '');
  const aria = r.metrics.captureControlsAria;
  if (aria) {
    const glyphNames = aria.split('\n').filter(l => /button "[^"A-Za-z]+\w/.test(l)).map(l => l.trim());
    lines.push(glyphNames.length
      ? `- Accessibility: CSS \`content\` glyphs end up in accessible names. The capture controls read \`${glyphNames.map(n => n.replace(/^- /, '').replace(/:$/, '')).join('`, `')}\` to assistive technology (\`button.stop::before\` in \`apps/extension/src/style.css\`; the same pattern is on \`[aria-pressed='true']::before\` and \`.connection-pill::before\`). CSS alt text (\`content: '\\25A0\\2002' / ''\`) would keep the glyph visual only.`
      : '- Capture control accessible names contain no decorative glyphs.');
  }
  const errs = r.metrics.pageErrors || [];
  // Student B's reconnect attempts fail by design while its network is down.
  const expected = errs.filter(e => e.context === 'studentB' && e.kind === 'console' && /^WebSocket connection to .* failed/.test(e.text));
  const unexpected = errs.filter(e => !expected.includes(e));
  lines.push(`- Console and page errors: ${errs.length} in total. ${expected.length} are student B's reconnect attempts failing while its network was deliberately down (\`WebSocket connection to ... failed\`), which is expected. ${unexpected.length ? `Unexpected (${unexpected.length}): ${unexpected.slice(0, 6).map(e => `${e.context} ${e.kind}: ${common.mdEscape(e.text).slice(0, 200)}`).join('; ')}${unexpected.length > 6 ? '; more in the JSON' : ''}.` : 'No other errors in any context.'}`);
  lines.push('');
  lines.push(LIMITS);
  return lines.join('\n');
}

// Bug write-ups are printed only when one of their checks fails in the run
// being reported, so a fixed bug drops out of the results on the next rerun.
const BUGS = [
  { id: 'BUG-1', title: 'no false-live protection on a silent network stall', checks: ['R01', 'R02'], text: `**BUG-1: No false-live protection on a silent network stall (checks R01, R02).**
Steps: instructor shares, students A and B join and are live. Stall B's network without closing the socket (here
\`context.setOffline(true)\`; in a classroom, Wi-Fi that drops without a TCP reset). Instructor keeps indicating regions.
Expected: within a few seconds B's pill leaves "live" (for example "stale") because nothing is arriving.
Actual: B's pill stays "live" for the whole outage while B receives none of the events; they arrive late in a burst
after the network returns. Likely files: \`services/live-session/src/client/webSocketSessionClient.ts\` (no heartbeat;
\`onConnectionChange\` fires only on socket open and close) and \`apps/extension/src/student/StudentExperience.tsx\`.
T-28 removed the content-silence timer because it raised false "stale" alarms; a relay-answered ping with a timeout
would detect a dead link without that problem.` },
  { id: 'BUG-2', title: 'a reconnecting student is not caught up with the latest state', checks: ['H04', 'P01'], text: `**BUG-2: A reconnecting student is not caught up with the latest state (checks H04, P01).**
Steps: B is live; B's connection drops (TCP reset); the instructor indicates a region while B is down; the network
returns and the client reconnects with its stored capability; the instructor sends nothing else.
Expected: the relay posts the session's \`latestState\` on resume and B shows the instructor's current region.
Actual: B's pill returns to "live" but B keeps showing the pre-outage view until the instructor's next event. The
protocol-level probe (P01) shows the same thing with no browser: a join gets its catch-up event, a resume gets none.
Likely cause: \`Relay.resume()\` (\`services/live-session/src/relay.ts\`) posts the catch-up from the \`$connect\` route
(\`services/live-session/src/handler.ts\`), where, as that file's own comment says, posting to the connection is not yet
possible. \`post()\` returns false and the result is ignored. The pill reading "live" over a stale view makes this a
false-live state too.` },
  { id: 'BUG-3', title: 'the client stops reconnecting after five failed attempts', checks: ['E01'], text: `**BUG-3: The client stops reconnecting after five failed attempts (check E01).**
Steps: B is live; B's network is down for 15 s; the network returns.
Expected: B reconnects on its own soon after the network returns.
Actual: B stays "stale" indefinitely. \`scheduleReconnect()\` in \`webSocketSessionClient.ts\` gives up once
\`attempt >= backoffMs.length\` (250, 500, 1000, 2000, 5000 ms: roughly 9-11 s of trying) and nothing restarts it: no
\`online\` listener, no periodic retry. Pressing Join again recovers (E02). The pill honestly says "stale", so this
is a recovery bug, not a false-live one.` },
  { id: 'BUG-4', title: 'the deployed relay refused capture.stopped', history: 'it reproduced in every run on 2026-09-16 until the relay was redeployed at about 16:35 UTC', checks: ['P02', 'L06', 'L08'], text: `**BUG-4: The deployed relay refuses \`capture.stopped\`, so students stay "live" after the instructor stops (checks P02, L06, L08).**
Steps: instructor shares, students are live; the instructor clicks Stop, or ends the share from Chrome's "Stop sharing" bar.
Expected: both students show "stopped" ("Instructor stopped sharing. Showing the last reviewed moment.").
Actual: the instructor panel says "Stopped sharing", but the relay answers the \`capture.stopped\` event with
\`rejected: event-type-not-allowlisted\` and never forwards it, so both students keep a "live" pill indefinitely: a
false-live state. Cause: deployment drift, not the source. \`capture.stopped\` was added to \`ALLOWED_EVENT_TYPES\` in
\`services/live-session/src/rules.ts\` (and to \`VIEW_BEARING\` in \`relay.ts\`) by commit 94cd2a3 on 2026-09-16, after the
relay was deployed on 2026-09-15. Fix: rebuild and redeploy the relay (\`services/live-session\` \`npm run build\`, then
\`infra\` \`cdk deploy\`), then rerun this bench. P02 checks the whole allowlist directly.` },
  { id: 'BUG-5', title: 'End Session can be lost', checks: ['L09', 'P03'], text: `**BUG-5: End Session can be lost, so students never see "ended" (checks L09, P03).**
Steps: instructor shares, students are live; the instructor clicks End Session.
Expected: both students show "ended" ("The instructor ended this session.").
Actual: intermittently, neither student receives \`session.ended\` and both keep their previous pill ("stopped" after
Stop, or "live" if the instructor ends while sharing) indefinitely; a late join to the same code is refused (L10), so
the session really is closed. P03 repeats the wire sequence without a browser and counts
how often \`session.ended\` arrives. Cause: \`CaptureController.endSession()\`
(\`apps/extension/src/instructor/captureController.ts\`) emits \`session.ended\` and immediately calls \`client.close()\`;
\`WebSocketSessionClient.close()\` (\`services/live-session/src/client/webSocketSessionClient.ts\`) sends
\`{kind: 'close'}\` in the same tick and closes the socket. API Gateway invokes the Lambda for each message
independently, so \`Relay.close()\` can mark the session closed before \`Relay.publish()\` checks it, and the event is
refused as \`session-not-open\` with nobody left to hear the refusal. Options: have the relay's close broadcast
\`session.ended\` itself, or have the client wait for \`accepted\` before sending \`close\`.` },
];

const LIMITS = `### Not automated here

- The real Chrome tab/window/screen chooser, real permission prompts, and real OS window or screen pixels (HiDPI
  scaling, video overlays, notifications over the slide). The fake capture draws the real PNGs into a canvas.
- Two physical devices on a real classroom network; all contexts here share one machine and one clock, and the
  network drops are simulated (Chromium offline emulation for the stall, a local proxy reset for the hard drop).
- The side panel itself (opened from the toolbar action) and focus switching between the shared tab and the panel.
- Audio and AR renderers; latency is measured in Read mode only.
- Instructor-side network loss (only student B's network is dropped).`;

main().catch(error => { console.error(error); process.exit(2); });
