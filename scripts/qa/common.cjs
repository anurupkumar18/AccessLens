'use strict';
/**
 * Shared plumbing for the AccessLens QA bench (scripts/qa/live-bench.cjs and
 * scripts/qa/extension-load.cjs). Nothing here touches app source: it builds
 * the app into a gitignored scratch directory, serves that build, drives it
 * with Playwright, and writes docs/qa/live-bench-results.{md,json}.
 *
 * Playwright is deliberately not a repo dependency. It is resolved from
 * PLAYWRIGHT_PATH, then a normal require, then the npx cache path this bench
 * was written against.
 */
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const DEFAULT_RELAY = 'wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo';
const BUILD_DIR = path.join(REPO, '.cache/qa/build');
const RESULTS_MD = path.join(REPO, 'docs/qa/live-bench-results.md');
const RESULTS_JSON = path.join(REPO, 'docs/qa/live-bench-results.json');
const PACK_DIR = path.join(REPO, 'packages/access-packs/bio-cell-demo');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    '/Users/omarrizwan/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* next */ }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_PATH to a playwright package directory (e.g. from `npx playwright --version`).');
}

function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    const name = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (typeof defaults[name] === 'boolean') out[name] = inline === undefined ? true : inline !== 'false';
    else if (inline !== undefined) out[name] = typeof defaults[name] === 'number' ? Number(inline) : inline;
    else { out[name] = typeof defaults[name] === 'number' ? Number(argv[++i]) : argv[++i]; }
  }
  return out;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function git(args) {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

function gitInfo() {
  return {
    head: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    appSourceSha: git(['log', '-1', '--format=%H', '--', 'apps', 'services', 'packages', 'packs', 'index.html', 'vite.config.ts', 'package.json']),
    appSourceDirty: git(['status', '--porcelain', '--', 'apps', 'services', 'packages', 'packs']) !== '',
  };
}

function viteBin() {
  return path.join(REPO, 'node_modules/vite/bin/vite.js');
}

/** Builds the extension with the relay URL baked in, into BUILD_DIR (gitignored). */
function build(relayUrl, outDir = BUILD_DIR) {
  if (!fs.existsSync(viteBin())) {
    throw new Error(`vite not found at ${viteBin()}. Run npm install (or symlink the main checkout's node_modules) first.`);
  }
  const started = Date.now();
  execFileSync(process.execPath, [viteBin(), 'build', '--config', path.join(__dirname, 'vite.qa.config.mjs'), '--outDir', outDir, '--logLevel', 'warn'], {
    cwd: REPO,
    env: { ...process.env, VITE_ACCESSLENS_WS_URL: relayUrl },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const assets = fs.readdirSync(path.join(outDir, 'assets'));
  const mainJs = assets.find(f => /^index-.*\.js$/.test(f));
  const baked = mainJs ? fs.readFileSync(path.join(outDir, 'assets', mainJs), 'utf8').includes(relayUrl) : false;
  if (!baked) throw new Error(`Build at ${outDir} does not contain the relay URL ${relayUrl}; VITE_ACCESSLENS_WS_URL was not applied.`);
  return { outDir: path.relative(REPO, outDir), ms: Date.now() - started, relayUrlBaked: baked };
}

function portFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/** Serves BUILD_DIR with `vite preview`. Returns { url, stop }. */
async function serve(outDir, port) {
  if (!(await portFree(port))) throw new Error(`Port ${port} is in use. Stop whatever is listening there or pass --port <free port>.`);
  const child = spawn(process.execPath, [viteBin(), 'preview', '--config', path.join(__dirname, 'vite.qa.config.mjs'), '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite preview exited early:\n${output}`);
    const ok = await new Promise(resolve => {
      http.get(url, res => { res.resume(); resolve(res.statusCode === 200); }).on('error', () => resolve(false));
    });
    if (ok) return { url, stop: () => { if (child.exitCode === null) child.kill('SIGTERM'); } };
    await sleep(250);
  }
  child.kill('SIGTERM');
  throw new Error(`vite preview did not answer on ${url}:\n${output}`);
}

/**
 * A local HTTP CONNECT proxy one browser context routes through. `setDown(true)`
 * destroys every open tunnel (the browser sees its TCP connection reset, exactly
 * like a dropped network) and refuses new tunnels until `setDown(false)`.
 */
function startProxy() {
  const tunnels = new Set();
  const log = [];
  let down = false;
  const server = http.createServer((req, res) => { res.writeHead(501); res.end(); });
  server.on('connect', (req, client, head) => {
    log.push({ t: Date.now(), target: req.url, refused: down });
    if (down) { client.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port) || 443, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const pair = { client, upstream };
    tunnels.add(pair);
    const done = () => { tunnels.delete(pair); client.destroy(); upstream.destroy(); };
    upstream.on('error', done); client.on('error', done); upstream.on('close', done); client.on('close', done);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server: `http://127.0.0.1:${server.address().port}`,
    log,
    get down() { return down; },
    setDown(value) {
      down = value;
      if (value) for (const pair of [...tunnels]) { pair.client.destroy(); pair.upstream.destroy(); }
    },
    close() { for (const pair of [...tunnels]) { pair.client.destroy(); pair.upstream.destroy(); } server.close(); },
  })));
}

/** Percentiles by nearest rank. */
function stats(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, p50: null, p95: null, max: null, min: null, mean: null };
  const rank = p => v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
  return { n: v.length, min: v[0], p50: rank(50), p95: rank(95), max: v[v.length - 1], mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length) };
}

function environment(extra = {}) {
  let playwrightVersion = 'unknown';
  try { playwrightVersion = require(path.join(path.dirname(require.resolve(process.env.PLAYWRIGHT_PATH || '/Users/omarrizwan/.npm/_npx/e41f203b7505f1fb/node_modules/playwright')), 'package.json')).version; } catch { /* ignore */ }
  return {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpus: `${os.cpus().length} x ${os.cpus()[0]?.model ?? 'unknown'}`,
    node: process.version,
    playwright: playwrightVersion,
    ...extra,
  };
}

const MARK = key => [`<!-- qa:${key}:start -->`, `<!-- qa:${key}:end -->`];

const MD_HEADER = `# AccessLens automated quality bench results

Generated by \`scripts/qa/live-bench.cjs\` (AL-004 automated half, automatable parts of AL-001)
and \`scripts/qa/extension-load.cjs\`. Each script rewrites only its own section below and its
own key in \`live-bench-results.json\`. Do not hand-edit between the markers; rerun instead.

## Rerun

\`\`\`sh
export PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH   # any Node >= 22 works
npm install                                         # or symlink an existing node_modules
node scripts/qa/live-bench.cjs                      # ~3-4 min, deployed relay, headless Chromium
node scripts/qa/extension-load.cjs                  # ~30 s, loads the unpacked MV3 build
\`\`\`

Both scripts build the app with \`VITE_ACCESSLENS_WS_URL\` into \`.cache/qa/\` (gitignored, never
\`dist/\`). Both take \`--relay wss://...\`, \`--skip-build\`, \`--headed\` and \`--no-write\`; the live bench
also takes \`--events 30\`, \`--interval-ms 750\` and \`--port 5180\`. Playwright is not a repo dependency;
set \`PLAYWRIGHT_PATH\` if it is not resolvable. Exit code 0 means no FAIL rows.

`;

/** Replaces one section of the results markdown and one key of the results JSON. */
function writeResults(key, json, markdown) {
  fs.mkdirSync(path.dirname(RESULTS_MD), { recursive: true });
  let all = {};
  try { all = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8')); } catch { /* fresh */ }
  all[key] = json;
  fs.writeFileSync(RESULTS_JSON, `${JSON.stringify(all, null, 2)}\n`);

  let md;
  try { md = fs.readFileSync(RESULTS_MD, 'utf8'); } catch { md = MD_HEADER; }
  if (!md.startsWith('# AccessLens automated quality bench results')) md = MD_HEADER;
  // Keep the header current even when the file exists.
  const firstMarker = md.indexOf('<!-- qa:');
  md = MD_HEADER + (firstMarker >= 0 ? md.slice(firstMarker) : '');
  const [start, end] = MARK(key);
  const block = `${start}\n${markdown.trim()}\n${end}`;
  const s = md.indexOf(start);
  const e = md.indexOf(end);
  if (s >= 0 && e > s) md = md.slice(0, s) + block + md.slice(e + end.length);
  else md = `${md.trimEnd()}\n\n${block}\n`;
  // Stable section order: live bench first.
  const order = ['live-bench', 'extension-load'];
  const blocks = order.map(k => { const [a, b] = MARK(k); const i = md.indexOf(a); const j = md.indexOf(b); return i >= 0 && j > i ? md.slice(i, j + b.length) : null; }).filter(Boolean);
  md = `${MD_HEADER}${blocks.join('\n\n')}\n`;
  fs.writeFileSync(RESULTS_MD, md);
}

/** Strips query strings from URLs in free text: reconnect URLs carry the relay capability token. */
function redact(text) {
  return String(text ?? '').replace(/(wss?|https?):\/\/([^\s'"?]+)\?[^\s'"]*/g, '$1://$2?<query redacted>');
}

function mdEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function checksTable(checks) {
  const rows = checks.map(c => `| ${c.id} | ${mdEscape(c.name)} | **${c.result}** | ${mdEscape(c.detail)} |`);
  return ['| ID | Check | Result | Observed |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function slidesAsDataUrls() {
  const images = {};
  for (let i = 1; i <= 5; i++) {
    images[`cell-slide-0${i}`] = `data:image/png;base64,${fs.readFileSync(path.join(PACK_DIR, `slides/cell-slide-0${i}.png`)).toString('base64')}`;
  }
  images['unapproved-photosynthesis'] = `data:image/png;base64,${fs.readFileSync(path.join(PACK_DIR, 'demo-assets/unapproved-photosynthesis.png')).toString('base64')}`;
  return images;
}

function loadPack() {
  return JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'pack.json'), 'utf8'));
}

module.exports = {
  REPO, DEFAULT_RELAY, BUILD_DIR, RESULTS_MD, RESULTS_JSON, PACK_DIR,
  loadPlaywright, parseArgs, sleep, gitInfo, build, serve, startProxy, stats, environment,
  writeResults, checksTable, mdEscape, redact, slidesAsDataUrls, loadPack,
};
