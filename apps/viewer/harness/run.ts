import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsdomBrowserDriver, type BrowserDriver, type BrowserRunOptions, type BrowserRunResult } from './browser';

export interface HarnessCliOptions extends BrowserRunOptions {
  mode?: string;
}

function usage(): never {
  throw new Error('usage: tsx apps/viewer/harness/run.ts [--artifact-dir <dir>] [--screenshot <path>] [--mode harness]');
}

export function parseArgs(argv: readonly string[]): HarnessCliOptions {
  const root = resolve(process.cwd(), 'apps/viewer/fixtures/artifacts/hnsw-search-stepper/1');
  const options: HarnessCliOptions = {
    artifactDir: root,
    screenshotPath: resolve(process.cwd(), 'artifacts/hnsw-search-stepper-1.svg'),
    mode: 'harness',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact-dir' || argument === '--artifact') {
      const value = argv[++index];
      if (!value) usage();
      options.artifactDir = resolve(value);
    } else if (argument === '--screenshot') {
      const value = argv[++index];
      if (!value) usage();
      options.screenshotPath = resolve(value);
    } else if (argument === '--mode') {
      const value = argv[++index];
      if (!value) usage();
      options.mode = value;
    } else if (argument === '--help' || argument === '-h') {
      usage();
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

/**
 * The browser driver is intentionally one small interface. V1 uses jsdom
 * because this checkout has neither Playwright nor Puppeteer nor a Chrome
 * binary; V8 can replace this factory without changing the harness contract.
 */
export function createBrowserDriver(): BrowserDriver {
  return new JsdomBrowserDriver();
}

export async function runHarness(options: HarnessCliOptions, driver = createBrowserDriver()): Promise<BrowserRunResult> {
  if (options.mode && options.mode !== 'harness') throw new Error(`unsupported harness mode: ${options.mode}`);
  if (!existsSync(resolve(options.artifactDir, 'manifest.json'))) {
    throw new Error(`artifact manifest not found: ${resolve(options.artifactDir, 'manifest.json')}`);
  }
  return driver.run(options);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const result = await runHarness(parseArgs(argv));
    // stdout is machine-readable by design; diagnostics belong in the JSON
    // result so the critic can persist them with the screenshot.
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message, consoleErrors: [message] })}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
