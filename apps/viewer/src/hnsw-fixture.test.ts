// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';

const fixturePath = join(process.cwd(), 'apps/viewer/fixtures/artifacts/hnsw-search-stepper/1/index.html');

describe('hand-written HNSW artifact', () => {
  it('steps accessibly and highlights the mapped layer without console errors', () => {
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('error', (error: unknown) => errors.push(String(error)));
    virtualConsole.on('jsdomError', (error: unknown) => errors.push(String(error)));
    const dom = new JSDOM(readFileSync(fixturePath, 'utf8'), {
      url: 'https://viewer.example.test/artifacts/hnsw-search-stepper/1/index.html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole,
    });
    const { window } = dom;
    const init = (window as Window & {
      accesslensInit: (params: Record<string, unknown>, ctx: { slideTitle: string; slideDescription: string; lessonContext: string }) => void;
      accesslensHighlight: (regionId: string) => void;
    }).accesslensInit;
    init({ ef: 32, M: 16 }, { slideTitle: 'HNSW', slideDescription: 'Graph', lessonContext: 'Search' });
    expect(window.document.getElementById('ef-value')?.textContent).toBe('ef: 32');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    expect(window.document.getElementById('hnsw-state')?.textContent).toContain('Step 1');
    (window as Window & { accesslensHighlight: (regionId: string) => void }).accesslensHighlight('layer-0');
    expect(window.document.querySelectorAll('.node.highlighted').length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    dom.window.close();
  });
});
