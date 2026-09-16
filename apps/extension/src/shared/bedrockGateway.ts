import { z } from 'zod';

/**
 * Future model work has one deliberately inert seam. It accepts identifiers,
 * never documents, prompts, credentials, or live student data. An approved
 * authoring service may implement this interface later; the extension itself
 * must remain useful when that service is unavailable.
 */
const ReviewedId = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:/-]+$/, 'must be a reviewed identifier');

export const DraftRequestSchema = z.object({
  packId: ReviewedId,
  assetId: ReviewedId,
  /** References only; content retrieval stays behind its separate approval gate. */
  sourceIds: z.array(ReviewedId).min(1).max(20),
}).strict();

export const ApprovedVoiceRequestSchema = z.object({
  packId: ReviewedId,
  assetId: ReviewedId,
  regionId: ReviewedId,
}).strict();

export type DraftRequest = z.infer<typeof DraftRequestSchema>;
export type ApprovedVoiceRequest = z.infer<typeof ApprovedVoiceRequestSchema>;

export class BedrockGatewayDisabledError extends Error {
  constructor() {
    super('AI authoring is disabled. The reviewed-pack demo remains available without a model connection.');
    this.name = 'BedrockGatewayDisabledError';
  }
}

export interface BedrockAgentGateway {
  readonly state: 'disabled' | 'enabled';
  createDraft(request: DraftRequest): Promise<never>;
  requestApprovedVoice(request: ApprovedVoiceRequest): Promise<never>;
}

/**
 * The only gateway shipped by the extension today. Parsing at this boundary
 * makes an accidental future call fail before it can contain student or course
 * data, while the absence of any SDK/client makes a network call impossible.
 */
export const disabledBedrockGateway: BedrockAgentGateway = {
  state: 'disabled',
  async createDraft(request) {
    DraftRequestSchema.parse(request);
    throw new BedrockGatewayDisabledError();
  },
  async requestApprovedVoice(request) {
    ApprovedVoiceRequestSchema.parse(request);
    throw new BedrockGatewayDisabledError();
  },
};

export function createBedrockGateway(): BedrockAgentGateway {
  return disabledBedrockGateway;
}
