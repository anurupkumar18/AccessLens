import { z } from 'zod';

const ReviewProgressSchema = z.object({
  schemaVersion: z.literal('1.0'),
  packId: z.string().min(1),
  conceptIds: z.array(z.string().min(1)).max(100),
}).strict();

const REVIEW_PROGRESS_STORAGE_KEY = 'accesslens.reviewProgress';

interface LocalStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

declare const chrome: { storage?: { local?: LocalStore } } | undefined;

let memoryStore = new Map<string, unknown>();

function store(): LocalStore {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) return chrome.storage.local;
  return {
    async get(key) { return memoryStore.has(key) ? { [key]: memoryStore.get(key) } : {}; },
    async set(items) { Object.entries(items).forEach(([key, value]) => memoryStore.set(key, value)); },
  };
}

/** Explicit student marks only. This is not inferred activity or assessment data. */
export async function loadReviewProgress(packId: string): Promise<string[]> {
  const stored = (await store().get(REVIEW_PROGRESS_STORAGE_KEY))[REVIEW_PROGRESS_STORAGE_KEY];
  if (stored === undefined) return [];
  const parsed = ReviewProgressSchema.parse(stored);
  return parsed.packId === packId ? parsed.conceptIds : [];
}

export async function saveReviewProgress(packId: string, conceptIds: string[]): Promise<void> {
  await store().set({ [REVIEW_PROGRESS_STORAGE_KEY]: ReviewProgressSchema.parse({ schemaVersion: '1.0', packId, conceptIds }) });
}

export function resetReviewProgressForTests(): void {
  memoryStore = new Map<string, unknown>();
}
