import { z } from 'zod';

const ReviewBookmarksSchema = z.object({
  schemaVersion: z.literal('1.0'),
  packId: z.string().min(1),
  conceptIds: z.array(z.string().min(1)).max(100),
}).strict();

const REVIEW_BOOKMARKS_STORAGE_KEY = 'accesslens.reviewBookmarks';

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

export async function loadReviewBookmarks(packId: string): Promise<string[]> {
  const stored = (await store().get(REVIEW_BOOKMARKS_STORAGE_KEY))[REVIEW_BOOKMARKS_STORAGE_KEY];
  if (stored === undefined) return [];
  const parsed = ReviewBookmarksSchema.parse(stored);
  return parsed.packId === packId ? parsed.conceptIds : [];
}

export async function saveReviewBookmarks(packId: string, conceptIds: string[]): Promise<void> {
  await store().set({ [REVIEW_BOOKMARKS_STORAGE_KEY]: ReviewBookmarksSchema.parse({ schemaVersion: '1.0', packId, conceptIds }) });
}

export function resetReviewBookmarksForTests(): void {
  memoryStore = new Map<string, unknown>();
}
