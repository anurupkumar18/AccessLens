import type { AccessPack, LiveEvent } from '../shared/contracts';

export type LiveStatus =
  | 'waiting'
  | 'live'
  | 'paused'
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

  switch (event.type) {
    case 'asset.changed':
      return {
        status: 'live',
        lastSequence: event.sequence,
        assetId: event.assetId,
        message: `Following ${event.assetId}.`,
      };
    case 'region.changed':
      return {
        status: 'live',
        lastSequence: event.sequence,
        assetId: event.assetId,
        regionId: event.regionId,
        hotspotId: event.arState?.action === 'clear' ? undefined : event.arState?.hotspotId,
        message: `Following ${event.regionId} on ${event.assetId}.`,
      };
    case 'capture.paused':
      return { ...current, status: 'paused', lastSequence: event.sequence, message: 'Instructor sharing is paused.' };
    case 'capture.resumed':
      return { ...current, status: 'live', lastSequence: event.sequence, message: 'Instructor sharing resumed.' };
    case 'source.unmatched':
      return {
        status: 'unmatched',
        lastSequence: event.sequence,
        message: 'This source is not in the reviewed lesson pack yet.',
      };
    case 'session.ended':
      return { status: 'ended', lastSequence: event.sequence, message: 'The instructor ended this session.' };
    case 'session.started':
      return { status: 'live', lastSequence: event.sequence, message: 'Connected to the live lesson.' };
    case 'caption.appended':
      return { ...current, lastSequence: event.sequence };
  }
}

export function markLiveStateStale(current: StudentLiveState): StudentLiveState {
  if (current.status !== 'live') return current;
  return { ...current, status: 'stale', message: 'Connection interrupted. Showing the last reviewed state.' };
}
