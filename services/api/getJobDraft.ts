import { getJobDraft } from '../../services/publish/routes';
import { artifactsBucket, ddb, jobsTable, packsBucket } from './config';
import { ApiHttpError, pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { ROUTES } from '../shared/api';
import type { ApiEvent } from './types';

const route = ROUTES.find(candidate => candidate.operationId === 'getJobDraft')!;

export const handler = withInstructor(async (event: ApiEvent, caller) => {
  if (!jobsTable || !packsBucket) throw new ApiHttpError(500, 'configuration_error', 'The authoring storage is not configured.');
  const jobId = pathParameter(event, 'jobId');
  const result = await getJobDraft({ jobId, ownerSub: caller.sub }, {
    dynamodb: ddb,
    s3: createStore(),
    jobsTableName: jobsTable,
    packsBucket,
    publicBaseUrl: process.env.ASSET_BASE_URL,
  });
  return respond(route, result);
});

function createStore() {
  // Publish route storage is intentionally local to the Lambda adapter. Draft
  // and published artifacts share the packs bucket in this temporary stack;
  // `artifactsBucket` remains available for a future split without exposing it
  // to route business logic.
  void artifactsBucket;
  return {
    async list(prefix: string) {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const response = await import('./config').then(({ s3 }) => s3.send(new ListObjectsV2Command({ Bucket: packsBucket, Prefix: prefix })));
      return ((response as { Contents?: Array<{ Key?: string }> }).Contents ?? []).flatMap(item => item.Key ? [item.Key] : []);
    },
    async read(key: string) {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const response = await import('./config').then(({ s3 }) => s3.send(new GetObjectCommand({ Bucket: packsBucket, Key: key })));
      const body = (response as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } }).Body;
      if (!body?.transformToByteArray) throw new Error(`S3 object ${key} had no readable body`);
      return body.transformToByteArray();
    },
    async write(key: string, body: Uint8Array | string, contentType?: string) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { s3 } = await import('./config');
      await s3.send(new PutObjectCommand({ Bucket: packsBucket, Key: key, Body: body, ...(contentType ? { ContentType: contentType } : {}) }));
    },
    async copy(source: string, destination: string, contentType?: string) {
      const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
      const { s3 } = await import('./config');
      await s3.send(new CopyObjectCommand({
        Bucket: packsBucket,
        Key: destination,
        CopySource: `${packsBucket}/${source}`,
        ...(contentType ? { ContentType: contentType, MetadataDirective: 'REPLACE' as const } : {}),
      }));
    },
  };
}
