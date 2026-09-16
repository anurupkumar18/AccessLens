import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ArtifactManifestSchema, type ArtifactManifest } from '../../extension/src/shared/contracts';

export interface BrowserRunOptions {
  artifactDir: string;
  /** Optional because a critic may only need the pass/fail verdict. */
  screenshotPath?: string;
  waitFrames?: number;
}

/** Stable result seam consumed by the Critic and catalog tooling. */
export interface BrowserRunResult {
  ok: boolean;
  consoleErrors: string[];
  unhandledRejections: string[];
  screenshotPath?: string;
  // These fields make a local harness result self-describing without changing
  // the small required seam above.
  artifactId: string;
  artifactVersion: number;
  durationMs: number;
  initialized: boolean;
}

export interface BrowserDriver {
  run(options: BrowserRunOptions): Promise<BrowserRunResult>;
}

function describeError(error: unknown): string {
  // Errors thrown by scripts in a jsdom VM come from another realm, so
  // `instanceof Error` is false in the Node realm running this driver.
  if (error && typeof error === 'object') {
    const candidate = error as { stack?: unknown; message?: unknown };
    if (typeof candidate.stack === 'string' && candidate.stack) return candidate.stack;
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
  }
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized === undefined ? String(error) : serialized;
  } catch {
    return String(error);
  }
}

function nextFrame(window: Window): Promise<void> {
  return new Promise((resolveFrame) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolveFrame());
      return;
    }
    // jsdom versions without pretend-to-be-visual still get a deterministic
    // frame boundary rather than an unbounded wait.
    window.setTimeout(resolveFrame, 0);
  });
}

/**
 * V1 fallback driver. It executes the fixture in a jsdom document, catches
 * console/runtime errors, verifies accesslensInit, and stores a deterministic
 * DOM/SVG snapshot. It cannot prove browser pixels, CSS layout, or true opaque
 * origin enforcement; the real Chromium implementation is deliberately left
 * behind this same interface for V8's Lambda harness.
 */
export class JsdomBrowserDriver implements BrowserDriver {
  async run(options: BrowserRunOptions): Promise<BrowserRunResult> {
    const startedAt = Date.now();
    const artifactDir = resolve(options.artifactDir);
    const manifest = await readManifest(artifactDir);
    const consoleErrors: string[] = [];
    const unhandledRejections: string[] = [];
    const initialized = { value: false };
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('error', (error) => consoleErrors.push(describeError(error)));
    virtualConsole.on('jsdomError', (error) => consoleErrors.push(describeError(error)));
    const dom = new JSDOM(await readFile(join(artifactDir, manifest.render.entry), 'utf8'), {
      url: `https://accesslens-harness.invalid/artifacts/${manifest.artifactId}/${manifest.artifactVersion}/index.html`,
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole,
    });
    const { window } = dom;
    const runtimeConsole = (window as unknown as { console: { error: (...args: unknown[]) => void } }).console;
    const originalConsoleError = runtimeConsole.error.bind(runtimeConsole);
    runtimeConsole.error = (...args: unknown[]) => {
      const message = args.map(describeError).join(' ');
      consoleErrors.push(message);
      originalConsoleError(...args);
    };
    window.addEventListener('error', (event) => {
      consoleErrors.push(event.error ? describeError(event.error) : event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      unhandledRejections.push(describeError(event.reason));
    });

    try {
      const init = (window as Window & {
        accesslensInit?: (params: Record<string, unknown>, ctx: { slideTitle: string; slideDescription: string; lessonContext: string }) => void;
      }).accesslensInit;
      if (typeof init !== 'function') throw new Error('artifact does not define window.accesslensInit');
      init(manifest.defaultParameters, {
        slideTitle: manifest.title,
        slideDescription: manifest.accessibility.description,
        lessonContext: manifest.summary,
      });
      initialized.value = true;
      for (let frame = 0; frame < (options.waitFrames ?? 2); frame += 1) await nextFrame(window);
    } catch (error) {
      consoleErrors.push(describeError(error));
    }

    if (options.screenshotPath) {
      await writeSnapshot(options.screenshotPath, manifest, dom.serialize());
    }
    dom.window.close();
    const uniqueErrors = [...new Set(consoleErrors.filter(Boolean))];
    const uniqueRejections = [...new Set(unhandledRejections.filter(Boolean))];
    return {
      ok: initialized.value && uniqueErrors.length === 0 && uniqueRejections.length === 0,
      consoleErrors: uniqueErrors,
      unhandledRejections: uniqueRejections,
      screenshotPath: options.screenshotPath ? resolve(options.screenshotPath) : undefined,
      artifactId: manifest.artifactId,
      artifactVersion: manifest.artifactVersion,
      durationMs: Date.now() - startedAt,
      initialized: initialized.value,
    };
  }
}

/** A named seam for a future Chromium implementation; V1 must not install it. */
export class ChromiumBrowserDriver implements BrowserDriver {
  async run(_options: BrowserRunOptions): Promise<BrowserRunResult> {
    throw new Error('Chromium browser driver is not bundled in V1; use the jsdom driver or install Playwright for a real screenshot');
  }
}

export async function readManifest(artifactDir: string): Promise<ArtifactManifest> {
  const raw = JSON.parse(await readFile(join(artifactDir, 'manifest.json'), 'utf8')) as unknown;
  const parsed = ArtifactManifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`manifest validation failed: ${parsed.error.message}`);
  return parsed.data;
}

async function writeSnapshot(path: string, manifest: ArtifactManifest, serializedDocument: string): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  // SVG keeps the result viewable on machines without a browser. It is called a
  // screenshotPath for compatibility with the future Chromium driver.
  const escaped = serializedDocument.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character] ?? character));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.render.minWidth}" height="${manifest.render.minHeight}"><text x="12" y="24" font-family="monospace" font-size="12">AccessLens jsdom render snapshot: ${manifest.artifactId}@${manifest.artifactVersion}</text><foreignObject x="0" y="36" width="100%" height="${Math.max(100, manifest.render.minHeight - 36)}"><pre xmlns="http://www.w3.org/1999/xhtml" style="font:10px monospace; white-space:pre-wrap; overflow-wrap:anywhere">${escaped}</pre></foreignObject></svg>`;
  await writeFile(path, svg, 'utf8');
}
