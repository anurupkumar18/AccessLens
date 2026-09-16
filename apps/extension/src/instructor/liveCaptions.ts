/**
 * Live captions during a session: microphone -> utterances -> AWS Transcribe
 * (via `services/captions`) -> `caption.appended` events on the session.
 *
 * Captions are published through the capture controller rather than sent to
 * the client directly, so they share its sequence counter. The relay refuses
 * any event whose sequence does not increase, and two independent counters
 * would race each other into exactly that refusal.
 *
 * Utterances are transcribed one at a time, in order. A caption that arrives
 * after the one spoken after it is worse than one that arrives late.
 */
import { callService, ServiceUnavailable } from '../accessibility/endpoints';
import { toPcm16Base64 } from '../mediaPrep/audio';
import { browserMicrophone, type MicrophoneHost, type MicrophoneStream } from '../sources/audio/microphone';
import { UtteranceSegmenter } from '../sources/audio/segmenter';

export interface Caption {
  text: string;
  isFinal: boolean;
  lang?: string;
}

export type Transcriber = (request: { sessionId: string; audio: string; lang: string }) => Promise<Caption[]>;

export const captionsService: Transcriber = async request =>
  (await callService<{ captions: Caption[] }>('captions', request)).captions;

export type LiveCaptionsPhase = 'off' | 'starting' | 'listening' | 'error';

export interface LiveCaptionsState {
  phase: LiveCaptionsPhase;
  message: string | null;
  lastCaption: string | null;
  /** Utterances waiting on transcription; a growing number means captions are lagging. */
  backlog: number;
}

export interface LiveCaptionsOptions {
  /** Publishes one caption on the open session; throws if there is none. */
  publish(caption: Caption): void;
  sessionId(): string | null;
  /** Read per utterance, so a language change applies to the next sentence. */
  lang(): string;
  microphone?: MicrophoneHost;
  transcribe?: Transcriber;
}

export interface LiveCaptions {
  getState(): LiveCaptionsState;
  subscribe(listener: (state: LiveCaptionsState) => void): () => void;
  /** Only from a click (charter A1): this opens the microphone. */
  start(): Promise<void>;
  stop(): void;
}

export function createLiveCaptions(options: LiveCaptionsOptions): LiveCaptions {
  const microphone = options.microphone ?? browserMicrophone;
  const transcribe = options.transcribe ?? captionsService;
  const listeners = new Set<(state: LiveCaptionsState) => void>();
  let state: LiveCaptionsState = { phase: 'off', message: null, lastCaption: null, backlog: 0 };
  let stream: MicrophoneStream | null = null;
  let segmenter: UtteranceSegmenter | null = null;
  let queue: Promise<void> = Promise.resolve();
  let generation = 0;

  const set = (patch: Partial<LiveCaptionsState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener(state));
  };

  function halt(): void {
    generation += 1;
    stream?.stop();
    stream = null;
    segmenter = null;
  }

  function enqueue(samples: Float32Array): void {
    const mine = generation;
    set({ backlog: state.backlog + 1 });
    queue = queue.then(async () => {
      try {
        const sessionId = options.sessionId();
        if (mine !== generation || !sessionId) return;
        const captions = await transcribe({ sessionId, audio: toPcm16Base64(samples), lang: options.lang() });
        if (mine !== generation) return;
        // Each request is a closed chunk, so its final results are settled
        // text. Interim ones would only flicker on students' screens.
        for (const caption of captions.filter(c => c.isFinal && c.text.trim())) {
          options.publish(caption);
          set({ lastCaption: caption.text });
        }
      } catch (error) {
        if (mine !== generation) return;
        if (error instanceof ServiceUnavailable) {
          // One failed chunk loses one sentence; stopping would lose the class.
          set({ message: `A caption was missed: ${error.message}` });
        } else {
          halt();
          set({ phase: 'error', message: error instanceof Error ? error.message : 'Captions stopped.' });
        }
      } finally {
        set({ backlog: Math.max(0, state.backlog - 1) });
      }
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start() {
      if (state.phase === 'starting' || state.phase === 'listening') return;
      if (!options.sessionId()) {
        set({ phase: 'error', message: 'Start sharing first, so captions have a session to go to.' });
        return;
      }
      set({ phase: 'starting', message: 'Allow microphone access in the browser prompt.', lastCaption: null });
      const mine = ++generation;
      const current = new UtteranceSegmenter(enqueue);
      try {
        const opened = await microphone.open(samples => current.push(samples));
        if (mine !== generation) {
          opened.stop();
          return;
        }
        stream = opened;
        segmenter = current;
        set({ phase: 'listening', message: null });
      } catch (error) {
        halt();
        const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        set({
          phase: 'error',
          message: denied
            ? 'Microphone access was blocked. Allow it for AccessLens, or use "Open in a full tab" if the side panel cannot ask.'
            : 'No microphone could be opened.',
        });
      }
    },

    stop() {
      if (state.phase === 'off') return;
      // Stopped while the permission prompt is open: the grant must not turn
      // captions back on when it arrives.
      if (state.phase === 'starting') generation += 1;
      // The last sentence before Stop is still transcribed and published; only
      // an error (or the session closing) abandons queued speech.
      stream?.stop();
      stream = null;
      segmenter?.flush();
      segmenter = null;
      set({ phase: 'off', message: null });
    },
  };
}
