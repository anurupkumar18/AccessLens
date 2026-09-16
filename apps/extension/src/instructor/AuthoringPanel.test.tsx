// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AccessPackSchema } from '../shared/contracts';
import type { AuthoringClient, JobState } from '../shared/authoringClient';
import { AuthoringPanel } from './AuthoringPanel';
import publishedPack from '../../../viewer/fixtures/published-pack.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pack = AccessPackSchema.parse(publishedPack);

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); container = null; root = null; vi.useRealTimers(); });

function fakeClient(statuses: JobState['status'][]) {
  const reviews: unknown[] = [];
  let polls = 0;
  const client: AuthoringClient = {
    submitDeck: vi.fn(async () => 'job-1'),
    getJob: vi.fn(async () => ({ jobId: 'job-1', status: statuses[Math.min(polls++, statuses.length - 1)], packId: pack.packId, slides: [] })),
    getDraft: vi.fn(async () => pack),
    review: vi.fn(async (_jobId, decisions) => { reviews.push(decisions); }),
    publish: vi.fn(async () => ({ packId: pack.packId, version: 9, packUrl: 'https://cdn.test/packs/p/9.json' })),
  };
  return { client, reviews };
}

function render(client: AuthoringClient) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<AuthoringPanel client={client} pollMs={10} />));
}
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 30)); }); };
const q = <T extends Element>(sel: string) => container!.querySelector(sel) as T;

async function fillAndSubmit() {
  const title = q<HTMLInputElement>('#authoring-title');
  const fileInput = q<HTMLInputElement>('#authoring-file');
  const file = new File(['deck'], 'deck.pdf', { type: 'application/pdf' });
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(title, 'How HNSW Works'); title.dispatchEvent(new Event('input', { bubbles: true }));
    Object.defineProperty(fileInput, 'files', { value: [file] }); fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
  act(() => { q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
}

describe('AuthoringPanel', () => {
  it('uploads, follows the job to review, shows every description, and publishes only after Approve', async () => {
    const { client, reviews } = fakeClient(['ingesting', 'visualizing', 'review']);
    render(client);
    await fillAndSubmit();
    expect(client.submitDeck).toHaveBeenCalledWith(expect.objectContaining({ name: 'deck.pdf' }), { packId: 'how-hnsw-works', title: 'How HNSW Works' });
    await flush(); await flush(); await flush();
    expect(container!.textContent).toContain('Ready for your review');
    expect(container!.querySelectorAll('.authoring-slides > li')).toHaveLength(pack.assets.length);
    expect(container!.textContent).toContain(pack.assets[0].regions[0].shortDescription);
    expect(client.publish).not.toHaveBeenCalled();
    // Leave the first region out, then publish.
    act(() => { q<HTMLInputElement>('.authoring-slides input[type=checkbox]').click(); });
    act(() => { Array.from(container!.querySelectorAll('button')).find(b => b.textContent === 'Approve and publish')!.click(); });
    await flush();
    expect(reviews[0]).toEqual(expect.arrayContaining([{ assetId: pack.assets[0].assetId, rejectRegions: [pack.assets[0].regions[0].regionId] }]));
    expect(client.publish).toHaveBeenCalledWith('job-1');
    expect(container!.textContent).toContain('version 9');
    expect(q<HTMLAnchorElement>('a').getAttribute('href')).toContain(encodeURIComponent('https://cdn.test/packs/p/9.json'));
  });

  it('reports a failed job instead of pretending', async () => {
    const { client } = fakeClient(['ingesting', 'failed']);
    render(client);
    await fillAndSubmit();
    await flush(); await flush();
    expect(q('[role=alert]').textContent).toContain('could not finish');
    expect(client.getDraft).not.toHaveBeenCalled();
  });
});
