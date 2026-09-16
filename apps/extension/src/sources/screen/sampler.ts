import type { CaptureStream } from './captureHost';
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

/**
 * Bounded-rate loop over a CaptureStream. Each tick samples one frame,
 * crops any letterbox or pillarbox bars down to the slide aspect,
 * fingerprints it, and drops it: the frame never leaves this function's
 * stack. Only the fingerprint string (or null when no frame was available)
 * reaches the callback.
 */
export function createSampler(
  stream: CaptureStream,
  scheduler: Scheduler,
  onSample: (fingerprint: string | null, frame?: import('./captureHost').Frame) => void,
  intervalMs: number = DEFAULT_SAMPLE_INTERVAL_MS,
): Sampler {
  let handle: SchedulerHandle | null = null;
  let running = false;

  function tick(): void {
    if (!running) return;
    handle = null;
    const frame = stream.sampleFrame();
    const fingerprint = frame ? fingerprintFrame(cropToAspect(frame)) : null;
    onSample(fingerprint, frame ?? undefined);
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
