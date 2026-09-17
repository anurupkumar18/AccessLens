// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import publishedFixture from '../../../viewer/fixtures/published-pack.json';
import { resetRemotePackBasesForTests } from '../shared/packMedia';
import { App, packChoices } from './App';
import type { AuthoringClient } from '../shared/authoringClient';
import type { ClassroomClient } from '../shared/classroomClient';
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

  it('switching this tab away from Instructor while sharing tells students the session ended, not silence', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const host = new FakeCaptureHost();
    const root = createRoot(container);
    act(() => root.render(<App client={client} pack={syntheticPack} host={host} scheduler={new FakeScheduler()} />));

    const studentContainer = document.createElement('div');
    document.body.appendChild(studentContainer);
    const studentRoot = createRoot(studentContainer);
    act(() => studentRoot.render(<App client={client} pack={syntheticPack} />));
    const studentButton = Array.from(studentContainer.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const startButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Start')!;
    await act(async () => { startButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(studentContainer.textContent).toContain('Connected to the live lesson');

    const thisTabStudentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    await act(async () => { thisTabStudentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(studentContainer.textContent).toContain('The instructor ended this session.');
    act(() => studentRoot.unmount());
    studentContainer.remove();
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
    expect(container.textContent).toContain(`Now on ${published.assets[0].title}.`);
    // A slide change names no region, so Focus shows the fetched pack's whole slide.
    expect(container.textContent).toContain(`Focus view · ${published.assets[0].title}`);
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

  it('switches between distinct Live lesson and Review student surfaces', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<App client={new InMemorySessionClient()} pack={syntheticPack} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} />));

    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.click());
    const reviewButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Review')!;
    await act(async () => reviewButton.click());

    expect(container.textContent).toContain('Review mode');
    expect(container.textContent).toContain('Not live. This page uses reviewed pack content');
    const liveButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Live lesson')!;
    await act(async () => liveButton.click());
    expect(container.textContent).toContain('Live lesson');
    root.unmount();
  });

  it('offers the published demo packs without signing in, and presents one when picked', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const published = AccessPackSchema.parse({ ...testPack, packId: 'introduction-to-hnsw', title: 'Introduction to HNSW', version: 1 });
    const fetchPublishedPack = vi.fn(async () => published);
    const authoringClient = { me: vi.fn(async () => { throw new Error('not signed in'); }) } as unknown as AuthoringClient;
    const root = createRoot(container);
    await act(async () => {
      root.render(<App client={new InMemorySessionClient()} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} fetchPublishedPack={fetchPublishedPack} authoringClient={authoringClient} />);
      await Promise.resolve();
    });

    const select = container.querySelector<HTMLSelectElement>('#pack-choice')!;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Introduction to HNSW (v1)', 'Cell Structure (reviewed)']);
    expect(select.value).toBe('bio-cell-demo');
    expect(fetchPublishedPack).not.toHaveBeenCalled();

    await act(async () => {
      select.value = 'published:introduction-to-hnsw';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(fetchPublishedPack).toHaveBeenCalledWith('introduction-to-hnsw', 1);
    expect(container.textContent).toContain('Pack: Introduction to HNSW · v1');
    root.unmount();
  });

  it('offers a separate class-library student surface without altering live lesson state', async () => {
    container = document.createElement('div'); document.body.appendChild(container);
    const classroomClient = { redeemInvite: vi.fn(), ask: vi.fn() } as unknown as ClassroomClient;
    const root = createRoot(container);
    await act(async () => root.render(<App client={new InMemorySessionClient()} pack={syntheticPack} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} classroomClient={classroomClient} />));
    act(() => Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'Student')!.click());
    act(() => Array.from(container!.querySelectorAll('button')).find(button => button.textContent === 'Class library')!.click());
    expect(container!.textContent).toContain('Join a class library');
    root.unmount();
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
    // Their own copy of a demo pack is listed once, under their packs.
    expect(Array.from(select.options).map(o => o.textContent).filter(t => t === `${published.title} (v${published.version})`)).toHaveLength(1);
    expect(select.value).toBe(`published:${published.packId}`);
    expect(fetchPublishedPack).toHaveBeenCalledWith(published.packId, published.version);
    expect(container.textContent).toContain(`Pack: ${published.title} · v${published.version}`);
    root.unmount();
  });
});
