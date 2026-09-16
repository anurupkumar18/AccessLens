/**
 * Private student action items. They deliberately use extension-local storage
 * only: no course API, relay, analytics, or account data is involved.
 */
export interface PrivateClassTask {
  taskId: string;
  createdAt: string;
  question: string;
  answer: string;
  sources: string[];
}

const STORAGE_KEY = 'accesslens.private-class-tasks.v1';

function readTasks(storage: Storage = window.localStorage): PrivateClassTask[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(isPrivateClassTask) : [];
  } catch {
    return [];
  }
}

function isPrivateClassTask(value: unknown): value is PrivateClassTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  return typeof task.taskId === 'string'
    && typeof task.createdAt === 'string'
    && typeof task.question === 'string'
    && typeof task.answer === 'string'
    && Array.isArray(task.sources)
    && task.sources.every(source => typeof source === 'string');
}

export function listPrivateClassTasks(storage: Storage = window.localStorage): PrivateClassTask[] {
  return readTasks(storage);
}

export function savePrivateClassTask(
  input: Omit<PrivateClassTask, 'taskId' | 'createdAt'>,
  storage: Storage = window.localStorage,
  now = new Date(),
): PrivateClassTask {
  const task: PrivateClassTask = {
    taskId: globalThis.crypto?.randomUUID?.() ?? `task-${now.getTime()}-${Math.random().toString(36).slice(2)}`,
    createdAt: now.toISOString(),
    ...input,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify([...readTasks(storage), task]));
  return task;
}
