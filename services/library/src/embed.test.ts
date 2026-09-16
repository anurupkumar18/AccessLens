import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, TitanEmbedder, type EmbeddingTransport } from './embed';

describe('TitanEmbedder', () => {
  it('uses the library model and batches text in groups of sixteen', async () => {
    const calls: string[][] = [];
    const transport: EmbeddingTransport = {
      embed: vi.fn(async (texts) => {
        calls.push(texts);
        return texts.map((_: string, index: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => index + 1));
      }),
    };
    const embedder = new TitanEmbedder(transport);
    const vectors = await embedder.embed(Array.from({ length: 17 }, (_, i) => `text ${i}`));

    expect(transport.embed).toHaveBeenCalledTimes(2);
    expect(calls.map(call => call.length)).toEqual([16, 1]);
    expect(vectors).toHaveLength(17);
    expect(vectors.every(vector => vector.length === EMBEDDING_DIMENSIONS)).toBe(true);
    expect(EMBEDDING_MODEL_ID).toBe('amazon.titan-embed-text-v2:0');
  });
});

const runLive = process.env.ACCESSLENS_RUN_AWS_INTEGRATION === '1';

describe.skipIf(!runLive)('TitanEmbedder live integration', () => {
  it('gets a 1024-dimensional vector from Bedrock in us-east-1', async () => {
    const embedder = TitanEmbedder.fromBedrock({ region: 'us-east-1' });
    const [vector] = await embedder.embed(['A sentence used to prove the library embedding model works.']);
    expect(vector).toHaveLength(1024);
  }, 30_000);
});
