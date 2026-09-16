// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { listPrivateClassTasks, savePrivateClassTask } from './classTasks';

afterEach(() => window.localStorage.clear());

describe('private class tasks', () => {
  it('persists an explicitly saved task locally without needing a network client', () => {
    const task = savePrivateClassTask({
      question: 'When is homework due?',
      answer: 'Friday at 5 PM.',
      sources: ['Syllabus (page 2)'],
    }, window.localStorage, new Date('2026-09-16T12:00:00.000Z'));

    expect(task.createdAt).toBe('2026-09-16T12:00:00.000Z');
    expect(listPrivateClassTasks()).toEqual([task]);
  });

  it('ignores malformed saved values', () => {
    window.localStorage.setItem('accesslens.private-class-tasks.v1', '{not json');
    expect(listPrivateClassTasks()).toEqual([]);
  });
});
