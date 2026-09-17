import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { StoredClassDeletionJob } from '../library/src/deletion';
import { publicDeletionJob } from '../library/src/deletion';
import { ROUTES } from '../shared/api';
import { ddb } from './config';
import { ApiHttpError, pathParameter, respond } from './http';
import { withInstructor } from './identity';

const route = ROUTES.find(candidate => candidate.operationId === 'getDeletionJob')!;

export const handler = withInstructor(async (event, caller) => {
  const profileId = pathParameter(event, 'profileId');
  const table = process.env.DELETION_JOBS_TABLE;
  if (!table) throw new ApiHttpError(500, 'configuration_error', 'DELETION_JOBS_TABLE is not configured.');
  const job = (await ddb.send(new GetCommand({ TableName: table, Key: { profileId } }))).Item as StoredClassDeletionJob | undefined;
  // The table record, not a now-deleted profile, is the ownership authority.
  if (!job || job.ownerSub !== caller.sub) throw new ApiHttpError(404, 'not_found', 'class deletion not found');
  return respond(route, { deletion: publicDeletionJob(job) });
});
