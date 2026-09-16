// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, vi } from 'vitest';
import axe from 'axe-core';
import { AccessPackSchema, InMemorySessionClient, type LiveEvent, type RoleCapability } from '../shared/contracts';
import type { AiClient } from '../shared/aiClient';
import type { CaptionDeps } from './SpeechCaptions';
import type { WhisperStreamOptions } from '../sources/voice/whisperStream';
import { InstructorPanel } from './index';
import { FakeCaptureHost, FakeClock, FakeScheduler, fixedIds, loadDemoFrame, loadSlideFrame, solidFrame, testPack } from '../sources/screen/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pack = AccessPackSchema.parse(testPack);
let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(host = new FakeCaptureHost()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const client = new InMemorySessionClient();
  const scheduler = new FakeScheduler();
  const events: LiveEvent[] = [];
  client.subscribe(e => events.push(e));
  root = createRoot(container);
  act(() => root!.render(
    <InstructorPanel client={client} pack={pack} host={host} scheduler={scheduler} clock={new FakeClock()} ids={fixedIds('JOIN42')} />,
  ));
  return { host, client, scheduler, events, stream: host.stream };
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
const select = (id: string, value: string) => act(() => {
  const el = container!.querySelector<HTMLSelectElement>(`#${id}`)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
});

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

  it('correcting to an asset and region emits asset.changed then region.changed and names the region', async () => {
    const { events } = render();
    await click('Start');
    select('correct-asset', 'slide-04');
    select('correct-region', 'nucleolus');
    await click('Apply correction');
    expect(events.slice(1)).toMatchObject([
      { type: 'asset.changed', assetId: 'slide-04' },
      { type: 'region.changed', assetId: 'slide-04', regionId: 'nucleolus' },
    ]);
    expect(status()).toContain('The nucleus');
    expect(status()).toContain('nucleolus');
  });

  it('indicating a region on the current asset emits its reviewed center pointer', async () => {
    const { stream, scheduler, events } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-05'));
    act(() => scheduler.tick(1));
    select('indicate-region', 'reticulum');
    await click('Indicate region');
    const region = pack.assets.find((asset) => asset.assetId === 'slide-05')!.regions.find((candidate) => candidate.regionId === 'reticulum')!;
    expect(events.at(-1)).toMatchObject({
      type: 'region.changed', assetId: 'slide-05', regionId: 'reticulum',
      pointer: { x: region.bounds.x + region.bounds.width / 2, y: region.bounds.y + region.bounds.height / 2 },
    });
    expect(status()).toContain('reticulum');
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
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const label = control.id ? container!.querySelector(`label[for="${control.id}"]`) : null;
      const named = (label?.textContent?.trim() || control.getAttribute('aria-label') || '').length > 0;
      expect(named, `${control.tagName}#${control.id} has no label`).toBe(true);
    }
  });

  it('unmounting while sharing ends the session rather than dropping it silently', async () => {
    const { events, stream } = render();
    await click('Start');
    expect(events.map(e => e.type)).toEqual(['session.started']);
    await act(async () => { root!.unmount(); root = null; });
    expect(events.map(e => e.type)).toEqual(['session.started', 'capture.stopped', 'session.ended']);
    expect(stream.stopped).toBe(true);
  });

  it('unmounting before Start emits nothing', async () => {
    const { events } = render();
    await act(async () => { root!.unmount(); root = null; });
    expect(events).toEqual([]);
  });

  it('sends a caption scoped to the current asset and clears the input', async () => {
    const { stream, scheduler, events } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-02'));
    act(() => scheduler.tick(1));
    const input = container!.querySelector<HTMLInputElement>('#caption-text')!;
    // React tracks the native value setter to detect a real change; assigning
    // `.value` directly leaves its tracker believing nothing happened.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeValueSetter.call(input, 'The mitochondrion releases usable energy.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(events.at(-1)).toMatchObject({
      type: 'caption.appended', assetId: 'slide-02',
      caption: { text: 'The mitochondrion releases usable energy.', isFinal: true },
    });
    expect(input.value).toBe('');
  });

  it('reports an empty caption without emitting', async () => {
    const { stream, scheduler, events } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-02'));
    act(() => scheduler.tick(1));
    const before = events.length;
    const form = container!.querySelector('#caption-text')!.closest('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container!.querySelector('[role="alert"]')?.textContent).toMatch(/caption/i);
    expect(events.length).toBe(before);
  });

  it('has no automatically detectable accessibility violations while sharing with a matched frame', async () => {
    const { stream, scheduler } = render();
    await click('Start');
    stream.enqueue(loadDemoFrame('slide-02'));
    act(() => scheduler.tick(1));
    const result = await axe.run(container!, {
      rules: { region: { enabled: false }, 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
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
      let whisper: WhisperStreamOptions | null = null;
      let clock = 0;
      const ai = {
        transcribeUrl: vi.fn(async () => ({ url: 'wss://transcribe.example', sampleRate: 16000, expiresIn: 300 })),
        transcribeClip: vi.fn(async () => 'Now look at the nucleus.'),
      } as unknown as AiClient;
      const deps: CaptionDeps = {
        getMicrophone: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
        startStream: vi.fn(async options => { onPiece = options.onPiece; return { stop: vi.fn() }; }),
        startWhisper: vi.fn(async options => { whisper = options; onPiece = options.onPiece; return { stop: vi.fn() }; }),
        now: () => clock,
      };
      return {
        ai, deps, track,
        whisper: () => whisper!,
        say: (text: string, isFinal: boolean) => act(() => onPiece!({ text, isFinal })),
        advance: (ms: number) => { clock += ms; },
      };
    }

    const chooseTranscribe = () => act(() => { container!.querySelector<HTMLInputElement>('#caption-engine-transcribe')!.click(); });

    it('is hidden before a session opens, and names where the audio goes before anything is captured', async () => {
      const f = fakes();
      renderWithCaptions(f.ai, f.deps);
      expect(container!.textContent).not.toContain('Live captions');
      await click('Start');
      expect(container!.textContent).toContain('to Whisper running on Amazon SageMaker');
      chooseTranscribe();
      expect(container!.textContent).toContain('sends your microphone audio to Amazon Transcribe');
      expect(f.deps.getMicrophone).not.toHaveBeenCalled();
    });

    it('captions through Whisper by default: each clip goes to the gateway as the instructor, and a named region moves students', async () => {
      const f = fakes();
      const { events, scheduler, stream } = renderWithCaptions(f.ai, f.deps);
      await click('Start');
      await act(async () => { stream.enqueue(loadDemoFrame('slide-04')); scheduler.tick(1); });
      await click('Start captions');
      expect(f.deps.startWhisper).toHaveBeenCalledTimes(1);
      expect(f.deps.startStream).not.toHaveBeenCalled();
      expect(f.ai.transcribeUrl).not.toHaveBeenCalled();
      expect(container!.querySelector<HTMLFieldSetElement>('.caption-engine')!.disabled).toBe(true);

      const clip = new Uint8Array([82, 73, 70, 70]);
      await expect(f.whisper().transcribe(clip)).resolves.toBe('Now look at the nucleus.');
      expect(f.ai.transcribeClip).toHaveBeenCalledWith(expect.objectContaining({ role: 'instructor', token: 'signed-by-relay' }), clip);

      f.say('Now look at the nucleus.', true);
      expect(events.filter(e => e.type === 'caption.appended')).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: 'region.changed', assetId: 'slide-04', regionId: 'nucleus' });
    });

    it('says to choose Amazon Transcribe when Whisper is not running, and offers Start again', async () => {
      const f = fakes();
      renderWithCaptions(f.ai, f.deps);
      await click('Start');
      await click('Start captions');
      act(() => {
        f.whisper().onError('Whisper is not running on AWS right now. Choose Amazon Transcribe instead.');
        f.whisper().onClosed();
      });
      expect(container!.textContent).toContain('Whisper is not running on AWS right now');
      expect(button('Start captions')).toBeTruthy();
      expect(container!.querySelector<HTMLFieldSetElement>('.caption-engine')!.disabled).toBe(false);
    });

    it('opens the microphone only from Start captions, sends caption text, and moves students to a named region', async () => {
      const f = fakes();
      const { events, scheduler, stream } = renderWithCaptions(f.ai, f.deps);
      await click('Start');
      await act(async () => { stream.enqueue(loadDemoFrame('slide-04')); scheduler.tick(1); });
      chooseTranscribe();
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
      chooseTranscribe();
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
      expect(f.deps.startWhisper).not.toHaveBeenCalled();
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

describe('InstructorPanel: live captions', () => {
  it('offers live captions only while sharing, and publishes what the instructor says', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const events: LiveEvent[] = [];
    client.subscribe(e => events.push(e));
    let speak: ((s: Float32Array) => void) | null = null;
    const microphone = { open: async (onSamples: (s: Float32Array) => void) => { speak = onSamples; return { stop: () => { speak = null; } }; } };
    const transcribe = async () => [{ text: 'Welcome to cell biology.', isFinal: true, lang: 'en-US' }];
    root = createRoot(container);
    act(() => root!.render(
      <InstructorPanel client={client} pack={pack} host={new FakeCaptureHost()} scheduler={new FakeScheduler()} clock={new FakeClock()} ids={fixedIds('JOIN42')} microphone={microphone} transcribe={transcribe} />,
    ));
    expect(container.textContent).not.toContain('Start live captions');

    await click('Start');
    await click('Start live captions');
    expect(container.textContent).toContain('Captioning');

    await act(async () => {
      speak!(new Float32Array(4800));
      speak!(Float32Array.from({ length: 16000 }, (_, i) => 0.3 * Math.sin(i / 5)));
      speak!(new Float32Array(16000));
      await new Promise(r => setTimeout(r, 0));
    });
    const caption = events.find(e => e.type === 'caption.appended');
    expect(caption).toMatchObject({ sessionId: 'JOIN42', caption: { text: 'Welcome to cell biology.' } });
    expect(container.textContent).toContain('Last caption sent');

    await click('Stop');
    expect(container.textContent).not.toContain('Stop live captions');
    expect(speak).toBeNull();
  });
});
