// Test doubles for the stream ports. Tests import these directly; production
// code never does.
import type { StreamPublisher, StreamSubscriber, SubscriberHandlers } from './ports';

/** Stands in for a MediaStreamTrack in Node, where there is none. */
export function fakeVideoTrack(label = 'fake-video'): MediaStreamTrack {
  return { kind: 'video', label, id: label, readyState: 'live', stop() {} } as unknown as MediaStreamTrack;
}

export class FakePublisher implements StreamPublisher {
  readonly calls: string[] = [];
  /** The token and track of the current publish, while publishing. */
  publishing: { token: string; track: MediaStreamTrack } | null = null;
  /** When set, publish rejects with this error instead of publishing. */
  rejectWith: Error | null = null;

  async publish(token: string, track: MediaStreamTrack): Promise<void> {
    this.calls.push('publish');
    if (this.rejectWith) throw this.rejectWith;
    this.publishing = { token, track };
  }
  async stop(): Promise<void> {
    this.calls.push('stop');
    this.publishing = null;
  }
}

export class FakeSubscriber implements StreamSubscriber {
  readonly calls: string[] = [];
  /** The token of the current subscription, while subscribed. */
  subscribed: string | null = null;
  private handlers: SubscriberHandlers | null = null;

  async subscribe(token: string, handlers: SubscriberHandlers): Promise<void> {
    this.calls.push(`subscribe:${token}`);
    this.subscribed = token;
    this.handlers = handlers;
  }
  stop(): void {
    this.calls.push('stop');
    this.subscribed = null;
    this.handlers = null;
  }
  /** Simulates the instructor's video arriving (or leaving, with null). */
  deliver(stream: MediaStream | null): void { this.handlers?.onVideo(stream); }
  /** Simulates the video service failing for this student. */
  fail(message: string): void { this.handlers?.onError(message); }
}
