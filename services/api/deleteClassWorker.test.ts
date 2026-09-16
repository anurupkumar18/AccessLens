import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteError } from '../library/src/routes/types';

const mocks = vi.hoisted(() => ({
  ddbSend: vi.fn(),
  deleteProfile: vi.fn(),
  purgeClassMetadata: vi.fn(),
  classroomDeps: vi.fn(),
  libraryDeps: vi.fn(),
}));

vi.mock('./config', () => ({ ddb: { send: mocks.ddbSend } }));
vi.mock('../library/src/routes/profiles', () => ({ deleteProfile: mocks.deleteProfile }));
vi.mock('../library/src/classroom', () => ({ purgeClassMetadata: mocks.purgeClassMetadata }));
vi.mock('./classroom', () => ({ classroomDeps: mocks.classroomDeps }));
vi.mock('./library', () => ({ libraryDeps: mocks.libraryDeps }));

import { handler } from './deleteClassWorker';

describe('class deletion worker retries', () => {
  beforeEach(() => {
    process.env.DELETION_JOBS_TABLE = 'deletion-jobs';
    mocks.ddbSend.mockReset().mockResolvedValue({});
    mocks.deleteProfile.mockReset();
    mocks.purgeClassMetadata.mockReset().mockResolvedValue(undefined);
    mocks.classroomDeps.mockReset().mockResolvedValue({});
    mocks.libraryDeps.mockReset().mockReturnValue({});
  });

  it('finishes class metadata cleanup after a prior worker already removed the profile', async () => {
    mocks.ddbSend.mockResolvedValueOnce({ Item: {
      jobId: 'job-1', profileId: 'class-1', ownerSub: 'instructor-1', status: 'failed', requestedAt: '2026-09-16T20:00:00.000Z', error: 'purge_failed',
    } });
    mocks.deleteProfile.mockRejectedValueOnce(new RouteError('not-found', 'profile class-1 not found'));

    await handler({ profileId: 'class-1', jobId: 'job-1' });

    expect(mocks.purgeClassMetadata).toHaveBeenCalledWith('class-1', {});
    const lastWrite = mocks.ddbSend.mock.calls.at(-1)?.[0] as { input: { Item: { status: string } } };
    expect(lastWrite.input.Item.status).toBe('succeeded');
  });
});
