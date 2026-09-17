// @vitest-environment jsdom
/**
 * The contract with professors and students: upload is the only action, and
 * what students open already has alt text and captions.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassList, CourseMediaApi, Item, ItemDetail } from './api';
import { InstructorMaterials, StudentMaterials } from './CourseMaterials';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  await settle();
}

const button = (name: string) => {
  const found = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button ${name}: ${container.textContent}`);
  return found;
};
const click = async (name: string) => { await act(async () => { button(name).click(); }); await settle(); };

function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const item = (patch: Partial<Item>): Item => ({ itemId: 'item0000000001', fileName: 'Week 3.pptx', kind: 'document', status: 'ready', createdAt: '2026-09-16T00:00:00Z', ...patch });

const documentDetail: ItemDetail = {
  item: item({}),
  manifest: {
    version: 1, itemId: 'item0000000001', fileName: 'Week 3.pptx', kind: 'document',
    document: {
      pages: [
        { number: 1, imageKey: 'p1', description: 'Title slide for cell structure.', text: 'Cell Structure', figures: [] },
        { number: 2, imageKey: 'p2', description: 'Diagram of an animal cell.', text: 'Organelles', figures: [{ altText: 'Labelled animal cell', longDescription: 'Nucleus at centre, mitochondria around it.' }] },
      ],
    },
  },
  urls: { p1: 'https://s3/p1.jpg', p2: 'https://s3/p2.jpg' },
};

const videoDetail: ItemDetail = {
  item: item({ itemId: 'item0000000002', fileName: 'lecture.mp4', kind: 'media' }),
  manifest: {
    version: 1, itemId: 'item0000000002', fileName: 'lecture.mp4', kind: 'media',
    media: { type: 'video', mediaKey: 'v', vttKey: 'c', language: 'en-US', transcript: [{ start: 0, end: 2, text: 'Welcome back.' }, { start: 65, end: 68, text: 'Now the Krebs cycle.' }] },
  },
  urls: { v: 'https://s3/video.mp4', c: 'https://s3/captions.vtt' },
};

function fakeApi(lists: ClassList[]): CourseMediaApi & { uploads: string[] } {
  let call = 0;
  const uploads: string[] = [];
  return {
    uploads,
    createClass: vi.fn(async (title: string) => ({ classCode: 'ABCD2345', instructorKey: 'secret', title: title || 'My class' })),
    upload: vi.fn(async (_cls, file: File, onProgress: (f: number) => void) => { onProgress(1); uploads.push(file.name); return 'item0000000009'; }),
    list: vi.fn(async () => lists[Math.min(call++, lists.length - 1)]!),
    get: vi.fn(async (_code: string, itemId: string) => (itemId === 'item0000000002' ? videoDetail : documentDetail)),
    remove: vi.fn(async () => undefined),
  };
}

describe('InstructorMaterials', () => {
  it('creates a class, shows the code to read out, and uploads on drop with no further steps', async () => {
    const api = fakeApi([
      { classCode: 'ABCD2345', title: 'BIOL 1210', items: [] },
      { classCode: 'ABCD2345', title: 'BIOL 1210', items: [item({ status: 'processing', progress: { done: 3, total: 40 } })] },
    ]);
    await render(<InstructorMaterials api={api} />);
    type('#class-title', 'BIOL 1210');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.querySelector('.class-code code')!.textContent).toBe('ABCD-2345');
    const drop = container.querySelector('.drop-zone')!;
    const file = new File(['x'], 'Week 3.pptx');
    await act(async () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
      drop.dispatchEvent(event);
    });
    await settle();
    expect(api.uploads).toEqual(['Week 3.pptx']);
    expect(container.textContent).toContain('Adding alt text: 3 of 40 pages done');
    expect(Array.from(container.querySelectorAll('button')).map(b => b.textContent)).not.toContainEqual(expect.stringMatching(/approve/i));
  });

  it('remembers the class, so returning professors land on it', async () => {
    const api = fakeApi([{ classCode: 'ABCD2345', title: 'Chem', items: [item({ status: 'failed', error: 'This file could not be converted.' })] }]);
    await render(<InstructorMaterials api={api} />);
    type('#class-title', 'Chem');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await settle();
    act(() => root!.unmount());
    container.remove();

    await render(<InstructorMaterials api={api} />);
    expect(container.querySelector('.class-code code')!.textContent).toBe('ABCD-2345');
    expect(container.textContent).toContain('This file could not be converted.');
  });
});

describe('StudentMaterials', () => {
  it('opens a class by code and shows only ready items as openable', async () => {
    const api = fakeApi([{ classCode: 'ABCD2345', title: 'BIOL 1210', items: [item({}), item({ itemId: 'item0000000003', fileName: 'reading.pdf', status: 'processing' })] }]);
    await render(<StudentMaterials api={api} />);
    type('#materials-code', 'abcd-2345');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await settle();

    expect(api.list).toHaveBeenCalledWith('ABCD2345');
    expect(container.textContent).toContain('BIOL 1210');
    expect(container.querySelectorAll('button.material-open')).toHaveLength(1);
    expect(container.textContent).toContain('Being prepared');
  });

  it('shows each page with alt text, figures, and the page text, with page navigation', async () => {
    localStorage.setItem('accesslens.courseMedia.studentClasses', JSON.stringify(['ABCD2345']));
    const api = fakeApi([{ classCode: 'ABCD2345', title: 'BIOL', items: [item({})] }]);
    await render(<StudentMaterials api={api} />);
    await click('Week 3.pptx');

    const img = () => container.querySelector<HTMLImageElement>('.material-page img')!;
    expect(img().alt).toBe('Page 1: Title slide for cell structure.');
    expect(container.textContent).toContain('Cell Structure');
    await click('Next page');
    expect(img().alt).toBe('Page 2: Diagram of an animal cell.');
    expect(img().src).toBe('https://s3/p2.jpg');
    expect(container.textContent).toContain('Labelled animal cell');
    expect(container.textContent).toContain('Nucleus at centre');
  });

  it('plays recordings with a captions track and a transcript that seeks', async () => {
    localStorage.setItem('accesslens.courseMedia.studentClasses', JSON.stringify(['ABCD2345']));
    const api = fakeApi([{ classCode: 'ABCD2345', title: 'BIOL', items: [item({ itemId: 'item0000000002', fileName: 'lecture.mp4', kind: 'media' })] }]);
    await render(<StudentMaterials api={api} />);
    await click('lecture.mp4');

    const video = container.querySelector('video')!;
    const track = video.querySelector('track')!;
    expect(track.getAttribute('src')).toBe('https://s3/captions.vtt');
    expect(track.getAttribute('kind')).toBe('captions');
    expect(video.getAttribute('crossorigin')).toBe('anonymous');
    await click('1:05');
    expect(video.currentTime).toBe(65);
  });
});
