import { chunkStage } from './chunkStage';
import { embedStage } from './embedStage';
import { extractStage } from './extractStage';
import { verifyStage } from './verifyStage';

export { chunkStage, embedStage, extractStage, verifyStage };

/** Plain functions and names for a Step Functions adapter to wire. */
export const STAGES = {
  extract: extractStage,
  chunk: chunkStage,
  embed: embedStage,
  verify: verifyStage,
} as const;
