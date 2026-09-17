// Test-only fixture loaders and test doubles for the screen source. This
// module imports Node and pngjs and must never be imported by production
// code; tests reach it directly (it is one of the allowed test imports).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import type { CaptureHost, CaptureStream, DisplaySurface, Frame } from '../captureHost';
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

/** Nearest-neighbour scale; enough for fingerprint tests, which see block means. */
export function scaleFrame(frame: Frame, width: number, height: number): Frame {
  const out = solidFrame(width, height, 0);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(frame.height - 1, Math.floor((y * frame.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(frame.width - 1, Math.floor((x * frame.width) / width));
      const si = (sy * frame.width + sx) * 4;
      out.data.set(frame.data.subarray(si, si + 4), (y * width + x) * 4);
    }
  }
  return out;
}

/** Copies `source` onto `target` at (left, top), clipped to the target. Mutates `target`. */
export function pasteFrame(target: Frame, source: Frame, left: number, top: number): Frame {
  for (let y = 0; y < source.height; y++) {
    const ty = y + top;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < source.width; x++) {
      const tx = x + left;
      if (tx < 0 || tx >= target.width) continue;
      const si = (y * source.width + x) * 4;
      target.data.set(source.data.subarray(si, si + 4), (ty * target.width + tx) * 4);
    }
  }
  return target;
}

/**
 * A slide as a desktop viewer shows it in a shared *window*: a light toolbar
 * with controls across the top, grey margins, and the slide centred in what
 * is left. The frame the browser hands over for a window share looks like this.
 */
export function slideInWindow(slide: Frame, width: number, height: number): Frame {
  const window = solidFrame(width, height, 232);
  pasteFrame(window, solidFrame(width, 52, 246), 0, 0);
  pasteFrame(window, solidFrame(width, 1, 190), 0, 52);
  pasteFrame(window, solidFrame(180, 20, 90), 90, 16);
  pasteFrame(window, solidFrame(24, 24, 120), width - 160, 14);
  pasteFrame(window, solidFrame(24, 24, 120), width - 120, 14);
  const areaWidth = width - 40;
  const areaHeight = height - 53 - 40;
  let slideWidth = areaWidth;
  let slideHeight = Math.round((slideWidth * 9) / 16);
  if (slideHeight > areaHeight) { slideHeight = areaHeight; slideWidth = Math.round((slideHeight * 16) / 9); }
  return pasteFrame(window, scaleFrame(slide, slideWidth, slideHeight), Math.round((width - slideWidth) / 2), 53 + Math.round((height - 53 - slideHeight) / 2));
}

/** A whole-screen share: `wallpaper` filling the display, a menu bar, a dock, and `window` placed at (left, top). */
export function screenWith(wallpaper: Frame, window: Frame, left: number, top: number, width = 1440, height = 900): Frame {
  const screen = scaleFrame(wallpaper, width, height);
  pasteFrame(screen, solidFrame(width, 26, 30), 0, 0);
  pasteFrame(screen, window, left, top);
  return pasteFrame(screen, solidFrame(Math.round(width * 0.45), 54, 70), Math.round(width * 0.27), height - 54);
}

/** A macOS-style arrow pointer: black body, white outline. `scale` 2 is its size on a Retina display. */
const ARROW = [
  'W...........', 'WW..........', 'WBW.........', 'WBBW........', 'WBBBW.......', 'WBBBBW......', 'WBBBBBW.....', 'WBBBBBBW....',
  'WBBBBBBBW...', 'WBBBBBBBBW..', 'WBBBBBBBBBW.', 'WBBBBBBWWWWW', 'WBBBWBBW....', 'WBBWWBBW....', 'WBW..WBBW...', 'WW...WBBW...',
  'W.....WBBW..', '......WBBW..', '.......WW...',
];

/** Copy of `frame` with the mouse pointer's tip at (x, y). */
export function withPointer(frame: Frame, x: number, y: number, scale = 2): Frame {
  const out: Frame = { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) };
  for (let row = 0; row < ARROW.length; row++) {
    for (let col = 0; col < ARROW[row].length; col++) {
      const cell = ARROW[row][col];
      if (cell === '.') continue;
      const value = cell === 'W' ? 255 : 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x + col * scale + dx;
          const py = y + row * scale + dy;
          if (px < 0 || py < 0 || px >= out.width || py >= out.height) continue;
          const offset = (py * out.width + px) * 4;
          out.data[offset] = value; out.data[offset + 1] = value; out.data[offset + 2] = value; out.data[offset + 3] = 255;
        }
      }
    }
  }
  return out;
}

// ---- Test doubles -------------------------------------------------------

export class FakeCaptureStream implements CaptureStream {
  readonly calls: string[] = [];
  private queue: Frame[] = [];
  private endedListeners = new Set<() => void>();
  stopped = false;
  /** Set before Start to simulate picking a tab, window, or whole screen in the chooser. */
  surface?: DisplaySurface;

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
