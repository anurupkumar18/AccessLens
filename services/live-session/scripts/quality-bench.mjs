#!/usr/bin/env node
/**
 * AL-004's repeatable relay-side quality bench.
 *
 * This creates an instructor session plus two anonymous student connections,
 * sends 30 valid region events, and reports delivery count, same-process
 * event-to-receipt latency, and inter-student skew. It also verifies that a
 * rejoining student receives the latest semantic state. It never sends raw
 * media, lesson prose, identity, or preference data.
 *
 * Usage:
 *   node scripts/quality-bench.mjs wss://<api>/<stage>
 *
 * This is relay wiring evidence, not a replacement for AL-001's real-browser
 * and real-device evidence. Run it only against the release endpoint named in
 * the final evidence record.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(readFileSync(join(resolve(here, '../../../packages/access-packs/bio-cell-demo'), 'pack.json'), 'utf8'));
const url = process.argv[2] ?? process.env.ACCESSLENS_WS_URL;

if (!url) {
  console.error('usage: node scripts/quality-bench.mjs wss://<api>/<stage>');
  process.exit(2);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionId = `sess-bench-${Date.now().toString(36)}`;
const failures = [];
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

class Client {
  constructor(name) {
    this.name = name;
    this.events = [];
    this.replies = [];
  }

  async connect() {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', message => {
      const payload = JSON.parse(message.data);
      if (payload.kind === 'event') this.events.push({ event: payload.event, receivedAt: performance.now() });
      else this.replies.push(payload);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error(`${this.name}: connection failed`)), { once: true });
    });
    return this;
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  async reply(timeoutMs = 8_000) {
    const started = performance.now();
    while (!this.replies.length) {
      if (performance.now() - started > timeoutMs) throw new Error(`${this.name}: no relay reply`);
      await sleep(10);
    }
    return this.replies.shift();
  }

  async event(sequence, timeoutMs = 8_000) {
    const started = performance.now();
    while (true) {
      const found = this.events.find(item => item.event.sequence === sequence);
      if (found) return found;
      if (performance.now() - started > timeoutMs) throw new Error(`${this.name}: no event ${sequence}`);
      await sleep(10);
    }
  }

  close() {
    this.socket?.close();
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function reviewedTargets() {
  return pack.assets.flatMap(asset => asset.regions.map(region => {
    const hotspot = asset.arScene?.hotspots.find(item => item.regionId === region.regionId);
    return {
      assetId: asset.assetId,
      regionId: region.regionId,
      pointer: {
        x: region.bounds.x + region.bounds.width / 2,
        y: region.bounds.y + region.bounds.height / 2,
      },
      ...(hotspot ? { arState: { hotspotId: hotspot.hotspotId, action: 'focus' } } : {}),
    };
  }));
}

function event(type, sequence, extra = {}) {
  return {
    schemaVersion: '1.0',
    type,
    sessionId,
    packId: pack.packId,
    packVersion: pack.version,
    sequence,
    sentAt: new Date().toISOString(),
    ...extra,
  };
}

async function main() {
  console.log(`endpoint ${url}`);
  console.log(`session  ${sessionId}`);

  const instructor = await new Client('instructor').connect();
  const studentA = await new Client('student-a').connect();
  const studentB = await new Client('student-b').connect();
  const clients = [instructor, studentA, studentB];

  try {
    instructor.send({ kind: 'create', sessionId });
    check('instructor capability', (await instructor.reply()).kind === 'capability');
    for (const student of [studentA, studentB]) {
      student.send({ kind: 'join', sessionId, role: 'student' });
      check(`${student.name} capability`, (await student.reply()).kind === 'capability');
    }

    instructor.send({ kind: 'event', event: event('session.started', 1) });
    check('session starts', (await instructor.reply()).kind === 'accepted');

    const targets = reviewedTargets();
    const sentAt = new Map();
    for (let offset = 0; offset < 30; offset += 1) {
      const sequence = offset + 2;
      const region = event('region.changed', sequence, targets[offset % targets.length]);
      sentAt.set(sequence, performance.now());
      instructor.send({ kind: 'event', event: region });
      check(`event ${offset + 1} accepted`, (await instructor.reply()).kind === 'accepted');
    }

    const sequences = Array.from({ length: 30 }, (_, index) => index + 2);
    const samples = [];
    for (const sequence of sequences) {
      const [a, b] = await Promise.all([studentA.event(sequence), studentB.event(sequence)]);
      samples.push({
        a: a.receivedAt - sentAt.get(sequence),
        b: b.receivedAt - sentAt.get(sequence),
        skew: Math.abs(a.receivedAt - b.receivedAt),
      });
    }
    check('student A receives 30/30 ordered events', JSON.stringify(studentA.events.filter(item => item.event.sequence >= 2).map(item => item.event.sequence)) === JSON.stringify(sequences));
    check('student B receives 30/30 ordered events', JSON.stringify(studentB.events.filter(item => item.event.sequence >= 2).map(item => item.event.sequence)) === JSON.stringify(sequences));

    console.log('\n  measured over 30 region events (same-process relay bench):');
    console.log(`  student latency p50/p95: ${percentile(samples.flatMap(sample => [sample.a, sample.b]), 0.5).toFixed(1)} / ${percentile(samples.flatMap(sample => [sample.a, sample.b]), 0.95).toFixed(1)} ms`);
    console.log(`  inter-student skew p50/p95: ${percentile(samples.map(sample => sample.skew), 0.5).toFixed(1)} / ${percentile(samples.map(sample => sample.skew), 0.95).toFixed(1)} ms`);

    const stopped = event('capture.stopped', 32);
    instructor.send({ kind: 'event', event: stopped });
    const stoppedReply = await instructor.reply();
    const stoppedAccepted = stoppedReply.kind === 'accepted';
    check('capture.stopped is accepted without closing the session', stoppedAccepted, JSON.stringify(stoppedReply));

    studentB.close();
    await sleep(100);
    const rejoiningStudent = await new Client('student-b-reconnected').connect();
    clients.push(rejoiningStudent);
    rejoiningStudent.send({ kind: 'join', sessionId, role: 'student' });
    check('rejoining student capability', (await rejoiningStudent.reply()).kind === 'capability');
    if (stoppedAccepted) {
      const latest = await rejoiningStudent.event(32);
      check('rejoining student receives the stopped lifecycle state', latest.event.type === 'capture.stopped');
    } else {
      check('rejoining student receives the stopped lifecycle state', false, 'not attempted because relay rejected capture.stopped');
    }

    instructor.send({ kind: 'close', sessionId });
    check('instructor closes the temporary bench session', (await instructor.reply()).kind === 'closed');
  } finally {
    clients.forEach(client => client.close());
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nquality bench passed');
  return failures.length ? 1 : 0;
}

main().then(code => process.exit(code), error => {
  console.error(`\nquality bench errored: ${error.message}`);
  process.exit(1);
});
