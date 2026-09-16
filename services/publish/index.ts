import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AccessPackSchema, ArtifactManifestSchema, type AccessPack } from '../../apps/extension/src/shared/contracts';
import { JobRecordSchema, type Deck, type JobRecord, type ReviewDecision } from '../shared/jobs';

export type PackAsset = AccessPack['assets'][number];

/** A Pack Author/Audio output before publish adds the deterministic fingerprint and paths. */
export type StagedAsset = Omit<PackAsset, 'fingerprint'> & { fingerprint?: string };

export interface ObjectStore {
  /** List object keys under a prefix. */
  list(prefix: string): Promise<readonly string[]>;
  /** Read an object; publish uses this for preflight validation before public writes. */
  read(key: string): Promise<Uint8Array>;
  write(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  copy(source: string, destination: string, contentType?: string): Promise<void>;
}

export interface PublishPackInput {
  job: JobRecord;
  deck: Deck;
  /** One staged draft asset for every slide in deck.slides. */
  assets: readonly StagedAsset[];
  /** Public CloudFront base URL, without a trailing slash. */
  publicBaseUrl?: string;
  /** The review metadata is deliberately opaque; no student identity belongs here. */
  reviewedBy?: string;
  publishedAt?: string;
}

export interface PublishResult {
  pack: AccessPack;
  packId: string;
  version: number;
  packKey: string;
  packUrl: string;
}

export class PublishValidationError extends Error {
  readonly code = 'invalid_publish';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PublishValidationError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

interface CopyPlan {
  source: string;
  destination: string;
  contentType: string;
}

const CONTENT_TYPES = {
  image: 'image/png',
  audio: 'audio/mpeg',
  json: 'application/json',
  artifact: 'application/octet-stream',
} as const;

function stagingPrefix(jobId: string): string {
  return `staging/${jobId}/`;
}

function ensureStagedKey(key: string, jobId: string, what: string): void {
  const prefix = stagingPrefix(jobId);
  if (!key.startsWith(prefix) || key.includes('..')) {
    throw new PublishValidationError(`${what} must be under ${prefix}; received ${key}`);
  }
}

function keyPart(value: string): string {
  // Asset and region ids are contract-controlled strings. This additional
  // normalization keeps generated media keys single-level if a direct Lambda
  // caller bypasses the API's pack-id/region-id conventions.
  return value.replace(/[^a-zA-Z0-9._-]/gu, '-');
}

function publishedMediaKey(packId: string, version: number, assetId: string): string {
  return `media/${keyPart(packId)}/${version}/${keyPart(assetId)}.png`;
}

function publishedAudioKey(packId: string, version: number, assetId: string, regionId: string): string {
  return `media/${keyPart(packId)}/${version}/${keyPart(assetId)}.${keyPart(regionId)}.mp3`;
}

function versionFromKey(key: string, packId: string): number | undefined {
  const prefix = `packs/${packId}/`;
  if (!key.startsWith(prefix)) return undefined;
  const match = new RegExp(`^packs/${escapeRegExp(packId)}/([1-9][0-9]*)\\.json$`, 'u').exec(key);
  return match ? Number(match[1]) : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function nextVersion(store: ObjectStore, packId: string): Promise<number> {
  const keys = await store.list(`packs/${packId}/`);
  const versions = keys
    .map(key => versionFromKey(key, packId))
    .filter((version): version is number => version !== undefined);
  return Math.max(0, ...versions) + 1;
}

function decisionSet(job: JobRecord, assetId: string): ReviewDecision[] {
  return job.decisions.filter(decision => decision.assetId === assetId);
}

function mergeDecisionState(decisions: readonly ReviewDecision[]): {
  rejectedRegions: Set<string>;
  edits: Map<string, { shortDescription?: string; plainLanguage?: string }>;
  visualization?: ReviewDecision['visualization'];
  parameters: Record<string, unknown>;
} {
  const rejectedRegions = new Set<string>();
  const edits = new Map<string, { shortDescription?: string; plainLanguage?: string }>();
  let visualization: ReviewDecision['visualization'];
  const parameters: Record<string, unknown> = {};
  for (const decision of decisions) {
    for (const regionId of decision.rejectRegions ?? []) rejectedRegions.add(regionId);
    for (const edit of decision.regionEdits ?? []) {
      edits.set(edit.regionId, {
        ...edits.get(edit.regionId),
        ...(edit.shortDescription === undefined ? {} : { shortDescription: edit.shortDescription }),
        ...(edit.plainLanguage === undefined ? {} : { plainLanguage: edit.plainLanguage }),
      });
    }
    if (decision.visualization !== undefined) visualization = decision.visualization;
    Object.assign(parameters, decision.parameters ?? {});
  }
  return { rejectedRegions, edits, visualization, parameters };
}

function applyDecision(asset: StagedAsset, decisions: readonly ReviewDecision[], deckFingerprint: string, input: PublishPackInput, version: number): {
  asset: PackAsset;
  media: CopyPlan[];
  artifactRoots: string[];
} {
  const state = mergeDecisionState(decisions);
  const regions = asset.regions.map(region => {
    const edit = state.edits.get(region.regionId);
    if (!edit) return { ...region };
    return {
      ...region,
      ...(edit.shortDescription === undefined ? {} : { shortDescription: edit.shortDescription }),
      ...(edit.plainLanguage === undefined ? {} : { plainLanguage: edit.plainLanguage }),
    };
  });
  const existingRegionIds = new Set(regions.map(region => region.regionId));
  for (const regionId of state.rejectedRegions) {
    if (!existingRegionIds.has(regionId)) {
      throw new PublishValidationError(`review decision for ${asset.assetId} names unknown region ${regionId}`);
    }
  }
  for (const regionId of state.edits.keys()) {
    if (!existingRegionIds.has(regionId)) {
      throw new PublishValidationError(`review decision for ${asset.assetId} edits unknown region ${regionId}`);
    }
  }
  const keptRegions = regions.filter(region => !state.rejectedRegions.has(region.regionId));
  const readingOrder = asset.readingOrder.filter(id => !state.rejectedRegions.has(id));
  const destinationMedia = publishedMediaKey(input.job.packId, version, asset.assetId);
  const slide = input.deck.slides.find(candidate => candidate.assetId === asset.assetId);
  if (!slide) throw new PublishValidationError(`staged asset ${asset.assetId} has no corresponding deck slide`);
  ensureStagedKey(slide.mediaKey, input.job.jobId, `slide ${asset.assetId} media`);

  const sourceMedia = asset.mediaUri ?? slide.mediaKey;
  ensureStagedKey(sourceMedia, input.job.jobId, `slide ${asset.assetId} media`);
  const media: CopyPlan[] = [{ source: sourceMedia, destination: destinationMedia, contentType: CONTENT_TYPES.image }];
  const rewrittenRegions = keptRegions.map(region => {
    if (!region.audioUri) return region;
    ensureStagedKey(region.audioUri, input.job.jobId, `audio for ${asset.assetId}/${region.regionId}`);
    const destination = publishedAudioKey(input.job.packId, version, asset.assetId, region.regionId);
    media.push({ source: region.audioUri, destination, contentType: CONTENT_TYPES.audio });
    return { ...region, audioUri: destination };
  });

  let visualization: PackAsset['visualization'];
  const artifactRoots: string[] = [];
  if (asset.visualization && state.visualization === 'approve') {
    visualization = {
      ...asset.visualization,
      parameters: { ...asset.visualization.parameters, ...state.parameters },
    };
    artifactRoots.push(`staging/${input.job.jobId}/artifacts/${keyPart(visualization.artifactId)}/${visualization.artifactVersion}/`);
  } else if (asset.visualization && state.visualization === undefined) {
    // A candidate is not student-visible merely because the asset was reviewed;
    // its own visualization decision is required by charter A3.
    visualization = undefined;
  } else if (asset.visualization && state.visualization === 'reject') {
    visualization = undefined;
  } else if (asset.visualization && state.visualization === 'regenerate') {
    visualization = undefined;
  }

  const publishedAsset: PackAsset = {
    assetId: asset.assetId,
    mediaUri: destinationMedia,
    fingerprint: deckFingerprint,
    title: asset.title,
    readingOrder,
    regions: rewrittenRegions,
    ...(asset.subtitle === undefined ? {} : { subtitle: asset.subtitle }),
    ...(asset.references === undefined ? {} : { references: asset.references }),
    ...(visualization === undefined ? {} : { visualization }),
  };
  return { asset: publishedAsset, media, artifactRoots };
}

function reviewRecord(input: PublishPackInput, publishedAt: string): AccessPack['review'] {
  return {
    status: 'instructor-reviewed',
    reviewedBy: input.reviewedBy ?? 'instructor',
    reviewedAt: publishedAt,
    externalSubjectMatterReview: false,
  };
}

function buildPack(input: PublishPackInput, version: number, publishedAssets: PackAsset[], publishedAt: string): AccessPack {
  try {
    return AccessPackSchema.parse({
      schemaVersion: '1.0',
      packId: input.job.packId,
      version,
      title: input.job.title,
      review: reviewRecord(input, publishedAt),
      matching: input.deck.matching,
      assets: publishedAssets,
    });
  } catch (error) {
    throw new PublishValidationError('finished pack fails AccessPackSchema validation', { cause: error });
  }
}

async function preflightPlan(store: ObjectStore, media: readonly CopyPlan[], artifactRoots: readonly string[]): Promise<CopyPlan[]> {
  for (const item of media) {
    await store.read(item.source);
  }
  const artifacts: CopyPlan[] = [];
  for (const root of artifactRoots) {
    const sourceKeys = await store.list(root);
    if (sourceKeys.length === 0) throw new PublishValidationError(`approved artifact has no staged objects under ${root}`);
    let sawManifest = false;
    for (const source of sourceKeys) {
      const relative = source.slice(root.length).replace(/^\/+/, '');
      if (!relative || relative.includes('..')) throw new PublishValidationError(`invalid staged artifact key ${source}`);
      const body = await store.read(source);
      // The staged manifest is what the viewer will trust once it sits under
      // artifacts/. Parse it here, before any public write, so a malformed or
      // unblessed artifact can never be approved into the published tree.
      if (relative === 'manifest.json') {
        sawManifest = true;
        try {
          ArtifactManifestSchema.parse(JSON.parse(new TextDecoder().decode(body)));
        } catch (error) {
          throw new PublishValidationError(`approved artifact manifest at ${source} is invalid`, { cause: error });
        }
      }
      artifacts.push({
        source,
        destination: `artifacts/${root.slice(root.indexOf('/artifacts/') + '/artifacts/'.length)}${relative}`,
        contentType: source.endsWith('.json') ? CONTENT_TYPES.json : CONTENT_TYPES.artifact,
      });
    }
    if (!sawManifest) throw new PublishValidationError(`approved artifact has no manifest.json under ${root}`);
  }
  return [...media, ...artifacts];
}

/**
 * Deterministically publishes one reviewed draft. All validation and source
 * preflight happens before the first copy/write in a published prefix. The
 * pack JSON is written last, after its media and approved artifact copies.
 */
export async function publishPack(input: PublishPackInput, store: ObjectStore): Promise<PublishResult> {
  const parsedJob = JobRecordSchema.parse(input.job);
  if (parsedJob.packId !== input.deck.packId) throw new PublishValidationError('job packId and deck packId do not match');
  if (parsedJob.jobId !== input.deck.jobId) throw new PublishValidationError('jobId and deck jobId do not match');
  if (parsedJob.status !== 'review' && parsedJob.status !== 'publishing') {
    throw new PublishValidationError(`job ${parsedJob.jobId} is not ready to publish (status ${parsedJob.status})`);
  }

  const deckIds = input.deck.slides.map(slide => slide.assetId);
  const stagedById = new Map<string, StagedAsset>();
  for (const asset of input.assets) {
    if (stagedById.has(asset.assetId)) throw new PublishValidationError(`duplicate staged asset ${asset.assetId}`);
    stagedById.set(asset.assetId, asset);
    if (!parsedJob.reviewedAssetIds.includes(asset.assetId)) {
      // This is deliberately checked before listing or writing any destination
      // key. It is the A3 gate: no asset outside the job's human approval set
      // can reach a published pack.
      throw new PublishValidationError(`asset ${asset.assetId} is not reviewed and cannot be published`);
    }
  }
  if (stagedById.size !== deckIds.length || deckIds.some(assetId => !stagedById.has(assetId))) {
    throw new PublishValidationError('published pack must contain exactly one staged asset for every deck slide');
  }
  const deckIdSet = new Set(deckIds);
  for (const reviewedId of parsedJob.reviewedAssetIds) {
    if (!deckIdSet.has(reviewedId)) throw new PublishValidationError(`reviewed asset ${reviewedId} is not present in the deck`);
  }

  const base = input.publicBaseUrl ?? process.env.PUBLIC_BASE_URL;
  if (!base) throw new PublishValidationError('publicBaseUrl is required to construct the published pack URL');

  const version = await nextVersion(store, parsedJob.packId);
  const publishedAt = input.publishedAt ?? new Date().toISOString();
  const publishedAssets: PackAsset[] = [];
  const media: CopyPlan[] = [];
  const artifactRoots: string[] = [];
  for (const slide of input.deck.slides) {
    const staged = stagedById.get(slide.assetId)!;
    const result = applyDecision(staged, decisionSet(parsedJob, slide.assetId), slide.fingerprint, input, version);
    publishedAssets.push(result.asset);
    media.push(...result.media);
    artifactRoots.push(...result.artifactRoots);
  }

  const pack = buildPack(input, version, publishedAssets, publishedAt);
  const plannedCopies = await preflightPlan(store, media, [...new Set(artifactRoots)]);
  const packKey = `packs/${parsedJob.packId}/${version}.json`;
  // Copy media/artifacts only after the completed pack was schema-validated and
  // every staged source was confirmed. No prior version key is ever a target.
  for (const copy of plannedCopies) await store.copy(copy.source, copy.destination, copy.contentType);
  await store.write(packKey, JSON.stringify(pack, null, 2) + '\n', CONTENT_TYPES.json);

  const packUrl = `${base.replace(/\/+$/u, '')}/${packKey}`;
  return { pack, packId: parsedJob.packId, version, packKey, packUrl };
}

export interface S3ObjectStoreOptions {
  client: { send(command: unknown): Promise<unknown> };
  bucket: string;
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body && typeof body === 'object' && 'transformToByteArray' in body) {
    const transform = (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray;
    return transform.call(body);
  }
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    }
    const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  throw new Error('S3 object response did not contain a readable body');
}

/** S3 adapter used only by Lambda/HTTP boundaries; unit tests inject ObjectStore fakes. */
export function createS3ObjectStore(options: S3ObjectStoreOptions): ObjectStore {
  return {
    async list(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await options.client.send(new ListObjectsV2Command({
          Bucket: options.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })) as { Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string };
        for (const item of response.Contents ?? []) if (item.Key) keys.push(item.Key);
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    },
    async read(key) {
      const response = await options.client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key })) as { Body?: unknown };
      if (!response.Body) throw new Error(`S3 object ${key} had no body`);
      return bodyBytes(response.Body);
    },
    async write(key, body, contentType) {
      await options.client.send(new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async copy(source, destination, contentType) {
      const encodedSource = `${options.bucket}/${source.split('/').map(part => encodeURIComponent(part)).join('/')}`;
      await options.client.send(new CopyObjectCommand({
        Bucket: options.bucket,
        Key: destination,
        CopySource: encodedSource,
        ...(contentType ? { ContentType: contentType, MetadataDirective: 'REPLACE' as const } : {}),
      }));
    },
  };
}
