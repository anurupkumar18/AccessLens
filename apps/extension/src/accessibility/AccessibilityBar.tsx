import React, { useMemo } from 'react';
import type { AccessPack, LiveEvent } from '../shared/contracts';
import { CaptionsPanel } from './CaptionsPanel';
import { CatchUpPanel } from './CatchUpPanel';
import { TranslatePanel } from './TranslatePanel';

/**
 * The three supports that sit alongside whichever mode a student chose.
 *
 * Deliberately not a fifth tab. The existing tabs are mutually exclusive
 * answers to "how do I want to receive this lesson"; these three are not
 * alternatives to that choice, they are things a student reaches for *while*
 * receiving it — often mid-sentence, often while already behind. Burying them
 * one tab-switch away would cost exactly the students they exist for.
 *
 * Each is collapsible and all start closed, because four audiences with
 * different needs should not all pay the screen space of each other's
 * features.
 */

interface Props {
  events: LiveEvent[];
  event: LiveEvent | null;
  pack: AccessPack;
  /** Reviewed description of the region currently in focus, if any. */
  currentText: string;
  lastSeenSequence: number;
  captionsActive: boolean;
  /** The student's "Show instructor captions" preference: off hides the captions panel entirely. */
  showCaptions?: boolean;
  reducedMotion: boolean;
}

export function AccessibilityBar({
  events,
  event,
  pack,
  currentText,
  lastSeenSequence,
  captionsActive,
  showCaptions = true,
  reducedMotion,
}: Props): React.ReactElement {
  // A caption event is not a topic change, so it must not reset the point a
  // student is catching up from.
  const catchUpEvents = useMemo(
    () => events.filter((item) => item.type !== 'caption.appended'),
    [events],
  );

  return (
    <aside className="a11y-bar" aria-label="Accessibility supports">
      {/* HIDDEN FOR DEMO 2026-09-17: raw machine-transcription "Live captions" panel.
          "Instructor's words" (LiveCaptionsView, mounted above the mode tabs) is kept
          as the only live-captions surface for this demo. Re-enable by restoring this
          block; showCaptions/captionsActive/CaptionsPanel are unchanged below. */}
      {false && showCaptions && (
        <details className="a11y-disclosure" open={captionsActive}>
          <summary>Live captions</summary>
          <CaptionsPanel event={event} listening={captionsActive} reducedMotion={reducedMotion} />
        </details>
      )}

      {/* HIDDEN FOR DEMO 2026-09-17: "What did I miss?" recap. Restore by removing the `false &&`. */}
      {false && (
        <details className="a11y-disclosure">
          <summary>What did I miss?</summary>
          <CatchUpPanel
            events={catchUpEvents}
            pack={pack}
            sinceSequence={lastSeenSequence}
            reducedMotion={reducedMotion}
          />
        </details>
      )}

      <details className="a11y-disclosure">
        <summary>Read this in your language</summary>
        <TranslatePanel text={currentText} reducedMotion={reducedMotion} />
      </details>
    </aside>
  );
}
