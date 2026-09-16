import React, { useEffect, useRef, useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import {
  AuthoringApiError, authoringApiUrl, createAuthoringClient, packIdFromTitle,
  type AuthoringClient, type JobState, type Published,
} from '../shared/authoringClient';
import {
  extensionIdentity, googleClientId, readSession, renderGoogleButton, signInWithExtension, writeSession, type GoogleSession,
} from '../shared/googleSignIn';

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
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'running'; jobId: string; job: JobState | null }
  | { kind: 'review'; jobId: string; pack: AccessPack; rejected: Set<string> }
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
  studentViewUrl = url => `?pack=${encodeURIComponent(url)}`,
}: Props): React.ReactElement {
  const [session, setSession] = useState<GoogleSession | null>(() => readSession());
  const [signInError, setSignInError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);
  const googleButton = useRef<HTMLDivElement>(null);
  const useExtensionFlow = signIn !== undefined || extensionIdentity() !== null;
  const client = injected ?? (apiUrl && session ? createAuthoringClient(apiUrl, session.idToken) : null);

  function signOut(): void {
    writeSession(null); setSession(null); setPhase({ kind: 'idle' });
  }

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
          if (!stopped) setPhase({ kind: 'review', jobId: phase.jobId, pack, rejected: new Set() });
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
      const jobId = await client.submitDeck({ name: file.name, type: file.type, body: file }, { packId: packIdFromTitle(title), title: title.trim() });
      setPhase({ kind: 'running', jobId, job: null });
    } catch (error) {
      setPhase({ kind: 'failed', message: failure(error) });
    }
  }

  async function publish(): Promise<void> {
    if (phase.kind !== 'review' || !client) return;
    const { jobId, pack, rejected } = phase;
    setPhase({ kind: 'publishing', jobId });
    try {
      await client.review(jobId, pack.assets.map(asset => {
        const rejectRegions = asset.regions.map(r => r.regionId).filter(id => rejected.has(`${asset.assetId}/${id}`));
        return rejectRegions.length ? { assetId: asset.assetId, rejectRegions } : { assetId: asset.assetId };
      }));
      const result = await client.publish(jobId);
      setPhase({ kind: 'published', result });
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

  function reset(): void {
    setPhase({ kind: 'idle' }); setFile(null); setTitle('');
    if (fileInput.current) fileInput.current.value = '';
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

      {session && (
        <p className="authoring-account">
          <span>Signed in as <strong>{session.email}</strong></span>
          <button type="button" className="secondary" onClick={signOut}>Sign out</button>
        </p>
      )}

      {(phase.kind === 'idle' || phase.kind === 'uploading' || (phase.kind === 'failed' && !phase.jobId)) && (
        <form onSubmit={e => { void submit(e); }} aria-label="Upload a deck">
          <label htmlFor="authoring-title">Lesson title
            <input id="authoring-title" type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
          </label>
          <label htmlFor="authoring-file">Deck (PDF or PPTX)
            <input id="authoring-file" ref={fileInput} type="file" accept=".pdf,.pptx,.docx,.txt" required onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
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
          <p role="status">Ready for your review: {phase.pack.assets.length} slides. Untick a description to leave it out, then publish.</p>
          <ol className="authoring-slides">
            {phase.pack.assets.map(asset => (
              <li key={asset.assetId}>
                <h3>{asset.title ?? asset.assetId}</h3>
                <ul>
                  {asset.regions.map(region => {
                    const key = `${asset.assetId}/${region.regionId}`;
                    return (
                      <li key={region.regionId}>
                        <label>
                          <input type="checkbox" checked={!phase.rejected.has(key)} onChange={() => toggleRegion(key)} />
                          <span className="authoring-short">{region.shortDescription}</span>
                          {region.plainLanguage ? <span className="authoring-plain">{region.plainLanguage}</span> : null}
                        </label>
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
