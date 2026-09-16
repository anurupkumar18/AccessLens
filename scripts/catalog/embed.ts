import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { validateCatalog } from './validate';

export const TITAN_MODEL = 'amazon.titan-embed-text-v2:0';
export const CATALOG_EMBEDDING_DIMENSIONS = 256;
export const DEFAULT_REGION = 'us-east-1';

export interface EmbeddedCatalogVector {
  artifactId: string;
  artifactVersion: number;
  vector: number[];
  manifest: ReturnType<typeof validateCatalog>['artifacts'][number];
}

export interface CatalogVectorsFile {
  schemaVersion: '1.0';
  dimensions: 256;
  model: typeof TITAN_MODEL;
  /** Present only for the explicit development-only --skip-harness path. */
  skipHarness?: true;
  harnessReport?: string;
  vectors: EmbeddedCatalogVector[];
}

export type Embedder = (text: string) => Promise<number[]>;

export function embeddingText(manifest: EmbeddedCatalogVector['manifest']): string {
  return [manifest.title, manifest.summary, ...manifest.tags, ...manifest.subjects].join(' ');
}

export function createTitanEmbedder(): Embedder {
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? DEFAULT_REGION });
  return async (text: string) => {
    const response = await client.send(new InvokeModelCommand({
      modelId: TITAN_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(JSON.stringify({ inputText: text, dimensions: CATALOG_EMBEDDING_DIMENSIONS, normalize: true })),
    }));
    if (!response.body) throw new Error('Titan returned an empty embedding response');
    const body = JSON.parse(new TextDecoder().decode(response.body)) as { embedding?: unknown };
    if (!Array.isArray(body.embedding) || !body.embedding.every(value => typeof value === 'number')) {
      throw new Error('Titan returned an invalid embedding');
    }
    if (body.embedding.length !== CATALOG_EMBEDDING_DIMENSIONS) {
      throw new Error(`Titan returned ${body.embedding.length} dimensions; expected ${CATALOG_EMBEDDING_DIMENSIONS}`);
    }
    return body.embedding;
  };
}

function parseArgs(args: string[]): { catalogRoot: string; outputPath: string; harnessReport?: string; skipHarness: boolean } {
  let catalogRoot = resolve('packages/catalog');
  let outputPath = resolve('packages/catalog/vectors.json');
  let harnessReport: string | undefined;
  let skipHarness = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--catalog' && args[index + 1]) catalogRoot = resolve(args[++index]);
    else if (arg === '--out' && args[index + 1]) outputPath = resolve(args[++index]);
    else if (arg === '--harness-report' && args[index + 1]) harnessReport = resolve(args[++index]);
    else if (arg === '--skip-harness') skipHarness = true;
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  if (!harnessReport && !skipHarness) throw new Error('embedding requires --harness-report <path>, or explicitly pass --skip-harness');
  return { catalogRoot, outputPath, harnessReport, skipHarness };
}

async function verifyHarnessReport(path: string, artifactIds: string[]): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  const reports = Array.isArray(parsed) ? parsed : (parsed as { reports?: unknown } | null)?.reports;
  if (!Array.isArray(reports)) throw new Error(`harness report must contain a reports array: ${path}`);
  const failed = reports.filter(report => !report || typeof report !== 'object' || (report as { passed?: unknown }).passed !== true);
  const ids = new Set(reports.filter(report => report && typeof report === 'object').map(report => (report as { artifactId?: unknown }).artifactId));
  const missing = artifactIds.filter(id => !ids.has(id));
  if (failed.length || missing.length || reports.length !== artifactIds.length) {
    throw new Error(`harness report is not a complete passing report (failed=${failed.length}, missing=${missing.length}, count=${reports.length}/${artifactIds.length})`);
  }
}

export async function buildVectors(options: {
  catalogRoot?: string;
  outputPath?: string;
  harnessReport?: string;
  skipHarness?: boolean;
  embed?: Embedder;
}): Promise<CatalogVectorsFile> {
  const catalogRoot = resolve(options.catalogRoot ?? 'packages/catalog');
  const outputPath = resolve(options.outputPath ?? 'packages/catalog/vectors.json');
  const catalog = validateCatalog(catalogRoot);
  if (options.skipHarness) {
    console.warn('WARNING: --skip-harness requested; vectors.json will record skipHarness:true and must be regenerated after viewer harness validation.');
  } else if (options.harnessReport) {
    await verifyHarnessReport(options.harnessReport, catalog.artifacts.map(artifact => artifact.artifactId));
  } else {
    throw new Error('embedding requires a passing harness report or explicit skipHarness');
  }
  const embed = options.embed ?? createTitanEmbedder();
  const vectors: EmbeddedCatalogVector[] = [];
  for (const manifest of catalog.artifacts) {
    const vector = await embed(embeddingText(manifest));
    if (vector.length !== CATALOG_EMBEDDING_DIMENSIONS) throw new Error(`${manifest.artifactId} embedding has ${vector.length} dimensions`);
    vectors.push({ artifactId: manifest.artifactId, artifactVersion: manifest.artifactVersion, vector, manifest });
  }
  const output: CatalogVectorsFile = {
    schemaVersion: '1.0', dimensions: CATALOG_EMBEDDING_DIMENSIONS, model: TITAN_MODEL,
    ...(options.skipHarness ? { skipHarness: true as const } : {}),
    ...(options.harnessReport ? { harnessReport: relative(process.cwd(), options.harnessReport) } : {}), vectors,
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/catalog/embed.ts')) {
  buildVectors(parseArgs(process.argv.slice(2))).then(output => {
    console.log(`Wrote ${output.vectors.length} vectors to ${resolve(process.argv.find((arg, index) => index > 1 && process.argv[index - 1] === '--out') ?? 'packages/catalog/vectors.json')}; skipHarness=${output.skipHarness === true}`);
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
