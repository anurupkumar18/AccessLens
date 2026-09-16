import type { AccessPack, LiveEvent, StreamSurface } from '../shared/contracts';

export type LiveStatus =
  | 'waiting'
  | 'live'
  | 'paused'
  | 'stopped'
  | 'stale'
  | 'unmatched'
  | 'ended'
  | 'incompatible';

export interface StudentLiveState {
  status: LiveStatus;
  lastSequence: number;
  assetId?: string;
  regionId?: string;
  hotspotId?: string;
  /**
   * Live video of the instructor's tab or window is being streamed, and what
   * kind of surface it is. Separate from `status` on purpose: video can start,
   * stop or fail without touching slide following.
   */
  stream?: { surface: StreamSurface };
  message: string;
}

export const initialStudentLiveState: StudentLiveState = {
  status: 'waiting',
  lastSequence: -1,
  message: 'Waiting for instructor event.',
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
        hotspotId: event.arState?.action === 'clear' ? undefined : event.arState?.hotspotId,
        stream,
        message: described,
      };
    }
    case 'capture.paused':
      return { ...current, status: 'paused', lastSequence: event.sequence, message: 'Instructor sharing is paused.' };
    case 'capture.resumed':
      return { ...current, status: 'live', lastSequence: event.sequence, message: 'Instructor sharing resumed.' };
    case 'capture.stopped':
      return {
        ...current,
        status: 'stopped',
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
      };
    case 'session.ended':
      return { status: 'ended', lastSequence: event.sequence, message: 'The instructor ended this session.' };
    case 'session.started':
      return { status: 'live', lastSequence: event.sequence, stream, message: 'Connected to the live lesson.' };
    case 'caption.appended':
      return { ...current, lastSequence: event.sequence };
  }
}

export function markLiveStateStale(current: StudentLiveState): StudentLiveState {
  if (current.status !== 'live') return current;
  return { ...current, status: 'stale', message: 'Connection interrupted. Showing the last reviewed state.' };
}

export function markLiveStateReconnected(current: StudentLiveState): StudentLiveState {
  if (current.status !== 'stale') return current;
  return { ...current, status: 'live', message: 'Reconnected.' };
}
