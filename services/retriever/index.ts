import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { ArtifactManifestSchema, type ArtifactManifest } from '../../apps/extension/src/shared/contracts';

export const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_DIMENSIONS = 256;
export const DEFAULT_K = 5;

export interface CatalogVector {
  artifactId: string;
  artifactVersion: number;
  vector: number[];
  manifest: ArtifactManifest;
}

export interface CatalogMatch {
  artifactId: string;
  artifactVersion: number;
  score: number;
  manifest: ArtifactManifest;
}

export type VectorLoader = () => Promise<readonly CatalogVector[]>;
export type EmbeddingProvider = (text: string) => Promise<readonly number[]>;

let cachedVectors: readonly CatalogVector[] | undefined;
let vectorLoader: VectorLoader = loadVectorsFromDisk;
let embeddingProvider: EmbeddingProvider = embedWithTitan;

/**
 * At a few hundred entries this brute-force scan is under 10 ms and needs no
 * search cluster. Keep it simple rather than turning the catalog into OpenSearch.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function setVectorLoader(loader: VectorLoader): void {
  vectorLoader = loader;
  cachedVectors = undefined;
}

export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  embeddingProvider = provider;
}

export function resetRetrieverDependencies(): void {
  vectorLoader = loadVectorsFromDisk;
  embeddingProvider = embedWithTitan;
  cachedVectors = undefined;
}

async function getVectors(): Promise<readonly CatalogVector[]> {
  if (!cachedVectors) cachedVectors = await vectorLoader();
  return cachedVectors;
}

export async function retrieveCatalog(conceptText: string, k = DEFAULT_K): Promise<CatalogMatch[]> {
  if (!Number.isFinite(k) || k <= 0) return [];
  const vectors = await getVectors();
  // An absent catalog is a normal Generator fallback, not an infrastructure
  // error. Avoid even making an embedding call when there is nothing to search.
  if (vectors.length === 0 || !conceptText.trim()) return [];
  const queryVector = await embeddingProvider(conceptText);
  return vectors
    .map((entry, index) => ({
      artifactId: entry.artifactId,
      artifactVersion: entry.artifactVersion,
      score: cosineSimilarity(queryVector, entry.vector),
      manifest: entry.manifest,
      index,
    }))
    // Preserve source order for equal scores; deterministic input order makes tie
    // handling stable without inventing a secondary relevance signal.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.floor(k))
    .map(({ index: _index, ...match }) => match);
}

async function loadVectorsFromDisk(): Promise<readonly CatalogVector[]> {
  const vectorsPath = process.env.CATALOG_VECTORS_PATH ?? resolve(process.cwd(), 'packages/catalog/vectors.json');
  const parsed: unknown = JSON.parse(await readFile(vectorsPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { vectors?: unknown }).vectors)) {
    throw new Error(`catalog vectors file has no vectors array: ${vectorsPath}`);
  }
  const vectors = (parsed as { vectors: unknown[] }).vectors;
  return vectors.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`catalog vector ${index} is not an object`);
    const candidate = entry as Partial<CatalogVector>;
    if (typeof candidate.artifactId !== 'string' || typeof candidate.artifactVersion !== 'number' || !Array.isArray(candidate.vector) || !candidate.vector.every(value => typeof value === 'number') || !candidate.manifest) {
      throw new Error(`catalog vector ${index} is malformed`);
    }
    if (candidate.vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`catalog vector ${index} has ${candidate.vector.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`);
    }
    const manifestResult = ArtifactManifestSchema.safeParse(candidate.manifest);
    if (!manifestResult.success) throw new Error(`catalog vector ${index} has an invalid manifest`);
    return { artifactId: candidate.artifactId, artifactVersion: candidate.artifactVersion, vector: candidate.vector, manifest: manifestResult.data };
  });
}

async function embedWithTitan(text: string): Promise<readonly number[]> {
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const response = await client.send(new InvokeModelCommand({
    modelId: EMBEDDING_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS, normalize: true })),
  }));
  if (!response.body) throw new Error('Titan returned an empty embedding response');
  const body = JSON.parse(new TextDecoder().decode(response.body)) as { embedding?: unknown };
  if (!Array.isArray(body.embedding) || !body.embedding.every(value => typeof value === 'number')) {
    throw new Error('Titan returned an invalid embedding');
  }
  return body.embedding;
}

export async function handler(event: { conceptText?: string; k?: number }): Promise<CatalogMatch[]> {
  return retrieveCatalog(event.conceptText ?? '', event.k ?? DEFAULT_K);
}
