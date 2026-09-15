// Port types for the screen source. The controller only ever talks to these
// interfaces; the production host (displayMediaHost.ts) and the test fake
// (fixtures/index.ts) both implement them, which is what makes the offscreen
// document a later swap with no controller change.

/** One RGBA frame. Lives for exactly one fingerprint pass; never stored. */
export interface Frame {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel, length === width * height * 4. */
  data: Uint8ClampedArray;
}

export interface CaptureStream {
  /** Returns the current frame, or null when none is available yet. */
  sampleFrame(): Frame | null;
  /** Releases the underlying media tracks. Idempotent. */
  stop(): void;
  /** Fires when the browser itself ends the share ("Stop sharing" bar). */
  onEnded(listener: () => void): () => void;
}

export interface CaptureHost {
  /**
   * The only path that can start capture. Must run from a user gesture; the
   * production host opens the browser's tab/window/screen chooser here.
   * Rejects (typically with a DOMException named NotAllowedError) when the
   * chooser is dismissed or denied.
   */
  requestStream(): Promise<CaptureStream>;
}
