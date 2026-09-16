/**
 * The video stage port. No AWS import: `relay.ts` depends on this shape, the
 * Lambda wires in `ivsStage.ts`, and the tests wire in `test/memoryStage.ts`.
 *
 * Why the relay touches video at all, given that media never passes through
 * it (charter A2, decision recorded in `docs/CONTEXT_RELAY.md` §4): somebody
 * has to create the room and hand out the keys. The relay already decides who
 * is the instructor and who is a student for a session, so it is the one place
 * that can mint a publish token for the former and a subscribe token for the
 * latter without inventing an identity system. The pixels go from the
 * instructor's browser to Amazon IVS Real-Time and from there to each student;
 * the relay only ever holds the stage's ARN and the tokens it is about to hand
 * to the connection that asked.
 */

/** What a participant token lets its holder do on the stage. */
export type StreamRole = 'publish' | 'subscribe';

export interface StagePort {
  /** Create the stage for a session. Returns its ARN. */
  createStage(sessionId: string): Promise<string>;
  /** Delete a stage, disconnecting anyone still on it. Tolerates an already-deleted stage. */
  deleteStage(stageArn: string): Promise<void>;
  /**
   * Mint a token for one participant. `publish` may also subscribe; `subscribe`
   * may only watch. The token lives at most `durationSeconds`, rounded up to
   * the minute the service works in.
   */
  createToken(stageArn: string, role: StreamRole, durationSeconds: number): Promise<string>;
}
