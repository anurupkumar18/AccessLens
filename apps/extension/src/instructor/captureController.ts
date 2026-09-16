import type { AccessPack, LiveEvent, SessionClient } from '../shared/contracts';
import {
  assertPackFingerprints, createSampler, createSlideLocator, hammingDistance, matchFingerprint, timeoutScheduler, wholeFrameFingerprint,
  DEFAULT_MATCH_OPTIONS, DEFAULT_SAMPLE_INTERVAL_MS,
  type CaptureHost, type CaptureStream, type DisplaySurface, type MatchOptions, type Sampler, type Scheduler,
} from '../sources/screen';

/** Injected time source; production uses the system clock. */
export interface Clock { now(): string }
export const systemClock: Clock = { now: () => new Date().toISOString() };

/** Injected ID source; production issues a short random join code. */
export interface IdGenerator { sessionId(): string }
export const randomIds: IdGenerator = {
  sessionId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  },
};

export type CapturePhase = 'idle' | 'starting' | 'sharing' | 'paused' | 'closed';

export type CurrentState =
  | { kind: 'fresh' }
  | { kind: 'matched'; assetId: string; title: string; regionId: string | null }
  | { kind: 'unmatched' };

/** Identifiers and strings only. Never a frame, never pixel data. */
export interface ControllerSnapshot {
  phase: CapturePhase;
  /** Open session ID, shown to students as the join code. */
  sessionId: string | null;
  /** Human-readable explanation of the last notable transition, if any. */
  message: string | null;
  current: CurrentState;
  sequence: number;
  /** Tab, window, or whole screen while sharing; null when not sharing or unreported. */
  surface: DisplaySurface | null;
}

export interface Correction { assetId: string; regionId?: string }

export interface CaptureController {
  getState(): ControllerSnapshot;
  subscribe(listener: (state: ControllerSnapshot) => void): () => void;
  /** Only ever call this from the Start button's click handler (charter A1). */
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  endSession(): void;
  correct(correction: Correction): void;
  indicateRegion(regionId: string): void;
  /** Halts sampling without emitting anything; for unmount. */
  dispose(): void;
}

export interface ControllerOptions {
  client: SessionClient;
  pack: AccessPack;
  host: CaptureHost;
  scheduler?: Scheduler;
  clock?: Clock;
  ids?: IdGenerator;
  sampleIntervalMs?: number;
  match?: MatchOptions;
}

/** Consecutive unmatched samples before source.unmatched fires. */
export const UNMATCHED_DEBOUNCE = 3;

export const SHARING_REQUIRED_MESSAGE =
  'Sharing is required for live sync. Click Start and choose a tab, window, or screen.';

type Emittable = { type: 'session.started' | 'capture.paused' | 'capture.resumed' | 'capture.stopped' | 'source.unmatched' | 'session.ended' }
  | { type: 'asset.changed'; assetId: string }
  | { type: 'region.changed'; assetId: string; regionId: string };

export function createCaptureController(options: ControllerOptions): CaptureController {
  const { client, pack, host } = options;
  const scheduler = options.scheduler ?? timeoutScheduler;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? randomIds;
  const intervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const matchOptions = options.match ?? DEFAULT_MATCH_OPTIONS;
  assertPackFingerprints(pack);
  const locator = createSlideLocator(pack, matchOptions);

  const listeners = new Set<(state: ControllerSnapshot) => void>();
  let phase: CapturePhase = 'idle';
  let sessionId: string | null = null;
  let message: string | null = null;
  let current: CurrentState = { kind: 'fresh' };
  let sequence = 0;

  let stream: CaptureStream | null = null;
  let sampler: Sampler | null = null;
  let unsubscribeEnded: (() => void) | null = null;
  let unmatchedStreak = 0;
  /** Fingerprint most recently observed; a string, never a frame. */
  let lastFingerprint: string | null = null;
  /** Sticky manual correction: automatic emission resumes only once the screen moves away from this. */
  let correctionAnchor: string | null = null;

  function snapshot(): ControllerSnapshot {
    return { phase, sessionId, message, current: { ...current }, sequence, surface: stream?.surface ?? null };
  }
  function notify(): void {
    const state = snapshot();
    listeners.forEach(l => l(state));
  }

  function emit(partial: Emittable): void {
    if (sessionId === null) throw new Error('No open session');
    const event = {
      schemaVersion: '1.0' as const,
      sessionId,
      packId: pack.packId,
      packVersion: pack.version,
      sequence: sequence + 1,
      sentAt: clock.now(),
      ...partial,
    } as LiveEvent;
    client.send(event);
    sequence += 1;
  }

  function findAsset(assetId: string) {
    const asset = pack.assets.find(a => a.assetId === assetId);
    if (!asset) throw new Error(`Asset ${assetId} is not in pack ${pack.packId}`);
    return asset;
  }

  function resetRecognition(): void {
    current = { kind: 'fresh' };
    unmatchedStreak = 0;
    lastFingerprint = null;
    correctionAnchor = null;
  }

  /** Halts sampling synchronously and releases the stream. Emits nothing. */
  function releaseStream(): void {
    sampler?.stop();
    sampler = null;
    unsubscribeEnded?.();
    unsubscribeEnded = null;
    stream?.stop();
    stream = null;
  }

  function onSample(fingerprint: string | null): void {
    if (phase !== 'sharing' || fingerprint === null) return;
    lastFingerprint = fingerprint;
    if (correctionAnchor !== null) {
      if (hammingDistance(fingerprint, correctionAnchor) <= matchOptions.threshold) return;
      correctionAnchor = null;
    }
    const decision = matchFingerprint(fingerprint, pack, matchOptions);
    if (decision.kind === 'matched') {
      unmatchedStreak = 0;
      if (current.kind === 'matched' && current.assetId === decision.assetId) return;
      current = { kind: 'matched', assetId: decision.assetId, title: findAsset(decision.assetId).title, regionId: null };
      emit({ type: 'asset.changed', assetId: decision.assetId });
      notify();
      return;
    }
    unmatchedStreak += 1;
    if (unmatchedStreak >= UNMATCHED_DEBOUNCE && current.kind !== 'unmatched') {
      current = { kind: 'unmatched' };
      emit({ type: 'source.unmatched' });
      notify();
    }
  }

  function endSharing(): void {
    if (phase !== 'sharing' && phase !== 'paused') return;
    releaseStream();
    phase = 'idle';
    resetRecognition();
    message = 'Stopped sharing. The session is still open: Start again to share, or End Session to close it.';
    emit({ type: 'capture.stopped' });
    notify();
  }

  return {
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start() {
      if (phase !== 'idle') throw new Error(`Cannot start while ${phase}`);
      phase = 'starting';
      message = 'Choose a tab, window, or screen in the browser dialog.';
      notify();
      const openedHere = sessionId === null;
      const id = sessionId ?? ids.sessionId();
      try {
        if (openedHere) {
          try {
            await client.create(id);
          } catch {
            phase = 'idle';
            message = 'Could not open a session. Check the connection and try Start again.';
            notify();
            return;
          }
        }
        const granted = await host.requestStream();
        sessionId = id;
        stream = granted;
        unsubscribeEnded = granted.onEnded(() => endSharing());
        phase = 'sharing';
        message = null;
        resetRecognition();
        emit({ type: 'session.started' });
        // A tab is the slide itself; a window or screen has other things around it to search past.
        const searchable = granted.surface === 'window' || granted.surface === 'monitor';
        sampler = createSampler(granted, scheduler, onSample, intervalMs, searchable ? frame => locator.fingerprint(frame) : wholeFrameFingerprint);
        sampler.start();
      } catch {
        if (openedHere) sessionId = null;
        phase = 'idle';
        message = SHARING_REQUIRED_MESSAGE;
      }
      notify();
    },

    pause() {
      if (phase !== 'sharing') throw new Error(`Cannot pause while ${phase}`);
      sampler?.stop();
      phase = 'paused';
      emit({ type: 'capture.paused' });
      notify();
    },

    resume() {
      if (phase !== 'paused') throw new Error(`Cannot resume while ${phase}`);
      phase = 'sharing';
      emit({ type: 'capture.resumed' });
      sampler?.start();
      notify();
    },

    stop() {
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot stop while ${phase}`);
      endSharing();
    },

    endSession() {
      if (phase === 'sharing' || phase === 'paused') endSharing();
      if (phase === 'closed') return;
      if (sessionId !== null) emit({ type: 'session.ended' });
      client.close();
      sessionId = null;
      phase = 'closed';
      message = 'Session ended.';
      notify();
    },

    correct({ assetId, regionId }) {
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot correct while ${phase}`);
      const asset = findAsset(assetId);
      if (regionId !== undefined && !asset.regions.some(r => r.regionId === regionId)) {
        throw new Error(`Region ${regionId} is not on asset ${assetId}`);
      }
      if (current.kind !== 'matched' || current.assetId !== assetId) {
        current = { kind: 'matched', assetId, title: asset.title, regionId: null };
        emit({ type: 'asset.changed', assetId });
      }
      if (regionId !== undefined) {
        current = { ...current, regionId };
        emit({ type: 'region.changed', assetId, regionId });
      }
      unmatchedStreak = 0;
      correctionAnchor = lastFingerprint;
      notify();
    },

    indicateRegion(regionId) {
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot indicate a region while ${phase}`);
      if (current.kind !== 'matched') throw new Error('No current asset to indicate a region on');
      const asset = findAsset(current.assetId);
      if (!asset.regions.some(r => r.regionId === regionId)) {
        throw new Error(`Region ${regionId} is not on asset ${current.assetId}`);
      }
      current = { ...current, regionId };
      emit({ type: 'region.changed', assetId: current.assetId, regionId });
      notify();
    },

    dispose() {
      releaseStream();
      listeners.clear();
    },
  };
}
