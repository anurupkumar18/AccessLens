import type { DocumentRecord, ProfileRecord } from '../../../shared/api';
import type { Excerpt } from '../../../shared/references';
import { RouteError, storeDelete, storeGet, storePut, storeValues, type CreateProfileInput, type DocumentPath, type LibraryRouteDeps, type ProfilePath, type RegisterDocumentInput, type SearchProfileInput } from './types';

type SearchResponse = { query: string; hits: Excerpt[] };

export async function createProfile(input: CreateProfileInput, deps: LibraryRouteDeps): Promise<{ profile: ProfileRecord; documents: DocumentRecord[] }> {
  const profileId = deps.id();
  const profile: ProfileRecord = {
    profileId,
    name: input.name,
    subject: input.subject,
    level: input.level,
    createdAt: deps.now().toISOString(),
    vectorIndexName: profileId,
  };
  await deps.vectors.createIndex(profileId);
  await storePut(deps.profiles, profileId, profile);
  return { profile, documents: [] };
}

export async function getProfile(input: ProfilePath, deps: LibraryRouteDeps): Promise<{ profile: ProfileRecord; documents: DocumentRecord[] }> {
  const profile = await requireProfile(input.profileId, deps);
  return {
    profile,
    documents: (await storeValues(deps.documents, input.profileId)).filter(document => document.profileId === input.profileId),
  };
}

export async function deleteProfile(input: ProfilePath, deps: LibraryRouteDeps): Promise<{ deleted: true; id: string }> {
  await requireProfile(input.profileId, deps);
  for (const document of (await storeValues(deps.documents, input.profileId)).filter(item => item.profileId === input.profileId)) {
    if (document.profileId !== input.profileId) continue;
    await deps.s3.deletePrefix(`library/${input.profileId}/${document.docId}/`);
    const keys = deps.listChunkKeys ? await deps.listChunkKeys(document.docId) : [];
    if (keys.length > 0) await deps.vectors.delete(keys, input.profileId);
    await storeDelete(deps.documents, document.docId);
  }
  await deps.s3.deletePrefix(`library/${input.profileId}/`);
  await deps.vectors.deleteIndex(input.profileId);
  await storeDelete(deps.profiles, input.profileId);
  return { deleted: true, id: input.profileId };
}

export async function registerDocument(input: RegisterDocumentInput, deps: LibraryRouteDeps): Promise<DocumentRecord> {
  await requireProfile(input.profileId, deps);
  const upload = await storeGet(deps.uploads, input.uploadId);
  if (!upload) throw new RouteError('not-found', `upload ${input.uploadId} not found`);

  // The upload id is a deterministic document identity for this API surface.
  // Re-registration replaces the prior record and removes its vectors first.
  const docId = upload.docId ?? deps.id();
  upload.docId = docId;
  const previous = await storeGet(deps.documents, docId);
  if (previous && previous.profileId === input.profileId) {
    await removeDocumentStorage(previous, deps);
  }
  const record: DocumentRecord = {
    docId,
    profileId: input.profileId,
    kind: input.kind,
    title: input.title,
    ...(input.citation ? { citation: input.citation } : {}),
    pages: 0,
    chunks: 0,
    status: 'pending',
  };
  await storePut(deps.documents, docId, record);
  await deps.startIndexing({ profileId: input.profileId, docId, path: upload.key, kind: input.kind, title: input.title, citation: input.citation });
  return record;
}

export async function getDocument(input: DocumentPath, deps: LibraryRouteDeps): Promise<DocumentRecord> {
  const document = await requireDocument(input, deps);
  return document;
}

export async function deleteDocument(input: DocumentPath, deps: LibraryRouteDeps): Promise<{ deleted: true; id: string }> {
  const document = await requireDocument(input, deps);
  await removeDocumentStorage(document, deps);
  await storeDelete(deps.documents, document.docId);
  return { deleted: true, id: document.docId };
}

export async function searchProfile(input: SearchProfileInput, deps: LibraryRouteDeps): Promise<SearchResponse> {
  await requireProfile(input.profileId, deps);
  const hits = await deps.retrieve(input.profileId, input.query, input.k ?? 6, {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.docId ? { docId: input.docId } : {}),
  });
  return { query: input.query, hits };
}

async function removeDocumentStorage(document: DocumentRecord, deps: LibraryRouteDeps): Promise<void> {
  await deps.s3.deletePrefix(`library/${document.profileId}/${document.docId}/`);
  const keys = deps.listChunkKeys ? await deps.listChunkKeys(document.docId) : [];
  // The index is profile-scoped. A pending document has no keys yet; deleting
  // an empty list is a no-op, while ready documents remove their exact keys.
  await deps.vectors.delete(keys, document.profileId);
}

async function requireProfile(profileId: string, deps: LibraryRouteDeps): Promise<ProfileRecord> {
  const profile = await storeGet(deps.profiles, profileId);
  if (!profile) throw new RouteError('not-found', `profile ${profileId} not found`);
  return profile;
}

async function requireDocument(input: DocumentPath, deps: LibraryRouteDeps): Promise<DocumentRecord> {
  const document = await storeGet(deps.documents, input.docId);
  if (!document || document.profileId !== input.profileId) {
    // Do not reveal whether a document id exists in another private profile.
    throw new RouteError('not-found', `document ${input.docId} not found`);
  }
  return document;
}
