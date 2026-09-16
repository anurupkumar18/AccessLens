import type { AccessPack, LiveEvent } from '../shared/contracts';

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
  message: string;
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

  switch (event.type) {
    case 'asset.changed':
      return {
        status: 'live',
        lastSequence: event.sequence,
        assetId: event.assetId,
        message: `Following ${event.assetId}.`,
        captions: current.captions,
      };
    case 'region.changed':
      return {
        status: 'live',
        lastSequence: event.sequence,
        assetId: event.assetId,
        regionId: event.regionId,
        pointer: event.pointer,
        hotspotId: event.arState?.action === 'clear' ? undefined : event.arState?.hotspotId,
        message: `Following ${event.regionId} on ${event.assetId}.`,
        captions: current.captions,
      };
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
        message: 'Instructor stopped sharing. Showing the last reviewed moment.',
      };
    case 'source.unmatched':
      return {
        status: 'unmatched',
        lastSequence: event.sequence,
        message: 'This source is not in the reviewed lesson pack yet.',
        captions: current.captions,
      };
    case 'session.ended':
      return { status: 'ended', lastSequence: event.sequence, message: 'The instructor ended this session.', captions: [] };
    case 'session.started':
      return { status: 'live', lastSequence: event.sequence, message: 'Connected to the live lesson.', captions: [] };
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
