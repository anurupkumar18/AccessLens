import { CAPTION_MAX_LENGTH, type AccessPack, type LiveEvent, type RoleCapability, type SessionClient } from '../shared/contracts';
import {
  assertPackFingerprints, createSampler, createSlideLocator, hammingDistance, matchFingerprint, timeoutScheduler, wholeFrameFingerprint,
  DEFAULT_MATCH_OPTIONS, DEFAULT_SAMPLE_INTERVAL_MS,
  type CaptureHost, type CaptureStream, type DisplaySurface, type MatchOptions, type Sampler, type Scheduler,
} from '../sources/screen';
import type { PresentingSlide, SlidesSource } from '../sources/slides';

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

/** What the controller is following while sharing: a captured surface, or the presenting Google Slides tab. */
export type FollowedSurface = DisplaySurface | 'slides';

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
  /** Tab, window, or whole screen while capturing, 'slides' while following Google Slides; null when not sharing or unreported. */
  surface: FollowedSurface | null;
}

export interface Correction { assetId: string; regionId?: string }

export interface CaptureController {
  getState(): ControllerSnapshot;
  subscribe(listener: (state: ControllerSnapshot) => void): () => void;
  /** Only ever call this from the Start button's click handler (charter A1). */
  start(): Promise<void>;
  /**
   * Opens the session (if none is open) and follows whichever Google Slides
   * tab presents next in this browser, slide by slide, until Stop. Requires
   * `slides` in the options; nothing is captured and no chooser opens.
   */
  followSlides(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  endSession(): void;
  correct(correction: Correction): void;
  indicateRegion(regionId: string): void;
  /**
   * Sends a live caption of the instructor's speech (text only) while a
   * session is open, naming the matched slide when there is one. Longer text
   * keeps its most recent words. Returns false when no session is open.
   */
  caption(text: string, isFinal: boolean): boolean;
  /** The relay-signed instructor capability for the open session, for the AI gateway. Null before a session opens. */
  getCapability(): RoleCapability | null;
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
  /** The Google Slides source, when this build can watch tabs (the installed extension). */
  slides?: SlidesSource;
}

/** Consecutive unmatched samples before source.unmatched fires. */
export const UNMATCHED_DEBOUNCE = 3;

export const SHARING_REQUIRED_MESSAGE =
  'Sharing is required for live sync. Click Start and choose a tab, window, or screen.';

type Emittable = { type: 'session.started' | 'capture.paused' | 'capture.resumed' | 'capture.stopped' | 'source.unmatched' | 'session.ended' }
  | { type: 'caption.appended'; assetId?: string; caption: { text: string; isFinal: boolean } }
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
  let capability: RoleCapability | null = null;
  let message: string | null = null;
  let current: CurrentState = { kind: 'fresh' };
  let sequence = 0;

  let stream: CaptureStream | null = null;
  let followingSlides = false;
  let unwatchSlides: (() => void) | null = null;
  /** The presenting slide most recently reported, re-applied on resume. */
  let lastSlide: PresentingSlide | null = null;
  let sampler: Sampler | null = null;
  let unsubscribeEnded: (() => void) | null = null;
  let unmatchedStreak = 0;
  /** Fingerprint most recently observed; a string, never a frame. */
  let lastFingerprint: string | null = null;
  /** Sticky manual correction: automatic emission resumes only once the screen moves away from this. */
  let correctionAnchor: string | null = null;

  function snapshot(): ControllerSnapshot {
    return { phase, sessionId, message, current: { ...current }, sequence, surface: followingSlides ? 'slides' : stream?.surface ?? null };
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

  /** Halts sampling synchronously and releases the stream or the Slides watch. Emits nothing. */
  function releaseStream(): void {
    sampler?.stop();
    sampler = null;
    unsubscribeEnded?.();
    unsubscribeEnded = null;
    stream?.stop();
    stream = null;
    unwatchSlides?.();
    unwatchSlides = null;
    followingSlides = false;
    lastSlide = null;
  }

  function showAsset(assetId: string | null): void {
    if (assetId === null) {
      if (current.kind === 'unmatched') return;
      current = { kind: 'unmatched' };
      emit({ type: 'source.unmatched' });
      return;
    }
    if (current.kind === 'matched' && current.assetId === assetId) return;
    current = { kind: 'matched', assetId, title: findAsset(assetId).title, regionId: null };
    emit({ type: 'asset.changed', assetId });
  }

  /** Maps the presenting slide to the pack by position in the deck's slide order. */
  async function onPresentingSlide(slide: PresentingSlide | null): Promise<void> {
    lastSlide = slide;
    if (!followingSlides || phase !== 'sharing') return;
    if (slide === null) {
      message = 'The presentation ended. Students keep the last slide; present again to continue.';
      notify();
      return;
    }
    let order: string[];
    try {
      order = await options.slides!.slideOrder(slide.deckId);
    } catch (error) {
      message = `Could not read the slide order of this deck: ${error instanceof Error ? error.message : String(error)}`;
      notify();
      return;
    }
    if (!followingSlides || phase !== 'sharing' || lastSlide !== slide) return;
    const index = slide.slideObjectId === null ? 0 : order.indexOf(slide.slideObjectId);
    const asset = index >= 0 ? pack.assets[index] : undefined;
    message = asset ? null : `Slide ${index + 1} of the deck has no reviewed slide in ${pack.title}.`;
    showAsset(asset?.assetId ?? null);
    notify();
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
      // Invoke the browser chooser before any awaited session/network work so
      // Chrome retains the Start button's transient user activation. This is
      // what makes window and entire-screen sharing reliable; tab sharing was
      // the only path that appeared to work when create() ran first.
      try {
        // Invoke the chooser before the first awaited operation so the browser
        // keeps the Start button's transient user activation for tab/window/
        // screen capture.
        const streamPromise = host.requestStream();
        if (openedHere) {
          try {
            capability = await client.create(id);
          } catch {
            const granted = await streamPromise.catch(() => null);
            granted?.stop();
            phase = 'idle';
            message = 'Could not open a session. Check the connection and try Start again.';
            notify();
            return;
          }
        }
        const granted = await streamPromise;
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
        if (openedHere) { sessionId = null; capability = null; }
        phase = 'idle';
        message = SHARING_REQUIRED_MESSAGE;
      }
      notify();
    },

    async followSlides() {
      if (!options.slides) throw new Error('This build cannot watch Google Slides tabs');
      if (phase !== 'idle') throw new Error(`Cannot follow Slides while ${phase}`);
      phase = 'starting';
      message = 'Opening the session…';
      notify();
      const openedHere = sessionId === null;
      const id = sessionId ?? ids.sessionId();
      if (openedHere) {
        try {
          capability = await client.create(id);
        } catch {
          phase = 'idle';
          message = 'Could not open a session. Check the connection and try again.';
          notify();
          return;
        }
      }
      sessionId = id;
      followingSlides = true;
      phase = 'sharing';
      message = 'Waiting for you to present. Open your deck in Google Slides and start the slideshow whenever you are ready.';
      resetRecognition();
      emit({ type: 'session.started' });
      unwatchSlides = options.slides.watcher.watch(slide => { void onPresentingSlide(slide); });
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
      if (followingSlides) void onPresentingSlide(lastSlide);
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
      capability = null;
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

    caption(text, isFinal) {
      if (sessionId === null || phase === 'closed') return false;
      const trimmed = text.trim().replace(/\s+/g, ' ');
      if (!trimmed) return false;
      const bounded = trimmed.length > CAPTION_MAX_LENGTH ? trimmed.slice(trimmed.length - CAPTION_MAX_LENGTH).replace(/^\S*\s/, '') : trimmed;
      emit({
        type: 'caption.appended',
        ...(current.kind === 'matched' ? { assetId: current.assetId } : {}),
        caption: { text: bounded, isFinal },
      });
      return true;
    },

    getCapability: () => capability,

    dispose() {
      releaseStream();
      listeners.clear();
    },
  };
}
