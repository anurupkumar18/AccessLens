import type { CaptureStream, Frame } from './captureHost';
import { fingerprintFrame } from './fingerprint';
import { cropToAspect } from './letterbox';

export type SchedulerHandle = unknown;

/** Injected timer so tests never use real timers. */
export interface Scheduler {
  schedule(callback: () => void, delayMs: number): SchedulerHandle;
  cancel(handle: SchedulerHandle): void;
}

export const timeoutScheduler: Scheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Two samples per second is the production default. */
export const DEFAULT_SAMPLE_INTERVAL_MS = 500;

export interface Sampler {
  start(): void;
  /** Halts synchronously: no callback fires after this returns. */
  stop(): void;
  readonly running: boolean;
}

/** Whole-frame fingerprint after trimming letterbox bars: right for a shared tab or a full-screen deck. */
export const wholeFrameFingerprint = (frame: Frame): string => fingerprintFrame(cropToAspect(frame));

/**
 * Bounded-rate loop over a CaptureStream. Each tick samples one frame,
 * fingerprints it (by default the whole frame minus letterbox bars; the
 * controller passes a slide locator so window and screen shares work too),
 * and drops it: the frame never leaves this function's stack. Only the
 * fingerprint string (or null when no frame was available) reaches the
 * callback.
 */
export function createSampler(
  stream: CaptureStream,
  scheduler: Scheduler,
  onSample: (fingerprint: string | null) => void,
  intervalMs: number = DEFAULT_SAMPLE_INTERVAL_MS,
  fingerprint: (frame: Frame) => string = wholeFrameFingerprint,
): Sampler {
  let handle: SchedulerHandle | null = null;
  let running = false;

  function tick(): void {
    if (!running) return;
    handle = null;
    const frame = stream.sampleFrame();
    onSample(frame ? fingerprint(frame) : null);
    if (running && handle === null) handle = scheduler.schedule(tick, intervalMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      handle = scheduler.schedule(tick, intervalMs);
    },
    stop() {
      running = false;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
    },
    get running() { return running; },
  };
}
