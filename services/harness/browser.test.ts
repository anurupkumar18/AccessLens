import { describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createArtifactServer, chromiumRenderCheck, type BrowserLauncher } from './browser';

const artifactHtml = '<html><head></head><body>artifact</body></html>';

describe('artifact harness browser adapter', () => {
  it('serves only the artifact and injects parameters into the harness page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accesslens-browser-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), artifactHtml);
    await writeFile(join(root, 'assets', 'data.json'), '{}');
    const server = await createArtifactServer(root, { ef: 32 });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();
      expect(html).toContain('__ACCESSLENS_HARNESS_PARAMETERS__');
      expect(html).toContain('"ef":32');
      expect(await fetch(`${server.url}/assets/data.json`).then(result => result.text())).toBe('{}');
      expect((await fetch(`${server.url}/../package.json`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('uses the injected browser launcher and reports a successful screenshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accesslens-browser-'));
    await writeFile(join(root, 'index.html'), artifactHtml);
    const launcher: BrowserLauncher = {
      launch: vi.fn(async ({ screenshotPath, url }) => {
        expect(url).toContain('mode=harness');
        await writeFile(screenshotPath, Buffer.from('PNG'));
        return {
          async close() {},
          result: { consoleErrors: [], unhandledRejections: [], screenshotPath },
        };
      }),
    };
    const render = chromiumRenderCheck({ launcher });
    const result = await render({ artifactDir: root, parameters: { ef: 32 } });
    expect(result).toMatchObject({ ok: true, consoleErrors: [], unhandledRejections: [] });
    expect(result.screenshotPath).toBe(join(root, 'harness-screenshot.png'));
    expect(await readFile(result.screenshotPath!)).toEqual(Buffer.from('PNG'));
  });

  it('turns browser failures into a failed render with console diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accesslens-browser-'));
    await writeFile(join(root, 'index.html'), artifactHtml);
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        async close() {},
        result: { consoleErrors: ['console.error from artifact'], unhandledRejections: ['rejected promise'] },
      })),
    };
    const result = await chromiumRenderCheck({ launcher })({ artifactDir: root, parameters: {} });
    expect(result).toEqual({ ok: false, consoleErrors: ['console.error from artifact'], unhandledRejections: ['rejected promise'], screenshotPath: expect.any(String) });
  });
});
