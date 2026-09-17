import React, { useEffect, useRef, useState } from 'react';
import type { CourseMediaApi, ItemDetail } from './api';

/**
 * How a student reads one piece of course material: every page and image has
 * alt text a screen reader announces and a sighted student can also read, and
 * every recording has captions and a transcript that seeks the player.
 */
export function MaterialViewer({ api, classCode, itemId, onBack }: {
  api: CourseMediaApi;
  classCode: string;
  itemId: string;
  onBack: () => void;
}): React.ReactElement {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get(classCode, itemId)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) setError((e as Error).message || 'This material could not be opened.'); });
    return () => { cancelled = true; };
  }, [api, classCode, itemId]);

  // Move focus to the material, so a screen reader announces what opened.
  useEffect(() => { if (detail) heading.current?.focus(); }, [detail]);

  const manifest = detail?.manifest;
  const url = (key?: string) => (key ? detail?.urls?.[key] : undefined);

  return (
    <article className="material-viewer" aria-busy={!detail && !error}>
      <button type="button" className="quiet" onClick={onBack}>← All materials</button>
      {error && <p role="alert">{error}</p>}
      {!detail && !error && <p role="status">Opening…</p>}
      {detail && !manifest && <p role="status">This material is still being prepared. Check back in a minute.</p>}
      {manifest && (
        <>
          <h3 ref={heading} tabIndex={-1}>{manifest.fileName}</h3>
          {manifest.document && <DocumentView pages={manifest.document.pages} truncatedAt={manifest.document.truncatedAt} url={url} />}
          {manifest.image && (
            <figure className="material-image">
              <img src={url(manifest.image.imageKey)} alt={manifest.image.decorative ? '' : manifest.image.altText} />
              {!manifest.image.decorative && (
                <figcaption>
                  <p><strong>Description:</strong> {manifest.image.altText}</p>
                  {manifest.image.longDescription && <p className="long-description">{manifest.image.longDescription}</p>}
                </figcaption>
              )}
            </figure>
          )}
          {manifest.media && <MediaView media={manifest.media} url={url} />}
          <p className="supporting-text">Alt text and captions were generated automatically and can contain mistakes.</p>
        </>
      )}
    </article>
  );
}

type Pages = NonNullable<NonNullable<ItemDetail['manifest']>['document']>['pages'];

function DocumentView({ pages, truncatedAt, url }: { pages: Pages; truncatedAt?: number; url: (key?: string) => string | undefined }): React.ReactElement {
  const [index, setIndex] = useState(0);
  const page = pages[index];
  if (!page) return <p>This document has no pages.</p>;
  const go = (next: number) => setIndex(Math.max(0, Math.min(pages.length - 1, next)));

  return (
    <section aria-label="Document pages">
      <div className="page-nav" role="group" aria-label="Page navigation">
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0}>Previous page</button>
        <label htmlFor="page-select" className="inline-label">Page</label>
        <select id="page-select" value={index} onChange={e => go(Number(e.target.value))}>
          {pages.map((p, i) => <option key={p.number} value={i}>{p.number} of {pages.length}</option>)}
        </select>
        <button type="button" onClick={() => go(index + 1)} disabled={index === pages.length - 1}>Next page</button>
      </div>
      <figure className="material-page" aria-live="polite">
        <img src={url(page.imageKey)} alt={`Page ${page.number}: ${page.description}`} />
        <figcaption><strong>About this page:</strong> {page.description}</figcaption>
      </figure>
      {page.figures.length > 0 && (
        <section aria-label="Figures on this page">
          <h4>Figures</h4>
          <ol className="figure-list">
            {page.figures.map((figure, i) => (
              <li key={i}>
                <p>{figure.altText}</p>
                {figure.longDescription && (
                  <details><summary>Full description</summary><p className="long-description">{figure.longDescription}</p></details>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {page.text && (
        <details open>
          <summary>Text on this page</summary>
          <div className="page-text">{page.text}</div>
        </details>
      )}
      {truncatedAt && <p className="a11y-notice">Only the first {truncatedAt} pages were processed.</p>}
    </section>
  );
}

type Media = NonNullable<NonNullable<ItemDetail['manifest']>['media']>;

export function MediaView({ media, url }: { media: Media; url: (key?: string) => string | undefined }): React.ReactElement {
  const player = useRef<HTMLMediaElement | null>(null);
  const [now, setNow] = useState(0);
  const src = url(media.mediaKey);
  const Player = media.type === 'video' ? 'video' : 'audio';
  const lang = media.language?.slice(0, 2) ?? 'en';

  const seek = (seconds: number) => {
    if (!player.current) return;
    player.current.currentTime = seconds;
    void player.current.play?.()?.catch(() => undefined);
  };

  return (
    <section aria-label="Recording with captions">
      {src ? (
        <Player
          ref={(el: HTMLMediaElement | null) => { player.current = el; }}
          className="media-player"
          controls
          crossOrigin="anonymous"
          src={src}
          onTimeUpdate={e => setNow((e.target as HTMLMediaElement).currentTime)}
        >
          <track kind="captions" src={url(media.vttKey)} srcLang={lang} label="Captions" default />
        </Player>
      ) : (
        <p className="a11y-notice">This recording's format cannot play in the browser. Its full transcript is below.</p>
      )}
      <h4>Transcript</h4>
      {media.transcript.length === 0 ? (
        <p className="supporting-text">No speech was detected in this recording.</p>
      ) : (
        <ol className="transcript" aria-label="Transcript">
          {media.transcript.map((cue, i) => {
            const active = now >= cue.start && now < cue.end;
            return (
              <li key={i} aria-current={active ? 'true' : undefined}>
                <button type="button" className="quiet transcript-time" onClick={() => seek(cue.start)} disabled={!src}
                  aria-label={`Play from ${formatTime(cue.start)}`}>
                  {formatTime(cue.start)}
                </button>
                <span>{cue.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
