import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

/** Library embeddings deliberately use 1024 dimensions (catalog uses another index). */
export const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_BATCH_SIZE = 16;

type EmbeddingVector = number[];

export interface EmbeddingTransport {
  embed(texts: readonly string[]): Promise<EmbeddingVector[]>;
}

interface BedrockEmbeddingResponse {
  embedding?: number[];
  embeddingsByType?: { float?: number[] };
  inputTextTokenCount?: number;
}

/** A small transport around Bedrock, injectable so all unit tests stay offline. */
export class BedrockEmbeddingTransport implements EmbeddingTransport {
  constructor(private readonly client: Pick<BedrockRuntimeClient, 'send'>) {}

  async embed(texts: readonly string[]): Promise<EmbeddingVector[]> {
    const vectors: EmbeddingVector[] = [];
    for (const text of texts) {
      const response = await this.client.send(new InvokeModelCommand({
        modelId: EMBEDDING_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: new TextEncoder().encode(JSON.stringify({
          inputText: text,
          dimensions: EMBEDDING_DIMENSIONS,
          normalize: true,
        })),
      }));
      const payload = JSON.parse(new TextDecoder().decode(response.body)) as BedrockEmbeddingResponse;
      const vector = payload.embedding ?? payload.embeddingsByType?.float;
      if (!vector) throw new Error('Titan embedding response did not contain an embedding');
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Titan embedding returned ${vector.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`);
      }
      vectors.push(vector);
    }
    return vectors;
  }
}

/** Batches calls at the API boundary so a stage never has to know Bedrock limits. */
export class TitanEmbedder {
  constructor(private readonly transport: EmbeddingTransport) {}

  static fromBedrock(options: { region?: string } = {}): TitanEmbedder {
    return new TitanEmbedder(new BedrockEmbeddingTransport(new BedrockRuntimeClient({
      region: options.region ?? process.env.AWS_REGION ?? 'us-east-1',
    })));
  }

  async embed(texts: readonly string[]): Promise<EmbeddingVector[]> {
    const vectors: EmbeddingVector[] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
      const result = await this.transport.embed(batch);
      if (result.length !== batch.length) {
        throw new Error(`Embedding transport returned ${result.length} vectors for ${batch.length} texts`);
      }
      for (const vector of result) {
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`Embedding vector has ${vector.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`);
        }
      }
      vectors.push(...result);
    }
    return vectors;
  }
}

export type { EmbeddingVector };
