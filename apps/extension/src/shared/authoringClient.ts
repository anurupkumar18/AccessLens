import { AccessPackSchema, type AccessPack } from './contracts';

/**
 * The instructor's client for the authoring API (Part 6): upload a deck,
 * start a job, watch it reach review, read the draft, record decisions and
 * publish. Every API call carries the instructor's Google ID token (D12,
 * see googleSignIn.ts); the presigned deck upload carries nothing.
 */
export type JobStatus = 'queued' | 'ingesting' | 'describing' | 'visualizing' | 'review' | 'needs_input' | 'publishing' | 'published' | 'failed';
export interface JobState { jobId: string; status: JobStatus; packId: string; slides: Array<{ assetId: string; stage: string; status: string }>; error?: string }
export interface ReviewDecision { assetId: string; rejectRegions?: string[]; regionEdits?: Array<{ regionId: string; shortDescription?: string; plainLanguage?: string }> }
export interface Published { packId: string; version: number; packUrl: string }
/** A pack the signed-in instructor published and can present: the latest version per pack id. */
export interface PublishedPackSummary { packId: string; title: string; version: number; packUrl: string; publishedAt: string }

/** The signed-in instructor's account (D13) and course profiles. */
export interface Instructor { sub: string; email: string; name?: string; createdAt: string; lastSeenAt: string }
export interface CourseProfile { profileId: string; name: string; subject: string; level: string; createdAt: string }
export type DocumentKind = 'textbook' | 'slides' | 'notes' | 'problems' | 'syllabus' | 'other';
export type DocumentStatus = 'pending' | 'extracting' | 'chunking' | 'embedding' | 'verifying' | 'ready' | 'failed';
export interface CourseDocument { docId: string; profileId: string; kind: DocumentKind; title: string; citation?: string; pages: number; chunks: number; status: DocumentStatus; stage?: string; error?: string }
export interface ProfileWithDocuments { profile: CourseProfile; documents: CourseDocument[] }

export interface AuthoringClient {
  /** Presigned upload then job start; resolves with the new job id. */
  submitDeck(file: { name: string; type: string; body: Blob }, job: { packId: string; title: string; description?: string; profileId?: string }): Promise<string>;
  getJob(jobId: string): Promise<JobState>;
  getDraft(jobId: string): Promise<AccessPack>;
  review(jobId: string, decisions: ReviewDecision[]): Promise<void>;
  publish(jobId: string): Promise<Published>;
  /** Creates the account on first call (D13) and lists the instructor's course profiles. */
  me(): Promise<{ instructor: Instructor; profiles: CourseProfile[]; packs: PublishedPackSummary[] }>;
  createProfile(input: { name: string; subject: string; level: string }): Promise<ProfileWithDocuments>;
  getProfile(profileId: string): Promise<ProfileWithDocuments>;
  deleteProfile(profileId: string): Promise<void>;
  /** Presigned upload then registration; indexing starts on the server. */
  addDocument(profileId: string, file: { name: string; type: string; body: Blob }, document: { kind: DocumentKind; title: string; citation?: string }): Promise<CourseDocument>;
  deleteDocument(profileId: string, docId: string): Promise<void>;
}

export class AuthoringApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const ACCEPTED: Record<string, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** The content type the API accepts for a file name, or null when it is not a deck we ingest. */
export function deckContentType(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return ACCEPTED[ext] ?? null;
}

/** A pack id the API accepts, derived from a lesson title. */
export function packIdFromTitle(title: string): string {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  return id || 'lesson';
}

export function createAuthoringClient(baseUrl: string, idToken: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): AuthoringClient {
  const root = baseUrl.replace(/\/+$/u, '');
  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${idToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
      throw new AuthoringApiError(response.status, error?.code ?? 'http_error', error?.message ?? `The authoring API answered ${response.status}.`);
    }
    return parsed as T;
  }
  /** Presigned PUT of a file; the API never sees the bytes and the PUT carries no token. */
  async function upload(file: { name: string; body: Blob }): Promise<string> {
    const contentType = deckContentType(file.name);
    if (!contentType) throw new AuthoringApiError(400, 'unsupported_file', 'Upload a PDF, PPTX, DOCX or TXT file.');
    const presigned = await call<{ uploadId: string; url: string }>('POST', '/v1/uploads', { filename: file.name, contentType });
    const put = await fetchImpl(presigned.url, { method: 'PUT', headers: { 'content-type': contentType }, body: file.body });
    if (!put.ok) throw new AuthoringApiError(put.status, 'upload_failed', `The upload answered ${put.status}.`);
    return presigned.uploadId;
  }
  const profilePath = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}`;
  return {
    async submitDeck(file, job) {
      const uploadId = await upload(file);
      const created = await call<{ jobId: string }>('POST', '/v1/jobs', {
        uploadId, packId: job.packId, title: job.title,
        ...(job.description ? { description: job.description } : {}),
        ...(job.profileId ? { profileId: job.profileId } : {}),
      });
      return created.jobId;
    },
    getJob: jobId => call<JobState>('GET', `/v1/jobs/${encodeURIComponent(jobId)}`),
    async getDraft(jobId) {
      const draft = await call<{ pack: unknown }>('GET', `/v1/jobs/${encodeURIComponent(jobId)}/draft`);
      return AccessPackSchema.parse(draft.pack);
    },
    async review(jobId, decisions) { await call('POST', `/v1/jobs/${encodeURIComponent(jobId)}/review`, { decisions }); },
    publish: jobId => call<Published>('POST', `/v1/jobs/${encodeURIComponent(jobId)}/publish`),
    me: () => call('GET', '/v1/me'),
    createProfile: input => call('POST', '/v1/profiles', input),
    getProfile: profileId => call('GET', profilePath(profileId)),
    async deleteProfile(profileId) { await call('DELETE', profilePath(profileId)); },
    async addDocument(profileId, file, document) {
      const uploadId = await upload(file);
      return call<CourseDocument>('POST', `${profilePath(profileId)}/documents`, { uploadId, ...document });
    },
    async deleteDocument(profileId, docId) { await call('DELETE', `${profilePath(profileId)}/documents/${encodeURIComponent(docId)}`); },
  };
}

/** The API base configured for this build, or null when authoring is not offered. */
export const authoringApiUrl: string | null = (import.meta.env.VITE_ACCESSLENS_API_URL as string | undefined) || null;
