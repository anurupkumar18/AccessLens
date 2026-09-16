import { describe, expect, it } from 'vitest';
import { extractClassFactDrafts } from './facts';

describe('automatic class fact drafts', () => {
  it('keeps exact page citations and extracts only explicit deadline and recap lines', () => {
    const drafts = extractClassFactDrafts({ docId: 'syllabus', title: 'Course syllabus', timeZone: 'America/Denver', pages: [{ page: 2, text: 'Homework 2 submission is due September 18, 2026 by 11:59 PM.\nRecap: 2026-09-16 - We covered graph traversal.' }] });
    expect(drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'deadline', dueAt: '2026-09-19T05:59:00.000Z', citation: expect.objectContaining({ page: 2, quote: 'Homework 2 submission is due September 18, 2026 by 11:59 PM.' }) }),
      expect.objectContaining({ kind: 'recap', occurredOn: '2026-09-16', citation: expect.objectContaining({ page: 2 }) }),
    ]));
  });

  it('does not infer a date when one is not present', () => {
    expect(extractClassFactDrafts({ docId: 'notes', title: 'Notes', timeZone: 'UTC', pages: [{ page: 1, text: 'The assignment is due next Friday.' }] })).toEqual([]);
  });
});
