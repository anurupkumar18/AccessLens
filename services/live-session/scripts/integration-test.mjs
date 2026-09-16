#!/usr/bin/env node
/**
 * Part 4's first "Done when", against real AWS:
 * "one instructor client drives two student clients over the deployed endpoint".
 *
 * The unit suite proves the relay's decisions with an in-memory store. This
 * proves the wiring -- API Gateway routes, Lambda permissions, the DynamoDB GSI,
 * and `PostToConnection` -- which is the half that unit tests structurally
 * cannot reach, and the half that fails with a plausible-looking green suite.
 *
 * Usage:
 *   AWS_PROFILE=... node scripts/integration-test.mjs wss://.../demo
 *
 * It creates a uniquely-named session, runs the reviewed happy-path fixture
 * through it, asserts both students saw every event in order, then checks the
 * refusals that matter: a student publishing, a stale sequence, and a raw-frame
 * payload. Exit code 0 means all of it held.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = resolve(here, '../../../packages/access-packs/bio-cell-demo');

const url = process.argv[2] ?? process.env.ACCESSLENS_WS_URL;
if (!url) {
  console.error('usage: node scripts/integration-test.mjs wss://<api>/<stage>');
  process.exit(2);
}

const happy = JSON.parse(readFileSync(join(packDir, 'fixtures/happy-path.json'), 'utf8'));
const rawFrame = JSON.parse(
  readFileSync(join(packDir, 'fixtures/invalid/raw-frame-payload.json'), 'utf8'),
);

// A fresh id per run: the relay refuses a replayed sequence, so reusing one
// would make the second run fail for a reason that has nothing to do with the
// code under test.
const sessionId = `sess-it-${Date.now().toString(36)}`;
const events = happy.events.map(event => ({ ...event, sessionId }));

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

/** A WebSocket client that records what it receives. */
class Client {
  constructor(name) {
    this.name = name;
    this.received = [];
    this.replies = [];
  }

  async connect(target = url) {
    this.socket = new WebSocket(target);
    this.socket.addEventListener('message', event => {
      const payload = JSON.parse(event.data);
      if (payload.kind === 'event') this.received.push(payload.event);
      else this.replies.push(payload);
    });
    await new Promise((res, rej) => {
      this.socket.addEventListener('open', res, { once: true });
      // `error` also fires on a normal close, so it must not reject once the
      // socket is already open -- that turned a working connection into a
      // "connect failed" the first time this ran.
      this.socket.addEventListener('error', event => {
        if (this.socket.readyState === WebSocket.OPEN) return;
        const detail = event?.message ?? event?.error?.message ?? 'no detail';
        rej(new Error(`${this.name}: connect failed (${detail})`));
      });
    });
    return this;
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  /** Wait for the next non-event reply, or time out. */
  async reply(timeoutMs = 8000) {
    const started = Date.now();
    while (this.replies.length === 0) {
      if (Date.now() - started > timeoutMs) throw new Error(`${this.name}: no reply in time`);
      await sleep(50);
    }
    return this.replies.shift();
  }

  close() {
    this.socket?.close();
  }
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function main() {
  console.log(`endpoint ${url}`);
  console.log(`session  ${sessionId}\n`);

  const instructor = await new Client('instructor').connect();
  instructor.send({ kind: 'create', sessionId });
  const created = await instructor.reply();
  check('instructor receives an instructor capability', created.kind === 'capability' &&
    created.capability?.role === 'instructor', JSON.stringify(created));

  const studentA = await new Client('student-a').connect();
  const studentB = await new Client('student-b').connect();
  for (const student of [studentA, studentB]) {
    student.send({ kind: 'join', sessionId, role: 'student' });
    const joined = await student.reply();
    check(`${student.name} receives a student capability`, joined.kind === 'capability' &&
      joined.capability?.role === 'student', JSON.stringify(joined));
  }

  console.log('\n  relaying the reviewed happy path…');
  for (const event of events) {
    instructor.send({ kind: 'event', event });
    const accepted = await instructor.reply();
    if (accepted.kind !== 'accepted') {
      check(`event ${event.sequence} (${event.type}) accepted`, false, JSON.stringify(accepted));
    }
  }
  await sleep(1500); // let the last broadcast land

  const expected = events.map(e => e.sequence);
  for (const student of [studentA, studentB]) {
    check(
      `${student.name} received all ${expected.length} events in order`,
      JSON.stringify(student.received.map(e => e.sequence)) === JSON.stringify(expected),
      `got ${JSON.stringify(student.received.map(e => e.sequence))}`,
    );
  }
  check('instructor was not echoed its own events', instructor.received.length === 0,
    `got ${instructor.received.length}`);

  // The session ended with the happy path's `session.ended`, so refusals are
  // checked on a second, still-open session.
  console.log('\n  refusals…');
  const second = `${sessionId}-b`;
  const instructor2 = await new Client('instructor-2').connect();
  instructor2.send({ kind: 'create', sessionId: second });
  await instructor2.reply();
  const student2 = await new Client('student-2').connect();
  student2.send({ kind: 'join', sessionId: second, role: 'student' });
  await student2.reply();

  const first = { ...events[0], sessionId: second };
  instructor2.send({ kind: 'event', event: first });
  await instructor2.reply();

  student2.send({ kind: 'event', event: { ...events[1], sessionId: second } });
  const studentPublish = await student2.reply();
  check('a student cannot publish instructor events',
    studentPublish.kind === 'rejected' &&
      studentPublish.rules?.includes('role-not-permitted-to-publish'),
    JSON.stringify(studentPublish));

  instructor2.send({ kind: 'event', event: first });
  const stale = await instructor2.reply();
  check('a replayed sequence is refused',
    stale.kind === 'rejected' && stale.rules?.includes('sequence-not-monotonic'),
    JSON.stringify(stale));

  instructor2.send({
    kind: 'event',
    event: { ...rawFrame.event, sessionId: second, sequence: 900 },
  });
  const raw = await instructor2.reply();
  check('a raw-frame payload is refused',
    raw.kind === 'rejected' && raw.rules?.includes('field-not-on-contract:frameData'),
    JSON.stringify(raw));

  instructor2.send({ kind: 'close', sessionId: second });
  const closed = await instructor2.reply();
  check('the instructor can close the session', closed.kind === 'closed', JSON.stringify(closed));

  instructor2.send({ kind: 'event', event: { ...events[1], sessionId: second } });
  const afterClose = await instructor2.reply();
  check('a closed session refuses further events',
    afterClose.kind === 'rejected' && afterClose.rules?.includes('session-not-open'),
    JSON.stringify(afterClose));

  for (const client of [instructor, studentA, studentB, instructor2, student2]) client.close();

  console.log(
    failures.length === 0
      ? '\nall integration checks passed'
      : `\n${failures.length} check(s) failed: ${failures.join(', ')}`,
  );
  return failures.length === 0 ? 0 : 1;
}

main().then(
  code => process.exit(code),
  error => {
    console.error(`\nintegration test errored: ${error.message}`);
    process.exit(1);
  },
);
