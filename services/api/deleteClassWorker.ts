import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { purgeClassMetadata } from '../library/src/classroom';
import { failDeletionJob, startDeletionJob, succeedDeletionJob, type StoredClassDeletionJob } from '../library/src/deletion';
import { deleteProfile } from '../library/src/routes/profiles';
import { RouteError } from '../library/src/routes/types';
import { ddb } from './config';
import { classroomDeps } from './classroom';
import { libraryDeps } from './library';

interface DeletionEvent { profileId?: unknown; jobId?: unknown }

/**
 * Trusted asynchronous purge worker. It takes only opaque ids, stores only
 * fixed failure codes, and intentionally does not log any source metadata.
 */
export async function handler(event: DeletionEvent): Promise<void> {
  if (typeof event.profileId !== 'string' || typeof event.jobId !== 'string') return;
  const table = process.env.DELETION_JOBS_TABLE;
  if (!table) return;
  const current = (await ddb.send(new GetCommand({ TableName: table, Key: { profileId: event.profileId } }))).Item as StoredClassDeletionJob | undefined;
  if (!current || current.jobId !== event.jobId || current.status === 'succeeded' || current.status === 'running') return;

  const running = startDeletionJob(current, new Date().toISOString());
  await ddb.send(new PutCommand({ TableName: table, Item: running }));
  try {
    try {
      await deleteProfile({ profileId: event.profileId }, libraryDeps());
    } catch (error) {
      // A prior worker may have completed the library portion before failing
      // the class-metadata portion. Continue so a retry can finish teardown.
      if (!(error instanceof RouteError && error.code === 'not-found')) throw error;
    }
    await purgeClassMetadata(event.profileId, await classroomDeps());
    await ddb.send(new PutCommand({ TableName: table, Item: succeedDeletionJob(running, new Date().toISOString()) }));
  } catch (error) {
    await ddb.send(new PutCommand({ TableName: table, Item: failDeletionJob(running, 'purge_failed', new Date().toISOString()) }));
  }
}
