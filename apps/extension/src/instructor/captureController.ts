import { CAPTION_MAX_LENGTH, type AccessPack, type LiveEvent, type RoleCapability, type SessionClient, type StreamSurface } from '../shared/contracts';
import {
  assertPackFingerprints, createPointerTracker, createSampler, createSlideLocator, hammingDistance, matchFingerprint, timeoutScheduler, wholeFrameFingerprint,
  DEFAULT_MATCH_OPTIONS, DEFAULT_SAMPLE_INTERVAL_MS,
  type CaptureHost, type CaptureStream, type DisplaySurface, type Frame, type MatchOptions, type PointerPosition, type Sampler, type Scheduler,
} from '../sources/screen';
import type { ScreenAnalyzer } from '../sources/screen/screenAnalyzer';
import type { PresentingSlide, SlidesSource } from '../sources/slides';
import type { StreamPublisher } from '../sources/stream';

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

/**
 * Live video of the instructor's tab or window, beside the capture phase and
 * never part of it: video can start, fail or stop without moving `phase`, so
 * nothing about it can interrupt slide following (charter A2 exception,
 * decision in docs/CONTEXT_RELAY.md §4).
 *
 *  - `off`: not streaming. `message` explains a refusal or failure, if any.
 *  - `unavailable`: this session has no video stage (the relay could not create one).
 *  - `starting`: the chooser is open or the publish is in flight.
 *  - `on`: publishing; `surface` names what students are watching.
 */
export type StreamState =
  | { status: 'off'; message: string | null }
  | { status: 'unavailable' }
  | { status: 'starting' }
  | { status: 'on'; surface: StreamSurface };

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
  /** Whether students follow the reviewed region under the instructor's mouse pointer (window and screen shares). */
  followPointer: boolean;
  /** Live video to students. Independent of `phase`. */
  stream: StreamState;
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
   * Turns pointer following on or off. On a window or whole-screen share the
   * mouse pointer is found in the shared frames on this device, and students
   * move to the reviewed region under it; only that region's id is sent.
   */
  setFollowPointer(on: boolean): void;
  /** Sends a bounded, instructor-authored caption line scoped to the current asset. */
  sendCaption(text: string): void;
  /**
   * Sends a live caption of the instructor's speech (text only) while a
   * session is open, naming the matched slide when there is one. Longer text
   * keeps its most recent words. Returns false when no session is open.
   */
  caption(text: string, isFinal: boolean): boolean;
  /** The relay-signed instructor capability for the open session, for the AI gateway. Null before a session opens. */
  getCapability(): RoleCapability | null;
  /**
   * Publishes a live caption on the open session, on the same sequence as
   * every other event. A caption is what was said, never a claim about what
   * is on screen, so it names no asset.
   */
  appendCaption(caption: { text: string; isFinal: boolean; lang?: string }): void;
  /**
   * Streams live video of one tab or window to the session's students. Only
   * ever call this from the Stream button's click handler (charter A1). While
   * sharing a captured surface, that same surface is published without a
   * second chooser; while following Google Slides, the browser chooser opens.
   * A whole monitor is refused and never published.
   */
  startStreaming(): Promise<void>;
  /** Ends the video for every student. Sharing and slide following continue. */
  stopStreaming(): void;
  /** Finds the first reviewed AR hotspot for the current slide and focuses it. */
  findAr(): void;
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
  analyzer?: ScreenAnalyzer;
  /** The Google Slides source, when this build can watch tabs (the installed extension). */
  slides?: SlidesSource;
  /** Publishes video to the session's stage. Without one, the Stream action is not offered. */
  publisher?: StreamPublisher;
}

/** Smallest reviewed region whose bounds contain a point on the slide. */
function regionAt<R extends { regionId: string; bounds: { x: number; y: number; width: number; height: number } }>(regions: readonly R[], point: PointerPosition): R | null {
  let best: R | null = null;
  for (const region of regions) {
    const { x, y, width, height } = region.bounds;
    if (point.x < x || point.x > x + width || point.y < y || point.y > y + height) continue;
    if (!best || width * height < best.bounds.width * best.bounds.height) best = region;
  }
  return best;
}

/** Consecutive unmatched samples before source.unmatched fires. */
export const UNMATCHED_DEBOUNCE = 3;

export const SHARING_REQUIRED_MESSAGE =
  'Sharing is required for live sync. Click Start and choose a tab, window, or screen.';

export const MONITOR_REFUSED_MESSAGE =
  'A whole screen is never streamed to students. Share one tab or one window to stream it.';
export const STREAM_UNAVAILABLE_MESSAGE =
  'Live video is unavailable for this session. Slides, text and audio still work.';

type Emittable = { type: 'session.started' | 'capture.paused' | 'capture.resumed' | 'capture.stopped' | 'stream.stopped' | 'source.unmatched' | 'session.ended' }
  | { type: 'stream.started'; surface: StreamSurface }
  | { type: 'caption.appended'; assetId?: string; caption: { text: string; isFinal: boolean; lang?: string } }
  | { type: 'asset.changed'; assetId: string }
  | { type: 'region.changed'; assetId: string; regionId: string; pointer?: { x: number; y: number }; arState?: { hotspotId: string; action: 'focus' | 'highlight' | 'clear' } }
  | { type: 'screen.analyzed'; analysis: import('../shared/contracts').ScreenAnalysisResult };

export function createCaptureController(options: ControllerOptions): CaptureController {
  const { client, pack, host } = options;
  const scheduler = options.scheduler ?? timeoutScheduler;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? randomIds;
  const intervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const matchOptions = options.match ?? DEFAULT_MATCH_OPTIONS;
  const analyzer = options.analyzer;
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
  let followPointer = true;
  const pointer = createPointerTracker();
  /** Where the pointer was in the latest sample, if it moved; a position, never a frame. */
  let pointerSample: PointerPosition | null = null;
  /** Region the pointer entered on the previous sample, awaiting a second sample before students move. */
  let pointerCandidate: string | null = null;

  let streamState: StreamState = { status: 'off', message: null };
  /** A capture opened only to stream it (Slides-follow mode). Owned here; the fingerprint `stream` is never this. */
  let videoOnly: CaptureStream | null = null;
  let unsubscribeVideoEnded: (() => void) | null = null;
  /** Guards a publish that is still in flight when streaming is stopped underneath it. */
  let streamAttempt = 0;

  function snapshot(): ControllerSnapshot {
    return { phase, sessionId, message, current: { ...current }, sequence, surface: followingSlides ? 'slides' : stream?.surface ?? null, followPointer, stream: { ...streamState } };
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

  /**
   * Pointer support is semantic, not a stream of cursor positions. Derive one
   * bounded focus point from reviewed pack geometry so the relay never learns
   * where somebody moved a real mouse on the shared source.
   */
  function reviewedRegionCenter(region: { regionId: string; bounds: { x: number; y: number; width: number; height: number } }): { x: number; y: number } {
    const pointer = {
      x: region.bounds.x + (region.bounds.width / 2),
      y: region.bounds.y + (region.bounds.height / 2),
    };
    if (pointer.x < 0 || pointer.x > 1 || pointer.y < 0 || pointer.y > 1) {
      throw new Error(`Reviewed region ${region.regionId} cannot produce a normalized focus pointer`);
    }
    return pointer;
  }

  function resetRecognition(): void {
    current = { kind: 'fresh' };
    unmatchedStreak = 0;
    lastFingerprint = null;
    correctionAnchor = null;
    resetPointer();
  }

  function resetPointer(): void {
    pointer.reset();
    pointerSample = null;
    pointerCandidate = null;
  }

  /**
   * Moves students to the reviewed region under the instructor's pointer. The
   * pointer has to be in the same region on two consecutive samples, so a
   * pointer crossing a region on its way somewhere else does not move anyone.
   */
  function followPointerTo(position: PointerPosition | null): void {
    if (!followPointer || !position || current.kind !== 'matched') return;
    const region = regionAt(findAsset(current.assetId).regions, position);
    if (!region || region.regionId === current.regionId) {
      pointerCandidate = null;
      return;
    }
    if (pointerCandidate !== region.regionId) {
      pointerCandidate = region.regionId;
      return;
    }
    pointerCandidate = null;
    current = { ...current, regionId: region.regionId };
    emit({ type: 'region.changed', assetId: current.assetId, regionId: region.regionId, pointer: reviewedRegionCenter(region) });
    notify();
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

  async function onSample(fingerprint: string | null, frame?: import('../sources/screen').Frame): Promise<void> {
    if (phase !== 'sharing' || fingerprint === null) return;
    if (analyzer && frame) {
      try {
        const analysis = await analyzer.analyze(frame);
        if (analysis && phase === 'sharing') emit({ type: 'screen.analyzed', analysis });
      } catch { /* transient analysis failure does not stop capture */ }
      return;
    }
    lastFingerprint = fingerprint;
    if (correctionAnchor !== null) {
      if (hammingDistance(fingerprint, correctionAnchor) <= matchOptions.threshold) return;
      correctionAnchor = null;
    }
    const decision = matchFingerprint(fingerprint, pack, matchOptions);
    if (decision.kind === 'matched') {
      unmatchedStreak = 0;
      if (current.kind === 'matched' && current.assetId === decision.assetId) {
        followPointerTo(pointerSample);
        return;
      }
      // The tracker keeps its background: it restarts by itself when the slide moves or its content changes.
      pointerCandidate = null;
      current = { kind: 'matched', assetId: decision.assetId, title: findAsset(decision.assetId).title, regionId: null };
      emit({ type: 'asset.changed', assetId: decision.assetId });
      notify();
      return;
    }
    unmatchedStreak += 1;
    pointerCandidate = null;
    if (unmatchedStreak >= UNMATCHED_DEBOUNCE && current.kind !== 'unmatched') {
      current = { kind: 'unmatched' };
      emit({ type: 'source.unmatched' });
      notify();
    }
  }

  /**
   * Ends the video for students. Emits `stream.stopped` only if `stream.started`
   * went out, so students never see a stop for a stream that never began.
   * Releases a video-only capture; a fingerprint capture keeps running.
   */
  function endStreaming(reason: string | null): void {
    streamAttempt += 1;
    const wasOn = streamState.status === 'on';
    void options.publisher?.stop();
    unsubscribeVideoEnded?.();
    unsubscribeVideoEnded = null;
    videoOnly?.stop();
    videoOnly = null;
    streamState = { status: 'off', message: reason };
    if (wasOn && sessionId !== null && phase !== 'closed') emit({ type: 'stream.stopped' });
  }

  function endSharing(): void {
    if (phase !== 'sharing' && phase !== 'paused') return;
    if (streamState.status !== 'off' && streamState.status !== 'unavailable') endStreaming(null);
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
        // Start the browser picker before awaiting network/session work. Browser
        // display capture requires this direct causal link to the Start click;
        // otherwise Chrome can reject window or display capture after the
        // transient user activation expires.
        const streamPromise = host.requestStream();
        const granted = await streamPromise;
        if (openedHere) {
          try {
            capability = await client.create(id);
          } catch {
            granted.stop();
            phase = 'idle';
            message = 'Could not open a session. Check the connection and try Start again.';
            notify();
            return;
          }
        }
        sessionId = id;
        stream = granted;
        unsubscribeEnded = granted.onEnded(() => endSharing());
        phase = 'sharing';
        message = null;
        resetRecognition();
        emit({ type: 'session.started' });
        // A tab is the slide itself; a window or screen has other things around it to search past.
        const searchable = granted.surface === 'window' || granted.surface === 'monitor';
        // A tab capture never includes the mouse pointer, so only window and screen shares track it.
        const locateAndTrack = (frame: Frame): string => {
          const fingerprint = locator.fingerprint(frame);
          const slide = locator.lastRect();
          pointerSample = followPointer && slide ? pointer.observe(frame, slide) : null;
          return fingerprint;
        };
        sampler = createSampler(granted, scheduler, onSample, intervalMs, searchable ? locateAndTrack : wholeFrameFingerprint);
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
      if (streamState.status !== 'off' && streamState.status !== 'unavailable') endStreaming(null);
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

    setFollowPointer(on) {
      followPointer = on;
      if (!on) resetPointer();
      notify();
    },

    indicateRegion(regionId) {
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot indicate a region while ${phase}`);
      if (current.kind !== 'matched') throw new Error('No current asset to indicate a region on');
      const asset = findAsset(current.assetId);
      const region = asset.regions.find(candidate => candidate.regionId === regionId);
      if (!region) {
        throw new Error(`Region ${regionId} is not on asset ${current.assetId}`);
      }
      current = { ...current, regionId };
      emit({ type: 'region.changed', assetId: current.assetId, regionId, pointer: reviewedRegionCenter(region) });
      notify();
    },

    async startStreaming() {
      if (!options.publisher) throw new Error('This build cannot stream video');
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot stream while ${phase}`);
      if (streamState.status === 'on' || streamState.status === 'starting') throw new Error('Already streaming');
      const token = capability?.streamToken;
      if (!token) {
        streamState = { status: 'unavailable' };
        message = STREAM_UNAVAILABLE_MESSAGE;
        notify();
        return;
      }
      const attempt = ++streamAttempt;
      streamState = { status: 'starting' };
      notify();

      // The surface to publish: the capture already chosen for fingerprinting
      // (no second chooser, decision 5), or in Slides-follow mode a fresh
      // capture from the browser's chooser, opened here from the click.
      let source: CaptureStream;
      let owned = false;
      if (stream) {
        source = stream;
      } else {
        try {
          source = await host.requestStream();
        } catch {
          if (attempt !== streamAttempt) return;
          streamState = { status: 'off', message: 'Streaming needs a tab or window. Click Stream this window and pick one.' };
          notify();
          return;
        }
        owned = true;
        if (attempt !== streamAttempt) { source.stop(); return; }
      }

      const surface = source.surface;
      if (surface !== 'browser' && surface !== 'window') {
        // A whole monitor is never published (hard rule). A capture opened only
        // for this is stopped on the spot; the fingerprint capture is not
        // published but keeps matching slides on this device.
        if (owned) source.stop();
        streamState = { status: 'off', message: surface === 'monitor' ? MONITOR_REFUSED_MESSAGE : 'The browser did not say whether that is a tab, a window or a screen, so it was not streamed.' };
        notify();
        return;
      }
      const track = source.videoTrack();
      if (!track) {
        if (owned) source.stop();
        streamState = { status: 'off', message: 'The shared surface has no live video to stream.' };
        notify();
        return;
      }

      try {
        await options.publisher.publish(token, track);
      } catch (error) {
        if (owned) source.stop();
        if (attempt !== streamAttempt) return;
        streamState = { status: 'off', message: `Could not start the live video: ${error instanceof Error ? error.message : String(error)}` };
        notify();
        return;
      }
      if (attempt !== streamAttempt) { void options.publisher.stop(); if (owned) source.stop(); return; }
      if (owned) {
        videoOnly = source;
        unsubscribeVideoEnded = source.onEnded(() => { endStreaming('The browser stopped the shared window, so the live video ended.'); notify(); });
      }
      streamState = { status: 'on', surface };
      emit({ type: 'stream.started', surface });
      notify();
    },

    stopStreaming() {
      if (streamState.status === 'off' || streamState.status === 'unavailable') return;
      endStreaming(null);
      notify();
    },

    findAr() {
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot find AR while ${phase}`);
      if (current.kind !== 'matched') throw new Error('No current asset to find AR for');
      const asset = findAsset(current.assetId);
      const hotspot = asset.arScene?.hotspots[0];
      if (!hotspot) throw new Error(`No reviewed AR scene is available for ${asset.title}`);
      current = { ...current, regionId: hotspot.regionId };
      emit({
        type: 'region.changed',
        assetId: current.assetId,
        regionId: hotspot.regionId,
        arState: { hotspotId: hotspot.hotspotId, action: 'focus' },
      });
      message = `AR ready: ${hotspot.label}. Students can open the AR mode.`;
      notify();
    },

    sendCaption(text) {
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot send a caption while ${phase}`);
      if (current.kind !== 'matched') throw new Error('No current asset to caption');
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Caption cannot be empty');
      if (trimmed.length > 280) throw new Error('Caption must be 280 characters or fewer');
      emit({ type: 'caption.appended', assetId: current.assetId, caption: { text: trimmed, isFinal: true } });
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

    appendCaption({ text, isFinal, lang }) {
      if (phase !== 'sharing' && phase !== 'paused') throw new Error(`Cannot caption while ${phase}`);
      const trimmed = text.trim().slice(0, CAPTION_MAX_LENGTH).trimEnd();
      if (!trimmed) return;
      const caption = lang && lang.length >= 2 && lang.length <= 16 ? { text: trimmed, isFinal, lang } : { text: trimmed, isFinal };
      emit({ type: 'caption.appended', caption });
    },

    dispose() {
      if (streamState.status === 'on' || streamState.status === 'starting') {
        streamAttempt += 1;
        void options.publisher?.stop();
        unsubscribeVideoEnded?.();
        videoOnly?.stop();
        videoOnly = null;
        streamState = { status: 'off', message: null };
      }
      releaseStream();
      listeners.clear();
    },
  };
}
