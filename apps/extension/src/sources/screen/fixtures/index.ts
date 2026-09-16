// Test-only fixture loaders and test doubles for the screen source. This
// module imports Node and pngjs and must never be imported by production
// code; tests reach it directly (it is one of the allowed test imports).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import type { CaptureHost, CaptureStream, Frame } from '../captureHost';
import type { Scheduler, SchedulerHandle } from '../sampler';
import testPackJson from './test-pack.json';

export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));
export const SLIDE_ASSET_IDS = ['slide-01', 'slide-02', 'slide-03', 'slide-04', 'slide-05', 'slide-06'] as const;
export type SlideAssetId = (typeof SLIDE_ASSET_IDS)[number];
export const testPack = testPackJson;

const cache = new Map<string, Frame>();

function loadPng(path: string): Frame {
  const cached = cache.get(path);
  if (cached) return cached;
  const png = PNG.sync.read(readFileSync(path));
  const frame: Frame = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
  cache.set(path, frame);
  return frame;
}

/** Clean 1920x1080 render of a slide: an approved slide, a twin, or unknown-01. */
export function loadSlideFrame(name: string): Frame {
  return loadPng(join(FIXTURE_ROOT, 'slides', `${name}.png`));
}

/** Demo-condition variant: 1280x720, noise, brightness shift, bezel. */
export function loadDemoFrame(name: SlideAssetId): Frame {
  return loadPng(join(FIXTURE_ROOT, 'slides', 'demo', `${name}.png`));
}

export function solidFrame(width: number, height: number, value: number): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  return { width, height, data };
}

// ---- Test doubles -------------------------------------------------------

export class FakeCaptureStream implements CaptureStream {
  readonly calls: string[] = [];
  private queue: Frame[] = [];
  private endedListeners = new Set<() => void>();
  stopped = false;

  /** Queue frames in the order the sampler should see them. */
  enqueue(...frames: Frame[]): void { this.queue.push(...frames); }
  get pending(): number { return this.queue.length; }

  sampleFrame(): Frame | null {
    this.calls.push('sampleFrame');
    return this.queue.shift() ?? null;
  }
  stop(): void { this.calls.push('stop'); this.stopped = true; }
  onEnded(listener: () => void): () => void {
    this.calls.push('onEnded');
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }
  /** Simulates the browser's own "Stop sharing" bar. */
  endFromBrowser(): void { this.endedListeners.forEach(l => l()); }
}

export class FakeCaptureHost implements CaptureHost {
  readonly calls: string[] = [];
  readonly stream = new FakeCaptureStream();
  /** When set, requestStream rejects with this error instead of resolving. */
  rejectWith: Error | null = null;

  static denied(): FakeCaptureHost {
    const host = new FakeCaptureHost();
    host.rejectWith = new DOMException('Permission denied', 'NotAllowedError');
    return host;
  }

  async requestStream(): Promise<CaptureStream> {
    this.calls.push('requestStream');
    if (this.rejectWith) throw this.rejectWith;
    return this.stream;
  }
}

export class FakeScheduler implements Scheduler {
  private pending: { id: number; callback: () => void }[] = [];
  private nextId = 1;
  schedule(callback: () => void, _delayMs: number): SchedulerHandle {
    const id = this.nextId++;
    this.pending.push({ id, callback });
    return id;
  }
  cancel(handle: SchedulerHandle): void {
    this.pending = this.pending.filter(p => p.id !== handle);
  }
  get pendingCount(): number { return this.pending.length; }
  /** Runs every callback that was pending at the start of each tick. */
  tick(times = 1): void {
    for (let i = 0; i < times; i++) {
      const due = this.pending;
      this.pending = [];
      due.forEach(p => p.callback());
    }
  }
}

export class FakeClock {
  private ms: number;
  constructor(startIso = '2026-09-15T15:00:00.000Z') { this.ms = Date.parse(startIso); }
  now(): string { return new Date(this.ms).toISOString(); }
  advance(ms: number): void { this.ms += ms; }
}

export const fixedIds = (sessionId = 'test-session') => ({ sessionId: () => sessionId });
