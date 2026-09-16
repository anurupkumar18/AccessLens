import { describe, expect, it } from 'vitest';
import {
  ApprovedVoiceRequestSchema,
  BedrockGatewayDisabledError,
  DraftRequestSchema,
  createBedrockGateway,
} from './bedrockGateway';

describe('disabled Bedrock gateway placeholder', () => {
  const draftRequest = { packId: 'bio-cell-demo', assetId: 'cell-slide-03', sourceIds: ['reviewed:cell-source'] };
  const voiceRequest = { packId: 'bio-cell-demo', assetId: 'cell-slide-03', regionId: 'mitochondrion' };

  it('is disabled by construction and never returns model output', async () => {
    const gateway = createBedrockGateway();
    expect(gateway.state).toBe('disabled');
    await expect(gateway.createDraft(draftRequest)).rejects.toBeInstanceOf(BedrockGatewayDisabledError);
    await expect(gateway.requestApprovedVoice(voiceRequest)).rejects.toBeInstanceOf(BedrockGatewayDisabledError);
  });

  it.each([
    ['raw screen content', { ...draftRequest, frameData: 'base64-screen' }],
    ['student identity', { ...draftRequest, studentId: 'student-7' }],
    ['course text', { ...draftRequest, sourceText: 'private course document' }],
    ['a malformed source identifier', { ...draftRequest, sourceIds: ['source with spaces'] }],
  ])('rejects %s before a future adapter could receive it', (_label, request) => {
    expect(DraftRequestSchema.safeParse(request).success).toBe(false);
  });

  it('keeps approved voice requests identifier-only', () => {
    expect(ApprovedVoiceRequestSchema.safeParse(voiceRequest).success).toBe(true);
    expect(ApprovedVoiceRequestSchema.safeParse({ ...voiceRequest, text: 'send this to a model' }).success).toBe(false);
  });
});
