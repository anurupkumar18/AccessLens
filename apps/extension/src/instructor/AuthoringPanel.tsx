import React, { useEffect, useRef, useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import {
  authoringApiUrl, createAuthoringClient, packIdFromTitle, readAuthoringToken, writeAuthoringToken,
  type AuthoringClient, type JobState, type Published,
} from '../shared/authoringClient';

interface Props {
  /** Injected in tests; otherwise built from VITE_ACCESSLENS_API_URL and the saved token. */
  client?: AuthoringClient;
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
 */
export function AuthoringPanel({ client: injected, pollMs = 5000, studentViewUrl = url => `?pack=${encodeURIComponent(url)}` }: Props): React.ReactElement {
  const [token, setToken] = useState(() => readAuthoringToken());
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);
  const client = injected ?? (authoringApiUrl && token ? createAuthoringClient(authoringApiUrl, token) : null);

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
        if (!stopped) setPhase({ kind: 'failed', jobId: phase.jobId, message: error instanceof Error ? error.message : String(error) });
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
      setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
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
      setPhase({ kind: 'failed', jobId, message: error instanceof Error ? error.message : String(error) });
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

  if (!authoringApiUrl && !injected) {
    return <section className="authoring" aria-labelledby="authoring-heading"><h2 id="authoring-heading">Upload slides</h2><p>This build has no authoring API configured.</p></section>;
  }

  return (
    <section className="authoring" aria-labelledby="authoring-heading">
      <h2 id="authoring-heading">Upload slides</h2>
      <p className="supporting-text">A deck becomes a lesson pack: slide images, descriptions and audio, which you review before anyone sees them.</p>

      <label htmlFor="authoring-token">Authoring token
        <input id="authoring-token" type="password" autoComplete="off" value={token}
          onChange={e => { setToken(e.target.value); writeAuthoringToken(e.target.value); }} />
      </label>

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
          {!token && <p role="note" className="supporting-text">Paste the token from the deploy output (or SSM /accesslens/authoring/api-token) to enable uploads.</p>}
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
