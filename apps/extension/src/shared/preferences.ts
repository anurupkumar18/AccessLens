import { z } from 'zod';

// Local-only accessibility preferences. Never sent through SessionClient or
// any LiveEvent -- the server never sees a mode choice, let alone a
// diagnosis, disability label, or behavioral signal (charter A4/A8).
export const StudentPreferencesSchema = z.object({
  schemaVersion: z.literal('1.0'),
  mode: z.enum(['focus', 'structured-text', 'dyslexic', 'ar']),
  textScale: z.number().min(0.75).max(2),
  // Defaults make saved preferences from before the reading controls existed
  // forward-compatible. These values remain entirely in local extension
  // storage; neither the relay nor an instructor sees them.
  fontFamily: z.enum(['system', 'serif', 'monospace']).default('system'),
  lineSpacing: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  contentWidth: z.enum(['standard', 'narrow', 'wide']).default('standard'),
  highContrast: z.boolean().default(false),
  speechRate: z.number().min(0.75).max(1.5).default(1),
  // Students who use their own screen reader (VoiceOver, NVDA, JAWS, ChromeVox,
  // Narrator) hear lesson changes in their own voice and speed, and can have
  // descriptions read by it instead of the AI voice.
  announceChanges: z.boolean().default(true),
  readAloudWith: z.enum(['ai-voice', 'screen-reader', 'browser-voice']).default('ai-voice'),
  reducedMotion: z.boolean(),
  captionsEnabled: z.boolean(),
}).strict();

export type StudentPreferences = z.infer<typeof StudentPreferencesSchema>;

export const defaultPreferences: StudentPreferences = {
  schemaVersion: '1.0',
  mode: 'structured-text',
  textScale: 1,
  fontFamily: 'system',
  lineSpacing: 'comfortable',
  contentWidth: 'standard',
  highContrast: false,
  speechRate: 1,
  announceChanges: true,
  readAloudWith: 'ai-voice',
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
  // A saved choice this build no longer offers starts the student on the
  // defaults rather than failing to load at all.
  const parsed = StudentPreferencesSchema.safeParse(stored);
  return parsed.success ? parsed.data : defaultPreferences;
}

export async function savePreferences(preferences: StudentPreferences): Promise<void> {
  const validated = StudentPreferencesSchema.parse(preferences);
  await store().set({ [PREFERENCES_STORAGE_KEY]: validated });
}

export function resetPreferencesForTests(): void {
  memoryStore = new Map<string, unknown>();
}
