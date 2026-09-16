import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, relative, resolve } from 'node:path';
import type { RenderCheck } from '../agents/critic';

/** A browser process is injected so tests can remain offline and deterministic. */
export interface BrowserProcess {
  close(): Promise<void>;
}

export interface BrowserLauncher {
  launch(input: {
    url: string;
    width: number;
    height: number;
    screenshotPath: string;
    timeoutMs: number;
  }): Promise<BrowserProcess & { result?: BrowserRenderResult }>;
}

export interface BrowserRenderResult {
  consoleErrors: string[];
  unhandledRejections: string[];
  screenshotPath?: string;
}

/**
 * Same RenderCheck shape consumed by the critic. The actual viewer lane can
 * provide its browser driver at this seam; this module supplies a bounded
 * Chromium CLI implementation for the Lambda image and a local fallback.
 */
export type { RenderCheck };

export interface ChromiumRenderOptions {
  chromiumPath?: string;
  timeoutMs?: number;
  launcher?: BrowserLauncher;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Launch headless Chromium against the harness page. The harness page itself
 * is served by `createArtifactServer`; no artifact code is executed in the
 * extension context or in this Node process.
 *
 * Chromium is expected to use the viewer's `?mode=harness` route, which owns
 * the opaque-origin sandbox and calls accesslensInit. A custom launcher is
 * accepted for deployments that use a CDP driver rather than the CLI.
 */
export function chromiumRenderCheck(
  options: ChromiumRenderOptions = {},
): RenderCheck {
  const launcher = options.launcher ?? cliChromiumLauncher(options.chromiumPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async ({ artifactDir, parameters }) => {
    const server = await createArtifactServer(artifactDir, parameters);
    const screenshotPath = join(artifactDir, 'harness-screenshot.png');
    try {
      const process = await launcher.launch({
        url: `${server.url}/?mode=harness`,
        width: 1280,
        height: 720,
        screenshotPath,
        timeoutMs,
      });
      await process.close();
      const result = process.result ?? { consoleErrors: [], unhandledRejections: [] };
      return {
        ok: result.consoleErrors.length === 0 && result.unhandledRejections.length === 0 && Boolean(result.screenshotPath ?? screenshotPath),
        consoleErrors: result.consoleErrors,
        unhandledRejections: result.unhandledRejections,
        screenshotPath: result.screenshotPath ?? screenshotPath,
      };
    } finally {
      await server.close();
    }
  };
}

/**
 * A tiny static server for one artifact. The viewer deployment normally serves
 * the host page and sandbox itself; this server is only the Lambda/local
 * harness adapter and deliberately restricts paths to artifactDir.
 */
export async function createArtifactServer(artifactDir: string, parameters: Record<string, unknown>): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const root = resolve(artifactDir);
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      await serveArtifactRequest(request, response, root, parameters);
    } catch (error) {
      const notFound = error instanceof Error && (error.message === 'not found' || (error as NodeJS.ErrnoException).code === 'ENOENT');
      response.statusCode = notFound ? 404 : 500;
      response.end(error instanceof Error ? error.message : 'internal server error');
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolvePromise => server.close(() => resolvePromise()));
    throw new Error('artifact server did not expose a TCP address');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise())),
  };
}

async function serveArtifactRequest(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const target = resolve(root, `.${pathname}`);
  const withinRoot = target === root || target.startsWith(`${root}/`);
  if (!withinRoot || relative(root, target).split('/').includes('..')) throw new Error('not found');
  let content = await readFile(target);
  if (target.endsWith('/index.html')) {
    // The viewer's harness route reads the payload from the query. A JSON value
    // is embedded as data, never interpreted as script in this Node server.
    const marker = '<head>';
    const injection = `<script>window.__ACCESSLENS_HARNESS_PARAMETERS__=${JSON.stringify(parameters)};</script>`;
    const source = content.toString();
    content = Buffer.from(source.includes(marker) ? source.replace(marker, `${marker}${injection}`) : `${injection}${source}`);
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType(target));
  response.setHeader('Cache-Control', 'no-store');
  response.end(content);
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function cliChromiumLauncher(chromiumPath = process.env.CHROMIUM_PATH ?? 'chromium'): BrowserLauncher {
  return {
    async launch(input) {
      const args = [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--window-size=${input.width},${input.height}`,
        `--screenshot=${input.screenshotPath}`,
        `--timeout=${input.timeoutMs}`,
        input.url,
      ];
      const child = spawn(chromiumPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stderr: Buffer[] = [];
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
      let timer: NodeJS.Timeout | undefined;
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>(resolvePromise => {
        timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolvePromise({ code: null, signal: 'SIGKILL' });
        }, input.timeoutMs);
        child.once('error', error => resolvePromise({ code: null, signal: null, error }));
        child.once('exit', (code, signal) => resolvePromise({ code, signal }));
      });
      if (timer) clearTimeout(timer);
      const errors = result.error ? [result.error.message] : result.code === 0 ? [] : [Buffer.concat(stderr).toString('utf8').trim() || `Chromium exited with code ${result.code ?? 'unknown'}`];
      return {
        async close() { /* process has exited or was killed */ },
        result: {
          consoleErrors: errors,
          unhandledRejections: [],
          ...(errors.length === 0 ? { screenshotPath: input.screenshotPath } : {}),
        },
      };
    },
  };
}
