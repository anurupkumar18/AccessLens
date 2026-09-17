// Port types for live video of the instructor's tab or window. The controller
// and the student shell only ever talk to these; the production
// implementations wrap the Amazon IVS Real-Time web SDK (ivsPublisher.ts,
// ivsSubscriber.ts) and the tests use the fakes in fixtures.ts, so neither the
// UI nor the controller tests ever load the SDK.
//
// The relay never sees the pixels. The instructor publishes one video track
// (no audio) straight to the session's stage with the publish token minted
// beside their capability; each student subscribes with their own
// subscribe-only token. The relay carries only the two `stream.*` events that
// tell students when to subscribe and when to stop.

export interface StreamPublisher {
  /**
   * Join the stage with `token` and publish `track`. Resolves once the SDK
   * reports the track published, rejects if joining or publishing fails.
   * Only ever called from the controller's Stream action, after the browser
   * chooser (charter A1).
   */
  publish(token: string, track: MediaStreamTrack): Promise<void>;
  /** Stop publishing and leave the stage. Idempotent. Never stops `track`; the capture owns it. */
  stop(): Promise<void>;
}

export interface SubscriberHandlers {
  /** The instructor's video, as a stream to hand a `<video>`; null when it went away. */
  onVideo(stream: MediaStream | null): void;
  /** One sentence for the student. The rest of the shell keeps working. */
  onError(message: string): void;
}

export interface StreamSubscriber {
  /** Join the stage with `token` and watch for the instructor's video track. */
  subscribe(token: string, handlers: SubscriberHandlers): Promise<void>;
  /** Leave the stage and release the video. Idempotent. */
  stop(): void;
}
