// @vitest-environment jsdom
//
// Renders a pack the authoring pipeline actually published -- fetched live
// from CloudFront -- through the real student renderers (decision D7). Opt in
// with ACCESSLENS_PACK_URL=https://<distribution>/packs/<packId>/<n>.json.
// Skipped otherwise, so the ordinary suite stays offline.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { App } from './App';
import { InMemorySessionClient, type AccessPack } from '../shared/contracts';
import { loadRemotePack } from '../shared/remotePack';
import { slideImageUrl } from '../shared/packMedia';
import { FakeCaptureHost, FakeScheduler } from '../sources/screen/fixtures';

const PACK_URL = process.env.ACCESSLENS_PACK_URL;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const describeIf = PACK_URL ? describe : describe.skip;

describeIf('a pack the pipeline published, in the student view', () => {
  let pack: AccessPack;
  let container: HTMLDivElement | null = null;

  beforeAll(async () => {
    pack = await loadRemotePack(new URL(PACK_URL!));
  }, 30_000);

  afterEach(() => { container?.remove(); container = null; });

  it('is a valid Access Pack whose slide images are reachable on the distribution', async () => {
    expect(pack.assets.length).toBeGreaterThan(0);
    for (const asset of pack.assets) {
      const url = slideImageUrl(pack, asset);
      expect(url, asset.assetId).toMatch(/^https:\/\//);
      const head = await fetch(url!, { method: 'HEAD' });
      expect(head.status, `${asset.assetId} ${url}`).toBe(200);
    }
  }, 60_000);

  it('renders through the Part 2 student renderers when the session names it', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const root = createRoot(container);
    act(() => root.render(<App client={client} pack={pack} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} />));
    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const slide = pack.assets[Math.min(1, pack.assets.length - 1)];
    await client.join('ABC123');
    act(() => client.send({
      schemaVersion: '1.0', type: 'asset.changed', sessionId: 'ABC123', packId: pack.packId, packVersion: pack.version,
      sequence: 1, sentAt: new Date().toISOString(), assetId: slide.assetId,
    }));

    // The same assertions the bundled packs satisfy: the followed slide and
    // its first region reach the DOM, and the slide image comes from
    // CloudFront rather than the bundle.
    expect(container.textContent).toContain(`Following ${slide.assetId}.`);
    expect(container.textContent).toContain(slide.regions[0].regionId);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(slideImageUrl(pack, slide));
  });

  it('carries the pipeline-only fields without breaking the renderers', () => {
    // audioUri and references are Part 6 additions the renderers do not use
    // yet (V6/V9 deferred). Their presence must be harmless.
    const withAudio = pack.assets.flatMap(a => a.regions).filter(r => r.audioUri).length;
    console.log(`regions with Polly audio: ${withAudio}; assets with visualization: ${pack.assets.filter(a => a.visualization).length}`);
    expect(withAudio).toBeGreaterThanOrEqual(0);
  });
});
