import React, { useEffect, useMemo, useRef, useState } from 'react';
import { mediaApi, type MediaApi } from './api';
import { buildCues, formatTimestamp, toTranscript, toWebVtt, type Cue } from './captions';
import { isOfficeGeneratedAlt, readPptx, writePptxAltText, type AltTextDecision } from './pptx';

/**
 * Instructor-side preparation of course media students will read: draft alt
 * text for images and slide pictures, draft captions for recordings.
 *
 * Every draft is Claude's until the instructor approves it (charter A3), and
 * nothing can be downloaded before that. The instructor then puts the reviewed
 * files where students already get course material; AccessLens does not publish
 * anything itself.
 */

type AltStatus = 'drafting' | 'needs-review' | 'approved';

interface AltItem {
  key: string;
  label: string;
  previewUrl?: string;
  decision: AltTextDecision;
  status: AltStatus;
  /** Existing alt text came from the author's own file, not from Claude. */
  origin: 'claude' | 'author' | 'manual';
  error?: string;
}

type Job =
  | { kind: 'image'; id: string; fileName: string; item: AltItem }
  | { kind: 'pptx'; id: string; fileName: string; bytes: Uint8Array; items: AltItem[] }
  | {
      kind: 'captions';
      id: string;
      fileName: string;
      mediaUrl: string;
      isVideo: boolean;
      lang: string;
      status: 'transcribing' | 'ready' | 'failed';
      progress: { done: number; total: number };
      cues: Cue[];
      reviewed: boolean;
      error?: string;
    };

const LANGUAGES: [string, string][] = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['es-US', 'Spanish (US)'],
  ['fr-FR', 'French'],
  ['de-DE', 'German'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['hi-IN', 'Hindi'],
  ['zh-CN', 'Chinese (Mandarin)'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
];

const MB = 1024 * 1024;
const LIMITS = { image: 20 * MB, pptx: 200 * MB, captions: 1024 * MB };
const DRAFT_CONCURRENCY = 3;

const EMPTY_DECISION: AltTextDecision = { decorative: false, altText: '', longDescription: '' };

export function classify(file: File): Job['kind'] | undefined {
  const name = file.name.toLowerCase();
  if (/\.(png|jpe?g)$/.test(name)) return 'image';
  if (name.endsWith('.pptx')) return 'pptx';
  if (/\.(mp3|mp4)$/.test(name)) return 'captions';
  return undefined;
}

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, '');

function download(data: BlobPart, type: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function altTextCsv(rows: { fileName: string; decision: AltTextDecision }[]): string {
  const lines = [['file', 'decorative', 'alt_text', 'long_description'].join(',')];
  for (const { fileName, decision } of rows) {
    lines.push([csvCell(fileName), decision.decorative ? 'yes' : 'no', csvCell(decision.altText), csvCell(decision.longDescription)].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

const canApprove = (item: AltItem) => item.status !== 'drafting' && (item.decision.decorative || item.decision.altText.trim().length > 0);

interface Props {
  api?: MediaApi;
}

export function MediaPrepPanel({ api = mediaApi }: Props): React.ReactElement {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [courseContext, setCourseContext] = useState('');
  const [lang, setLang] = useState('en-US');
  const [rejected, setRejected] = useState<string[]>([]);
  const nextId = useRef(0);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);

  const objectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  };

  const patchJob = (id: string, patch: (job: Job) => Job) => setJobs(all => all.map(job => (job.id === id ? patch(job) : job)));

  const patchItem = (jobId: string, key: string, patch: Partial<AltItem>) =>
    patchJob(jobId, job => {
      if (job.kind === 'image') return job.item.key === key ? { ...job, item: { ...job.item, ...patch } } : job;
      if (job.kind === 'pptx') return { ...job, items: job.items.map(item => (item.key === key ? { ...item, ...patch } : item)) };
      return job;
    });

  const contextWith = (local: string) => [courseContext.trim() && `Course: ${courseContext.trim()}`, local].filter(Boolean).join('\n');

  async function draft(jobId: string, key: string, blob: Blob, context: string): Promise<void> {
    patchItem(jobId, key, { status: 'drafting', error: undefined });
    try {
      const decision = await api.draftAltText(blob, context);
      patchItem(jobId, key, { status: 'needs-review', decision, origin: 'claude' });
    } catch (error) {
      patchItem(jobId, key, { status: 'needs-review', origin: 'manual', error: (error as Error).message || 'Could not draft alt text.' });
    }
  }

  async function addFile(file: File): Promise<void> {
    const kind = classify(file);
    if (!kind) {
      setRejected(r => [...r, `${file.name}: only .pptx, .png, .jpg, .mp3, and .mp4 files are supported.`]);
      return;
    }
    if (file.size > LIMITS[kind]) {
      setRejected(r => [...r, `${file.name}: larger than ${LIMITS[kind] / MB} MB.`]);
      return;
    }
    const id = `job-${nextId.current++}`;

    if (kind === 'image') {
      const item: AltItem = { key: 'image', label: file.name, previewUrl: objectUrl(file), decision: EMPTY_DECISION, status: 'drafting', origin: 'claude' };
      setJobs(all => [...all, { kind, id, fileName: file.name, item }]);
      await draft(id, item.key, file, contextWith(`File name: ${file.name}`));
      return;
    }

    if (kind === 'captions') {
      const isVideo = file.name.toLowerCase().endsWith('.mp4');
      setJobs(all => [...all, { kind, id, fileName: file.name, mediaUrl: objectUrl(file), isVideo, lang, status: 'transcribing', progress: { done: 0, total: 0 }, cues: [], reviewed: false }]);
      try {
        const words = await api.transcribe(file, lang, (done, total) =>
          patchJob(id, job => (job.kind === 'captions' ? { ...job, progress: { done, total } } : job)));
        patchJob(id, job => (job.kind === 'captions' ? { ...job, status: 'ready', cues: buildCues(words) } : job));
      } catch (error) {
        patchJob(id, job => (job.kind === 'captions' ? { ...job, status: 'failed', error: (error as Error).message || 'Transcription failed.' } : job));
      }
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let images;
    try {
      images = readPptx(bytes);
    } catch (error) {
      setRejected(r => [...r, `${file.name}: ${(error as Error).message}`]);
      return;
    }
    const items: AltItem[] = images.map(image => {
      const existing = image.pictures.find(p => p.existingDecorative || (p.existingAlt.trim() && !isOfficeGeneratedAlt(p.existingAlt)));
      const slides = `Slide${image.slides.length > 1 ? 's' : ''} ${image.slides.join(', ')}`;
      const previewUrl = image.mimeType ? objectUrl(new Blob([image.bytes as BlobPart], { type: image.mimeType })) : undefined;
      if (existing) {
        return {
          key: image.mediaPath, label: slides, previewUrl, status: 'approved', origin: 'author',
          decision: { decorative: existing.existingDecorative, altText: existing.existingDecorative ? '' : existing.existingAlt, longDescription: '' },
        };
      }
      return {
        key: image.mediaPath, label: slides, previewUrl, decision: EMPTY_DECISION, origin: 'manual',
        status: image.mimeType ? 'drafting' : 'needs-review',
        error: image.mimeType ? undefined : 'This picture format cannot be read in the browser. Write its alt text by hand.',
      };
    });
    setJobs(all => [...all, { kind, id, fileName: file.name, bytes, items }]);

    const queue = images.filter((image, i) => image.mimeType && items[i].status === 'drafting');
    const worker = async () => {
      for (let image = queue.shift(); image; image = queue.shift()) {
        await draft(id, image.mediaPath, new Blob([image.bytes as BlobPart], { type: image.mimeType }), contextWith(image.context));
      }
    };
    await Promise.all(Array.from({ length: DRAFT_CONCURRENCY }, worker));
  }

  function onFiles(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setRejected([]);
    files.forEach(file => void addFile(file));
  }

  const approvedImages = jobs.filter((job): job is Extract<Job, { kind: 'image' }> => job.kind === 'image' && job.item.status === 'approved');

  return (
    <section aria-labelledby="media-prep-heading" className="media-prep">
      <h2 id="media-prep-heading">Prepare course media</h2>
      <p className="supporting-text">
        Upload slides, images, or recordings. AccessLens drafts alt text and captions with Claude; you review and approve
        every draft before you can download it, then post the files wherever your students already get course material.
      </p>
      <p className="a11y-notice">
        Images and audio are sent to the AccessLens AWS service only to draft text and are not stored. Upload only material
        you are allowed to share.
      </p>

      <div className="media-prep-options">
        <p>
          <label htmlFor="media-course-context">Course or topic (optional)</label>
          <input id="media-course-context" type="text" value={courseContext} placeholder="e.g. BIOL 1210, cell biology"
            onChange={e => setCourseContext(e.target.value)} />
        </p>
        <p>
          <label htmlFor="media-caption-lang">Spoken language in recordings</label>
          <select id="media-caption-lang" value={lang} onChange={e => setLang(e.target.value)}>
            {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </p>
        <p>
          <label htmlFor="media-upload">Files: .pptx, .png, .jpg, .mp3, .mp4</label>
          <input id="media-upload" type="file" multiple onChange={onFiles}
            accept=".pptx,.png,.jpg,.jpeg,.mp3,.mp4,image/png,image/jpeg,audio/mpeg,video/mp4,application/vnd.openxmlformats-officedocument.presentationml.presentation" />
        </p>
      </div>

      {rejected.length > 0 && (
        <div role="alert">{rejected.map(message => <p key={message}>{message}</p>)}</div>
      )}

      {jobs.map(job => {
        if (job.kind === 'image') {
          return (
            <article key={job.id} className="media-job" aria-label={job.fileName}>
              <h3>{job.fileName}</h3>
              <AltTextEditor idPrefix={job.id} item={job.item} onChange={patch => patchItem(job.id, job.item.key, patch)} />
              <div className="a11y-actions">
                <button type="button" disabled={job.item.status !== 'approved'}
                  onClick={() => void navigator.clipboard?.writeText(job.item.decision.decorative ? '' : job.item.decision.altText)}>
                  Copy alt text
                </button>
              </div>
            </article>
          );
        }
        if (job.kind === 'pptx') {
          const approved = job.items.filter(item => item.status === 'approved').length;
          const ready = approved === job.items.length;
          return (
            <article key={job.id} className="media-job" aria-label={job.fileName}>
              <h3>{job.fileName}</h3>
              {job.items.length === 0 ? (
                <p className="supporting-text">This deck has no embedded pictures, so it needs no alt text.</p>
              ) : (
                <p role="status" className="supporting-text">{approved} of {job.items.length} pictures approved.</p>
              )}
              {job.items.map(item => (
                <AltTextEditor key={item.key} idPrefix={job.id} item={item} onChange={patch => patchItem(job.id, item.key, patch)} />
              ))}
              <div className="a11y-actions">
                <button type="button" className="primary" disabled={!ready || job.items.length === 0}
                  onClick={() => {
                    const decisions = new Map(job.items.map(item => [item.key, item.decision]));
                    download(writePptxAltText(job.bytes, decisions) as BlobPart, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', `${baseName(job.fileName)}-accessible.pptx`);
                  }}>
                  Download deck with alt text
                </button>
              </div>
              {!ready && job.items.length > 0 && <p className="supporting-text">Approve every picture to download the deck.</p>}
            </article>
          );
        }
        return (
          <CaptionJob key={job.id} job={job}
            onChange={patch => patchJob(job.id, current => (current.kind === 'captions' ? { ...current, ...patch } : current))} />
        );
      })}

      {approvedImages.length > 0 && (
        <div className="a11y-actions">
          <button type="button" onClick={() => download(altTextCsv(approvedImages.map(job => ({ fileName: job.fileName, decision: job.item.decision }))), 'text/csv', 'alt-text.csv')}>
            Download approved image alt text (.csv)
          </button>
        </div>
      )}
    </section>
  );
}

function AltTextEditor({ idPrefix, item, onChange }: { idPrefix: string; item: AltItem; onChange: (patch: Partial<AltItem>) => void }): React.ReactElement {
  const id = `${idPrefix}-alt-${item.key.replace(/[^a-z0-9]/gi, '-')}`;
  const setDecision = (patch: Partial<AltTextDecision>) => onChange({ decision: { ...item.decision, ...patch } });
  const badge = item.status === 'approved'
    ? (item.origin === 'author' ? '✓ Already in your file' : '✓ Approved')
    : item.status === 'drafting' ? '◔ Drafting…' : item.origin === 'claude' ? '⚠ Draft by Claude, not reviewed' : '✎ Needs your alt text';

  return (
    <div className="alt-item" data-status={item.status}>
      <div className="alt-item-head">
        {item.previewUrl
          ? <img src={item.previewUrl} alt="" className="alt-item-preview" />
          : <span className="alt-item-preview alt-item-missing" aria-hidden="true">No preview</span>}
        <div>
          <p className="eyebrow">{item.label}</p>
          <p className="alt-item-badge" role="status">{badge}</p>
        </div>
      </div>
      {item.error && <p className="a11y-notice">{item.error}</p>}
      <p>
        <input id={`${id}-decorative`} type="checkbox" checked={item.decision.decorative} disabled={item.status === 'drafting'}
          onChange={e => setDecision({ decorative: e.target.checked })} />{' '}
        <label htmlFor={`${id}-decorative`} className="inline-label">Decorative (screen readers skip it)</label>
      </p>
      {!item.decision.decorative && (
        <>
          <p>
            <label htmlFor={`${id}-alt`}>Alt text</label>
            <textarea id={`${id}-alt`} rows={2} value={item.decision.altText} disabled={item.status === 'drafting'}
              onChange={e => setDecision({ altText: e.target.value })} />
            <span className="supporting-text">{item.decision.altText.length} characters. Aim for under 150.</span>
          </p>
          <p>
            <label htmlFor={`${id}-long`}>Long description (charts, diagrams, tables)</label>
            <textarea id={`${id}-long`} rows={3} value={item.decision.longDescription} disabled={item.status === 'drafting'}
              onChange={e => setDecision({ longDescription: e.target.value })} />
          </p>
        </>
      )}
      <div className="a11y-actions">
        {item.status === 'approved' ? (
          <button type="button" className="quiet" onClick={() => onChange({ status: 'needs-review' })}>Edit again</button>
        ) : (
          <button type="button" className="primary" disabled={!canApprove(item)} onClick={() => onChange({ status: 'approved' })}>Approve</button>
        )}
      </div>
    </div>
  );
}

function CaptionJob({ job, onChange }: {
  job: Extract<Job, { kind: 'captions' }>;
  onChange: (patch: Partial<Extract<Job, { kind: 'captions' }>>) => void;
}): React.ReactElement {
  const vtt = useMemo(() => toWebVtt(job.cues), [job.cues]);
  const player = useRef<HTMLMediaElement | null>(null);
  const track = useRef<TextTrack | null>(null);

  // Preview through the TextTrack API rather than a <track> blob URL: swapping
  // a track's src reloads the media, which would jump the instructor back to
  // the start on every keystroke while they correct a cue.
  useEffect(() => {
    const element = player.current;
    if (!element || typeof element.addTextTrack !== 'function' || typeof VTTCue === 'undefined') return;
    track.current ??= element.addTextTrack('captions', 'Draft captions', job.lang.slice(0, 2));
    const current = track.current;
    current.mode = 'showing';
    for (const cue of Array.from(current.cues ?? [])) current.removeCue(cue);
    for (const cue of job.cues) current.addCue(new VTTCue(cue.start, cue.end, cue.text));
  }, [job.cues, job.lang, job.status]);

  const editCue = (index: number, text: string) =>
    onChange({ cues: job.cues.map((cue, i) => (i === index ? { ...cue, text } : cue)) });

  const Player = job.isVideo ? 'video' : 'audio';

  return (
    <article className="media-job" aria-label={job.fileName}>
      <h3>{job.fileName}</h3>
      {job.status === 'transcribing' && (
        <p role="status" className="supporting-text">
          ◔ Transcribing{job.progress.total > 0 ? ` part ${Math.min(job.progress.done + 1, job.progress.total)} of ${job.progress.total}` : ' (decoding audio)'}…
        </p>
      )}
      {job.status === 'failed' && <p role="alert">{job.error}</p>}
      {job.status === 'ready' && (
        <>
          <p className="a11y-notice">⚠ Captions drafted by automatic transcription. Check names, terms, and equations before students rely on them.</p>
          <Player controls src={job.mediaUrl} className="media-player" ref={(el: HTMLMediaElement | null) => { player.current = el; }} />
          {job.cues.length === 0 ? (
            <p className="supporting-text">No speech was recognised in this file.</p>
          ) : (
            <ol className="cue-list" aria-label="Caption cues">
              {job.cues.map((cue, index) => (
                <li key={`${cue.start}-${index}`}>
                  <label htmlFor={`${job.id}-cue-${index}`} className="cue-time">
                    {formatTimestamp(cue.start).slice(0, 8)} – {formatTimestamp(cue.end).slice(0, 8)}
                  </label>
                  <textarea id={`${job.id}-cue-${index}`} rows={2} value={cue.text} onChange={e => editCue(index, e.target.value)} />
                </li>
              ))}
            </ol>
          )}
          <p>
            <input id={`${job.id}-reviewed`} type="checkbox" checked={job.reviewed} onChange={e => onChange({ reviewed: e.target.checked })} />{' '}
            <label htmlFor={`${job.id}-reviewed`} className="inline-label">I have read and corrected these captions</label>
          </p>
          <div className="a11y-actions">
            <button type="button" className="primary" disabled={!job.reviewed || job.cues.length === 0}
              onClick={() => download(vtt, 'text/vtt', `${baseName(job.fileName)}.vtt`)}>
              Download captions (.vtt)
            </button>
            <button type="button" disabled={!job.reviewed || job.cues.length === 0}
              onClick={() => download(toTranscript(job.cues), 'text/plain', `${baseName(job.fileName)}-transcript.txt`)}>
              Download transcript (.txt)
            </button>
          </div>
        </>
      )}
    </article>
  );
}
