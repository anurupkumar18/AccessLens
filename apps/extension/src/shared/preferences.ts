import { z } from 'zod';

// Local-only accessibility preferences. Never sent through SessionClient or
// any LiveEvent -- the server never sees a mode choice, let alone a
// diagnosis, disability label, or behavioral signal (charter A4/A8).
export const StudentPreferencesSchema = z.object({
  schemaVersion: z.literal('1.0'),
  mode: z.enum(['focus', 'structured-text', 'audio', 'dyslexic', 'ar']),
  textScale: z.number().min(0.75).max(2),
  reducedMotion: z.boolean(),
  captionsEnabled: z.boolean(),
}).strict();

export type StudentPreferences = z.infer<typeof StudentPreferencesSchema>;

export const defaultPreferences: StudentPreferences = {
  schemaVersion: '1.0',
  mode: 'focus',
  textScale: 1,
  reducedMotion: false,
  captionsEnabled: true,
};

export const PREFERENCES_STORAGE_KEY = 'accesslens.studentPreferences';

interface LocalStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

declare const chrome: { storage?: { local?: LocalStore } } | undefined;

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}

let memoryStore = new Map<string, unknown>();

const inMemoryStore: LocalStore = {
  async get(key) {
    return memoryStore.has(key) ? { [key]: memoryStore.get(key) } : {};
  },
  async set(items) {
    for (const [key, value] of Object.entries(items)) memoryStore.set(key, value);
  },
  async remove(key) {
    memoryStore.delete(key);
  },
};

function store(): LocalStore {
  return hasChromeStorage() ? (chrome as { storage: { local: LocalStore } }).storage.local : inMemoryStore;
}

export async function loadPreferences(): Promise<StudentPreferences> {
  const result = await store().get(PREFERENCES_STORAGE_KEY);
  const stored = result[PREFERENCES_STORAGE_KEY];
  if (stored === undefined) return defaultPreferences;
  return StudentPreferencesSchema.parse(stored);
}

export async function savePreferences(preferences: StudentPreferences): Promise<void> {
  const validated = StudentPreferencesSchema.parse(preferences);
  await store().set({ [PREFERENCES_STORAGE_KEY]: validated });
}

export function resetPreferencesForTests(): void {
  memoryStore = new Map<string, unknown>();
}
