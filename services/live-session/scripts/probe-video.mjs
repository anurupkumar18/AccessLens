#!/usr/bin/env node
/**
 * Runtime truth for the video stage, against the deployed relay.
 *
 * Opens two WebSockets, creates a session on one and joins it on the other,
 * prints both replies with the tokens shortened, then reads the session row
 * to find the stage ARN and checks it with `aws ivs-realtime get-stage`.
 * Finally closes the session and checks the stage is gone.
 *
 *   node scripts/probe-video.mjs wss://.../demo <sessionsTable>
 */
import { execFileSync } from 'node:child_process';

const [url, sessionsTable] = process.argv.slice(2);
if (!url || !sessionsTable) {
  console.error('usage: node scripts/probe-video.mjs wss://<api>/<stage> <sessionsTable>');
  process.exit(2);
}
const sessionId = `probe-${Date.now().toString(36)}`;
const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' }));

function open(name) {
  const socket = new WebSocket(url);
  const received = [];
  socket.addEventListener('message', m => received.push(JSON.parse(String(m.data))));
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ name, socket, received }));
    socket.addEventListener('error', e => reject(new Error(`${name}: ${e.message ?? 'socket error'}`)));
  });
}
const send = (c, payload) => c.socket.send(JSON.stringify(payload));
const waitFor = (c, predicate, ms = 8000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const hit = c.received.find(predicate);
    if (hit) return resolve(hit);
    if (Date.now() - started > ms) return reject(new Error(`${c.name}: timed out waiting`));
    setTimeout(tick, 50);
  };
  tick();
});
const short = value => (typeof value === 'string' && value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)} (${value.length} chars)` : value);
const show = (label, reply) => console.log(label, JSON.stringify(reply, (k, v) => (k === 'token' || k === 'streamToken' ? short(v) : v), 2));

const instructor = await open('instructor');
const student = await open('student');
send(instructor, { kind: 'create', sessionId });
const created = await waitFor(instructor, r => r.kind === 'capability' || r.kind === 'error');
show('create →', created);
send(student, { kind: 'join', sessionId, role: 'student' });
const joined = await waitFor(student, r => r.kind === 'capability' || r.kind === 'error');
show('join →', joined);

const row = aws('dynamodb', 'get-item', '--table-name', sessionsTable, '--key', JSON.stringify({ sessionId: { S: sessionId } }));
const stageArn = row.Item?.stageArn?.S;
console.log('session row stageArn:', stageArn);
const stage = aws('ivs-realtime', 'get-stage', '--arn', stageArn);
console.log('get-stage →', stage.stage.name, stage.stage.arn === stageArn ? '(ARN matches)' : '(ARN MISMATCH)');

const decode = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const pub = decode(created.capability.streamToken);
const sub = decode(joined.capability.streamToken);
console.log('instructor token capabilities:', pub.capabilities, 'user_id:', pub.user_id ?? '(none)');
console.log('student token capabilities:   ', sub.capabilities, 'user_id:', sub.user_id ?? '(none)');
console.log('tokens differ:', created.capability.streamToken !== joined.capability.streamToken);

send(instructor, { kind: 'close', sessionId });
await waitFor(instructor, r => r.kind === 'closed');
try {
  aws('ivs-realtime', 'get-stage', '--arn', stageArn);
  console.log('after close: stage STILL EXISTS');
} catch (error) {
  console.log('after close: get-stage →', /ResourceNotFound/.test(String(error.stderr ?? error)) ? 'ResourceNotFoundException (stage deleted)' : String(error).slice(0, 200));
}
instructor.socket.close();
student.socket.close();
