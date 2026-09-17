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

class FakeProtocolAwareClient extends InMemorySessionClient {
  private invalidEventListeners = new Set<() => void>();
  onInvalidEvent(listener: () => void): () => void {
    this.invalidEventListeners.add(listener);
    return () => this.invalidEventListeners.delete(listener);
  }
  emitInvalidEvent(): void {
    this.invalidEventListeners.forEach((listener) => listener());
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

  it('opens in Read mode with the whole lesson and the instructor\'s slide marked', () => {
    renderExperience();
    expect(container?.textContent).toContain('mitochondrion: The mitochondrion releases usable energy for the cell.');
    expect(container!.querySelector('.read-view')).not.toBeNull();
    expect(container!.querySelector(`article#read-${validPack.assets[0].assetId}`)?.getAttribute('aria-current')).toBe('true');
    expect(container!.querySelector<HTMLAnchorElement>('.read-view .skip-link')?.getAttribute('href')).toBe(`#read-${validPack.assets[0].assetId}`);
  });


  it("announces the instructor's slide and region to the student's own screen reader, unless they turn it off", () => {
    const { rerender } = renderExperience();
    const announcer = () => container!.querySelector('[data-testid="screen-reader-announcer"]')!;
    expect(announcer().getAttribute('aria-live')).toBe('polite');
    const region = validPack.assets[0].regions.find((r) => r.regionId === 'mitochondrion')!;
    expect(announcer().textContent).toContain(`Slide: ${validPack.assets[0].title}.`);
    expect(announcer().textContent).toContain(region.shortDescription);

    const toggle = container!.querySelector<HTMLInputElement>('#announce-changes-toggle')!;
    act(() => toggle.click());
    rerender();
    expect(announcer().textContent).toBe('');
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

  it('offers the AR tab for a reviewed slide with regions', () => {
    renderExperience(validEvent, validPack);
    const tabs = Array.from(container!.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
    // Reading spacing hidden for the 2026-09-17 demo (see allModes in StudentExperience.tsx); restore 'Reading spacing' here when it comes back.
    expect(tabs).toEqual(['Read', 'Focus', 'AR']);
    expect(container!.querySelector('#mode-tab-ar')).not.toBeNull();
  });

  it('keeps a saved AR preference when the slide has no authored 3D model', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(
      <StudentExperience client={new InMemorySessionClient()} event={validEvent} pack={validPack} preferences={{ ...defaultPreferences, mode: 'ar' }} onPreferencesChange={() => {}} />,
    ));
    expect(container!.querySelector('#mode-tab-ar')?.getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Loading the AR scene');
  });

  // SKIPPED FOR DEMO 2026-09-17: Reading spacing tab hidden (allModes in StudentExperience.tsx). Restore both together.
  it.skip('offers a local reading-spacing mode with an explicit toggle', async () => {
    const harness = renderExperience();
    const tab = Array.from(container!.querySelectorAll('[role="tab"]')).find((item) => item.textContent === 'Reading spacing') as HTMLButtonElement;
    await act(async () => tab.click());
    expect(harness.preferences.mode).toBe('dyslexic');
    expect(container?.textContent).toContain('Reading spacing');
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
    const readTab = container!.querySelector('#mode-tab-structured-text') as HTMLButtonElement;
    await act(async () => readTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(harness.preferences.mode).toBe('focus');
    expect(container?.textContent).toContain('Focus view');
  });

  it('updates local reading controls through their native keyboard-accessible inputs', async () => {
    const harness = renderExperience();
    const font = container!.querySelector('#font-family') as HTMLSelectElement;
    const spacing = container!.querySelector('#line-spacing') as HTMLSelectElement;
    const width = container!.querySelector('#content-width') as HTMLSelectElement;
    const contrast = container!.querySelector('#high-contrast-toggle') as HTMLInputElement;

    await act(async () => {
      font.value = 'serif'; font.dispatchEvent(new Event('change', { bubbles: true }));
      spacing.value = 'spacious'; spacing.dispatchEvent(new Event('change', { bubbles: true }));
      width.value = 'narrow'; width.dispatchEvent(new Event('change', { bubbles: true }));
      contrast.click();
    });

    expect(harness.preferences).toMatchObject({ fontFamily: 'serif', lineSpacing: 'spacious', contentWidth: 'narrow', highContrast: true });
    expect(container!.querySelector('.student-experience')?.className).toContain('high-contrast');
    expect(container!.querySelector('.student-experience')?.className).toContain('font-serif');
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

  it('fails closed when the relay wrapper rejects a live event', async () => {
    const client = new FakeProtocolAwareClient();
    renderExperience(validEvent, arPack, client);
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');

    await act(async () => client.emitInvalidEvent());

    expect(container?.querySelector('.connection-pill')?.textContent).toBe('stale');
    expect(container?.textContent).toContain('A live update could not be verified. Showing the last reviewed state.');
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

  it('shows an instructor caption, labelled as speech rather than a reviewed description', () => {
    const captionEvent = {
      schemaVersion: '1.0' as const, type: 'caption.appended' as const, sessionId: 'demo-session',
      packId: validPack.packId, packVersion: validPack.version,
      assetId: 'cell-slide-03', caption: { text: 'Backside attack on the electrophile.', isFinal: true },
      sequence: 1, sentAt: '2026-09-15T15:00:01Z',
    };
    renderExperience(captionEvent, validPack);
    expect(container?.textContent).toContain('Backside attack on the electrophile.');
    expect(container?.textContent).toContain('not a reviewed description');
  });

  it('hides captions once the student turns the preference off', () => {
    const captionEvent = {
      schemaVersion: '1.0' as const, type: 'caption.appended' as const, sessionId: 'demo-session',
      packId: validPack.packId, packVersion: validPack.version,
      assetId: 'cell-slide-03', caption: { text: 'Backside attack on the electrophile.', isFinal: true },
      sequence: 1, sentAt: '2026-09-15T15:00:01Z',
    };
    const harness = renderExperience(captionEvent, validPack);
    expect(container?.textContent).toContain('Backside attack on the electrophile.');
    const toggle = container!.querySelector('#captions-toggle') as HTMLInputElement;
    act(() => { toggle.click(); });
    expect(harness.preferences.captionsEnabled).toBe(false);
    expect(container?.textContent).not.toContain('Backside attack on the electrophile.');
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
    expect(container!.textContent).toContain('mitochondrion: The mitochondrion releases usable energy for the cell.');

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

  it('the pane stays up and stays subscribed while the instructor changes slides', async () => {
    const subscriber = new FakeSubscriber();
    const { join, deliver, pane } = mount(new VideoSessionClient(), subscriber, validEvent);
    await join();
    deliver(streamStarted);
    const media = { id: 'fake-media-stream' } as unknown as MediaStream;
    act(() => subscriber.deliver(media));

    deliver({ ...validEvent, type: 'asset.changed', assetId: 'cell-slide-03', regionId: undefined, pointer: undefined, sequence: 3 } as unknown as LiveEvent);
    deliver({ ...validEvent, sequence: 4 });

    expect(pane()).not.toBeNull();
    expect((pane()!.querySelector('video') as unknown as { srcObject: unknown }).srcObject).toBe(media);
    expect(subscriber.calls).toEqual(['subscribe:subscribe-token-1']);
    expect(container!.textContent).toContain('mitochondrion: The mitochondrion releases usable energy for the cell.');
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
    act(() => subscriber.fail('The live video could not connect. The lesson text still works.'));
    expect(pane()!.textContent).toContain('The live video could not connect.');
    expect(container!.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(container!.textContent).toContain('mitochondrion: The mitochondrion releases usable energy for the cell.');
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
