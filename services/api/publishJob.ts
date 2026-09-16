import { publishJob } from '../../services/publish/routes';
import { ddb, jobsTable, packsBucket } from './config';
import { ApiHttpError, pathParameter, respond } from './http';
import { withInstructor } from './identity';
import { ROUTES } from '../shared/api';
import type { ApiEvent } from './types';
import { CopyObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';

const route = ROUTES.find(candidate => candidate.operationId === 'publishJob')!;

export const handler = withInstructor(async (event: ApiEvent, caller) => {
  if (!jobsTable || !packsBucket) throw new ApiHttpError(500, 'configuration_error', 'The authoring storage is not configured.');
  const jobId = pathParameter(event, 'jobId');
  const result = await publishJob({ jobId, ownerSub: caller.sub }, {
    dynamodb: ddb,
    s3: createStore(),
    jobsTableName: jobsTable,
    packsBucket,
    publicBaseUrl: process.env.ASSET_BASE_URL,
  });
  return respond(route, result, 201);
});

function createStore() {
  return {
    async list(prefix: string) {
      const response = await import('./config').then(({ s3 }) => s3.send(new ListObjectsV2Command({ Bucket: packsBucket, Prefix: prefix })));
      return ((response as { Contents?: Array<{ Key?: string }> }).Contents ?? []).flatMap(item => item.Key ? [item.Key] : []);
    },
    async read(key: string) {
      const response = await import('./config').then(({ s3 }) => s3.send(new GetObjectCommand({ Bucket: packsBucket, Key: key })));
      const body = (response as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } }).Body;
      if (!body?.transformToByteArray) throw new Error(`S3 object ${key} had no readable body`);
      return body.transformToByteArray();
    },
    async write(key: string, body: Uint8Array | string, contentType?: string) {
      const { s3 } = await import('./config');
      await s3.send(new PutObjectCommand({ Bucket: packsBucket, Key: key, Body: body, ...(contentType ? { ContentType: contentType } : {}) }));
    },
    async copy(source: string, destination: string, contentType?: string) {
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
