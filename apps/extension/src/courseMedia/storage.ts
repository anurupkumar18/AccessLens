/**
 * What the extension remembers between visits: the professor's classes (with
 * their instructor keys, which exist nowhere else) and the student's class
 * codes. Local to this browser, like student preferences.
 */
import type { InstructorClass } from './api';

interface LocalStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
declare const chrome: { storage?: { local?: LocalStore } } | undefined;

const INSTRUCTOR_KEY = 'accesslens.courseMedia.instructorClasses';
const STUDENT_KEY = 'accesslens.courseMedia.studentClasses';

function store(): LocalStore {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) return chrome.storage.local;
  return {
    async get(key) {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        return raw ? { [key]: JSON.parse(raw) } : {};
      } catch {
        return {};
      }
    },
    async set(items) {
      try {
        for (const [key, value] of Object.entries(items)) globalThis.localStorage?.setItem(key, JSON.stringify(value));
      } catch {
        // Storage can be unavailable (private mode); the session still works.
      }
    },
  };
}

async function read<T>(key: string, valid: (value: unknown) => value is T): Promise<T[]> {
  const value = (await store().get(key))[key];
  return Array.isArray(value) ? value.filter(valid) : [];
}

const isInstructorClass = (v: unknown): v is InstructorClass =>
  typeof v === 'object' && v !== null && typeof (v as InstructorClass).classCode === 'string'
  && typeof (v as InstructorClass).instructorKey === 'string' && typeof (v as InstructorClass).title === 'string';

export const loadInstructorClasses = () => read(INSTRUCTOR_KEY, isInstructorClass);

export async function saveInstructorClass(cls: InstructorClass): Promise<InstructorClass[]> {
  const next = [cls, ...(await loadInstructorClasses()).filter(c => c.classCode !== cls.classCode)];
  await store().set({ [INSTRUCTOR_KEY]: next });
  return next;
}

export const loadStudentCodes = () => read(STUDENT_KEY, (v): v is string => typeof v === 'string');

export async function saveStudentCode(code: string): Promise<string[]> {
  const next = [code, ...(await loadStudentCodes()).filter(c => c !== code)].slice(0, 10);
  await store().set({ [STUDENT_KEY]: next });
  return next;
}
