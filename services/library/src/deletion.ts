/**
 * Data-only helpers for durable course-library deletion jobs (AL-058).
 *
 * Keeping these pure makes the transition rules independently testable and
 * ensures that neither source material nor worker exceptions become durable
 * job metadata.
 */
import type { ClassDeletionJob } from '../../shared/api';

export type StoredClassDeletionJob = ClassDeletionJob & { ownerSub: string };

export function queueDeletionJob(input: { jobId: string; profileId: string; ownerSub: string; requestedAt: string }): StoredClassDeletionJob {
  return { jobId: input.jobId, profileId: input.profileId, ownerSub: input.ownerSub, status: 'queued', requestedAt: input.requestedAt };
}

export function startDeletionJob(job: StoredClassDeletionJob, startedAt: string): StoredClassDeletionJob {
  return { ...job, status: 'running', startedAt, completedAt: undefined, error: undefined };
}

export function succeedDeletionJob(job: StoredClassDeletionJob, completedAt: string): StoredClassDeletionJob {
  return { ...job, status: 'succeeded', completedAt, error: undefined };
}

export function failDeletionJob(job: StoredClassDeletionJob, error: 'dispatch_failed' | 'purge_failed', completedAt: string): StoredClassDeletionJob {
  return { ...job, status: 'failed', error, completedAt };
}

/** Never return the instructor's Google subject from the public API. */
export function publicDeletionJob(job: StoredClassDeletionJob): ClassDeletionJob {
  const { ownerSub: _ownerSub, ...publicJob } = job;
  return publicJob;
}
