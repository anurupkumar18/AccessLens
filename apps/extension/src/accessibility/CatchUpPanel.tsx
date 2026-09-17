import React, { useCallback, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import type { AccessPack, LiveEvent } from '../shared/contracts';
import { ServiceUnavailable, callService } from './endpoints';

/**
 * "What did I miss."
 *
 * The one feature every audience this product targets actually shares. A blind
 * student, a deaf student, a student reading in their second language, and a
 * student whose attention lapsed all fail the same way: they lose the thread,
 * and getting back in costs more than staying in did. Everything else here is
 * about receiving the lesson; this is about re-entering it.
 *
 * Two deliberate constraints:
 *
 * - The summary is generated, so it is labelled generated — before the text,
 *   not after it, so someone listening learns it is unverified before they
 *   have taken it as fact.
 * - It reports from a remembered point rather than "the last five minutes",
 *   because a student does not know when they drifted. The sequence number at
 *   the moment they last looked is something the app can know and they cannot.
 */

interface Props {
  events: LiveEvent[];
  pack: AccessPack;
  /** Sequence the student was last known to have seen. */
  sinceSequence: number;
  reducedMotion: boolean;
}

interface RecapResponse {
  text: string;
  notice: string;
  covered?: { fromSequence: number; toSequence: number; regionCount: number };
}

export function CatchUpPanel({ events, pack, sinceSequence, reducedMotion }: Props): React.ReactElement {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [recap, setRecap] = useState<RecapResponse | null>(null);
  const [message, setMessage] = useState('');
  const inFlight = useRef<AbortController | null>(null);

  const askWhatIMissed = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState('working');
    setMessage('Catching you up…');

    try {
      const response = await callService<RecapResponse>(
        'recap',
        {
          events,
          sinceSequence,
          pack: {
            title: pack.title,
            assets: pack.assets.map((asset) => ({
              assetId: asset.assetId,
              title: asset.title,
              regions: asset.regions.map((region) => ({
                regionId: region.regionId,
                label: (region as { label?: string }).label ?? region.regionId,
                shortDescription: region.shortDescription,
              })),
            })),
          },
        },
        controller.signal,
      );
      setRecap(response);
      setState('done');
      setMessage('Caught up.');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setState('error');
      setMessage(
        error instanceof ServiceUnavailable
          ? error.message
          : 'Could not build a catch-up just now.',
      );
    }
  }, [events, pack, sinceSequence]);

  return (
    <section className="a11y-card" aria-labelledby="catchup-heading">
      <h3 id="catchup-heading">Lost the thread?</h3>
      <p className="supporting-text">
        A short summary of what the instructor covered since you last looked.
      </p>

      <div className="a11y-actions">
        <button type="button" onClick={() => void askWhatIMissed()} disabled={state === 'working'}>
          {state === 'working' ? 'Catching up…' : 'What did I miss?'}
        </button>
        {state === 'working' && !reducedMotion ? (
          // Decorative only: the same information is in the button label and
          // the live region below, so a screen reader loses nothing by skipping
          // it, and a reduced-motion student never sees it at all.
          <span aria-hidden="true" className="a11y-orb">
            <ThinkingOrb state="composing" size={20} />
          </span>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="supporting-text">
        {message}
      </p>

      {recap ? (
        <div className="a11y-result">
          <p className="a11y-notice">
            <strong>Heads up:</strong> {recap.notice}
          </p>
          <p>{recap.text}</p>
          {recap.covered && recap.covered.regionCount > 0 ? (
            <p className="supporting-text">
              Covering {recap.covered.regionCount}{' '}
              {recap.covered.regionCount === 1 ? 'topic' : 'topics'} since you last looked.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
