// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { InMemorySessionClient, type SessionClient } from '../shared/contracts';
import { validEvent, validPack } from '../shared/fixtures';
import type { AccessPack } from '../shared/contracts';

/** validPack with the AR scene the reviewed pack carries for this slide. */
const arPack: AccessPack = { ...validPack, assets: [{ ...validPack.assets[0], arScene: { modelUri: 'models/cell.glb', defaultCamera: 'overview', hotspots: [{ hotspotId: 'cell-slide-03:mitochondrion', regionId: 'mitochondrion', nodeName: 'Mitochondrion', label: 'Mitochondrion' }] } }] };
import { defaultPreferences, type StudentPreferences } from '../shared/preferences';
import { StudentExperience } from './StudentExperience';

class FakeConnectionAwareClient extends InMemorySessionClient {
  private connectionListeners = new Set<(connected: boolean) => void>();
  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }
  emitConnectionChange(connected: boolean): void {
    this.connectionListeners.forEach((listener) => listener(connected));
  }
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StudentExperience', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderExperience(event = validEvent, pack: AccessPack = arPack, client: SessionClient = new InMemorySessionClient()): { preferences: StudentPreferences; rerender(): void } {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const state = { preferences: defaultPreferences };
    const rerender = (): void => {
      root?.render(
        <StudentExperience
          client={client}
          event={event}
          pack={pack}
          preferences={state.preferences}
          onPreferencesChange={(next) => { state.preferences = next; rerender(); }}
        />,
      );
    };
    act(rerender);
    return { get preferences() { return state.preferences; }, rerender };
  }

  it('follows an instructor event and renders Focus mode first', () => {
    renderExperience();
    expect(container?.textContent).toContain('Following mitochondrion on cell-slide-03.');
    expect(container?.textContent).toContain('Focus view');
  });


  it('renders capture stopped as a non-live state', () => {
    const stoppedEvent = {
      schemaVersion: '1.0' as const,
      type: 'capture.stopped' as const,
      sessionId: 'demo-session',
      packId: 'bio-cell-demo',
      packVersion: 1,
      sequence: 2,
      sentAt: '2026-09-15T15:00:01Z',
    };
    renderExperience(stoppedEvent);
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('stopped');
    expect(container?.textContent).toContain('Instructor stopped sharing. Showing the last reviewed moment.');
  });

  it('offers the AR tab only when the pack carries an AR scene', () => {
    renderExperience(validEvent, validPack);
    const tabs = Array.from(container!.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
    expect(tabs).toEqual(['Focus', 'Read', 'Hear', 'Dyslexic']);
    expect(container!.querySelector('#mode-tab-ar')).toBeNull();
  });

  it('shows Focus when a saved AR preference meets a pack without an AR scene', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(
      <StudentExperience client={new InMemorySessionClient()} event={validEvent} pack={validPack} preferences={{ ...defaultPreferences, mode: 'ar' }} onPreferencesChange={() => {}} />,
    ));
    expect(container.textContent).toContain('Focus view');
    expect(container.textContent).not.toContain('Synchronized AR');
  });

  it('offers a local Dyslexic text mode with an explicit toggle', async () => {
    const harness = renderExperience();
    const tab = Array.from(container!.querySelectorAll('[role="tab"]')).find((item) => item.textContent === 'Dyslexic') as HTMLButtonElement;
    await act(async () => tab.click());
    expect(harness.preferences.mode).toBe('dyslexic');
    expect(container?.textContent).toContain('Dyslexic-friendly text');
    const toggle = container!.querySelector('.dyslexic-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('switches to AR through the accessible mode tabs', async () => {
    const harness = renderExperience();
    const arTab = Array.from(container!.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === 'AR') as HTMLButtonElement;
    await act(async () => {
      arTab.click();
      await import('../ar/CellArView');
    });
    expect(harness.preferences.mode).toBe('ar');
    expect(container?.textContent).toContain('Synchronized AR');
    expect(container?.textContent).toContain('Mitochondrion');
  });

  it('supports arrow-key movement between mode tabs', async () => {
    const harness = renderExperience();
    const focusTab = container!.querySelector('#mode-tab-focus') as HTMLButtonElement;
    await act(async () => focusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(harness.preferences.mode).toBe('structured-text');
    expect(container?.textContent).toContain('Structured text');
  });


  it('goes stale only on a real disconnect, and live again on reconnect -- not from content silence', async () => {
    const client = new FakeConnectionAwareClient();
    renderExperience(validEvent, arPack, client);
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');

    await act(async () => client.emitConnectionChange(false));
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('stale');
    expect(container?.textContent).toContain('Connection interrupted. Showing the last reviewed state.');

    await act(async () => client.emitConnectionChange(true));
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');
    expect(container?.textContent).toContain('Reconnected.');
  });

  it('stays live when content is quiet, for a transport with no connection status to report', async () => {
    vi.useFakeTimers();
    try {
      renderExperience();
      expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');
      await act(async () => { vi.advanceTimersByTime(120_000); });
      expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no automatically detectable accessibility violations in the AR fallback', async () => {
    renderExperience();
    const arTab = container!.querySelector('#mode-tab-ar') as HTMLButtonElement;
    await act(async () => {
      arTab.click();
      await import('../ar/CellArView');
    });
    const result = await axe.run(container!, {
      rules: {
        region: { enabled: false },
        'color-contrast': { enabled: false },
      },
    });
    expect(result.violations).toEqual([]);
  });
});

// ---- Live video pane ----------------------------------------------------------

import { FakeSubscriber } from '../sources/stream/fixtures';
import type { LiveEvent } from '../shared/contracts';

/** The relay hands a student a subscribe-only token beside the capability; the in-memory client does not, so this one does. */
class VideoSessionClient extends InMemorySessionClient {
  override async join(sessionId: string) {
    return { ...(await super.join(sessionId)), streamToken: 'subscribe-token-1' };
  }
}

const streamStarted: LiveEvent = { ...validEvent, type: 'stream.started', surface: 'browser', sequence: 2, assetId: undefined, regionId: undefined, pointer: undefined } as unknown as LiveEvent;
const streamStopped: LiveEvent = { schemaVersion: '1.0', type: 'stream.stopped', sessionId: 'demo-session', packId: 'bio-cell-demo', packVersion: 1, sequence: 3, sentAt: '2026-09-15T15:00:02Z' };
const captureStopped: LiveEvent = { ...streamStopped, type: 'capture.stopped', sequence: 3 };

describe('StudentExperience: live video pane', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mount(client: SessionClient, subscriber: FakeSubscriber, first: LiveEvent | null) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    let current = first;
    const show = (event: LiveEvent | null): void => {
      current = event;
      root?.render(
        <StudentExperience client={client} event={current} pack={validPack} preferences={defaultPreferences} onPreferencesChange={() => undefined} subscriber={subscriber} />,
      );
    };
    act(() => show(first));
    const deliver = (event: LiveEvent) => act(() => show(event));
    const join = async () => {
      const input = container!.querySelector<HTMLInputElement>('#session-code')!;
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setValue.call(input, 'demo-session');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { container!.querySelector('.join-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    };
    const pane = () => container!.querySelector('.live-video');
    return { deliver, join, pane };
  }

  it('shows nothing about video until the instructor streams', async () => {
    const subscriber = new FakeSubscriber();
    const { join, pane } = mount(new VideoSessionClient(), subscriber, validEvent);
    await join();
    expect(pane()).toBeNull();
    expect(subscriber.calls).toEqual([]);
  });

  it('subscribes with the join token on stream.started, plays the video muted and inline, and tears down on stream.stopped', async () => {
    const subscriber = new FakeSubscriber();
    const { join, deliver, pane } = mount(new VideoSessionClient(), subscriber, validEvent);
    await join();
    deliver(streamStarted);

    expect(subscriber.calls).toEqual(['subscribe:subscribe-token-1']);
    const section = pane()!;
    expect(section.getAttribute('aria-label')).toBe("Instructor's live slide video");
    const video = section.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.getAttribute('aria-label')).toBe("Live video of the instructor's tab");
    expect(section.textContent).toContain('Connecting');

    const media = { id: 'fake-media-stream' } as unknown as MediaStream;
    act(() => subscriber.deliver(media));
    expect((video as unknown as { srcObject: unknown }).srcObject).toBe(media);
    expect(section.textContent).toContain("Live video of the instructor's tab");
    // Focus mode is still following the slide underneath.
    expect(container!.textContent).toContain('Following mitochondrion on cell-slide-03.');

    deliver(streamStopped);
    expect(pane()).toBeNull();
    expect(subscriber.calls).toEqual(['subscribe:subscribe-token-1', 'stop']);
  });

  it('a student who joins mid-stream subscribes from the catch-up event', async () => {
    const subscriber = new FakeSubscriber();
    // The relay's catch-up posts stream.started as the first thing this student sees.
    const { join, pane } = mount(new VideoSessionClient(), subscriber, streamStarted);
    expect(subscriber.calls).toEqual([]); // no token before joining
    await join();
    expect(subscriber.calls).toEqual(['subscribe:subscribe-token-1']);
    expect(pane()).not.toBeNull();
  });

  it('capture.stopped ends the video too', async () => {
    const subscriber = new FakeSubscriber();
    const { join, deliver, pane } = mount(new VideoSessionClient(), subscriber, validEvent);
    await join();
    deliver(streamStarted);
    deliver(captureStopped);
    expect(pane()).toBeNull();
    expect(subscriber.subscribed).toBeNull();
  });

  it('a video failure is one sentence and the modes keep working', async () => {
    const subscriber = new FakeSubscriber();
    const { join, deliver, pane } = mount(new VideoSessionClient(), subscriber, validEvent);
    await join();
    deliver(streamStarted);
    act(() => subscriber.fail('The live video could not connect. Text and audio still work.'));
    expect(pane()!.textContent).toContain('The live video could not connect.');
    expect(container!.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(container!.textContent).toContain('Following mitochondrion on cell-slide-03.');
  });

  it('without a stage token the pane explains and never subscribes', async () => {
    const subscriber = new FakeSubscriber();
    const { join, deliver, pane } = mount(new InMemorySessionClient(), subscriber, validEvent);
    await join();
    deliver(streamStarted);
    expect(subscriber.calls).toEqual([]);
    expect(pane()!.textContent).toContain('no video access');
  });
});
