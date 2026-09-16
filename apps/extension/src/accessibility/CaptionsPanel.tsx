import React, { useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import type { LiveEvent } from '../shared/contracts';

/**
 * Live captions of what the instructor is saying.
 *
 * The slide carries one kind of meaning; the instructor's voice carries
 * another, and no Access Pack contains it. For a deaf or hard-of-hearing
 * student that second channel is simply missing, and for a student reading in
 * a second language it moves faster than they can parse.
 *
 * Captions arrive as `caption.appended` events on the same ordered stream as
 * everything else, which is why T-16 had to be fixed first: the event type
 * existed with no payload, so a caption event could not carry a caption.
 *
 * Interim results are replaced in place rather than appended. Streaming
 * recognition revises itself constantly, and appending every revision produces
 * a stuttering wall of near-duplicates — unreadable precisely for the people
 * who need it most.
 */

interface Props {
  event: LiveEvent | null;
  listening: boolean;
  reducedMotion: boolean;
}

interface Line {
  id: number;
  text: string;
  isFinal: boolean;
  lang?: string;
}

const MAX_LINES = 40;

export function CaptionsPanel({ event, listening, reducedMotion }: Props): React.ReactElement {
  const [lines, setLines] = useState<Line[]>([]);
  const nextId = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!event || event.type !== 'caption.appended') return;
    const caption = (event as { caption?: { text: string; isFinal: boolean; lang?: string } }).caption;
    if (!caption?.text) return;

    setLines((current) => {
      const previous = current[current.length - 1];
      // An interim line is a draft of the line before it, not a new one.
      if (previous && !previous.isFinal) {
        const replaced = current.slice(0, -1);
        replaced.push({ ...previous, text: caption.text, isFinal: caption.isFinal, lang: caption.lang });
        return replaced.slice(-MAX_LINES);
      }
      nextId.current += 1;
      return [...current, { id: nextId.current, ...caption }].slice(-MAX_LINES);
    });
  }, [event]);

  useEffect(() => {
    // Follow the newest line, but only within the transcript box — scrolling
    // the whole panel would yank the page out from under someone reading it.
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  return (
    <section className="a11y-card" aria-labelledby="captions-heading">
      <div className="a11y-card-head">
        <h3 id="captions-heading">Live captions</h3>
        {listening && !reducedMotion ? (
          <span aria-hidden="true" className="a11y-orb">
            <ThinkingOrb state="listening" size={20} />
          </span>
        ) : null}
      </div>

      <p className="supporting-text">
        {listening
          ? 'Captioning what your instructor is saying. Machine transcription — it can mishear.'
          : 'Captions appear here once your instructor starts speaking.'}
      </p>

      {/* `log` rather than `status`: a live region that appends is what a
          transcript is, and it stops assistive tech re-reading the whole box
          every time one line changes. */}
      <div
        ref={logRef}
        className="a11y-transcript"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Live transcript"
        tabIndex={0}
      >
        {lines.length === 0 ? (
          <p className="supporting-text">No captions yet.</p>
        ) : (
          lines.map((line) => (
            <p key={line.id} lang={line.lang} className={line.isFinal ? '' : 'a11y-interim'}>
              {line.text}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
