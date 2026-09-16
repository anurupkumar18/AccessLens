// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AccessPackSchema, InMemorySessionClient, type LiveEvent, type RoleCapability } from '../shared/contracts';
import type { AiClient } from '../shared/aiClient';
import type { CaptionDeps } from './LiveCaptions';
import { InstructorPanel } from './index';
import { FakeCaptureHost, FakeClock, FakeScheduler, fixedIds, loadDemoFrame, loadSlideFrame, solidFrame, testPack } from '../sources/screen/fixtures';
import type { PresentingSlide, SlidesSource } from '../sources/slides';
import { FakePublisher } from '../sources/stream/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pack = AccessPackSchema.parse(testPack);
const arPack = AccessPackSchema.parse({
  ...testPack,
  assets: testPack.assets.map((asset) => asset.assetId === 'slide-03' ? {
    ...asset,
    arScene: {
      modelUri: 'models/cell.glb',
      defaultCamera: 'default',
      hotspots: [{ hotspotId: 'slide-03:mitochondrion', regionId: 'mitochondrion', nodeName: 'mitochondrion', label: 'Mitochondrion' }],
    },
  } : asset),
});
let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(host = new FakeCaptureHost(), slides?: SlidesSource, selectedPack = pack) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const client = new InMemorySessionClient();
  const scheduler = new FakeScheduler();
  const events: LiveEvent[] = [];
  client.subscribe(e => events.push(e));
  const publisher = new FakePublisher();
  root = createRoot(container);
  act(() => root!.render(
    <InstructorPanel client={client} pack={selectedPack} host={host} scheduler={scheduler} clock={new FakeClock()} ids={fixedIds('JOIN42')} slides={slides} publisher={publisher} />,
  ));
  return { host, client, scheduler, events, publisher, stream: host.stream };
}

/** A Google Slides deck presenting in this browser, driven by the test. */
function fakeSlides(order: string[]) {
  let listener: ((slide: PresentingSlide | null) => void) | null = null;
  const source: SlidesSource = {
    watcher: { watch(l) { listener = l; return () => { listener = null; }; } },
    slideOrder: vi.fn(async () => order),
  };
  const present = (slide: PresentingSlide | null) => act(async () => { listener!(slide); await Promise.resolve(); await Promise.resolve(); });
  return { source, present, watching: () => listener !== null };
}

/** Capture-control buttons only (Start/Pause/Resume/Stop/End Session), not form submit buttons. */
const buttons = () => Array.from(container!.querySelectorAll('[aria-label="Capture controls"] button')).map(b => b.textContent?.trim());
const button = (name: string) => {
  const found = Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}; have ${buttons().join(', ')}`);
  return found;
};
const click = async (name: string) => act(async () => { button(name).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const status = () => container!.querySelector('[role="status"]')!.textContent ?? '';

describe('InstructorPanel', () => {
  it('before Start, the host has no calls and only Start is offered', () => {
    const { host } = render();
    expect(host.calls).toEqual([]);
    expect(buttons()).toEqual(['Start']);
    expect(status()).toMatch(/not sharing/i);
    expect(container!.textContent).not.toContain('Join code');
  });

  it('clicking Start calls the host once, reports sharing, shows the join code, and emits session.started', async () => {
    const { host, events } = render();
    await click('Start');
    expect(host.calls).toEqual(['requestStream']);
    expect(status()).toMatch(/sharing/i);
    expect(container!.textContent).toContain('JOIN42');
    expect(events.map(e => e.type)).toEqual(['session.started']);
    expect(buttons()).toEqual(['Pause', 'Stop', 'End Session']);
  });

  it('a denied chooser explains that sharing is required and offers Start again', async () => {
    const { events } = render(FakeCaptureHost.denied());
    await click('Start');
    expect(status()).toMatch(/sharing is required/i);
    expect(buttons()).toEqual(['Start']);
    expect(events).toEqual([]);
  });

  it('names the matched asset title once the sampler recognises a demo-condition frame', async () => {
    const { stream, scheduler } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-03'));
    act(() => scheduler.tick(1));
    expect(status()).toContain('The mitochondrion');
  });

  it('reads Unmatched after three unknown frames', async () => {
    const { stream, scheduler, events } = render();
    await click('Start');
    stream.enqueue(solidFrame(1440, 900, 40), solidFrame(1440, 900, 40), solidFrame(1440, 900, 40));
    act(() => scheduler.tick(3));
    expect(status()).toContain('Unmatched');
    expect(events.map(e => e.type)).toEqual(['session.started', 'source.unmatched']);
  });

  it('Follow Google Slides opens the session first, then follows the deck slide by slide once it presents', async () => {
    const host = new FakeCaptureHost();
    const deck = fakeSlides(['p', 'g1', 'g2']);
    const { events } = render(host, deck.source);
    expect(buttons()).toEqual(['Follow Google Slides', 'Share a window instead']);

    await click('Follow Google Slides');
    expect(host.calls).toEqual([]);
    expect(events.map(e => e.type)).toEqual(['session.started']);
    expect(container!.textContent).toContain('JOIN42');
    expect(status()).toContain('Waiting for you to present');
    expect(deck.watching()).toBe(true);

    await deck.present({ deckId: 'deck', slideObjectId: 'g1' });
    expect(events.at(-1)).toMatchObject({ type: 'asset.changed', assetId: pack.assets[1].assetId });
    expect(status()).toContain(pack.assets[1].title);

    await deck.present({ deckId: 'deck', slideObjectId: 'g1' });
    expect(events).toHaveLength(2);
    await deck.present({ deckId: 'deck', slideObjectId: 'p' });
    expect(events.at(-1)).toMatchObject({ type: 'asset.changed', assetId: pack.assets[0].assetId });

    await deck.present(null);
    expect(status()).toContain('presentation ended');
    expect(events).toHaveLength(3);

    await click('Stop');
    expect(events.at(-1)?.type).toBe('capture.stopped');
    expect(deck.watching()).toBe(false);
    expect(deck.source.slideOrder).toHaveBeenCalledTimes(3);
  });

  it('offers Find AR for a matched slide with a reviewed scene', async () => {
    const { stream, scheduler, events } = render(new FakeCaptureHost(), undefined, arPack);
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-03'));
    act(() => scheduler.tick(1));
    await click('Find AR for this slide');
    expect(events.at(-1)).toMatchObject({
      type: 'region.changed',
      assetId: 'slide-03',
      arState: { action: 'focus' },
    });
  });

  it('Pause, Resume, Stop, and End Session each emit their event and change the button set', async () => {
    const { events, stream } = render();
    await click('Start');
    await click('Pause');
    expect(events.at(-1)?.type).toBe('capture.paused');
    expect(buttons()).toEqual(['Resume', 'Stop', 'End Session']);
    expect(status()).toMatch(/paused/i);
    await click('Resume');
    expect(events.at(-1)?.type).toBe('capture.resumed');
    expect(buttons()).toEqual(['Pause', 'Stop', 'End Session']);
    await click('Stop');
    expect(events.at(-1)?.type).toBe('capture.stopped');
    expect(stream.stopped).toBe(true);
    expect(buttons()).toEqual(['Start', 'End Session']);
    expect(container!.textContent).toContain('JOIN42');
    await click('End Session');
    expect(events.map(e => e.type)).toEqual(['session.started', 'capture.paused', 'capture.resumed', 'capture.stopped', 'session.ended']);
    expect(buttons()).toEqual([]);
    expect(status()).toMatch(/session ended/i);
  });

  it('the browser Stop sharing bar returns the panel to the stopped state', async () => {
    const { stream, events } = render();
    await click('Start');
    act(() => stream.endFromBrowser());
    expect(events.map(e => e.type)).toEqual(['session.started', 'capture.stopped']);
    expect(buttons()).toEqual(['Start', 'End Session']);
  });

  it('every button and form control has an accessible name', async () => {
    const { stream, scheduler } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-02'));
    act(() => scheduler.tick(1));
    for (const b of Array.from(container!.querySelectorAll('button'))) {
      expect((b.textContent?.trim() || b.getAttribute('aria-label') || '').length).toBeGreaterThan(0);
    }
    const controls = Array.from(container!.querySelectorAll<HTMLElement>('select, input, textarea'));
    for (const control of controls) {
      const label = control.id ? container!.querySelector(`label[for="${control.id}"]`) : null;
      const named = (label?.textContent?.trim() || control.getAttribute('aria-label') || '').length > 0;
      expect(named, `${control.tagName}#${control.id} has no label`).toBe(true);
    }
  });

  it('says what is being shared and, when a window or screen shows no reviewed slide, how to fix it', async () => {
    const host = new FakeCaptureHost();
    host.stream.surface = 'window';
    const { stream, scheduler } = render(host);
    await click('Start');
    expect(status()).toContain('Sharing a window.');
    await act(async () => { stream.enqueue(solidFrame(1440, 900, 40), solidFrame(1440, 900, 40), solidFrame(1440, 900, 40)); scheduler.tick(3); });
    expect(status()).toContain('Unmatched');
    expect(status()).toMatch(/make the slide bigger/i);
  });

  describe('live captions', () => {
    /** A client whose capabilities look relay-signed, so the AI features switch on. */
    class SignedClient extends InMemorySessionClient {
      override async create(sessionId: string): Promise<RoleCapability> {
        return { ...(await super.create(sessionId)), token: 'signed-by-relay' };
      }
    }

    function renderWithCaptions(ai: AiClient | null, deps: CaptionDeps) {
      container = document.createElement('div');
      document.body.appendChild(container);
      const client = new SignedClient();
      const scheduler = new FakeScheduler();
      const host = new FakeCaptureHost();
      const events: LiveEvent[] = [];
      client.subscribe(e => events.push(e));
      root = createRoot(container);
      act(() => root!.render(
        <InstructorPanel client={client} pack={pack} host={host} scheduler={scheduler} clock={new FakeClock()} ids={fixedIds('JOIN42')} ai={ai} captionDeps={deps} />,
      ));
      return { events, scheduler, stream: host.stream };
    }

    function fakes() {
      const track = { stop: vi.fn() };
      let onPiece: ((piece: { text: string; isFinal: boolean }) => void) | null = null;
      let clock = 0;
      const ai = { transcribeUrl: vi.fn(async () => ({ url: 'wss://transcribe.example', sampleRate: 16000, expiresIn: 300 })) } as unknown as AiClient;
      const deps: CaptionDeps = {
        getMicrophone: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
        startStream: vi.fn(async options => { onPiece = options.onPiece; return { stop: vi.fn() }; }),
        now: () => clock,
      };
      return { ai, deps, track, say: (text: string, isFinal: boolean) => act(() => onPiece!({ text, isFinal })), advance: (ms: number) => { clock += ms; } };
    }

    it('is hidden before a session opens, and explains the AWS notice before anything is captured', async () => {
      const f = fakes();
      renderWithCaptions(f.ai, f.deps);
      expect(container!.textContent).not.toContain('Live captions');
      await click('Start');
      expect(container!.textContent).toContain('sends your microphone audio to Amazon Transcribe');
      expect(f.deps.getMicrophone).not.toHaveBeenCalled();
    });

    it('opens the microphone only from Start captions, sends caption text, and moves students to a named region', async () => {
      const f = fakes();
      const { events, scheduler, stream } = renderWithCaptions(f.ai, f.deps);
      await click('Start');
      await act(async () => { stream.enqueue(loadDemoFrame('slide-04')); scheduler.tick(1); });
      await click('Start captions');
      expect(f.deps.getMicrophone).toHaveBeenCalledTimes(1);
      expect(f.ai.transcribeUrl).toHaveBeenCalledWith(expect.objectContaining({ role: 'instructor', token: 'signed-by-relay' }));

      f.say('now look at', false);
      f.say('now look at the', false);
      f.say('Now look at the nucleus.', true);
      const captions = events.filter(e => e.type === 'caption.appended');
      expect(captions.map(e => (e as { caption: { isFinal: boolean } }).caption.isFinal)).toEqual([false, true]);
      expect(events.at(-1)).toMatchObject({ type: 'region.changed', assetId: 'slide-04', regionId: 'nucleus' });
      expect(button('Stop captions')).toBeTruthy();
    });

    it('does not move students when the instructor turns voice following off', async () => {
      const f = fakes();
      const { events, scheduler, stream } = renderWithCaptions(f.ai, f.deps);
      await click('Start');
      await act(async () => { stream.enqueue(loadDemoFrame('slide-04')); scheduler.tick(1); });
      await click('Start captions');
      act(() => { container!.querySelector<HTMLInputElement>('#caption-follow')!.click(); });
      f.say('The nucleolus is inside.', true);
      expect(events.some(e => e.type === 'region.changed')).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: 'caption.appended' });
    });

    it('explains how to allow the microphone when permission is refused', async () => {
      const f = fakes();
      f.deps.getMicrophone = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); });
      renderWithCaptions(f.ai, f.deps);
      await click('Start');
      await click('Start captions');
      expect(container!.textContent).toMatch(/Open in a full tab/);
      expect(f.ai.transcribeUrl).not.toHaveBeenCalled();
    });

    it('says captions need the AWS session when no AI endpoint is configured', async () => {
      const f = fakes();
      renderWithCaptions(null, f.deps);
      await click('Start');
      expect(container!.textContent).toContain('Live captions need the AWS session');
      expect(() => button('Start captions')).toThrow();
    });
  });
});

// ---- Live video controls ------------------------------------------------------

/** The relay hands the instructor a publish token beside the capability; the in-memory client does not, so this one does. */
class VideoSessionClient extends InMemorySessionClient {
  override async create(sessionId: string) {
    return { ...(await super.create(sessionId)), streamToken: 'publish-token-1' };
  }
}

function renderWithVideo(surface: 'browser' | 'window' | 'monitor' = 'browser') {
  container = document.createElement('div');
  document.body.appendChild(container);
  const host = new FakeCaptureHost();
  host.stream.surface = surface;
  const client = new VideoSessionClient();
  const publisher = new FakePublisher();
  const events: LiveEvent[] = [];
  client.subscribe(e => events.push(e));
  root = createRoot(container);
  act(() => root!.render(
    <InstructorPanel client={client} pack={pack} host={host} scheduler={new FakeScheduler()} clock={new FakeClock()} ids={fixedIds('JOIN42')} publisher={publisher} />,
  ));
  return { host, publisher, events, stream: host.stream };
}

const findButton = (label: string) => Array.from(container!.querySelectorAll('button')).find(b => b.textContent?.trim() === label);

describe('InstructorPanel: live video controls', () => {
  it('offers Stream this window only once sharing, and it is the only path to publishing', async () => {
    const { publisher } = renderWithVideo('browser');
    expect(findButton('Stream this window')).toBeUndefined();
    await click('Start');
    expect(findButton('Stream this window')).toBeDefined();
    expect(publisher.calls).toEqual([]);
  });

  it('shows what is streaming and a Stop streaming control while on, then returns to the offer', async () => {
    const { publisher, events } = renderWithVideo('browser');
    await click('Start');
    await click('Stream this window');
    expect(publisher.calls).toEqual(['publish']);
    expect(container!.textContent).toContain('Streaming a tab');
    expect(container!.textContent).toContain('never your whole screen');
    expect(findButton('Stop streaming')).toBeDefined();
    expect(events.map(e => e.type)).toEqual(['session.started', 'stream.started']);

    await click('Stop streaming');
    expect(publisher.calls).toEqual(['publish', 'stop']);
    expect(container!.textContent).not.toContain('Streaming a tab');
    expect(findButton('Stream this window')).toBeDefined();
    // Sharing itself is untouched.
    expect(findButton('Stop')).toBeDefined();
    expect(events.map(e => e.type)).toEqual(['session.started', 'stream.started', 'stream.stopped']);
  });

  it('names a window when a window is streamed', async () => {
    renderWithVideo('window');
    await click('Start');
    await click('Stream this window');
    expect(container!.textContent).toContain('Streaming a window');
  });

  it('refuses a whole screen in words, publishes nothing, and keeps sharing', async () => {
    const { publisher } = renderWithVideo('monitor');
    await click('Start');
    await click('Stream this window');
    expect(publisher.calls).toEqual([]);
    expect(container!.textContent).toContain('A whole screen is never streamed to students');
    expect(findButton('Stop')).toBeDefined();
    expect(findButton('Stream this window')).toBeDefined();
  });

  it('says video is unavailable when the session has no stage token', async () => {
    const { publisher } = render();
    await click('Start');
    await click('Stream this window');
    expect(publisher.calls).toEqual([]);
    expect(container!.textContent).toContain('Live video is unavailable for this session');
    expect((findButton('Stream this window') as HTMLButtonElement).disabled).toBe(true);
  });
});
