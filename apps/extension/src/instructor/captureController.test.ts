import { describe, it, expect, vi } from 'vitest';
import { AccessPackSchema, InMemorySessionClient, LiveEventSchema, type LiveEvent } from '../shared/contracts';
import type { CaptureStream } from '../sources/screen/captureHost';
import { createCaptureController } from './index';
import {
  FakeCaptureHost, FakeClock, FakeScheduler, fixedIds, loadDemoFrame, loadSlideFrame, screenWith, slideInWindow, testPack,
} from '../sources/screen/fixtures';
import type { DisplaySurface, Frame } from '../sources/screen';
import reviewedPackJson from '../../../../packages/access-packs/bio-cell-demo/pack.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

function loadPng(repoPath: string): Frame {
  const image = PNG.sync.read(readFileSync(join(__dirname, '../../../..', repoPath)));
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

const pack = AccessPackSchema.parse(testPack);

function setup(host = new FakeCaptureHost()) {
  const client = new InMemorySessionClient();
  const scheduler = new FakeScheduler();
  const clock = new FakeClock();
  const events: LiveEvent[] = [];
  client.subscribe(e => events.push(e));
  const controller = createCaptureController({ client, pack, host, scheduler, clock, ids: fixedIds('sess-1') });
  return { controller, client, host, scheduler, clock, events, stream: host.stream };
}

async function sharing() {
  const s = setup();
  await s.controller.start();
  return s;
}

const types = (events: LiveEvent[]) => events.map(e => e.type);
const demo = (id: 'slide-01' | 'slide-02' | 'slide-03' | 'slide-04' | 'slide-05' | 'slide-06') => loadDemoFrame(id);
const unknown = () => loadSlideFrame('unknown-01');

describe('capture controller: start and permission flow (A1, A3)', () => {
  it('constructing the controller and loading the pack calls nothing on the host', () => {
    const { host, events, controller } = setup();
    expect(host.calls).toEqual([]);
    expect(events).toEqual([]);
    expect(controller.getState().phase).toBe('idle');
  });

  it('start() calls requestStream exactly once and emits session.started with sequence 1 before any sample', async () => {
    const { controller, host, events, stream } = setup();
    await controller.start();
    expect(host.calls).toEqual(['requestStream']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'session.started', sequence: 1, sessionId: 'sess-1', packId: 'bio-cell-demo', packVersion: 1 });
    expect(stream.calls.filter(c => c === 'sampleFrame')).toEqual([]);
    expect(controller.getState()).toMatchObject({ phase: 'sharing', sessionId: 'sess-1' });
  });

  it('opens the browser chooser before awaiting session creation so window and display capture retain user activation', async () => {
    const host = new FakeCaptureHost();
    const client = new InMemorySessionClient();
    const order: string[] = [];
    const originalCreate = client.create.bind(client);
    const originalRequest = host.requestStream.bind(host);
    client.create = async (sessionId: string) => { order.push('create'); return originalCreate(sessionId); };
    host.requestStream = async () => { order.push('requestStream'); return originalRequest(); };
    const controller = createCaptureController({ client, pack, host, scheduler: new FakeScheduler(), ids: fixedIds('sess-gesture') });

    await controller.start();

    expect(order).toEqual(['requestStream', 'create']);
  });

  it('does not create a temporary session until the instructor grants capture', async () => {
    const host = new FakeCaptureHost();
    const client = new InMemorySessionClient();
    let allowCapture: ((stream: CaptureStream) => void) | undefined;
    const create = client.create.bind(client);
    const createSpy = vi.fn(create);
    client.create = createSpy;
    host.requestStream = () => new Promise<CaptureStream>((resolve) => { allowCapture = resolve; });
    const controller = createCaptureController({ client, pack, host, scheduler: new FakeScheduler(), ids: fixedIds('sess-consent') });

    const starting = controller.start();
    await Promise.resolve();
    expect(createSpy).not.toHaveBeenCalled();

    allowCapture!(host.stream);
    await starting;
    expect(createSpy).toHaveBeenCalledWith('sess-consent');
  });

  it('stops an already-granted stream when session creation fails', async () => {
    const host = new FakeCaptureHost();
    const client = new InMemorySessionClient();
    client.create = async () => { throw new Error('relay unavailable'); };
    const controller = createCaptureController({ client, pack, host, scheduler: new FakeScheduler(), ids: fixedIds('sess-failed-create') });

    await controller.start();

    expect(host.stream.calls).toContain('stop');
    expect(controller.getState()).toMatchObject({ phase: 'idle', message: 'Could not open a session. Check the connection and try Start again.' });
  });

  it('a denied chooser emits nothing, returns to idle with an explanation, and still called requestStream once', async () => {
    const { controller, host, events } = setup(FakeCaptureHost.denied());
    await controller.start();
    expect(host.calls).toEqual(['requestStream']);
    expect(events).toEqual([]);
    const state = controller.getState();
    expect(state.phase).toBe('idle');
    expect(state.message).toMatch(/sharing is required/i);
  });
});

describe('capture controller: recognition and event mapping (A4)', () => {
  it('five scripted slide changes produce exactly five asset.changed events in order with consecutive sequences', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-01'), demo('slide-01'));
    scheduler.tick(2);
    expect(types(events)).toEqual(['session.started', 'asset.changed']);
    const before = events.length;

    stream.enqueue(
      demo('slide-02'), demo('slide-02'),
      demo('slide-03'),
      demo('slide-04'), demo('slide-04'), demo('slide-04'),
      demo('slide-05'),
      demo('slide-06'), demo('slide-06'),
    );
    scheduler.tick(9);
    const transitions = events.slice(before);
    expect(transitions.map(e => e.type)).toEqual(['asset.changed', 'asset.changed', 'asset.changed', 'asset.changed', 'asset.changed']);
    expect(transitions.map(e => (e as { assetId: string }).assetId)).toEqual(['slide-02', 'slide-03', 'slide-04', 'slide-05', 'slide-06']);
    const sequences = events.map(e => e.sequence);
    expect(sequences).toEqual(sequences.map((_, i) => i + 1));
    expect(controller.getState().current).toMatchObject({ kind: 'matched', assetId: 'slide-06', title: 'Summary' });
  });

  it('a single unknown frame between two approved frames emits nothing extra', async () => {
    const { stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-01'), unknown(), demo('slide-02'));
    scheduler.tick(3);
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'asset.changed']);
  });

  it('three consecutive unknown frames emit exactly one source.unmatched; thirty more emit nothing further', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-01'), unknown(), unknown());
    scheduler.tick(3);
    expect(types(events)).toEqual(['session.started', 'asset.changed']);
    stream.enqueue(unknown());
    scheduler.tick(1);
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'source.unmatched']);
    expect(events[2]).not.toHaveProperty('assetId');
    expect(controller.getState().current).toEqual({ kind: 'unmatched' });
    for (let i = 0; i < 30; i++) stream.enqueue(unknown());
    scheduler.tick(30);
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'source.unmatched']);
  });

  it('a fresh session with three unknown frames also reports source.unmatched', async () => {
    const { stream, scheduler, events } = await sharing();
    stream.enqueue(unknown(), unknown(), unknown());
    scheduler.tick(3);
    expect(types(events)).toEqual(['session.started', 'source.unmatched']);
  });

  it('ticks with no frame available emit nothing and do not count toward the unmatched debounce', async () => {
    const { stream, scheduler, events } = await sharing();
    scheduler.tick(5);
    stream.enqueue(unknown(), unknown());
    scheduler.tick(2);
    scheduler.tick(3);
    expect(types(events)).toEqual(['session.started']);
  });
});

describe('capture controller: pause, resume, stop, end (A5)', () => {
  it('pause() emits capture.paused and halts sampling; resume() emits capture.resumed and continues', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-01'));
    scheduler.tick(1);
    controller.pause();
    expect(types(events).at(-1)).toBe('capture.paused');
    expect(controller.getState().phase).toBe('paused');
    const samplesBefore = stream.calls.filter(c => c === 'sampleFrame').length;
    stream.enqueue(demo('slide-02'), demo('slide-03'));
    scheduler.tick(5);
    expect(stream.calls.filter(c => c === 'sampleFrame').length).toBe(samplesBefore);
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'capture.paused']);
    expect(stream.stopped).toBe(false);

    controller.resume();
    expect(types(events).at(-1)).toBe('capture.resumed');
    scheduler.tick(2);
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'capture.paused', 'capture.resumed', 'asset.changed', 'asset.changed']);
  });

  it('stop() emits capture.stopped, releases the stream, and later frames never produce events', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-01'));
    scheduler.tick(1);
    controller.stop();
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'capture.stopped']);
    expect(stream.calls).toContain('stop');
    expect(controller.getState()).toMatchObject({ phase: 'idle', sessionId: 'sess-1' });
    stream.enqueue(demo('slide-02'), demo('slide-03'), unknown(), unknown(), unknown());
    scheduler.tick(50);
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'capture.stopped']);
  });

  it('the browser ending the stream has the same effect as stop()', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.endFromBrowser();
    expect(types(events)).toEqual(['session.started', 'capture.stopped']);
    expect(controller.getState().phase).toBe('idle');
    stream.enqueue(demo('slide-02'));
    scheduler.tick(10);
    expect(types(events)).toEqual(['session.started', 'capture.stopped']);
  });

  it('start() after stop() reuses the open session and continues the sequence', async () => {
    const { controller, host, events } = await sharing();
    controller.stop();
    await controller.start();
    expect(host.calls).toEqual(['requestStream', 'requestStream']);
    expect(types(events)).toEqual(['session.started', 'capture.stopped', 'session.started']);
    expect(events.map(e => e.sequence)).toEqual([1, 2, 3]);
    expect(events.every(e => e.sessionId === 'sess-1')).toBe(true);
  });

  it('endSession() after a stop closes the client so a further send throws', async () => {
    const { controller, client, events } = await sharing();
    controller.stop();
    controller.endSession();
    expect(types(events)).toEqual(['session.started', 'capture.stopped', 'session.ended']);
    expect(controller.getState()).toMatchObject({ phase: 'closed', sessionId: null });
    expect(() => client.send(events[0])).toThrow(/closed/);
  });

  it('endSession() while sharing stops first (capture.stopped) and then ends', async () => {
    const { controller, client, stream, events } = await sharing();
    controller.endSession();
    expect(types(events)).toEqual(['session.started', 'capture.stopped', 'session.ended']);
    expect(stream.stopped).toBe(true);
    expect(() => client.send(events[0])).toThrow(/closed/);
  });
});

describe('capture controller: manual correction and region indication (A5)', () => {
  it('correct({ assetId }) emits asset.changed for that asset', async () => {
    const { controller, events } = await sharing();
    controller.correct({ assetId: 'slide-04' });
    expect(events.at(-1)).toMatchObject({ type: 'asset.changed', assetId: 'slide-04', sequence: 2 });
    expect(controller.getState().current).toMatchObject({ kind: 'matched', assetId: 'slide-04', regionId: null });
  });

  it('correct({ assetId, regionId }) emits asset.changed then region.changed carrying both IDs', async () => {
    const { controller, events } = await sharing();
    controller.correct({ assetId: 'slide-04', regionId: 'nucleolus' });
    expect(events.slice(1)).toMatchObject([
      { type: 'asset.changed', assetId: 'slide-04', sequence: 2 },
      { type: 'region.changed', assetId: 'slide-04', regionId: 'nucleolus', sequence: 3 },
    ]);
    expect(controller.getState().current).toMatchObject({ kind: 'matched', assetId: 'slide-04', regionId: 'nucleolus' });
  });

  it('correcting to the current asset with a region emits only region.changed', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-02'));
    scheduler.tick(1);
    controller.correct({ assetId: 'slide-02', regionId: 'membrane' });
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'region.changed']);
  });

  it('indicateRegion(regionId) on a current asset emits region.changed with the current asset ID', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-05'));
    scheduler.tick(1);
    controller.indicateRegion('reticulum');
    expect(events.at(-1)).toMatchObject({ type: 'region.changed', assetId: 'slide-05', regionId: 'reticulum' });
  });

  it('rejects unknown asset or region IDs without emitting', async () => {
    const { controller, events } = await sharing();
    expect(() => controller.correct({ assetId: 'not-a-slide' })).toThrow();
    expect(() => controller.correct({ assetId: 'slide-01', regionId: 'nucleolus' })).toThrow();
    expect(() => controller.indicateRegion('cell-outline')).toThrow();
    expect(types(events)).toEqual(['session.started']);
  });

  it('a correction is sticky: identical frames stay quiet, a clearly different approved slide re-triggers', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-01'), demo('slide-01'));
    scheduler.tick(2);
    controller.correct({ assetId: 'slide-03' });
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'asset.changed']);
    for (let i = 0; i < 10; i++) stream.enqueue(demo('slide-01'));
    scheduler.tick(10);
    expect(types(events)).toEqual(['session.started', 'asset.changed', 'asset.changed']);
    expect(controller.getState().current).toMatchObject({ assetId: 'slide-03' });
    stream.enqueue(demo('slide-06'));
    scheduler.tick(1);
    expect(events.at(-1)).toMatchObject({ type: 'asset.changed', assetId: 'slide-06' });
  });
});

describe('capture controller: live captions (T-16)', () => {
  it('sendCaption emits caption.appended scoped to the current asset', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-02'));
    scheduler.tick(1);
    controller.sendCaption('  The mitochondrion releases usable energy.  ');
    expect(events.at(-1)).toMatchObject({
      type: 'caption.appended', assetId: 'slide-02',
      caption: { text: 'The mitochondrion releases usable energy.', isFinal: true },
    });
  });

  it('rejects an empty or whitespace-only caption without emitting', async () => {
    const { controller, events } = await sharing();
    expect(() => controller.sendCaption('   ')).toThrow();
    expect(types(events)).toEqual(['session.started']);
  });

  it('rejects a caption over 280 characters without emitting', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-02'));
    scheduler.tick(1);
    const before = types(events);
    expect(() => controller.sendCaption('x'.repeat(281))).toThrow();
    expect(types(events)).toEqual(before);
  });

  it('rejects a caption with no current matched asset', async () => {
    const { controller } = await sharing();
    expect(() => controller.sendCaption('hello')).toThrow();
  });

  it('rejects a caption while not sharing', async () => {
    const { controller } = await sharing();
    controller.stop();
    expect(() => controller.sendCaption('hello')).toThrow();
  });
});

describe('capture controller: contract and privacy invariants (A2)', () => {
  it('every emitted event passes LiveEventSchema and the state snapshot never carries frame data', async () => {
    const { controller, stream, scheduler, events } = await sharing();
    stream.enqueue(demo('slide-01'), unknown(), unknown(), unknown(), demo('slide-02'));
    scheduler.tick(5);
    controller.correct({ assetId: 'slide-04', regionId: 'nucleus' });
    controller.pause();
    controller.resume();
    controller.stop();
    expect(events.length).toBeGreaterThan(6);
    for (const event of events) expect(LiveEventSchema.safeParse(event).success).toBe(true);

    const forbiddenKeys = new Set(['data', 'frame', 'pixels']);
    const walk = (value: unknown): void => {
      expect(value).not.toBeInstanceOf(Uint8ClampedArray);
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          expect(forbiddenKeys.has(key)).toBe(false);
          walk(child);
        }
      }
    };
    walk(controller.getState());
    const serialised = JSON.stringify(controller.getState());
    expect(serialised).not.toMatch(/"(data|frame|pixels)"/);
    for (const event of events) expect(JSON.stringify(event)).not.toMatch(/"(data|frame|pixels)"/);
  });

  it('sentAt comes from the injected clock', async () => {
    const { controller, clock, events } = await sharing();
    clock.advance(1500);
    controller.correct({ assetId: 'slide-02' });
    expect(events[0].sentAt).toBe('2026-09-15T15:00:00.000Z');
    expect(events[1].sentAt).toBe('2026-09-15T15:00:01.500Z');
  });
});

describe('capture controller: window and whole-screen shares', () => {
  // The reviewed pack's second slide shown in a viewer window: toolbar and
  // margins push the whole-frame fingerprint past the threshold, which is the
  // failure instructors hit when they picked "Window" or "Entire screen".
  const reviewedPack = AccessPackSchema.parse(reviewedPackJson);
  const windowed = () => slideInWindow(loadPng('packages/access-packs/bio-cell-demo/slides/cell-slide-02.png'), 900, 900);

  function setupReviewed(surface: DisplaySurface | undefined) {
    const host = new FakeCaptureHost();
    host.stream.surface = surface;
    const client = new InMemorySessionClient();
    const scheduler = new FakeScheduler();
    const events: LiveEvent[] = [];
    client.subscribe(e => events.push(e));
    const controller = createCaptureController({ client, pack: reviewedPack, host, scheduler, clock: new FakeClock(), ids: fixedIds('sess-w') });
    return { controller, scheduler, events, stream: host.stream };
  }

  it('finds the slide inside a shared window and reports the surface', async () => {
    const { controller, scheduler, events, stream } = setupReviewed('window');
    await controller.start();
    expect(controller.getState().surface).toBe('window');
    stream.enqueue(windowed(), windowed());
    scheduler.tick(2);
    expect(events.filter(e => e.type === 'asset.changed')).toMatchObject([{ assetId: 'cell-slide-02' }]);
  });

  it('searches a whole-screen share the same way', async () => {
    const { controller, scheduler, events, stream } = setupReviewed('monitor');
    await controller.start();
    const screen = () => screenWith(loadSlideFrame('unknown-01'), windowed(), 40, 80);
    stream.enqueue(screen(), screen());
    scheduler.tick(2);
    expect(events.filter(e => e.type === 'asset.changed')).toMatchObject([{ assetId: 'cell-slide-02' }]);
  });

  it('keeps a shared tab on the whole-frame path, so a tab showing a window screenshot is still unmatched', async () => {
    const { controller, scheduler, events, stream } = setupReviewed('browser');
    await controller.start();
    stream.enqueue(windowed(), windowed(), windowed());
    scheduler.tick(3);
    expect(types(events)).toEqual(['session.started', 'source.unmatched']);
  });
});
