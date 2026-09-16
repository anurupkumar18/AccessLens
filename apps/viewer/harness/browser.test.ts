import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsdomBrowserDriver } from './browser';

const fixtureRoot = join(process.cwd(), 'apps/viewer/fixtures/artifacts');
const hnswDir = join(fixtureRoot, 'hnsw-search-stepper', '1');
const failingDir = join(fixtureRoot, 'failing-init', '1');

describe('jsdom harness browser driver', () => {
  let screenshotDir: string;

  afterEach(() => {
    // The driver writes deterministic snapshots into this temporary directory;
    // no generated output is left in the repository.
  });

  it('initializes a passing artifact and writes a screenshot substitute', async () => {
    screenshotDir = mkdtempSync(join(tmpdir(), 'accesslens-harness-'));
    const result = await new JsdomBrowserDriver().run({
      artifactDir: hnswDir,
      screenshotPath: join(screenshotDir, 'hnsw.svg'),
    });
    expect(result.ok).toBe(true);
    expect(result.artifactId).toBe('hnsw-search-stepper');
    expect(result.artifactVersion).toBe(1);
    expect(result.initialized).toBe(true);
    expect(result.consoleErrors).toEqual([]);
    expect(result.screenshotPath).toBeDefined();
    expect(existsSync(result.screenshotPath!)).toBe(true);
    expect(readFileSync(result.screenshotPath!, 'utf8')).toContain('AccessLens jsdom render snapshot');
  });

  it('fails an artifact that throws during accesslensInit and preserves the error', async () => {
    screenshotDir = mkdtempSync(join(tmpdir(), 'accesslens-harness-'));
    const result = await new JsdomBrowserDriver().run({
      artifactDir: failingDir,
      screenshotPath: join(screenshotDir, 'failing.svg'),
    });
    expect(result.ok).toBe(false);
    expect(result.initialized).toBe(false);
    expect(result.consoleErrors.some((error) => error.includes('fixture init failure'))).toBe(true);
  });
});
