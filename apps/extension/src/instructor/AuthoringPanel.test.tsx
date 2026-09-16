// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AccessPackSchema } from '../shared/contracts';
import { AuthoringApiError, type AuthoringClient, type CourseProfile, type JobState } from '../shared/authoringClient';
import type { GoogleSession } from '../shared/googleSignIn';
import { AuthoringPanel } from './AuthoringPanel';
import publishedPack from '../../../viewer/fixtures/published-pack.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pack = AccessPackSchema.parse(publishedPack);

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); container = null; root = null; vi.useRealTimers(); });

const instructor = { sub: 'g-1', email: 'prof@uni.edu', name: 'Prof Example', createdAt: '2026-09-16T00:00:00.000Z', lastSeenAt: '2026-09-16T00:00:00.000Z' };
const algorithms: CourseProfile = { profileId: 'prof-algo', name: 'Algorithms', subject: 'CS', level: 'undergrad', createdAt: '2026-09-16T00:00:00.000Z' };

function fakeClient(statuses: JobState['status'][], profiles: CourseProfile[] = []) {
  const reviews: unknown[] = [];
  let polls = 0;
  const client: AuthoringClient = {
    submitDeck: vi.fn(async () => 'job-1'),
    getJob: vi.fn(async () => ({ jobId: 'job-1', status: statuses[Math.min(polls++, statuses.length - 1)], packId: pack.packId, slides: [] })),
    getDraft: vi.fn(async () => pack),
    review: vi.fn(async (_jobId, decisions) => { reviews.push(decisions); }),
    publish: vi.fn(async () => ({ packId: pack.packId, version: 9, packUrl: 'https://cdn.test/packs/p/9.json' })),
    me: vi.fn(async () => ({ instructor, profiles })),
    createProfile: vi.fn(async input => ({ profile: { ...algorithms, ...input, profileId: 'prof-new' }, documents: [] })),
    getProfile: vi.fn(async profileId => ({ profile: profiles.find(p => p.profileId === profileId) ?? algorithms, documents: [] })),
    deleteProfile: vi.fn(async () => undefined),
    addDocument: vi.fn(async () => { throw new Error('not used'); }),
    deleteDocument: vi.fn(async () => undefined),
  };
  return { client, reviews };
}

function render(client: AuthoringClient) {
  mount(<AuthoringPanel client={client} pollMs={10} />);
}
function mount(element: React.ReactElement) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
}
const clickButton = (text: string) => act(() => { Array.from(container!.querySelectorAll('button')).find(b => b.textContent === text)!.click(); });
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
  act(() => { q<HTMLFormElement>('form[aria-label="Upload a deck"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
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
    clickButton('Approve and publish');
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

  it('offers nothing but Google sign-in until an instructor signs in, then shows who is signed in', async () => {
    window.localStorage.clear();
    const session: GoogleSession = { idToken: 'id.tok.en', email: 'prof@uni.edu', expiresAt: Date.now() + 3600_000 };
    const signIn = vi.fn(async () => session);
    mount(<AuthoringPanel apiUrl="https://api.test" clientId="cid" signIn={signIn} pollMs={10} />);
    expect(container!.querySelector('form')).toBeNull();
    expect(container!.querySelector('#authoring-token')).toBeNull();
    clickButton('Sign in with Google');
    await flush();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain('Signed in as prof@uni.edu');
    expect(container!.querySelector('form')).not.toBeNull();
    clickButton('Sign out');
    expect(container!.querySelector('form')).toBeNull();
    expect(container!.textContent).toContain('Sign in with Google');
  });

  it('drops an expired session when the API answers 401 and asks for a new sign-in', async () => {
    const { client } = fakeClient(['ingesting']);
    (client.submitDeck as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new AuthoringApiError(401, 'unauthorized', 'expired'));
    render(client);
    await fillAndSubmit();
    expect(q('[role=alert]').textContent).toContain('sign-in expired');
    expect(window.localStorage.getItem('accesslens.authoring.session')).toBeNull();
  });

  it('says so when the build has no API or Google client configured', () => {
    mount(<AuthoringPanel apiUrl={null} clientId={null} />);
    expect(container!.textContent).toContain('no authoring API or Google sign-in configured');
    expect(container!.querySelector('button')).toBeNull();
  });

  it('creates the account on sign-in, greets the instructor by name, and sends the chosen course with the deck', async () => {
    const { client } = fakeClient(['ingesting'], [algorithms]);
    render(client);
    await flush();
    expect(client.me).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain('Prof Example');
    const select = q<HTMLSelectElement>('#authoring-profile');
    expect(Array.from(select.options).map(o => o.value)).toEqual(['', 'prof-algo']);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'prof-algo'); select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await fillAndSubmit();
    expect(client.submitDeck).toHaveBeenCalledWith(expect.anything(), { packId: 'how-hnsw-works', title: 'How HNSW Works', profileId: 'prof-algo' });
  });

  it('offers no course picker when the instructor has no profiles', async () => {
    const { client } = fakeClient(['ingesting']);
    render(client);
    await flush();
    expect(container!.querySelector('#authoring-profile')).toBeNull();
    expect(container!.querySelector('.library')).not.toBeNull();
  });
});
