import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DocumentRecord } from '../../shared/api';
import { convertOfficeToPdf, detectInputFormat } from '../../ingest/src/ingest';
import { readFileSync } from 'node:fs';
import { AwsVectorAdmin, S3ChunkStore, S3LibraryStore } from './aws';
import { TitanEmbedder } from './embed';
import { indexDocument } from './indexDocument';
import { retrieve } from './retrieve';
import { extractPages } from './stages/extractPages';

/**
 * The course-library indexer (spec section 9.2), one Lambda invocation per
 * registered document: download the private source, convert PPTX/DOCX with
 * LibreOffice, extract page text with Poppler, chunk, embed with Titan v2,
 * write the profile's S3 Vectors index and the verbatim chunk manifest, then
 * verify with a page-one query. It runs in the ingest container, which
 * carries both tools. The document record reports every stage.
 */
export interface IndexDocumentEvent {
  profileId: string;
  docId: string;
  kind: DocumentRecord['kind'];
  title: string;
  citation?: string;
  /** Key in the library bucket, `library/{profileId}/{docId}/source.<ext>`. */
  sourceKey: string;
}

export interface IndexerConfig {
  region: string;
  libraryBucket: string;
  vectorBucket: string;
  documentsTable: string;
}

export function indexerConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const config = {
    region: env.AWS_REGION ?? 'us-east-1',
    libraryBucket: env.LIBRARY_BUCKET ?? '',
    vectorBucket: env.VECTOR_BUCKET ?? '',
    documentsTable: env.DOCUMENTS_TABLE ?? '',
  };
  for (const [name, value] of Object.entries(config)) if (!value) throw new Error(`${name} is not configured for the library indexer`);
  return config;
}

export async function handler(event: IndexDocumentEvent): Promise<DocumentRecord> {
  const config = indexerConfig();
  const s3 = new S3Client({ region: config.region });
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }), { marshallOptions: { removeUndefinedValues: true } });
  const store = new S3LibraryStore(s3, config.libraryBucket);
  const chunks = new S3ChunkStore(s3, config.libraryBucket);
  const vectors = new AwsVectorAdmin({ ...config, profilesTable: '', documentsTable: config.documentsTable }, config.region);
  const embedder = TitanEmbedder.fromBedrock({ region: config.region });

  const workDir = mkdtempSync(join(tmpdir(), 'library-'));
  try {
    const sourcePath = join(workDir, `source${extensionOf(event.sourceKey)}`);
    await store.download(event.sourceKey, sourcePath);
    const pdfPath = detectInputFormat(readFileSync(sourcePath)) === 'pdf' ? sourcePath : convertOfficeToPdf(sourcePath, join(workDir, 'pdf'));

    return await indexDocument({ ...event, path: pdfPath }, {
      async update(record) {
        const { docId, ...fields } = record;
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = {};
        const sets: string[] = [];
        const removes: string[] = [];
        for (const [key, value] of Object.entries(fields)) {
          names[`#${key}`] = key;
          if (value === undefined) { removes.push(`#${key}`); continue; }
          values[`:${key}`] = value;
          sets.push(`#${key} = :${key}`);
        }
        await dynamo.send(new UpdateCommand({
          TableName: config.documentsTable,
          Key: { docId },
          UpdateExpression: [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : ''].filter(Boolean).join(' '),
          ExpressionAttributeNames: names,
          ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        }));
      },
      extractPages,
      embed: embedder,
      vectors: vectors.store(event.profileId),
      chunks,
      retrieve: (profileId, query, k, filter) => retrieve(profileId, query, k, filter, {
        embed: embedder,
        vectors: { forProfile: id => vectors.store(id) },
        chunks,
      }),
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function extensionOf(key: string): string {
  const match = key.toLowerCase().match(/\.(pdf|pptx|docx)$/u);
  return match ? `.${match[1]}` : '.pdf';
}
