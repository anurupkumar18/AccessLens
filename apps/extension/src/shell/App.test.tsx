// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { App, packChoices } from './App';
import { InMemorySessionClient } from '../shared/contracts';
import { loadPreferences, resetPreferencesForTests } from '../shared/preferences';
import { FakeCaptureHost, FakeScheduler, testPack } from '../sources/screen/fixtures';
import { AccessPackSchema } from '../shared/contracts';

const syntheticPack = AccessPackSchema.parse(testPack);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('App shell', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => resetPreferencesForTests());

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

  it('resolves the student pack from the session events, not the instructor dropdown', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const root = createRoot(container);
    act(() => root.render(<App client={client} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} />));

    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // An instructor elsewhere is teaching the HNSW draft pack; this tab never touched the dropdown.
    const hnsw = packChoices.find(c => c.id === 'hnsw-explainer')!.pack;
    await client.join('ABC123');
    act(() => client.send({
      schemaVersion: '1.0', type: 'asset.changed', sessionId: 'ABC123', packId: hnsw.packId, packVersion: hnsw.version,
      sequence: 1, sentAt: '2026-09-15T15:00:00Z', assetId: hnsw.assets[1].assetId,
    }));

    expect(container.textContent).not.toContain('different reviewed lesson version');
    // Part 3's Focus view renders the followed slide's regions from the resolved pack.
    expect(container.textContent).toContain(`Following ${hnsw.assets[1].assetId}.`);
    expect(container.textContent).toContain(hnsw.assets[1].regions[0].regionId);
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
});
