import type { AccessPack, LiveEvent, ScreenAnalysisResult, StreamSurface } from '../shared/contracts';

export type LiveStatus =
  | 'waiting'
  | 'live'
  | 'paused'
  | 'stopped'
  | 'stale'
  | 'unmatched'
  | 'ended'
  | 'incompatible';

/** Instructor speech, never a pack description or raw audio (charter A2). */
export interface StudentCaption {
  /** The slide it was spoken over, when there is a current match. */
  assetId?: string;
  text: string;
  isFinal: boolean;
}

/** A short rolling transcript, not a durable record; nothing is persisted. */
export const MAX_RECENT_CAPTIONS = 5;

export interface StudentLiveState {
  status: LiveStatus;
  /** An invalid relay payload must not be reset to live by socket recovery alone. */
  staleReason?: 'connection' | 'protocol';
  lastSequence: number;
  assetId?: string;
  regionId?: string;
  /** A reviewed semantic focus point, never a captured cursor location. */
  pointer?: { x: number; y: number };
  hotspotId?: string;
  /**
   * Live video of the instructor's tab or window is being streamed, and what
   * kind of surface it is. Separate from `status` on purpose: video can start,
   * stop or fail without touching slide following.
   */
  stream?: { surface: StreamSurface };
  message: string;
  analysis?: ScreenAnalysisResult;
  captions: StudentCaption[];
}

export const initialStudentLiveState: StudentLiveState = {
  status: 'waiting',
  lastSequence: -1,
  message: 'Waiting for instructor event.',
  captions: [],
};

export function applyLiveEvent(
  current: StudentLiveState,
  event: LiveEvent,
  pack: AccessPack,
): StudentLiveState {
  if (event.sequence <= current.lastSequence) return current;

  if (event.packId !== pack.packId || event.packVersion !== pack.version) {
    return {
      status: 'incompatible',
      lastSequence: event.sequence,
      message: 'The instructor is using a different reviewed lesson version.',
      captions: current.captions,
    };
  }

  // View events say which slide is showing. They say nothing about video, so
  // the stream in force rides through them; only the stream and lifecycle
  // events below end it.
  const stream = current.stream;
  switch (event.type) {
    case 'asset.changed': {
      const asset = pack.assets.find((candidate) => candidate.assetId === event.assetId);
      return {
        status: 'live',
        lastSequence: event.sequence,
        assetId: event.assetId,
        stream,
        message: `Now on ${asset?.title ?? event.assetId}.`,
        captions: current.captions,
      };
    }
    case 'region.changed': {
      // The status line is a live region, so this sentence is what a screen
      // reader speaks when the instructor moves. It carries the reviewed
      // description itself, not the identifiers: a student hears "Mitochondrion:
      // the mitochondrion releases usable energy for the cell", once, without
      // having to find it.
      const asset = pack.assets.find((candidate) => candidate.assetId === event.assetId);
      const region = asset?.regions.find((candidate) => candidate.regionId === event.regionId);
      const name = region?.label ?? event.regionId;
      const described = region ? `${name}: ${region.shortDescription}` : `${name} on ${asset?.title ?? event.assetId}.`;
      return {
        status: 'live',
        lastSequence: event.sequence,
        assetId: event.assetId,
        regionId: event.regionId,
        pointer: event.pointer,
        hotspotId: event.arState?.action === 'clear' ? undefined : event.arState?.hotspotId,
        stream,
        message: described,
        captions: current.captions,
      };
    }
    case 'capture.paused':
      return { ...current, status: 'paused', staleReason: undefined, lastSequence: event.sequence, message: 'Instructor sharing is paused.' };
    case 'capture.resumed':
      return { ...current, status: 'live', staleReason: undefined, lastSequence: event.sequence, message: 'Instructor sharing resumed.' };
    case 'capture.stopped':
      return {
        ...current,
        status: 'stopped',
        staleReason: undefined,
        lastSequence: event.sequence,
        stream: undefined,
        message: 'Instructor stopped sharing. Showing the last reviewed moment.',
      };
    case 'stream.started':
      return { ...current, lastSequence: event.sequence, stream: { surface: event.surface } };
    case 'stream.stopped':
      return { ...current, lastSequence: event.sequence, stream: undefined };
    case 'source.unmatched':
      return {
        status: 'unmatched',
        lastSequence: event.sequence,
        stream,
        message: 'This source is not in the reviewed lesson pack yet.',
        captions: current.captions,
      };
    case 'screen.analyzed':
      // Screen analysis is supplemental narration for the current slide. It
      // must not replace the reviewed slide/region state: otherwise a vision
      // result arriving after an asset change makes Focus, Read, and AR fall
      // back to the previous/default slide until the next pointer event.
      return { ...current, status: 'live', staleReason: undefined, lastSequence: event.sequence, stream, analysis: event.analysis, message: `Understanding: ${event.analysis.title}.` };
    case 'session.ended':
      return { status: 'ended', lastSequence: event.sequence, message: 'The instructor ended this session.', captions: [] };
    case 'session.started':
      return { status: 'live', lastSequence: event.sequence, stream, message: 'Connected to the live lesson.', captions: [] };
    case 'caption.appended':
      return {
        ...current,
        staleReason: undefined,
        lastSequence: event.sequence,
        captions: [...current.captions, { assetId: event.assetId, text: event.caption.text, isFinal: event.caption.isFinal }].slice(-MAX_RECENT_CAPTIONS),
      };
  }
}

export function markLiveStateStale(current: StudentLiveState): StudentLiveState {
  if (current.status !== 'live') return current;
  return { ...current, status: 'stale', staleReason: 'connection', message: 'Connection interrupted. Showing the last reviewed state.' };
}

export function markLiveStateReconnected(current: StudentLiveState): StudentLiveState {
  if (current.status !== 'stale' || current.staleReason === 'protocol') return current;
  return { ...current, status: 'live', staleReason: undefined, message: 'Reconnected.' };
}

/** Fail closed when the transport drops an event at the contract boundary. */
export function markLiveStateProtocolInvalid(current: StudentLiveState): StudentLiveState {
  if (current.status === 'ended' || current.status === 'stopped' || current.status === 'incompatible') return current;
  const message = current.lastSequence < 0
    ? 'A live update could not be verified. Waiting for a reviewed update.'
    : 'A live update could not be verified. Showing the last reviewed state.';
  return { ...current, status: 'stale', staleReason: 'protocol', message };
}
