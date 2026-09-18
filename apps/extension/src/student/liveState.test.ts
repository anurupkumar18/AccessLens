import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../shared/contracts';
import { validEvent, validPack } from '../shared/fixtures';
import { MAX_RECENT_CAPTIONS, applyLiveEvent, initialStudentLiveState, markLiveStateProtocolInvalid, markLiveStateStale, markLiveStateReconnected } from './liveState';

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
      pointer: { x: 0.42, y: 0.31 },
      arState: { hotspotId: 'mitochondrion-hotspot', action: 'focus' },
      sequence: 1,
      sentAt: '2026-09-15T15:00:00Z',
    };
    const result = applyLiveEvent(initialStudentLiveState, event, validPack);
    expect(result).toMatchObject({
      status: 'live',
      assetId: 'cell-slide-03',
      regionId: 'mitochondrion',
      pointer: { x: 0.42, y: 0.31 },
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

  it('appends a caption without replacing the current region', () => {
    const withRegion = applyLiveEvent(initialStudentLiveState, { ...validEvent, sequence: 1 } as LiveEvent, validPack);
    const captioned = applyLiveEvent(withRegion, {
      schemaVersion: '1.0', type: 'caption.appended', sessionId: 'demo-session',
      packId: validPack.packId, packVersion: validPack.version,
      assetId: 'cell-slide-03', caption: { text: 'Backside attack on the electrophile.', isFinal: true },
      sequence: 2, sentAt: '2026-09-15T15:00:01Z',
    } as LiveEvent, validPack);
    expect(captioned.captions).toEqual([{ assetId: 'cell-slide-03', text: 'Backside attack on the electrophile.', isFinal: true }]);
    expect(captioned.regionId).toBe(withRegion.regionId);
    expect(captioned.assetId).toBe(withRegion.assetId);
  });

  it('caps the rolling caption transcript at MAX_RECENT_CAPTIONS', () => {
    let state = initialStudentLiveState;
    for (let i = 0; i < MAX_RECENT_CAPTIONS + 3; i++) {
      state = applyLiveEvent(state, {
        schemaVersion: '1.0', type: 'caption.appended', sessionId: 'demo-session',
        packId: validPack.packId, packVersion: validPack.version,
        assetId: 'cell-slide-03', caption: { text: `line ${i}`, isFinal: true },
        sequence: i + 1, sentAt: '2026-09-15T15:00:01Z',
      } as LiveEvent, validPack);
    }
    expect(state.captions).toHaveLength(MAX_RECENT_CAPTIONS);
    expect(state.captions[0].text).toBe('line 3');
    expect(state.captions.at(-1)?.text).toBe(`line ${MAX_RECENT_CAPTIONS + 2}`);
  });

  it('clears the caption transcript on a fresh session.started', () => {
    const captioned = applyLiveEvent(initialStudentLiveState, {
      schemaVersion: '1.0', type: 'caption.appended', sessionId: 'demo-session',
      packId: validPack.packId, packVersion: validPack.version,
      assetId: 'cell-slide-03', caption: { text: 'hello', isFinal: true },
      sequence: 1, sentAt: '2026-09-15T15:00:01Z',
    } as LiveEvent, validPack);
    expect(captioned.captions).toHaveLength(1);
    const restarted = applyLiveEvent(captioned, {
      schemaVersion: '1.0', type: 'session.started', sessionId: 'demo-session',
      packId: validPack.packId, packVersion: validPack.version,
      sequence: 2, sentAt: '2026-09-15T15:00:02Z',
    } as LiveEvent, validPack);
    expect(restarted.captions).toEqual([]);
  });

  it('keeps the current slide when supplemental screen analysis arrives', () => {
    const onSlide = applyLiveEvent(initialStudentLiveState, {
      ...validEvent, type: 'asset.changed', sequence: 1, assetId: 'cell-slide-03',
    } as LiveEvent, validPack);
    const analysed = applyLiveEvent(onSlide, {
      ...validEvent, type: 'screen.analyzed', sequence: 2,
      analysis: {
        title: 'Cell overview', summary: 'A cell diagram.', text: ['Cell'],
        audioDescription: 'A diagram of a cell.',
      },
    } as LiveEvent, validPack);
    expect(analysed.assetId).toBe('cell-slide-03');
    expect(analysed.analysis?.title).toBe('Cell overview');
  });
});

describe('applyLiveEvent: live video survives slide changes', () => {
  const started = { ...validEvent, type: 'stream.started', surface: 'browser', sequence: 10, assetId: undefined, regionId: undefined, pointer: undefined } as unknown as LiveEvent;
  const at = (type: LiveEvent['type'], sequence: number, extra: Record<string, unknown> = {}) =>
    ({ ...validEvent, assetId: undefined, regionId: undefined, pointer: undefined, type, sequence, ...extra }) as unknown as LiveEvent;

  it('keeps the stream through asset, region, unmatched and session.started events', () => {
    let state = applyLiveEvent(initialStudentLiveState, started, validPack);
    expect(state.stream).toEqual({ surface: 'browser' });
    state = applyLiveEvent(state, at('asset.changed', 11, { assetId: 'cell-slide-03' }), validPack);
    expect(state.stream).toEqual({ surface: 'browser' });
    state = applyLiveEvent(state, at('region.changed', 12, { assetId: 'cell-slide-03', regionId: 'mitochondrion' }), validPack);
    expect(state.stream).toEqual({ surface: 'browser' });
    state = applyLiveEvent(state, at('source.unmatched', 13), validPack);
    expect(state.stream).toEqual({ surface: 'browser' });
    state = applyLiveEvent(state, at('session.started', 14), validPack);
    expect(state.stream).toEqual({ surface: 'browser' });
    state = applyLiveEvent(state, at('capture.paused', 15), validPack);
    expect(state.stream).toEqual({ surface: 'browser' });
  });

  it.each(['stream.stopped', 'capture.stopped', 'session.ended'] as const)('ends the stream on %s', (type) => {
    const state = applyLiveEvent(applyLiveEvent(initialStudentLiveState, started, validPack), at(type, 11), validPack);
    expect(state.stream).toBeUndefined();
  });
});
