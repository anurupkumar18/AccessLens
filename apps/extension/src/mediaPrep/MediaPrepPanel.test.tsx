// @vitest-environment jsdom
/**
 * The review gate is the point of this panel: a Claude draft must never be
 * downloadable, copyable, or written into a deck until the instructor approves
 * it (charter A3).
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { altTextCsv, classify, MediaPrepPanel } from './MediaPrepPanel';
import type { MediaApi } from './api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

function render(api: MediaApi) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<MediaPrepPanel api={api} />));
}

const fakeApi = (overrides: Partial<MediaApi> = {}): MediaApi => ({
  draftAltText: vi.fn(async () => ({ decorative: false, altText: 'Bar chart of enzyme activity by temperature.', longDescription: 'Peaks at 37 C.' })),
  transcribe: vi.fn(async (_media, _lang, onProgress) => {
    onProgress(1, 1);
    return [
      { text: 'Welcome', start: 0, end: 0.4 },
      { text: 'back.', start: 0.5, end: 0.9 },
    ];
  }),
  ...overrides,
});

async function upload(...files: File[]) {
  const input = container.querySelector<HTMLInputElement>('#media-upload')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

const button = (name: string) => {
  const found = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const click = (name: string) => act(async () => { button(name).dispatchEvent(new MouseEvent('click', { bubbles: true })); });

function tinyDeck(): Uint8Array {
  const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = (x: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${x}</Relationships>`;
  return zipSync({
    'ppt/presentation.xml': strToU8(`<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(rels(`<Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/>`)),
    'ppt/slides/slide1.xml': strToU8(`<p:sld ${P}><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 4"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(rels(`<Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/>`)),
    'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
  });
}

describe('MediaPrepPanel', () => {
  it('shows an image draft as unreviewed and blocks copying until approved', async () => {
    const api = fakeApi();
    render(api);
    await upload(new File([new Uint8Array([1])], 'enzymes.png', { type: 'image/png' }));

    expect(api.draftAltText).toHaveBeenCalledWith(expect.any(File), expect.stringContaining('enzymes.png'));
    expect(container.textContent).toContain('Draft by Claude, not reviewed');
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Bar chart of enzyme activity by temperature.');
    expect(button('Copy alt text').disabled).toBe(true);

    await click('Approve');
    expect(container.textContent).toContain('✓ Approved');
    expect(button('Copy alt text').disabled).toBe(false);
    expect(button('Download approved image alt text').disabled).toBe(false);
  });

  it('lets the instructor write alt text by hand when drafting fails', async () => {
    render(fakeApi({ draftAltText: vi.fn(async () => { throw new Error('The alt text service could not reach the model.'); }) }));
    await upload(new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' }));

    expect(container.textContent).toContain('could not reach the model');
    expect(button('Approve').disabled).toBe(true);
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'Students measuring a leaf under a microscope.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('Approve').disabled).toBe(false);
  });

  it('holds back the deck download until every picture is approved', async () => {
    render(fakeApi());
    await upload(new File([tinyDeck() as BlobPart], 'lecture-3.pptx'));

    expect(container.textContent).toContain('0 of 1 pictures approved');
    expect(button('Download deck with alt text').disabled).toBe(true);
    await click('Approve');
    expect(container.textContent).toContain('1 of 1 pictures approved');
    expect(button('Download deck with alt text').disabled).toBe(false);
  });

  it('drafts captions for a recording and requires review before download', async () => {
    const api = fakeApi();
    render(api);
    await upload(new File([new Uint8Array([1])], 'week-2.mp4', { type: 'video/mp4' }));

    expect(api.transcribe).toHaveBeenCalledWith(expect.any(File), 'en-US', expect.any(Function));
    expect(container.querySelector('video')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('.cue-list textarea')!.value).toBe('Welcome back.');
    expect(button('Download captions (.vtt)').disabled).toBe(true);

    const reviewed = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { reviewed.click(); });
    expect(button('Download captions (.vtt)').disabled).toBe(false);
    expect(button('Download transcript (.txt)').disabled).toBe(false);
  });

  it('reports a failed transcription instead of showing empty captions', async () => {
    render(fakeApi({ transcribe: vi.fn(async () => { throw new Error('No audio track could be decoded from this file.'); }) }));
    await upload(new File([new Uint8Array([1])], 'silent.mp3', { type: 'audio/mpeg' }));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('No audio track');
  });

  it('rejects unsupported files by name', async () => {
    const api = fakeApi();
    render(api);
    await upload(new File(['x'], 'notes.docx'));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('notes.docx');
    expect(api.draftAltText).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('classifies the supported uploads', () => {
    expect(['a.PNG', 'b.jpeg', 'c.pptx', 'd.mp3', 'e.MP4', 'f.ppt'].map(name => classify(new File([], name))))
      .toEqual(['image', 'image', 'pptx', 'captions', 'captions', undefined]);
  });

  it('quotes CSV cells so commas and quotes in alt text survive a spreadsheet', () => {
    expect(altTextCsv([{ fileName: 'a,b.png', decision: { decorative: false, altText: 'A "big" cell', longDescription: '' } }]))
      .toBe('file,decorative,alt_text,long_description\r\n"a,b.png",no,"A ""big"" cell",""\r\n');
  });
});
