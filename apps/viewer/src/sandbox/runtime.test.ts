// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SandboxRuntime } from './runtime';

const artifact = `<!doctype html><html><body><button id="step">Step</button><div id="state" aria-live="polite"></div><script>
window.accesslensInit = function (params, ctx) {
  window.__received = { params: params, ctx: ctx };
  let step = 0;
  const render = function () { document.getElementById('state').textContent = 'step ' + step; };
  document.getElementById('step').addEventListener('click', function () { step += 1; render(); });
  window.accesslensHighlight = function (regionId) { document.getElementById('state').textContent = 'highlight ' + regionId; };
  render();
};
</script></body></html>`;

function makeRuntime() {
  const owner = document.createElement('iframe');
  document.body.appendChild(owner);
  const iframe = owner.contentDocument!;
  const parent = { postMessage: vi.fn() } as unknown as Window;
  const sandboxWindow = owner.contentWindow!;
  Object.defineProperty(sandboxWindow, 'parent', { configurable: true, value: parent });
  const runtime = new SandboxRuntime({
    window: sandboxWindow,
    document: iframe,
    fetch: vi.fn(async () => ({ ok: true, text: async () => artifact }) as Response),
    parentOrigin: 'https://viewer.example.test',
  });
  runtime.start();
  return { iframe, parent, sandboxWindow, runtime, owner };
}

function deliver(runtime: SandboxRuntime, message: unknown, sandboxWindow: Window) {
  runtime.handleMessage(new MessageEvent('message', {
    data: message,
    origin: 'https://viewer.example.test',
    source: sandboxWindow.parent,
  }));
}

describe('SandboxRuntime', () => {
  it('loads an artifact, passes parameters and context to accesslensInit, and highlights', async () => {
    const { iframe, parent, runtime, sandboxWindow } = makeRuntime();
    deliver(runtime, {
      type: 'sandbox.load', artifactId: 'hnsw-search-stepper', artifactVersion: 1,
      artifactUrl: 'https://viewer.example.test/artifacts/hnsw-search-stepper/1/index.html',
      html: artifact, parameters: { ef: 32, M: 16 }, ctx: {
        slideTitle: 'HNSW', slideDescription: 'graph', lessonContext: 'search',
        references: [{ docId: 'paper', title: 'Paper', page: 1, quote: 'graph' }],
      },
    }, sandboxWindow);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((sandboxWindow as unknown as { __received: unknown }).__received).toEqual({
      params: { ef: 32, M: 16 },
      ctx: {
        slideTitle: 'HNSW', slideDescription: 'graph', lessonContext: 'search',
        references: [{ docId: 'paper', title: 'Paper', page: 1, quote: 'graph' }],
      },
    });
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'sandbox.ready' }, 'https://viewer.example.test');
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'sandbox.loaded', artifactId: 'hnsw-search-stepper', artifactVersion: 1 }, 'https://viewer.example.test');
    deliver(runtime, { type: 'sandbox.highlight', regionId: 'layer-0' }, sandboxWindow);
    expect(iframe.getElementById('state')?.textContent).toBe('highlight layer-0');
  });

  it('freezes keyboard-driven stepping and clear removes the rendered frame', async () => {
    const { iframe, runtime, sandboxWindow } = makeRuntime();
    deliver(runtime, {
      type: 'sandbox.load', artifactId: 'hnsw-search-stepper', artifactVersion: 1,
      artifactUrl: 'https://viewer.example.test/artifacts/hnsw-search-stepper/1/index.html',
      html: artifact, parameters: {}, ctx: { slideTitle: 'HNSW', slideDescription: 'graph', lessonContext: 'search' },
    }, sandboxWindow);
    await new Promise((resolve) => setTimeout(resolve, 0));
    iframe.getElementById('step')?.dispatchEvent(new iframe.defaultView!.Event('click', { bubbles: true }));
    expect(iframe.getElementById('state')?.textContent).toBe('step 1');
    deliver(runtime, { type: 'sandbox.freeze' }, sandboxWindow);
    const key = new iframe.defaultView!.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    iframe.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    deliver(runtime, { type: 'sandbox.clear' }, sandboxWindow);
    expect(iframe.getElementById('artifact-root')?.innerHTML).toBe('');
  });

  it('reports a thrown accesslensInit as a render error', async () => {
    const { parent, runtime, sandboxWindow } = makeRuntime();
    deliver(runtime, {
      type: 'sandbox.load', artifactId: 'bad', artifactVersion: 1,
      artifactUrl: 'https://viewer.example.test/artifacts/bad/1/index.html',
      html: '<script>window.accesslensInit = function () { throw new Error("fixture boom"); };</script>',
      parameters: {}, ctx: { slideTitle: 'Bad', slideDescription: 'bad', lessonContext: 'bad' },
    }, sandboxWindow);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((parent.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([message]) => message.type === 'sandbox.error' && message.code === 'render' && message.message.includes('fixture boom'))).toBe(true);
  });
});
