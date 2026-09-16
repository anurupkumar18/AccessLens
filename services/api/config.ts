import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const region = process.env.AWS_REGION ?? 'us-east-1';
export const decksBucket = process.env.DECKS_BUCKET ?? '';
export const packsBucket = process.env.PACKS_BUCKET ?? '';
export const artifactsBucket = process.env.ARTIFACTS_BUCKET ?? '';
export const assetBaseUrl = (process.env.ASSET_BASE_URL ?? '').replace(/\/$/u, '');
export const version = process.env.SERVICE_VERSION ?? 'v2';

export const s3 = new S3Client({ region });
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
export const jobsTable = process.env.JOBS_TABLE ?? '';
