import React, { useEffect, useState } from 'react';
import type { SessionClient } from '../shared/contracts';
import { readChoice, writeChoice } from '../shell/localChoice';

const KEEP_FINAL_LINES = 3;
const ANNOUNCE_KEY = 'accesslens-announce-captions';

/**
 * The instructor's words as live text. Labelled as speech, never as reviewed
 * lesson text: captions sit beside the reviewed descriptions and never replace
 * them (fixtures/captions.json expectations). Screen-reader announcement is
 * off by default so captions do not talk over the lesson; a student can turn
 * it on, and that choice stays on this device.
 */
export function LiveCaptionsView({ client }: { client: SessionClient }): React.ReactElement {
  const [finals, setFinals] = useState<string[]>([]);
  const [partial, setPartial] = useState('');
  const [announce, setAnnounce] = useState(() => readChoice(ANNOUNCE_KEY, ['on'] as const) === 'on');

  useEffect(() => client.subscribe(event => {
    if (event.type !== 'caption.appended') return;
    if (event.caption.isFinal) {
      setFinals(lines => [...lines, event.caption.text].slice(-KEEP_FINAL_LINES));
      setPartial('');
    } else {
      setPartial(event.caption.text);
    }
  }), [client]);

  function toggleAnnounce(): void {
    setAnnounce(!announce);
    writeChoice(ANNOUNCE_KEY, announce ? null : 'on');
  }

  const empty = finals.length === 0 && !partial;
  return (
    <section className="captions-view" aria-labelledby="captions-view-title">
      <div className="captions-head">
        <h3 id="captions-view-title">Instructor's words</h3>
        <span className="caption-tag">Live captions · not reviewed text</span>
      </div>
      <div className="caption-lines" role="log" aria-live={announce ? 'polite' : 'off'}>
        {empty ? <p className="supporting-text">Captions appear here when your instructor turns them on.</p> : null}
        {finals.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
        {partial ? <p className="caption-partial">{partial}</p> : null}
      </div>
      <p className="caption-option">
        <input id="announce-captions" type="checkbox" checked={announce} onChange={toggleAnnounce} />
        <label htmlFor="announce-captions">Read new captions to my screen reader</label>
      </p>
    </section>
  );
}
