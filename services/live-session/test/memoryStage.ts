/**
 * In-memory `StagePort`. Records every call so a test can prove the stage was
 * created with the session, that the tokens differ by role, and that the stage
 * was deleted exactly when the session closed -- without an AWS SDK mock.
 */
import type { StagePort, StreamRole } from '../src/stage.js';

export class MemoryStage implements StagePort {
  readonly stages = new Set<string>();
  readonly calls: string[] = [];
  /** When set, createStage rejects with this error, as when the role lacks permission. */
  failCreateWith: Error | null = null;
  private counter = 0;

  async createStage(sessionId: string): Promise<string> {
    this.calls.push(`createStage:${sessionId}`);
    if (this.failCreateWith) throw this.failCreateWith;
    const arn = `arn:aws:ivs:us-east-1:000000000000:stage/${sessionId}-${++this.counter}`;
    this.stages.add(arn);
    return arn;
  }

  async deleteStage(stageArn: string): Promise<void> {
    this.calls.push(`deleteStage:${stageArn}`);
    this.stages.delete(stageArn);
  }

  async createToken(stageArn: string, role: StreamRole, durationSeconds: number): Promise<string> {
    this.calls.push(`createToken:${role}`);
    if (!this.stages.has(stageArn)) throw new Error(`no such stage ${stageArn}`);
    return `${role}-token-${stageArn.split('/')[1]}-${durationSeconds}-${++this.counter}`;
  }
}
