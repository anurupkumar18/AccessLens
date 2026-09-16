import { randomUUID } from 'node:crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { archiveProfile } from '../library/src/classroom';
import { failDeletionJob, publicDeletionJob, queueDeletionJob, type StoredClassDeletionJob } from '../library/src/deletion';
import { ROUTES } from '../shared/api';
import { ddb, region } from './config';
import { classroomCall } from './classroom';
import { ApiHttpError, pathParameter, respond } from './http';
import { withInstructor } from './identity';

const route = ROUTES.find(candidate => candidate.operationId === 'deleteProfile')!;
const lambda = new LambdaClient({ region });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ApiHttpError(500, 'configuration_error', `${name} is not configured.`);
  return value;
}

async function existingJob(table: string, profileId: string): Promise<StoredClassDeletionJob | undefined> {
  return (await ddb.send(new GetCommand({ TableName: table, Key: { profileId } }))).Item as StoredClassDeletionJob | undefined;
}

async function dispatch(table: string, worker: string, job: StoredClassDeletionJob): Promise<StoredClassDeletionJob> {
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: worker,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ profileId: job.profileId, jobId: job.jobId })),
    }));
    return job;
  } catch {
    // Do not persist SDK error text: it can contain user-supplied object keys.
    const failed = failDeletionJob(job, 'dispatch_failed', new Date().toISOString());
    await ddb.send(new PutCommand({ TableName: table, Item: failed }));
    return failed;
  }
}

/**
 * Archive and revoke access synchronously, then let the worker purge durable
 * material. A profile has one durable deletion record, so duplicate requests
 * cannot start competing cleanup work and a failed dispatch can be retried.
 */
export const handler = withInstructor(async (event, caller) => {
  const profileId = pathParameter(event, 'profileId');
  const table = required('DELETION_JOBS_TABLE');
  const worker = required('DELETION_WORKER_FUNCTION');
  await classroomCall(deps => archiveProfile({ profileId, ownerSub: caller.sub }, deps));

  let job = await existingJob(table, profileId);
  if (job && job.ownerSub !== caller.sub) throw new ApiHttpError(404, 'not_found', 'class not found');
  if (!job) {
    job = queueDeletionJob({ jobId: randomUUID(), profileId, ownerSub: caller.sub, requestedAt: new Date().toISOString() });
    try {
      await ddb.send(new PutCommand({ TableName: table, Item: job, ConditionExpression: 'attribute_not_exists(profileId)' }));
    } catch {
      // A concurrent deletion request won the conditional write. Read its
      // record rather than exposing a conditional-check implementation detail.
      job = await existingJob(table, profileId);
      if (!job || job.ownerSub !== caller.sub) throw new ApiHttpError(409, 'deletion_conflict', 'A class deletion is already being prepared.');
    }
  }

  if (job.status === 'failed') {
    job = queueDeletionJob({ jobId: job.jobId, profileId, ownerSub: caller.sub, requestedAt: job.requestedAt });
    await ddb.send(new PutCommand({ TableName: table, Item: job }));
  }
  if (job.status === 'queued') job = await dispatch(table, worker, job);
  return respond(route, { deletion: publicDeletionJob(job) }, 202);
});
