import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessPackSchema } from '../../shared/contracts';
import { fingerprintFrame, matchFingerprint, DEFAULT_MATCH_OPTIONS } from './index';
import { loadSlideFrame, loadDemoFrame, solidFrame, testPack, SLIDE_ASSET_IDS, FIXTURE_ROOT } from './fixtures';

const FORMAT = /^dhash-v1:[0-9a-f]{16}$/;
const pack = AccessPackSchema.parse(testPack);
const assetById = (id: string) => pack.assets.find(a => a.assetId === id)!;

describe('fingerprint contract (A4)', () => {
  it('produces the dhash-v1 format: prefix plus sixteen lowercase hex characters', () => {
    expect(fingerprintFrame(loadSlideFrame('slide-01'))).toMatch(FORMAT);
    expect(fingerprintFrame(loadDemoFrame('slide-01'))).toMatch(FORMAT);
    expect(fingerprintFrame(solidFrame(64, 64, 0))).toMatch(FORMAT);
  });

  it.each(SLIDE_ASSET_IDS)('%s: fingerprint equals its pack entry and is deterministic', assetId => {
    const first = fingerprintFrame(loadSlideFrame(assetId));
    const second = fingerprintFrame(loadSlideFrame(assetId));
    expect(first).toBe(assetById(assetId).fingerprint);
    expect(second).toBe(first);
  });

  it('every pack fingerprint has the documented format', () => {
    for (const asset of pack.assets) expect(asset.fingerprint).toMatch(FORMAT);
  });
});

describe('matcher (A4): threshold and ambiguity margin', () => {
  it.each(SLIDE_ASSET_IDS)('demo-condition variant of %s matches its own asset', assetId => {
    const decision = matchFingerprint(fingerprintFrame(loadDemoFrame(assetId)), pack);
    expect(decision).toMatchObject({ kind: 'matched', assetId });
  });

  it('an unapproved slide is unmatched, never a best guess', () => {
    const decision = matchFingerprint(fingerprintFrame(loadSlideFrame('unknown-01')), pack);
    expect(decision.kind).toBe('unmatched');
  });

  it('a twin slide is unmatched because two assets sit inside the ambiguity margin', () => {
    expect(matchFingerprint(fingerprintFrame(loadSlideFrame('twin-a')), pack).kind).toBe('unmatched');
    expect(matchFingerprint(fingerprintFrame(loadSlideFrame('twin-b')), pack).kind).toBe('unmatched');
  });

  it('solid black and solid white frames are both unmatched', () => {
    expect(matchFingerprint(fingerprintFrame(solidFrame(1280, 720, 0)), pack).kind).toBe('unmatched');
    expect(matchFingerprint(fingerprintFrame(solidFrame(1280, 720, 255)), pack).kind).toBe('unmatched');
  });

  it('a clean approved slide matches itself with distance zero', () => {
    const decision = matchFingerprint(fingerprintFrame(loadSlideFrame('slide-03')), pack);
    expect(decision).toEqual({ kind: 'matched', assetId: 'slide-03', distance: 0 });
  });

  it('exposes the tuned threshold and margin so the README and the code cannot drift', () => {
    expect(DEFAULT_MATCH_OPTIONS).toEqual({ threshold: 10, margin: 4 });
  });
});

describe('fingerprint-pack CLI (Part 5 deliverable)', () => {
  it('run on the clean slides, reproduces the checked-in pack byte for byte', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'accesslens-pack-')), 'test-pack.json');
    const packPath = join(FIXTURE_ROOT, 'test-pack.json');
    execFileSync(process.execPath, [
      'node_modules/tsx/dist/cli.mjs', 'scripts/fingerprint-pack.ts', packPath, join(FIXTURE_ROOT, 'slides'), '--out', out,
    ], { cwd: process.cwd(), stdio: 'pipe' });
    expect(readFileSync(out)).toEqual(readFileSync(packPath));
  }, 60_000);
});
