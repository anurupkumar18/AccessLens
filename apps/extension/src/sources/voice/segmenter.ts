/**
 * Cuts a live 16 kHz PCM16 microphone stream into spoken clips at pauses.
 *
 * Whisper transcribes whole clips, not a stream, so captions need clips that
 * end where the instructor pauses: cutting mid-word garbles both halves. This
 * is a plain energy gate over 30 ms frames. It also keeps silence and short
 * noises (a cough, a click) from ever being sent, which matters twice over:
 * each clip is a GPU call, and Whisper invents text for silence.
 */
export interface SegmenterOptions {
  sampleRate: number;
  /** Frame RMS, in 16-bit sample units, that counts as speech (500 is about -36 dBFS). */
  speechLevel?: number;
  /** Quiet this long after speech ends the clip. */
  endSilenceMs?: number;
  /** A clip with less speech than this is dropped. */
  minSpeechMs?: number;
  /** Unbroken speech is cut here so captions keep coming during a long sentence. */
  maxClipMs?: number;
  /** Audio kept from just before speech is detected, so the first syllable is not lost. */
  preRollMs?: number;
}

const FRAME_MS = 30;

export class SpeechSegmenter {
  private readonly frameSamples: number;
  private readonly speechLevel: number;
  private readonly endSilenceMs: number;
  private readonly minSpeechMs: number;
  private readonly maxClipMs: number;
  private readonly preRollFrames: number;
  private remainder = new Int16Array(0);
  private preRoll: Int16Array[] = [];
  private clip: Int16Array[] | null = null;
  private speechMs = 0;
  private silenceMs = 0;

  constructor(options: SegmenterOptions) {
    this.frameSamples = Math.round((options.sampleRate * FRAME_MS) / 1000);
    this.speechLevel = options.speechLevel ?? 500;
    this.endSilenceMs = options.endSilenceMs ?? 600;
    this.minSpeechMs = options.minSpeechMs ?? 240;
    this.maxClipMs = options.maxClipMs ?? 8000;
    this.preRollFrames = Math.round((options.preRollMs ?? 240) / FRAME_MS);
  }

  /** Adds microphone audio; returns any clips (PCM16 bytes) that ended within it. */
  push(pcm16: Uint8Array): Uint8Array[] {
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    const samples = new Int16Array(this.remainder.length + Math.floor(pcm16.byteLength / 2));
    samples.set(this.remainder);
    for (let i = this.remainder.length; i < samples.length; i++) samples[i] = view.getInt16((i - this.remainder.length) * 2, true);

    const clips: Uint8Array[] = [];
    let offset = 0;
    for (; offset + this.frameSamples <= samples.length; offset += this.frameSamples) {
      const clip = this.frame(samples.slice(offset, offset + this.frameSamples));
      if (clip) clips.push(clip);
    }
    this.remainder = samples.slice(offset);
    return clips;
  }

  /** Ends the stream: the clip in progress, if it holds enough speech. */
  flush(): Uint8Array | null {
    return this.finish();
  }

  private frame(frame: Int16Array): Uint8Array | null {
    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    const speech = Math.sqrt(sum / frame.length) >= this.speechLevel;

    if (!this.clip) {
      if (!speech) {
        this.preRoll.push(frame);
        if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
        return null;
      }
      this.clip = [...this.preRoll, frame];
      this.preRoll = [];
      this.speechMs = FRAME_MS;
      this.silenceMs = 0;
      return null;
    }

    this.clip.push(frame);
    if (speech) {
      this.speechMs += FRAME_MS;
      this.silenceMs = 0;
    } else {
      this.silenceMs += FRAME_MS;
    }
    if (this.silenceMs >= this.endSilenceMs) return this.finish();
    if (this.clip.length * FRAME_MS >= this.maxClipMs) {
      const clip = this.finish();
      this.clip = [];
      return clip;
    }
    return null;
  }

  private finish(): Uint8Array | null {
    const frames = this.clip;
    const enough = this.speechMs >= this.minSpeechMs;
    this.clip = null;
    this.speechMs = 0;
    this.silenceMs = 0;
    if (!frames || !enough) return null;
    const bytes = new Uint8Array(frames.reduce((total, frame) => total + frame.length * 2, 0));
    const view = new DataView(bytes.buffer);
    let offset = 0;
    for (const frame of frames) for (const sample of frame) { view.setInt16(offset, sample, true); offset += 2; }
    return bytes;
  }
}
