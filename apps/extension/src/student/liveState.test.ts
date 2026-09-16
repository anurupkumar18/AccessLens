import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../shared/contracts';
import { validEvent, validPack } from '../shared/fixtures';
import { applyLiveEvent, initialStudentLiveState, markLiveStateProtocolInvalid, markLiveStateStale, markLiveStateReconnected } from './liveState';

describe('student live state', () => {
  it('applies the newest reviewed region and AR hotspot', () => {
    const event: LiveEvent = {
      schemaVersion: '1.0',
      type: 'region.changed',
      sessionId: 'demo-session',
      packId: 'bio-cell-demo',
      packVersion: 1,
      assetId: 'cell-slide-03',
      regionId: 'mitochondrion',
      arState: { hotspotId: 'mitochondrion-hotspot', action: 'focus' },
      sequence: 1,
      sentAt: '2026-09-15T15:00:00Z',
    };
    const result = applyLiveEvent(initialStudentLiveState, event, validPack);
    expect(result).toMatchObject({
      status: 'live',
      assetId: 'cell-slide-03',
      regionId: 'mitochondrion',
      hotspotId: 'mitochondrion-hotspot',
      lastSequence: 1,
    });
  });

  it('ignores stale and duplicate events', () => {
    const newest = applyLiveEvent(initialStudentLiveState, { ...validEvent, sequence: 8 } as LiveEvent, validPack);
    const stale = applyLiveEvent(newest, {
      schemaVersion: '1.0',
      type: 'region.changed',
      sessionId: 'demo-session',
      packId: 'bio-cell-demo',
      packVersion: 1,
      assetId: 'cell-slide-03',
      regionId: 'wrong-region',
      sequence: 7,
      sentAt: '2026-09-15T15:00:00Z',
    }, validPack);
    expect(stale).toBe(newest);
    expect(stale.regionId).toBe('mitochondrion');
  });

  it('stops rendering a mismatched Access Pack version', () => {
    const result = applyLiveEvent(initialStudentLiveState, { ...validEvent, packVersion: 2 }, validPack);
    expect(result.status).toBe('incompatible');
    expect(result.assetId).toBeUndefined();
  });

  it('preserves the last reviewed state when the connection becomes stale', () => {
    const live = applyLiveEvent(initialStudentLiveState, validEvent, validPack);
    expect(markLiveStateStale(live)).toMatchObject({
      status: 'stale',
      assetId: 'cell-slide-03',
      regionId: 'mitochondrion',
    });
  });

  it('freezes the last reviewed state when capture stops without ending the session', () => {
    const live = applyLiveEvent(initialStudentLiveState, validEvent, validPack);
    const stopped = applyLiveEvent(live, { ...validEvent, type: 'capture.stopped', sequence: 2 } as LiveEvent, validPack);
    expect(stopped).toMatchObject({
      status: 'stopped',
      assetId: 'cell-slide-03',
      regionId: 'mitochondrion',
      message: 'Instructor stopped sharing. Showing the last reviewed moment.',
    });
    expect(markLiveStateReconnected(stopped)).toBe(stopped);
  });

  it('returns to live with the last reviewed region once the socket reconnects', () => {
    const live = applyLiveEvent(initialStudentLiveState, validEvent, validPack);
    const stale = markLiveStateStale(live);
    expect(markLiveStateReconnected(stale)).toMatchObject({
      status: 'live',
      assetId: 'cell-slide-03',
      regionId: 'mitochondrion',
      message: 'Reconnected.',
    });
  });

  it('leaves a non-stale status alone on a reconnect notification', () => {
    const ended = applyLiveEvent(initialStudentLiveState, { ...validEvent, type: 'session.ended', sequence: 9 } as LiveEvent, validPack);
    expect(markLiveStateReconnected(ended)).toBe(ended);
  });

  it('fails closed on an invalid relay payload until a later valid event arrives', () => {
    const live = applyLiveEvent(initialStudentLiveState, validEvent, validPack);
    const invalid = markLiveStateProtocolInvalid(live);
    expect(invalid).toMatchObject({
      status: 'stale',
      staleReason: 'protocol',
      assetId: 'cell-slide-03',
      regionId: 'mitochondrion',
      message: 'A live update could not be verified. Showing the last reviewed state.',
    });
    expect(markLiveStateReconnected(invalid)).toBe(invalid);

    const recovered = applyLiveEvent(invalid, { ...validEvent, sequence: 2 } as LiveEvent, validPack);
    expect(recovered).toMatchObject({ status: 'live', lastSequence: 2 });
    expect(recovered.staleReason).toBeUndefined();
  });

  it('shows unmatched without inventing an asset or region', () => {
    const unmatched: LiveEvent = {
      schemaVersion: '1.0',
      type: 'source.unmatched',
      sessionId: 'demo-session',
      packId: validPack.packId,
      packVersion: validPack.version,
      sequence: 2,
      sentAt: '2026-09-15T15:00:01Z',
    };
    const result = applyLiveEvent(initialStudentLiveState, unmatched, validPack);
    expect(result).toMatchObject({ status: 'unmatched', lastSequence: 2 });
    expect(result.assetId).toBeUndefined();
    expect(result.regionId).toBeUndefined();
  });
});
