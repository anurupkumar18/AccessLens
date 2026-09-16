import { describe, expect, it, vi } from 'vitest';
import { createProfile, deleteDocument, deleteProfile, getDocument, getProfile, registerDocument, searchProfile } from './profiles';
import type { LibraryRouteDeps } from './types';

function deps(): LibraryRouteDeps {
  return {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    id: vi.fn(() => 'generated-id'),
    profiles: new Map(), documents: new Map(),
    uploads: new Map([['upload-1', { key: 'uploads/doc.pdf' }]]),
    s3: {
      put: vi.fn(), delete: vi.fn(), deletePrefix: vi.fn(),
    },
    vectors: {
      createIndex: vi.fn(async () => undefined), deleteIndex: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    startIndexing: vi.fn(async () => undefined),
    listChunkKeys: vi.fn(async () => ['doc-1:p1-c0-a']),
    retrieve: vi.fn(async () => []),
  };
}

describe('profile/document routes', () => {
  it('creates and reads a profile without student data', async () => {
    const d = deps();
    const result = await createProfile({ name: 'Algorithms', subject: 'CS', level: 'undergrad' }, d);
    expect(result.profile).toMatchObject({ profileId: 'generated-id', name: 'Algorithms' });
    expect(JSON.stringify(result)).not.toMatch(/student|preference|connection/iu);
    await expect(getProfile({ profileId: 'generated-id' }, d)).resolves.toEqual(result);
  });

  it('registers a document and starts indexing', async () => {
    const d = deps();
    await createProfile({ name: 'Algorithms', subject: 'CS', level: 'undergrad' }, d);
    const record = await registerDocument({ profileId: 'generated-id', uploadId: 'upload-1', kind: 'notes', title: 'Notes' }, d);
    expect(record).toMatchObject({ docId: 'generated-id', profileId: 'generated-id', status: 'pending' });
    expect(d.startIndexing).toHaveBeenCalledWith(expect.objectContaining({ docId: 'generated-id' }));
  });

  it('only exposes an owning instructor document through the document route', async () => {
    const d = deps();
    d.documents.set('doc-1', { docId: 'doc-1', profileId: 'profile-1', kind: 'notes', title: 'Notes', pages: 1, chunks: 1, status: 'ready' });
    await expect(getDocument({ profileId: 'other-profile', docId: 'doc-1' }, d)).rejects.toThrow(/not found/u);
    await expect(getDocument({ profileId: 'profile-1', docId: 'doc-1' }, d)).resolves.toMatchObject({ docId: 'doc-1' });
  });

  it('search returns excerpts only for the owning profile and caps student quotes', async () => {
    const d = deps();
    d.profiles.set('profile-1', { profileId: 'profile-1', name: 'P', subject: 'S', level: 'L', createdAt: '2026-01-01T00:00:00.000Z', vectorIndexName: 'profile-1' });
    d.retrieve = vi.fn(async () => [{ chunkId: 'c', docId: 'd', title: 'T', page: 1, score: .8, text: 'x'.repeat(700) }]);
    await expect(searchProfile({ profileId: 'other-profile', query: 'q', k: 1 }, d)).rejects.toThrow(/not found/u);
    await expect(searchProfile({ profileId: 'profile-1', query: 'q', k: 1 }, d)).resolves.toMatchObject({ hits: [{ text: 'x'.repeat(700) }] });
    expect('x'.repeat(700).slice(0, 300)).toHaveLength(300);
  });

  it('deletes document vectors and private files, and deleting a profile deletes its index', async () => {
    const d = deps();
    d.documents.set('doc-1', { docId: 'doc-1', profileId: 'profile-1', kind: 'notes', title: 'Notes', pages: 1, chunks: 2, status: 'ready' });
    await deleteDocument({ profileId: 'profile-1', docId: 'doc-1' }, d);
    expect(d.s3.deletePrefix).toHaveBeenCalledWith('library/profile-1/doc-1/');
    expect(d.vectors.delete).toHaveBeenCalledWith(['doc-1:p1-c0-a'], 'profile-1');
    d.profiles.set('profile-1', { profileId: 'profile-1', name: 'P', subject: 'S', level: 'L', createdAt: '2026-01-01T00:00:00.000Z', vectorIndexName: 'profile-1' });
    await deleteProfile({ profileId: 'profile-1' }, d);
    expect(d.vectors.deleteIndex).toHaveBeenCalledWith('profile-1');
    expect(d.s3.deletePrefix).toHaveBeenCalledWith('library/profile-1/');
  });
});
