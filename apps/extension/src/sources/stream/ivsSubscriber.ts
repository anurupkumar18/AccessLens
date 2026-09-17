import type { StreamSubscriber } from './ports';

/**
 * Watches the instructor's video on an Amazon IVS Real-Time stage.
 *
 * Subscribes to video only from any remote participant (the stage has one
 * publisher, the instructor; subscribe-only tokens cannot publish, so no
 * student can appear here). Each video track that arrives replaces the pane's
 * stream; when the instructor's streams go away the pane clears. Loaded on
 * first use for the same reason as the publisher.
 */
export function createIvsSubscriber(): StreamSubscriber {
  let stage: import('amazon-ivs-web-broadcast').Stage | null = null;

  return {
    async subscribe(token, handlers) {
      const sdk = await import('amazon-ivs-web-broadcast');
      const strategy: import('amazon-ivs-web-broadcast').StageStrategy = {
        stageStreamsToPublish: () => [],
        shouldPublishParticipant: () => false,
        shouldSubscribeToParticipant: participant => (participant.isLocal ? sdk.SubscribeType.NONE : sdk.SubscribeType.AUDIO_VIDEO),
      };
      const next = new sdk.Stage(token, strategy);
      next.on(sdk.StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant, streams) => {
        if (participant.isLocal) return;
        const video = streams.find(s => s.streamType === sdk.StreamType.VIDEO);
        if (video) handlers.onVideo(new MediaStream([video.mediaStreamTrack]));
      });
      next.on(sdk.StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED, (participant, streams) => {
        if (participant.isLocal) return;
        if (streams.some(s => s.streamType === sdk.StreamType.VIDEO)) handlers.onVideo(null);
      });
      next.on(sdk.StageEvents.STAGE_PARTICIPANT_LEFT, participant => {
        if (!participant.isLocal) handlers.onVideo(null);
      });
      next.on(sdk.StageEvents.STAGE_CONNECTION_STATE_CHANGED, state => {
        if (state === sdk.StageConnectionState.ERRORED) handlers.onError('The live video could not connect. The lesson text still works.');
      });
      next.on(sdk.StageEvents.ERROR, () => handlers.onError('The live video could not connect. The lesson text still works.'));
      stage = next;
      try {
        await next.join();
      } catch {
        next.leave();
        if (stage === next) stage = null;
        handlers.onError('The live video could not connect. The lesson text still works.');
      }
    },
    stop() {
      stage?.leave();
      stage = null;
    },
  };
}
