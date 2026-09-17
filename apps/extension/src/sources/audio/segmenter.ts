/**
 * Microphone samples -> utterances worth captioning.
 *
 * The captions service transcribes one buffered chunk per request, so the
 * cut points decide both latency and accuracy: cutting mid-word makes
 * Transcribe mishear both halves, and waiting for long silences leaves a deaf
 * student reading a sentence the class has already moved past. So an
 * utterance ends at the first real pause after speech, or -- for an instructor
 * who never pauses -- at the quietest moment shortly before a length cap, with
 * the rest carried into the next utterance.
 *
 * Pure: no audio APIs, so the rules are testable with synthetic samples.
 */

export const SAMPLE_RATE_HZ = 16000;

export interface SegmenterOptions {
  sampleRate?: number;
  /** Silence this long after speech ends the utterance. */
  pauseMs?: number;
  /** Hard cap, so captions keep flowing through a long unbroken explanation. */
  maxUtteranceMs?: number;
  /** Speech shorter than this is a cough or a desk knock, not a caption. */
  minSpeechMs?: number;
  /** Audio kept from before speech was detected, so first syllables survive. */
  prerollMs?: number;
}

const WINDOW_MS = 20;
/** Absolute floor for "speech", for a very quiet room. */
const MIN_THRESHOLD = 0.01;
/** How far back from the cap to look for a gap between words: 1.5 s. */
const CUT_SEARCH_WINDOWS = 75;

export class UtteranceSegmenter {
  private readonly rate: number;
  private readonly window: number;
  private readonly pauseWindows: number;
  private readonly maxSamples: number;
  private readonly minSpeechWindows: number;
  private readonly prerollWindows: number;

  private pending = new Float32Array(0);
  private preroll: Float32Array[] = [];
  private utterance: Float32Array[] = [];
  private utteranceRms: number[] = [];
  private utteranceSamples = 0;
  private speechWindows = 0;
  private silentRun = 0;
  private noiseFloor = 0.005;

  constructor(private readonly onUtterance: (samples: Float32Array) => void, options: SegmenterOptions = {}) {
    this.rate = options.sampleRate ?? SAMPLE_RATE_HZ;
    this.window = Math.round((this.rate * WINDOW_MS) / 1000);
    this.pauseWindows = Math.ceil((options.pauseMs ?? 500) / WINDOW_MS);
    this.maxSamples = Math.round(((options.maxUtteranceMs ?? 5000) * this.rate) / 1000);
    this.minSpeechWindows = Math.ceil((options.minSpeechMs ?? 250) / WINDOW_MS);
    this.prerollWindows = Math.ceil((options.prerollMs ?? 200) / WINDOW_MS);
  }

  push(samples: Float32Array): void {
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    let offset = 0;
    for (; offset + this.window <= joined.length; offset += this.window) {
      this.consume(joined.slice(offset, offset + this.window));
    }
    this.pending = joined.slice(offset);
  }

  /** Emit whatever speech is buffered, for when the instructor stops captions. */
  flush(): void {
    this.finish();
  }

  private consume(window: Float32Array): void {
    let energy = 0;
    for (const sample of window) energy += sample * sample;
    const rms = Math.sqrt(energy / window.length);
    const threshold = Math.max(MIN_THRESHOLD, this.noiseFloor * 3);
    const speech = rms > threshold;

    if (this.utterance.length === 0) {
      if (!speech) {
        // Track the room's noise only while nobody is speaking.
        this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
        this.preroll.push(window);
        if (this.preroll.length > this.prerollWindows) this.preroll.shift();
        return;
      }
      this.utterance = [...this.preroll];
      this.utteranceRms = this.preroll.map(() => 0);
      this.utteranceSamples = this.preroll.length * this.window;
      this.preroll = [];
    }

    this.utterance.push(window);
    this.utteranceRms.push(rms);
    this.utteranceSamples += window.length;
    if (speech) {
      this.speechWindows += 1;
      this.silentRun = 0;
    } else {
      this.silentRun += 1;
    }

    if (this.silentRun >= this.pauseWindows) this.finish();
    else if (this.utteranceSamples >= this.maxSamples) this.cutAtQuietest();
  }

  /**
   * Continuous speech hit the cap. Cutting exactly here usually splits a word,
   * which Transcribe then mishears on both sides, so cut at the quietest
   * window of the last stretch -- nearly always the gap between two words --
   * and carry the remainder into the next utterance.
   */
  private cutAtQuietest(): void {
    const search = Math.min(CUT_SEARCH_WINDOWS, this.utterance.length - 1);
    let cut = this.utterance.length - 1;
    for (let i = this.utterance.length - search; i < this.utterance.length; i++) {
      if (this.utteranceRms[i] < this.utteranceRms[cut]) cut = i;
    }
    const carried = this.utterance.slice(cut + 1);
    const carriedRms = this.utteranceRms.slice(cut + 1);
    this.utterance = this.utterance.slice(0, cut + 1);
    this.silentRun = 0;
    this.finish();
    this.utterance = carried;
    this.utteranceRms = carriedRms;
    this.utteranceSamples = carried.length * this.window;
    this.speechWindows = carriedRms.filter(value => value > MIN_THRESHOLD).length;
  }

  private finish(): void {
    if (this.utterance.length > 0 && this.speechWindows >= this.minSpeechWindows) {
      // Drop most of the trailing silence; it costs transcription time and says nothing.
      const keep = Math.max(1, this.utterance.length - Math.max(0, this.silentRun - this.prerollWindows));
      const windows = this.utterance.slice(0, keep);
      const samples = new Float32Array(windows.reduce((sum, w) => sum + w.length, 0));
      let offset = 0;
      for (const w of windows) {
        samples.set(w, offset);
        offset += w.length;
      }
      this.onUtterance(samples);
    }
    this.utterance = [];
    this.utteranceRms = [];
    this.utteranceSamples = 0;
    this.speechWindows = 0;
    this.silentRun = 0;
  }
}
