import React, { useEffect, useRef, useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import {
  AuthoringApiError, authoringApiUrl, createAuthoringClient, packIdFromTitle,
  type AuthoringClient, type CourseProfile, type Instructor, type JobState, type Published, type PublishedPackSummary,
} from '../shared/authoringClient';
import { LibraryPanel } from './LibraryPanel';
import {
  extensionIdentity, googleClientId, readSession, renderGoogleButton, signInWithExtension, writeSession, type GoogleSession,
} from '../shared/googleSignIn';
import { createLocalImagePack } from '../shared/localPack';

interface Props {
  /** Injected in tests; otherwise built from VITE_ACCESSLENS_API_URL and the Google session. */
  client?: AuthoringClient;
  /** The authoring API base; defaults to VITE_ACCESSLENS_API_URL. */
  apiUrl?: string | null;
  /** The Google OAuth client id; defaults to VITE_GOOGLE_CLIENT_ID. */
  clientId?: string | null;
  /** How to obtain a Google session; defaults to the extension identity API or Google's button. */
  signIn?: () => Promise<GoogleSession>;
  /** Poll interval while a job runs. */
  pollMs?: number;
  /** Where a published pack can be opened in the student view. */
  studentViewUrl?: (packUrl: string) => string;
  /** The instructor's published packs, on sign-in and after each publish; the shell offers them for presenting. */
  onPublishedPacks?: (packs: PublishedPackSummary[]) => void;
  /** Localhost-only image preview; never used by the authenticated authoring path. */
  onLocalPack?: (pack: AccessPack) => void;
}

/** What the instructor has typed for a region, keyed `assetId/regionId`. */
interface RegionText { shortDescription: string; plainLanguage: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'running'; jobId: string; job: JobState | null }
  | { kind: 'review'; jobId: string; pack: AccessPack; rejected: Set<string>; edits: Map<string, RegionText> }
  | { kind: 'publishing'; jobId: string }
  | { kind: 'published'; result: Published }
  | { kind: 'failed'; message: string; jobId?: string };

const STAGE_TEXT: Record<string, string> = {
  queued: 'Queued.',
  ingesting: 'Rendering the slides.',
  describing: 'Reading the deck as a whole.',
  visualizing: 'Describing each slide and recording audio.',
  review: 'Ready for your review.',
  needs_input: 'The pipeline needs more information about this deck.',
  failed: 'The pipeline could not finish this deck.',
};

/**
 * Upload a deck, watch the authoring pipeline, review every description and
 * publish. Nothing reaches students until Publish is pressed (charter A3):
 * the draft is job-scoped and the API refuses to publish unreviewed assets.
 * Instructors sign in with Google first (D12); the API decides who is an
 * instructor, this panel only carries the token.
 */
export function AuthoringPanel({
  client: injected, apiUrl = authoringApiUrl, clientId = googleClientId, signIn, pollMs = 5000,
  studentViewUrl = url => `?pack=${encodeURIComponent(url)}`, onPublishedPacks,
  onLocalPack,
}: Props): React.ReactElement {
  const [session, setSession] = useState<GoogleSession | null>(() => readSession());
  const [signInError, setSignInError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [profileId, setProfileId] = useState('');
  const [account, setAccount] = useState<{ instructor: Instructor; profiles: CourseProfile[] } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [localError, setLocalError] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const localImageUrlRef = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const googleButton = useRef<HTMLDivElement>(null);
  const useExtensionFlow = signIn !== undefined || extensionIdentity() !== null;
  const localPreview = import.meta.env.DEV && onLocalPack !== undefined && !injected && !apiUrl && !clientId;
  const client = injected ?? (apiUrl && session ? createAuthoringClient(apiUrl, session.idToken) : null);

  useEffect(() => () => {
    if (localImageUrlRef.current) URL.revokeObjectURL(localImageUrlRef.current);
  }, []);

  function signOut(): void {
    writeSession(null); setSession(null); setAccount(null); setPhase({ kind: 'idle' });
  }

  // First call after sign-in creates the instructor account (D13) and lists
  // the course profiles a deck can be described against.
  useEffect(() => {
    if (!client) { setAccount(null); return; }
    let stopped = false;
    client.me().then(me => {
      if (stopped) return;
      setAccount({ instructor: me.instructor, profiles: me.profiles });
      onPublishedPacks?.(me.packs);
    }).catch(error => {
      if (!stopped) setPhase({ kind: 'failed', message: failure(error) });
    });
    return () => { stopped = true; };
    // Re-run when the client changes (sign-in / sign-out), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client === null, session?.idToken, injected]);

  /** An expired or revoked Google session reads as 401; drop it so the sign-in button returns. */
  function failure(error: unknown): string {
    if (error instanceof AuthoringApiError && error.status === 401) {
      writeSession(null); setSession(null);
      return 'Your Google sign-in expired. Sign in again to continue.';
    }
    return error instanceof Error ? error.message : String(error);
  }

  async function startSignIn(): Promise<void> {
    if (!clientId) return;
    setSignInError(null);
    try {
      setSession(await (signIn ?? (() => signInWithExtension(clientId)))());
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : String(error));
    }
  }

  // Web page (local hosting): Google renders its own button.
  useEffect(() => {
    const parent = googleButton.current;
    if (useExtensionFlow || !clientId || session || injected || !parent) return;
    void renderGoogleButton(parent, clientId, next => setSession(next)).catch(error => {
      setSignInError(error instanceof Error ? error.message : String(error));
    });
  }, [useExtensionFlow, clientId, session, injected]);

  useEffect(() => {
    if (phase.kind !== 'running' || !client) return;
    let stopped = false;
    const tick = async () => {
      try {
        const job = await client.getJob(phase.jobId);
        if (stopped) return;
        if (job.status === 'review') {
          const pack = await client.getDraft(phase.jobId);
          if (!stopped) setPhase({ kind: 'review', jobId: phase.jobId, pack, rejected: new Set(), edits: new Map() });
        } else if (job.status === 'failed' || job.status === 'needs_input') {
          setPhase({ kind: 'failed', jobId: phase.jobId, message: job.error ?? STAGE_TEXT[job.status] });
        } else {
          setPhase({ kind: 'running', jobId: phase.jobId, job });
        }
      } catch (error) {
        if (!stopped) setPhase({ kind: 'failed', jobId: phase.jobId, message: failure(error) });
      }
    };
    const handle = setInterval(() => { void tick(); }, pollMs);
    void tick();
    return () => { stopped = true; clearInterval(handle); };
    // Re-arm only when the job changes, not on every progress update.
  }, [client, phase.kind, phase.kind === 'running' ? phase.jobId : null, pollMs]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!client || !file || !title.trim()) return;
    setPhase({ kind: 'uploading' });
    try {
      const jobId = await client.submitDeck({ name: file.name, type: file.type, body: file }, { packId: packIdFromTitle(title), title: title.trim(), ...(profileId ? { profileId } : {}) });
      setPhase({ kind: 'running', jobId, job: null });
    } catch (error) {
      setPhase({ kind: 'failed', message: failure(error) });
    }
  }

  async function publish(): Promise<void> {
    if (phase.kind !== 'review' || !client) return;
    const { jobId, pack, rejected, edits } = phase;
    setPhase({ kind: 'publishing', jobId });
    try {
      await client.review(jobId, pack.assets.map(asset => {
        const rejectRegions = asset.regions.map(r => r.regionId).filter(id => rejected.has(`${asset.assetId}/${id}`));
        // Only what actually changed is sent; the API applies edits on top of the draft.
        const regionEdits = asset.regions.flatMap(region => {
          const edit = edits.get(`${asset.assetId}/${region.regionId}`);
          if (!edit || rejected.has(`${asset.assetId}/${region.regionId}`)) return [];
          const short = edit.shortDescription.trim();
          const plain = edit.plainLanguage.trim();
          const changed = {
            ...(short && short !== region.shortDescription ? { shortDescription: short } : {}),
            ...(plain && plain !== region.plainLanguage ? { plainLanguage: plain } : {}),
          };
          return Object.keys(changed).length ? [{ regionId: region.regionId, ...changed }] : [];
        });
        return {
          assetId: asset.assetId,
          ...(rejectRegions.length ? { rejectRegions } : {}),
          ...(regionEdits.length ? { regionEdits } : {}),
        };
      }));
      const result = await client.publish(jobId);
      setPhase({ kind: 'published', result });
      if (onPublishedPacks) onPublishedPacks((await client.me()).packs);
    } catch (error) {
      setPhase({ kind: 'failed', jobId, message: failure(error) });
    }
  }

  function toggleRegion(key: string): void {
    if (phase.kind !== 'review') return;
    const rejected = new Set(phase.rejected);
    if (rejected.has(key)) rejected.delete(key); else rejected.add(key);
    setPhase({ ...phase, rejected });
  }

  function editRegion(key: string, current: RegionText, change: Partial<RegionText>): void {
    if (phase.kind !== 'review') return;
    const edits = new Map(phase.edits);
    edits.set(key, { ...(edits.get(key) ?? current), ...change });
    setPhase({ ...phase, edits });
  }

  function reset(): void {
    setPhase({ kind: 'idle' }); setFile(null); setTitle('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submitLocalPreview(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!file || !onLocalPack) return;
    setLocalError(null);
    try {
      const pack = await createLocalImagePack(file, title);
      onLocalPack(pack);
      setLocalReady(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }

  if (localPreview) {
    return <section className="authoring" aria-labelledby="authoring-heading">
      <h2 id="authoring-heading">Local slide preview</h2>
      <p className="supporting-text">No Google sign-in is needed on localhost. Upload one PNG or JPEG slide to test local matching and the spatial AR renderer. The image and preview pack stay in this browser.</p>
      <form onSubmit={event => { void submitLocalPreview(event); }} aria-label="Local slide preview upload">
        <label htmlFor="local-slide-title">Slide title
          <input id="local-slide-title" type="text" value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. My lesson slide" maxLength={200} />
        </label>
        <label htmlFor="local-slide-file">Slide image (PNG or JPEG)
          <input id="local-slide-file" type="file" accept="image/png,image/jpeg" required onChange={event => {
            const nextFile = event.target.files?.[0] ?? null;
            if (localImageUrlRef.current) URL.revokeObjectURL(localImageUrlRef.current);
            const nextUrl = nextFile ? URL.createObjectURL(nextFile) : null;
            localImageUrlRef.current = nextUrl;
            setLocalImageUrl(nextUrl);
            setFile(nextFile);
            setLocalReady(false);
          }} />
        </label>
        <button type="submit" disabled={!file}>Load local slide</button>
      </form>
      {localImageUrl && <figure className="slide-figure"><div className="slide-frame"><img className="slide-image" src={localImageUrl} alt={title || file?.name || 'Selected local slide'} /></div><figcaption className="supporting-text">Share the image-only tab for the cleanest local match: <a href={localImageUrl} target="_blank" rel="noopener">Open slide image in a tab</a>.</figcaption></figure>}
      {localReady && <p role="status">Local slide loaded. Start sharing this image or open Student mode and choose AR.</p>}
      {localError && <p role="alert">{localError}</p>}
    </section>;
  }

  if (!injected && (!apiUrl || !clientId)) {
    return <section className="authoring" aria-labelledby="authoring-heading"><h2 id="authoring-heading">Upload slides</h2><p>This build has no authoring API or Google sign-in configured.</p></section>;
  }

  if (!client) {
    return (
      <section className="authoring" aria-labelledby="authoring-heading">
        <h2 id="authoring-heading">Upload slides</h2>
        <p className="supporting-text">Sign in with the Google account your course lists as an instructor to upload and review decks.</p>
        {useExtensionFlow
          ? <button type="button" onClick={() => { void startSignIn(); }}>Sign in with Google</button>
          : <div ref={googleButton} aria-label="Sign in with Google" />}
        {signInError && <p role="alert">{signInError}</p>}
      </section>
    );
  }

  return (
    <section className="authoring" aria-labelledby="authoring-heading">
      <h2 id="authoring-heading">Upload slides</h2>
      <p className="supporting-text">A deck becomes a lesson pack: slide images, descriptions and audio, which you review before anyone sees them.</p>

      {(account || session) && (
        <p className="authoring-account">
          <span>Signed in as <strong>{account?.instructor.name ?? account?.instructor.email ?? session?.email}</strong>{account?.instructor.name ? ` (${account.instructor.email})` : ''}</span>
          <button type="button" className="secondary" onClick={signOut}>Sign out</button>
        </p>
      )}

      {account && <LibraryPanel client={client} profiles={account.profiles} onProfilesChange={profiles => setAccount({ ...account, profiles })} pollMs={pollMs} />}

      {(phase.kind === 'idle' || phase.kind === 'uploading' || (phase.kind === 'failed' && !phase.jobId)) && (
        <form onSubmit={e => { void submit(e); }} aria-label="Upload a deck">
          <label htmlFor="authoring-title">Lesson title
            <input id="authoring-title" type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
          </label>
          <label htmlFor="authoring-file">Deck (PDF or PPTX)
            <input id="authoring-file" ref={fileInput} type="file" accept=".pdf,.pptx,.docx,.txt" required onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {account && account.profiles.length > 0 && (
            <label htmlFor="authoring-profile">Course (descriptions quote its materials)
              <select id="authoring-profile" value={profileId} onChange={e => setProfileId(e.target.value)}>
                <option value="">No course</option>
                {account.profiles.map(profile => <option key={profile.profileId} value={profile.profileId}>{profile.name}</option>)}
              </select>
            </label>
          )}
          <button type="submit" disabled={!client || !file || !title.trim() || phase.kind === 'uploading'}>
            {phase.kind === 'uploading' ? 'Uploading…' : 'Upload and describe'}
          </button>
        </form>
      )}

      {phase.kind === 'running' && (
        <p role="status" aria-live="polite">
          {STAGE_TEXT[phase.job?.status ?? 'queued']}{phase.job && phase.job.slides.length > 0 ? ` ${phase.job.slides.length} slides done.` : ''}
        </p>
      )}

      {phase.kind === 'review' && (
        <div className="authoring-review">
          <p role="status">Ready for your review: {phase.pack.assets.length} slides. Edit any description, untick one to leave it out, then publish. An edited description is re-recorded in the same voice when you publish.</p>
          <ol className="authoring-slides">
            {phase.pack.assets.map(asset => (
              <li key={asset.assetId}>
                <h3>{asset.title ?? asset.assetId}</h3>
                <ul>
                  {asset.regions.map(region => {
                    const key = `${asset.assetId}/${region.regionId}`;
                    const current: RegionText = { shortDescription: region.shortDescription, plainLanguage: region.plainLanguage };
                    const text = phase.edits.get(key) ?? current;
                    const kept = !phase.rejected.has(key);
                    const id = key.replace(/[^a-zA-Z0-9_-]/gu, '-');
                    return (
                      <li key={region.regionId} className={kept ? undefined : 'authoring-region-out'}>
                        <label className="authoring-keep">
                          <input type="checkbox" checked={kept} onChange={() => toggleRegion(key)} />
                          <span>{region.label ?? region.regionId}</span>
                        </label>
                        <div className="authoring-region-text">
                          <label htmlFor={`short-${id}`}>Description
                            <textarea id={`short-${id}`} className="authoring-short" rows={2} maxLength={700} disabled={!kept} value={text.shortDescription}
                              onChange={e => editRegion(key, current, { shortDescription: e.target.value })} />
                          </label>
                          <label htmlFor={`plain-${id}`}>Plain language
                            <textarea id={`plain-${id}`} className="authoring-plain" rows={2} maxLength={500} disabled={!kept} value={text.plainLanguage}
                              onChange={e => editRegion(key, current, { plainLanguage: e.target.value })} />
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => { void publish(); }}>Approve and publish</button>
          <button type="button" className="secondary" onClick={reset}>Discard</button>
        </div>
      )}

      {phase.kind === 'publishing' && <p role="status" aria-live="polite">Publishing…</p>}

      {phase.kind === 'published' && (
        <p role="status" className="authoring-published">
          Published <strong>{phase.result.packId}</strong> version {phase.result.version}.{' '}
          <a href={studentViewUrl(phase.result.packUrl)}>Open in the student view</a>.{' '}
          <button type="button" className="secondary" onClick={reset}>Upload another</button>
        </p>
      )}

      {phase.kind === 'failed' && (
        <p role="alert">{phase.message} <button type="button" className="secondary" onClick={reset}>Start over</button></p>
      )}
    </section>
  );
}
