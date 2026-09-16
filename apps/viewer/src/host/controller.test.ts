// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerHostController } from './controller';
import type { ExtensionToViewer } from '../protocol';

const manifest = {
  schemaVersion: '1.0',
  artifactId: 'hnsw-search-stepper',
  artifactVersion: 1,
  title: 'HNSW search, step by step',
  summary: 'Hand-authored layered graph.',
  subjects: ['computer-science'],
  tags: ['graph'],
  interaction: 'stepper',
  provenance: { kind: 'catalog', sourceUrl: 'https://github.com/anurupkumar18/Mind-Machine', license: 'CC0-1.0' },
  parameters: {
    type: 'object',
    properties: {
      ef: { type: 'integer', minimum: 1, maximum: 512 },
      M: { type: 'integer', minimum: 2, maximum: 64 },
    },
  },
  defaultParameters: { ef: 32, M: 16 },
  libraries: [],
  accessibility: {
    description: 'A layered graph.',
    keyboard: 'Space steps the search.',
    semanticOutline: ['Layer 2', 'Layer 1', 'Layer 0'],
  },
  render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
} as const;

const load: ExtensionToViewer = {
  type: 'viz.load',
  packId: 'pack',
  packVersion: 1,
  assetId: 'slide-1',
  artifactId: 'hnsw-search-stepper',
  artifactVersion: 1,
  parameters: { ef: 32, M: 16 },
  ctx: {
    slideTitle: 'HNSW',
    slideDescription: 'A layered graph.',
    lessonContext: 'Nearest-neighbor search.',
    references: [{ docId: 'paper', title: 'HNSW paper', page: 3, quote: 'A graph' }],
  },
};

function response(body: unknown, text = '<html><body><script>window.accesslensInit=()=>{};</script></body></html>') {
  return {
    ok: true,
    json: async () => body,
    text: async () => text,
  } as Response;
}

function setup(fetchImpl = vi.fn(async (url: string | URL) => {
  return String(url).endsWith('manifest.json') ? response(manifest) : response({}, '<html></html>');
})) {
  const iframe = document.createElement('iframe');
  const sandboxWindow = { postMessage: vi.fn() } as unknown as Window;
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: sandboxWindow });
  document.body.appendChild(iframe);
  const parentPost = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
  const controller = new ViewerHostController({
    window,
    iframe,
    fetch: fetchImpl as unknown as typeof fetch,
    artifactBase: 'https://viewer.example.test',
    allowedOrigins: ['https://allowed.example.test', 'chrome-extension://*'],
  });
  controller.start();
  return { iframe, sandboxWindow, parentPost, controller, fetchImpl };
}

function dispatchExtension(message: unknown, origin = 'https://allowed.example.test') {
  window.dispatchEvent(new MessageEvent('message', { data: message, origin, source: window }));
}

function dispatchSandbox(message: unknown, sandboxWindow: Window, origin = 'null') {
  window.dispatchEvent(new MessageEvent('message', { data: message, origin, source: sandboxWindow }));
}

describe('ViewerHostController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a valid-looking message from a disallowed origin', async () => {
    const { sandboxWindow } = setup();
    dispatchExtension(load, 'https://evil.example.test');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).not.toHaveBeenCalled();
  });

  it('uses a concrete target origin when posting to the sandbox', async () => {
    const { sandboxWindow } = setup();
    dispatchSandbox({ type: 'sandbox.ready' }, sandboxWindow);
    dispatchExtension(load);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const postMessage = (sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
    expect(postMessage).toHaveBeenCalled();
    expect(postMessage.mock.calls[0][1]).not.toBe('*');
    expect(postMessage.mock.calls[0][1]).toBe('null');
  });

  it('reports an unblessed library as a manifest error without rendering', async () => {
    const badManifest = { ...manifest, libraries: ['not-blessed'] };
    const fetchImpl = vi.fn(async (url: string | URL) => String(url).endsWith('manifest.json') ? response(badManifest) : response({}, '<html></html>'));
    const { sandboxWindow, parentPost } = setup(fetchImpl);
    dispatchSandbox({ type: 'sandbox.ready' }, sandboxWindow);
    dispatchExtension(load);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parentPost.mock.calls.some(([message]) => (message as { type?: string }).type === 'viz.error' && (message as { code?: string }).code === 'manifest')).toBe(true);
    expect((sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).not.toHaveBeenCalled();
  });

  it('rejects a manifest without accessibility.keyboard', async () => {
    const badManifest = { ...manifest, accessibility: { ...manifest.accessibility, keyboard: undefined } };
    const fetchImpl = vi.fn(async (url: string | URL) => String(url).endsWith('manifest.json') ? response(badManifest) : response({}, '<html></html>'));
    const { sandboxWindow, parentPost } = setup(fetchImpl);
    dispatchSandbox({ type: 'sandbox.ready' }, sandboxWindow);
    dispatchExtension(load);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parentPost.mock.calls.some(([message]) => (message as { type?: string }).type === 'viz.error' && (message as { code?: string }).code === 'manifest')).toBe(true);
    expect((sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).not.toHaveBeenCalled();
  });

  it('rejects out-of-range parameters before they reach the sandbox', async () => {
    const { sandboxWindow, parentPost } = setup();
    dispatchSandbox({ type: 'sandbox.ready' }, sandboxWindow);
    dispatchExtension({ ...load, parameters: { ef: 999, M: 16 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parentPost.mock.calls.some(([message]) => (message as { type?: string }).type === 'viz.error' && (message as { code?: string }).code === 'params')).toBe(true);
    expect((sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).not.toHaveBeenCalled();
  });

  it('injects valid parameters verbatim', async () => {
    const { sandboxWindow } = setup();
    dispatchSandbox({ type: 'sandbox.ready' }, sandboxWindow);
    dispatchExtension(load);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const command = ((sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage.mock.calls[0][0]) as { type: string; parameters: object };
    expect(command.type).toBe('sandbox.load');
    expect(command.parameters).toEqual(load.parameters);
  });

  it('forwards highlight, freeze, and clear lifecycle commands', () => {
    const { sandboxWindow } = setup();
    dispatchSandbox({ type: 'sandbox.ready' }, sandboxWindow);
    dispatchExtension({ type: 'viz.highlight', regionId: 'layer-0' });
    dispatchExtension({ type: 'viz.freeze' });
    dispatchExtension({ type: 'viz.clear' });
    const commands = (sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage.mock.calls.map(([message]) => message as { type: string });
    expect(commands.map(({ type }) => type)).toEqual(['sandbox.highlight', 'sandbox.freeze', 'sandbox.clear']);
  });

  it('replaces an existing artifact on a second valid load and passes references through', async () => {
    const secondManifest = { ...manifest, artifactId: 'graph-search-stepper' };
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes('/graph-search-stepper/')) return value.endsWith('manifest.json') ? response(secondManifest) : response({}, '<html></html>');
      return value.endsWith('manifest.json') ? response(manifest) : response({}, '<html></html>');
    });
    const { sandboxWindow } = setup(fetchImpl);
    dispatchSandbox({ type: 'sandbox.ready' }, sandboxWindow);
    dispatchExtension(load);
    await new Promise((resolve) => setTimeout(resolve, 0));
    dispatchExtension({ ...load, artifactId: 'graph-search-stepper', artifactVersion: 1, parameters: { ef: 40, M: 20 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const commands = (sandboxWindow as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage.mock.calls.map(([message]) => message as { type: string; ctx?: { references?: unknown }; parameters?: object });
    expect(commands.map(({ type }) => type)).toEqual(['sandbox.load', 'sandbox.clear', 'sandbox.load']);
    expect(commands[2].parameters).toEqual({ ef: 40, M: 20 });
    expect(commands[2].ctx?.references).toEqual(load.ctx.references);
  });
});
