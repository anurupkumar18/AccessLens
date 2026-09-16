import type { DocumentRecord, ProfileRecord } from '../../../shared/api';
import type { Excerpt } from '../../../shared/references';
import { RouteError, storeDelete, storeGet, storePut, storeValues, type CreateProfileInput, type DocumentPath, type LibraryRouteDeps, type ProfilePath, type RegisterDocumentInput, type SearchProfileInput } from './types';
import { validateLibraryDocumentMetadata } from '../intake';

type SearchResponse = { query: string; hits: Excerpt[] };

export async function createProfile(input: CreateProfileInput, deps: LibraryRouteDeps): Promise<{ profile: ProfileRecord; documents: DocumentRecord[] }> {
  const profileId = deps.id();
  const profile: ProfileRecord = {
    profileId,
    ...(input.ownerSub ? { ownerSub: input.ownerSub } : {}),
    name: input.name,
    subject: input.subject,
    level: input.level,
    timeZone: input.timeZone ?? 'UTC',
    archiveState: 'active',
    createdAt: deps.now().toISOString(),
    vectorIndexName: profileId,
  };
  await deps.vectors.createIndex(profileId);
  await storePut(deps.profiles, profileId, profile);
  return { profile, documents: [] };
}

export async function getProfile(input: ProfilePath, deps: LibraryRouteDeps): Promise<{ profile: ProfileRecord; documents: DocumentRecord[] }> {
  const profile = await requireProfile(input.profileId, deps, input.ownerSub);
  return {
    profile,
    documents: (await storeValues(deps.documents, input.profileId)).filter(document => document.profileId === input.profileId),
  };
}

export async function deleteProfile(input: ProfilePath, deps: LibraryRouteDeps): Promise<{ deleted: true; id: string }> {
  await requireProfile(input.profileId, deps, input.ownerSub);
  for (const document of (await storeValues(deps.documents, input.profileId)).filter(item => item.profileId === input.profileId)) {
    if (document.profileId !== input.profileId) continue;
    // Read the manifest before deleting its S3 prefix; the exact vector keys
    // are needed to remove a document without disturbing sibling documents.
    const keys = deps.listChunkKeys ? await deps.listChunkKeys(document.docId) : [];
    if (keys.length > 0) await deps.vectors.delete(keys, input.profileId);
    await deps.s3.deletePrefix(`library/${input.profileId}/${document.docId}/`);
    await storeDelete(deps.documents, document.docId);
  }
  await deps.s3.deletePrefix(`library/${input.profileId}/`);
  await deps.vectors.deleteIndex(input.profileId);
  await storeDelete(deps.profiles, input.profileId);
  return { deleted: true, id: input.profileId };
}

export async function registerDocument(input: RegisterDocumentInput, deps: LibraryRouteDeps): Promise<DocumentRecord> {
  const profile = await requireProfile(input.profileId, deps, input.ownerSub);
  try { validateLibraryDocumentMetadata(input); } catch (error) { throw new RouteError('bad-request', error instanceof Error ? error.message : 'course document was rejected'); }
  const upload = await storeGet(deps.uploads, input.uploadId);
  if (!upload) throw new RouteError('not-found', `upload ${input.uploadId} not found`);
  try { deps.validateUpload?.(upload); } catch (error) { throw new RouteError('bad-request', error instanceof Error ? error.message : 'course upload was rejected'); }

  // The upload id is a deterministic document identity for this API surface.
  // Re-registration replaces the prior record and removes its vectors first.
  const docId = upload.profileDocIds?.[input.profileId] ?? upload.docId ?? deps.id();
  upload.profileDocIds = { ...(upload.profileDocIds ?? {}), [input.profileId]: docId };
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
  await deps.startIndexing({ profileId: input.profileId, docId, path: upload.key, kind: input.kind, title: input.title, citation: input.citation, timeZone: profile.timeZone });
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
  await requireProfile(input.profileId, deps, input.ownerSub);
  const hits = await deps.retrieve(input.profileId, input.query, input.k ?? 6, {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.docId ? { docId: input.docId } : {}),
  });
  return { query: input.query, hits };
}

async function removeDocumentStorage(document: DocumentRecord, deps: LibraryRouteDeps): Promise<void> {
  const keys = deps.listChunkKeys ? await deps.listChunkKeys(document.docId) : [];
  // The index is profile-scoped. A pending document has no keys yet; deleting
  // an empty list is a no-op, while ready documents remove their exact keys.
  await deps.vectors.delete(keys, document.profileId);
  await deps.s3.deletePrefix(`library/${document.profileId}/${document.docId}/`);
}

async function requireProfile(profileId: string, deps: LibraryRouteDeps, ownerSub?: string): Promise<ProfileRecord> {
  const profile = await storeGet(deps.profiles, profileId);
  // Another instructor's profile is indistinguishable from a missing one.
  if (!profile || (ownerSub !== undefined && profile.ownerSub !== ownerSub)) throw new RouteError('not-found', `profile ${profileId} not found`);
  return profile;
}

async function requireDocument(input: DocumentPath, deps: LibraryRouteDeps): Promise<DocumentRecord> {
  if (input.ownerSub !== undefined) await requireProfile(input.profileId, deps, input.ownerSub);
  const document = await storeGet(deps.documents, input.docId);
  if (!document || document.profileId !== input.profileId) {
    // Do not reveal whether a document id exists in another private profile.
    throw new RouteError('not-found', `document ${input.docId} not found`);
  }
  return document;
}
