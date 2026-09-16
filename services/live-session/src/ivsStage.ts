/**
 * `StagePort` on Amazon IVS Real-Time.
 *
 * One stage per session, named after the session so a stray stage in the
 * console can be traced back. Tokens carry no user id: IVS assigns a random
 * participant id, and nothing about a student (charter A6) ever reaches this
 * call. A subscribe token cannot publish, so a student who extracted theirs
 * still cannot put video in front of the class.
 */
import {
  CreateParticipantTokenCommand,
  CreateStageCommand,
  DeleteStageCommand,
  IVSRealTimeClient,
  ParticipantTokenCapability,
  ResourceNotFoundException,
} from '@aws-sdk/client-ivs-realtime';
import type { StagePort, StreamRole } from './stage.js';

export class IvsStage implements StagePort {
  constructor(private readonly client: IVSRealTimeClient = new IVSRealTimeClient({})) {}

  async createStage(sessionId: string): Promise<string> {
    const result = await this.client.send(new CreateStageCommand({ name: `accesslens-${sessionId}` }));
    const arn = result.stage?.arn;
    if (!arn) throw new Error('CreateStage returned no ARN');
    return arn;
  }

  async deleteStage(stageArn: string): Promise<void> {
    try {
      await this.client.send(new DeleteStageCommand({ arn: stageArn }));
    } catch (error) {
      if (error instanceof ResourceNotFoundException) return;
      throw error;
    }
  }

  async createToken(stageArn: string, role: StreamRole, durationSeconds: number): Promise<string> {
    const result = await this.client.send(
      new CreateParticipantTokenCommand({
        stageArn,
        duration: Math.max(1, Math.ceil(durationSeconds / 60)),
        capabilities:
          role === 'publish'
            ? [ParticipantTokenCapability.PUBLISH, ParticipantTokenCapability.SUBSCRIBE]
            : [ParticipantTokenCapability.SUBSCRIBE],
      }),
    );
    const token = result.participantToken?.token;
    if (!token) throw new Error('CreateParticipantToken returned no token');
    return token;
  }
}
