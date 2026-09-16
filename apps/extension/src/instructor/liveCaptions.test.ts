import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailable } from '../accessibility/endpoints';
import { SAMPLE_RATE_HZ } from '../sources/audio/segmenter';
import type { MicrophoneHost } from '../sources/audio/microphone';
import { createLiveCaptions, type Caption, type Transcriber } from './liveCaptions';

const ms = (n: number) => Math.round((SAMPLE_RATE_HZ * n) / 1000);
const silence = (d: number) => new Float32Array(ms(d));
const speech = (d: number) => Float32Array.from({ length: ms(d) }, (_, i) => 0.3 * Math.sin(i / 5));

class FakeMicrophone implements MicrophoneHost {
  listener: ((s: Float32Array) => void) | null = null;
  stopped = 0;
  rejectWith: Error | null = null;
  pending: ((value: void) => void) | null = null;
  async open(onSamples: (s: Float32Array) => void) {
    if (this.rejectWith) throw this.rejectWith;
    this.listener = onSamples;
    return { stop: () => { this.stopped += 1; this.listener = null; } };
  }
  /** One spoken sentence followed by a pause. */
  say(duration = 1000) {
    this.listener?.(silence(300));
    this.listener?.(speech(duration));
    this.listener?.(silence(900));
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(transcribe: Transcriber, sessionId: string | null = 'JOIN42') {
  const microphone = new FakeMicrophone();
  const published: Caption[] = [];
  const captions = createLiveCaptions({ publish: c => published.push(c), sessionId: () => sessionId, lang: () => 'en-US', microphone, transcribe });
  return { captions, microphone, published };
}

describe('live captions', () => {
  it('transcribes each utterance for the open session and publishes only final captions', async () => {
    const transcribe = vi.fn<Transcriber>(async () => [
      { text: 'The mitochondria', isFinal: false, lang: 'en-US' },
      { text: 'The mitochondria make ATP.', isFinal: true, lang: 'en-US' },
    ]);
    const { captions, microphone, published } = setup(transcribe);
    await captions.start();
    expect(captions.getState().phase).toBe('listening');

    microphone.say();
    await settle();
    expect(transcribe).toHaveBeenCalledWith({ sessionId: 'JOIN42', audio: expect.any(String), lang: 'en-US' });
    expect(published).toEqual([{ text: 'The mitochondria make ATP.', isFinal: true, lang: 'en-US' }]);
    expect(captions.getState().lastCaption).toBe('The mitochondria make ATP.');
  });

  it('publishes in speaking order even when an earlier transcription is slower', async () => {
    let call = 0;
    const transcribe: Transcriber = async () => {
      const n = ++call;
      await new Promise(r => setTimeout(r, n === 1 ? 30 : 1));
      return [{ text: `sentence ${n}`, isFinal: true }];
    };
    const { captions, microphone, published } = setup(transcribe);
    await captions.start();
    microphone.say();
    microphone.say();
    await new Promise(r => setTimeout(r, 60));
    expect(published.map(c => c.text)).toEqual(['sentence 1', 'sentence 2']);
  });

  it('keeps captioning after one failed request, and says a caption was missed', async () => {
    let call = 0;
    const transcribe: Transcriber = async () => {
      if (++call === 1) throw new ServiceUnavailable('Could not reach the service.');
      return [{ text: 'Second sentence.', isFinal: true }];
    };
    const { captions, microphone, published } = setup(transcribe);
    await captions.start();
    microphone.say();
    await settle();
    expect(captions.getState()).toMatchObject({ phase: 'listening', message: expect.stringContaining('missed') });
    microphone.say();
    await settle();
    expect(published.map(c => c.text)).toEqual(['Second sentence.']);
  });

  it('stops and explains when publishing fails because the session is gone', async () => {
    const microphone = new FakeMicrophone();
    const captions = createLiveCaptions({
      publish: () => { throw new Error('Cannot caption while idle'); },
      sessionId: () => 'JOIN42', lang: () => 'en-US', microphone,
      transcribe: async () => [{ text: 'Hello.', isFinal: true }],
    });
    await captions.start();
    microphone.say();
    await settle();
    expect(captions.getState().phase).toBe('error');
    expect(microphone.stopped).toBe(1);
  });

  it('stop turns the microphone off but still captions the last sentence', async () => {
    const transcribe = vi.fn<Transcriber>(async () => [{ text: 'Last words.', isFinal: true }]);
    const { captions, microphone, published } = setup(transcribe);
    await captions.start();
    microphone.listener?.(silence(300));
    microphone.listener?.(speech(1000));
    captions.stop();
    await settle();
    expect(microphone.stopped).toBe(1);
    expect(captions.getState().phase).toBe('off');
    expect(published.map(c => c.text)).toEqual(['Last words.']);
  });

  it('refuses to start without a session, and explains a blocked microphone', async () => {
    const noSession = setup(async () => [], null);
    await noSession.captions.start();
    expect(noSession.captions.getState()).toMatchObject({ phase: 'error', message: expect.stringContaining('Start sharing first') });

    const blocked = setup(async () => []);
    blocked.microphone.rejectWith = new DOMException('denied', 'NotAllowedError');
    await blocked.captions.start();
    expect(blocked.captions.getState()).toMatchObject({ phase: 'error', message: expect.stringContaining('blocked') });
  });

  it('a Stop during the permission prompt wins over the late grant', async () => {
    let grant: (() => void) | null = null;
    const stopped = { count: 0 };
    const microphone: MicrophoneHost = {
      open: () => new Promise(resolve => { grant = () => resolve({ stop: () => { stopped.count += 1; } }); }),
    };
    const captions = createLiveCaptions({ publish: () => undefined, sessionId: () => 'JOIN42', lang: () => 'en-US', microphone, transcribe: async () => [] });
    const starting = captions.start();
    expect(captions.getState().phase).toBe('starting');
    captions.stop();
    grant!();
    await starting;
    expect(captions.getState().phase).toBe('off');
    expect(stopped.count).toBe(1);
  });
});
