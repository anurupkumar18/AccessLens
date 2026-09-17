import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ddbSend: vi.fn(),
  lambdaSend: vi.fn(),
  classroomCall: vi.fn(),
}));

vi.mock('./config', () => ({ ddb: { send: mocks.ddbSend }, region: 'us-east-1' }));
vi.mock('./classroom', () => ({ classroomCall: mocks.classroomCall }));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class { send = mocks.lambdaSend; },
  InvokeCommand: class { constructor(readonly input: unknown) {} },
}));

import { handler as deleteProfile } from './deleteProfile';
import { handler as getDeletionJob } from './getDeletionJob';

const signedIn = (profileId = 'class-1') => ({ pathParameters: { profileId }, requestContext: { authorizer: { jwt: { claims: { sub: 'instructor-1', email: 'prof@uni.edu', email_verified: true } } } } });

describe('class deletion HTTP jobs', () => {
  beforeEach(() => {
    mocks.ddbSend.mockReset();
    mocks.lambdaSend.mockReset().mockResolvedValue({});
    mocks.classroomCall.mockReset().mockResolvedValue({});
    process.env.DELETION_JOBS_TABLE = 'deletion-jobs';
    process.env.DELETION_WORKER_FUNCTION = 'delete-worker';
  });

  it('archives first, queues a worker, and never returns the owner subject', async () => {
    mocks.ddbSend
      .mockResolvedValueOnce({}) // no existing job
      .mockResolvedValueOnce({}); // conditional put

    const result = await deleteProfile(signedIn());
    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.deletion).toMatchObject({ profileId: 'class-1', status: 'queued' });
    expect(body.deletion).not.toHaveProperty('ownerSub');
    expect(mocks.classroomCall).toHaveBeenCalledOnce();
    expect(mocks.lambdaSend).toHaveBeenCalledOnce();
  });

  it('returns purge status only to the owning instructor', async () => {
    mocks.ddbSend.mockResolvedValueOnce({ Item: {
      jobId: 'job-1', profileId: 'class-1', ownerSub: 'instructor-1', status: 'failed', requestedAt: '2026-09-16T20:00:00.000Z', completedAt: '2026-09-16T20:01:00.000Z', error: 'purge_failed',
    } });
    const result = await getDeletionJob(signedIn());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '{}')).toEqual({ deletion: {
      jobId: 'job-1', profileId: 'class-1', status: 'failed', requestedAt: '2026-09-16T20:00:00.000Z', completedAt: '2026-09-16T20:01:00.000Z', error: 'purge_failed',
    } });

    mocks.ddbSend.mockResolvedValueOnce({ Item: {
      jobId: 'job-1', profileId: 'class-1', ownerSub: 'another-instructor', status: 'queued', requestedAt: '2026-09-16T20:00:00.000Z',
    } });
    expect((await getDeletionJob(signedIn())).statusCode).toBe(404);
  });
});
