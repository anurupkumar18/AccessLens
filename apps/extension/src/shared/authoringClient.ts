import { AccessPackSchema, type AccessPack } from './contracts';
import { readChoice, writeChoice } from '../shell/localChoice';

/**
 * The instructor's client for the authoring API (Part 6): upload a deck,
 * start a job, watch it reach review, read the draft, record decisions and
 * publish. The bearer token is the one the stack issued at deploy; it lives
 * in this browser's localStorage only and is never sent anywhere but the API.
 */
export type JobStatus = 'queued' | 'ingesting' | 'describing' | 'visualizing' | 'review' | 'needs_input' | 'publishing' | 'published' | 'failed';
export interface JobState { jobId: string; status: JobStatus; packId: string; slides: Array<{ assetId: string; stage: string; status: string }>; error?: string }
export interface ReviewDecision { assetId: string; rejectRegions?: string[]; regionEdits?: Array<{ regionId: string; shortDescription?: string; plainLanguage?: string }> }
export interface Published { packId: string; version: number; packUrl: string }

export interface AuthoringClient {
  /** Presigned upload then job start; resolves with the new job id. */
  submitDeck(file: { name: string; type: string; body: Blob }, job: { packId: string; title: string; description?: string }): Promise<string>;
  getJob(jobId: string): Promise<JobState>;
  getDraft(jobId: string): Promise<AccessPack>;
  review(jobId: string, decisions: ReviewDecision[]): Promise<void>;
  publish(jobId: string): Promise<Published>;
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

export function createAuthoringClient(baseUrl: string, token: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): AuthoringClient {
  const root = baseUrl.replace(/\/+$/u, '');
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
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
  return {
    async submitDeck(file, job) {
      const contentType = deckContentType(file.name);
      if (!contentType) throw new AuthoringApiError(400, 'unsupported_file', 'Upload a PDF, PPTX, DOCX or TXT deck.');
      const upload = await call<{ uploadId: string; url: string }>('POST', '/v1/uploads', { filename: file.name, contentType });
      const put = await fetchImpl(upload.url, { method: 'PUT', headers: { 'content-type': contentType }, body: file.body });
      if (!put.ok) throw new AuthoringApiError(put.status, 'upload_failed', `The deck upload answered ${put.status}.`);
      const created = await call<{ jobId: string }>('POST', '/v1/jobs', { uploadId: upload.uploadId, packId: job.packId, title: job.title, ...(job.description ? { description: job.description } : {}) });
      return created.jobId;
    },
    getJob: jobId => call<JobState>('GET', `/v1/jobs/${encodeURIComponent(jobId)}`),
    async getDraft(jobId) {
      const draft = await call<{ pack: unknown }>('GET', `/v1/jobs/${encodeURIComponent(jobId)}/draft`);
      return AccessPackSchema.parse(draft.pack);
    },
    async review(jobId, decisions) { await call('POST', `/v1/jobs/${encodeURIComponent(jobId)}/review`, { decisions }); },
    publish: jobId => call<Published>('POST', `/v1/jobs/${encodeURIComponent(jobId)}/publish`),
  };
}

const TOKEN_KEY = 'accesslens.authoring.token';
export function readAuthoringToken(): string { return readChoice(TOKEN_KEY, [] as readonly string[]) ?? readRaw(); }
function readRaw(): string { try { return window.localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } }
export function writeAuthoringToken(token: string): void { writeChoice(TOKEN_KEY, token.trim() || null); }

/** The API base configured for this build, or null when authoring is not offered. */
export const authoringApiUrl: string | null = (import.meta.env.VITE_ACCESSLENS_API_URL as string | undefined) || null;
