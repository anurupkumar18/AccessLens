import { describe, expect, it } from 'vitest';
import { failDeletionJob, publicDeletionJob, queueDeletionJob, startDeletionJob, succeedDeletionJob } from './deletion';

describe('durable class deletion jobs', () => {
  const queued = queueDeletionJob({ jobId: 'job-1', profileId: 'class-1', ownerSub: 'instructor-1', requestedAt: '2026-09-16T20:00:00.000Z' });

  it('moves through the only supported lifecycle without retaining unsafe error details', () => {
    const running = startDeletionJob(queued, '2026-09-16T20:01:00.000Z');
    const complete = succeedDeletionJob(running, '2026-09-16T20:02:00.000Z');
    expect(complete).toMatchObject({ status: 'succeeded', startedAt: '2026-09-16T20:01:00.000Z', completedAt: '2026-09-16T20:02:00.000Z' });
    expect(failDeletionJob(running, 'purge_failed', '2026-09-16T20:02:00.000Z')).toMatchObject({ status: 'failed', error: 'purge_failed' });
  });

  it('omits the instructor subject from the response record', () => {
    expect(publicDeletionJob(queued)).toEqual({ jobId: 'job-1', profileId: 'class-1', status: 'queued', requestedAt: '2026-09-16T20:00:00.000Z' });
  });
});
