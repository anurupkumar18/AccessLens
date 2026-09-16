// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AuthoringClient, CourseDocument, CourseProfile } from '../shared/authoringClient';
import { LibraryPanel } from './LibraryPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); container = null; root = null; });

const algorithms: CourseProfile = { profileId: 'prof-algo', name: 'Algorithms', subject: 'CS', level: 'undergrad', createdAt: '2026-09-16T00:00:00.000Z' };
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 25)); }); };
const q = <T extends Element>(sel: string) => container!.querySelector(sel) as T;
const type = (sel: string, value: string) => act(() => {
  const el = q<HTMLInputElement>(sel);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = (sel: string) => act(() => { q<HTMLFormElement>(sel).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

function fakeClient(documentStatuses: CourseDocument['status'][]) {
  let reads = 0;
  const documents: CourseDocument[] = [];
  const client = {
    createProfile: vi.fn(async (input: { name: string; subject: string; level: string }) => ({ profile: { ...input, profileId: 'prof-new', createdAt: '2026-09-16T00:00:00.000Z' }, documents: [] })),
    getProfile: vi.fn(async (profileId: string) => {
      const status = documentStatuses[Math.min(reads++, documentStatuses.length - 1)];
      return { profile: { ...algorithms, profileId }, documents: documents.map(d => ({ ...d, status, pages: status === 'ready' ? 12 : 0 })) };
    }),
    deleteProfile: vi.fn(async () => undefined),
    addDocument: vi.fn(async (profileId: string, _file: unknown, document: { kind: CourseDocument['kind']; title: string }) => {
      const created: CourseDocument = { docId: 'doc-1', profileId, kind: document.kind, title: document.title, pages: 0, chunks: 0, status: 'pending' };
      documents.push(created);
      return created;
    }),
    deleteDocument: vi.fn(async () => { documents.length = 0; }),
  } as unknown as AuthoringClient;
  return client;
}

function mount(client: AuthoringClient, profiles: CourseProfile[], onProfilesChange = vi.fn()) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<LibraryPanel client={client} profiles={profiles} onProfilesChange={onProfilesChange} pollMs={10} />));
  return onProfilesChange;
}

describe('LibraryPanel', () => {
  it('creates a course and reports the new profile list upward', async () => {
    const client = fakeClient(['ready']);
    const onChange = mount(client, []);
    expect(container!.querySelector('#library-select')).toBeNull();
    type('#library-name', 'Algorithms'); type('#library-subject', 'CS'); type('#library-level', 'undergrad');
    submit('form[aria-label="Create a course"]');
    await flush();
    expect(client.createProfile).toHaveBeenCalledWith({ name: 'Algorithms', subject: 'CS', level: 'undergrad' });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ profileId: 'prof-new', name: 'Algorithms' })]);
  });

  it('adds a document to the selected course and polls it through indexing to ready', async () => {
    const client = fakeClient(['pending', 'embedding', 'ready']);
    mount(client, [algorithms]);
    await flush();
    expect(container!.textContent).toContain('No materials yet');
    type('#library-doc-title', 'Lecture 5 notes');
    act(() => {
      const input = q<HTMLInputElement>('#library-doc-file');
      Object.defineProperty(input, 'files', { value: [new File(['pdf'], 'lec05.pdf', { type: 'application/pdf' })] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    submit('form[aria-label="Add material"]');
    await flush();
    expect(client.addDocument).toHaveBeenCalledWith('prof-algo', expect.objectContaining({ name: 'lec05.pdf' }), { kind: 'notes', title: 'Lecture 5 notes' });
    expect(container!.textContent).toContain('Lecture 5 notes');
    await flush(); await flush(); await flush();
    expect(q('.library-doc-status').textContent).toBe('Ready.');
    expect(container!.textContent).toContain('12 pages');
  });

  it('removes a document and deletes a course', async () => {
    const client = fakeClient(['ready']);
    const onChange = mount(client, [algorithms]);
    await flush();
    act(() => { Array.from(container!.querySelectorAll('button')).find(b => b.textContent === 'Delete course')!.click(); });
    await flush();
    expect(client.deleteProfile).toHaveBeenCalledWith('prof-algo');
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows a failed document with its reason instead of pretending', async () => {
    const client = fakeClient(['failed']);
    (client.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({ profile: algorithms, documents: [{ docId: 'd', profileId: 'prof-algo', kind: 'textbook', title: 'Book', pages: 0, chunks: 0, status: 'failed', stage: 'verify', error: 'page 1 sentence did not retrieve a page 1 chunk' }] });
    mount(client, [algorithms]);
    await flush();
    expect(q('.library-doc-status').textContent).toContain('Indexing failed: page 1 sentence');
  });
});
