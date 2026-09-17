import type { StreamPublisher } from './ports';

/**
 * Publishes one video track to an Amazon IVS Real-Time stage.
 *
 * The SDK is imported on first use rather than at module load: the extension
 * bundles it (the side panel's CSP forbids remote script) but nothing needs it
 * until an instructor clicks Stream, so it stays out of the shell's first
 * paint. The strategy publishes exactly one `LocalStageStream` and subscribes
 * to nobody: the instructor is the only publisher, and watching their own
 * video would only cost bandwidth.
 */
export function createIvsPublisher(): StreamPublisher {
  let stage: import('amazon-ivs-web-broadcast').Stage | null = null;

  return {
    async publish(token, track) {
      const sdk = await import('amazon-ivs-web-broadcast');
      const local = new sdk.LocalStageStream(track, { maxFramerate: 15 });
      const strategy: import('amazon-ivs-web-broadcast').StageStrategy = {
        stageStreamsToPublish: () => [local],
        shouldPublishParticipant: () => true,
        shouldSubscribeToParticipant: () => sdk.SubscribeType.NONE,
      };
      const next = new sdk.Stage(token, strategy);
      const published = new Promise<void>((resolve, reject) => {
        next.on(sdk.StageEvents.STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED, (participant, state) => {
          if (!participant.isLocal) return;
          if (state === sdk.StageParticipantPublishState.PUBLISHED) resolve();
          if (state === sdk.StageParticipantPublishState.ERRORED) reject(new Error('The video service refused to publish this window.'));
        });
        next.on(sdk.StageEvents.STAGE_CONNECTION_STATE_CHANGED, state => {
          if (state === sdk.StageConnectionState.ERRORED) reject(new Error('Could not connect to the video service.'));
        });
        next.on(sdk.StageEvents.ERROR, error => reject(new Error(error.message)));
      });
      stage = next;
      try {
        await next.join();
        await published;
      } catch (error) {
        next.leave();
        if (stage === next) stage = null;
        throw error;
      }
    },
    async stop() {
      stage?.leave();
      stage = null;
    },
  };
}
