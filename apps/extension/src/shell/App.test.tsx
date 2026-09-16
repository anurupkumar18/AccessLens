// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import publishedFixture from '../../../viewer/fixtures/published-pack.json';
import { resetRemotePackBasesForTests } from '../shared/packMedia';
import { App, packChoices } from './App';
import type { AuthoringClient } from '../shared/authoringClient';
import { InMemorySessionClient } from '../shared/contracts';
import { loadPreferences, resetPreferencesForTests } from '../shared/preferences';
import { FakeCaptureHost, FakeScheduler, testPack } from '../sources/screen/fixtures';
import { AccessPackSchema } from '../shared/contracts';

const syntheticPack = AccessPackSchema.parse(testPack);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('App shell', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => { resetPreferencesForTests(); resetRemotePackBasesForTests(); });

  afterEach(() => {
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('lets the student view follow an instructor correction, with no network client', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const host = new FakeCaptureHost();
    const root = createRoot(container);
    act(() => root.render(<App client={client} pack={syntheticPack} host={host} scheduler={new FakeScheduler()} />));

    expect(host.calls).toEqual([]);
    const startButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Start')!;
    await act(async () => { startButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(host.calls).toEqual(['requestStream']);

    const assetSelect = container.querySelector<HTMLSelectElement>('#correct-asset')!;
    act(() => { assetSelect.value = 'slide-04'; assetSelect.dispatchEvent(new Event('change', { bubbles: true })); });
    const regionSelect = container.querySelector<HTMLSelectElement>('#correct-region')!;
    act(() => { regionSelect.value = 'nucleolus'; regionSelect.dispatchEvent(new Event('change', { bubbles: true })); });
    const apply = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Apply correction')!;
    await act(async () => { apply.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.textContent).toContain('Following nucleolus on slide-04');
  });

  it('fetches the published pack a session names when no bundled pack matches', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const published = AccessPackSchema.parse(publishedFixture);
    const fetchPublishedPack = vi.fn(async () => published);
    const root = createRoot(container);
    act(() => root.render(<App client={client} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} fetchPublishedPack={fetchPublishedPack} />));

    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // The instructor is teaching a pack the pipeline published; this build bundles no copy of that version.
    expect(packChoices.some(c => c.pack.packId === published.packId && c.pack.version === published.version)).toBe(false);
    await client.join('ABC123');
    await act(async () => {
      client.send({
        schemaVersion: '1.0', type: 'asset.changed', sessionId: 'ABC123', packId: published.packId, packVersion: published.version,
        sequence: 1, sentAt: '2026-09-15T15:00:00Z', assetId: published.assets[0].assetId,
      });
      await Promise.resolve();
    });

    expect(fetchPublishedPack).toHaveBeenCalledTimes(1);
    expect(fetchPublishedPack).toHaveBeenCalledWith(published.packId, published.version);
    expect(container.textContent).not.toContain('different reviewed lesson version');
    expect(container.textContent).toContain(`Following ${published.assets[0].assetId}.`);
    expect(container.textContent).toContain(published.assets[0].regions[0].regionId);
  });

  it('tells the student when the session pack cannot be fetched', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const root = createRoot(container);
    act(() => root.render(<App client={client} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} fetchPublishedPack={async () => { throw new Error('HTTP 404'); }} />));
    act(() => Array.from(container!.querySelectorAll('button')).find(b => b.textContent === 'Student')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await client.join('ABC123');
    await act(async () => {
      client.send({ schemaVersion: '1.0', type: 'asset.changed', sessionId: 'ABC123', packId: 'nope', packVersion: 9, sequence: 1, sentAt: '2026-09-15T15:00:00Z', assetId: 'slide-01' });
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('nope v9');
  });

  it('persists the student reduced-motion preference to local storage only', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const root = createRoot(container);
    await act(async () => root.render(<App client={client} />));

    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const toggle = container.querySelector('#reduced-motion-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(toggle.checked).toBe(true);
    expect((await loadPreferences()).reducedMotion).toBe(true);
  });

  it('offers the signed-in instructor their published packs and presents the newest one', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // A pack the pipeline published under this build's fingerprint contract (the viewer fixture predates it).
    const published = AccessPackSchema.parse({ ...testPack, packId: 'introduction-to-hnsw', title: 'Introduction to HNSW', version: 1 });
    const summary = { packId: published.packId, title: published.title, version: published.version, packUrl: `https://cdn.test/packs/${published.packId}/${published.version}.json`, publishedAt: '2026-09-16T18:22:00.000Z' };
    const authoringClient = { me: vi.fn(async () => ({ instructor: { sub: 'g-1', email: 'prof@uni.edu', createdAt: '2026-09-16T00:00:00.000Z', lastSeenAt: '2026-09-16T00:00:00.000Z' }, profiles: [], packs: [summary] })) } as unknown as AuthoringClient;
    const fetchPublishedPack = vi.fn(async () => published);
    const root = createRoot(container);
    await act(async () => {
      root.render(<App client={new InMemorySessionClient()} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} fetchPublishedPack={fetchPublishedPack} authoringClient={authoringClient} />);
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    const select = container.querySelector<HTMLSelectElement>('#pack-choice')!;
    expect(Array.from(select.options).map(o => o.textContent)).toContain(`${published.title} (v${published.version})`);
    expect(select.value).toBe(`published:${published.packId}`);
    expect(fetchPublishedPack).toHaveBeenCalledWith(published.packId, published.version);
    expect(container.textContent).toContain(`Pack: ${published.title} · v${published.version}`);
    root.unmount();
  });
});
