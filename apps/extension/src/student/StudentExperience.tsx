import React, { Suspense, useEffect, useState } from 'react';
import type { AccessPack, LiveEvent, SessionClient } from '../shared/contracts';
import type { StudentPreferences } from '../shared/preferences';
import { FocusView } from '../renderers/FocusView';
import { StructuredTextView } from '../renderers/StructuredTextView';
import { AudioView } from '../renderers/AudioView';
import { applyLiveEvent, initialStudentLiveState, markLiveStateStale, markLiveStateReconnected } from './liveState';

const CellArView = React.lazy(async () => {
  const module = await import('../ar/CellArView');
  return { default: module.CellArView };
});

interface Props {
  client: SessionClient;
  event: LiveEvent | null;
  pack: AccessPack;
  preferences: StudentPreferences;
  onPreferencesChange(preferences: StudentPreferences): void;
}

const modes: Array<{ id: StudentPreferences['mode']; label: string }> = [
  { id: 'focus', label: 'Focus' },
  { id: 'structured-text', label: 'Read' },
  { id: 'audio', label: 'Hear' },
  { id: 'ar', label: 'AR' },
];

export function StudentExperience({ client, event, pack, preferences, onPreferencesChange }: Props): React.ReactElement {
  const [sessionId, setSessionId] = useState('');
  const [joinMessage, setJoinMessage] = useState('Type the join code your instructor reads out, then press Join.');
  const [live, setLive] = useState(initialStudentLiveState);

  useEffect(() => {
    if (!event) return;
    setLive((current) => applyLiveEvent(current, event, pack));
  }, [event, pack]);

  useEffect(() => {
    // Real socket connectivity, when the transport can report it (Part 4's
    // WebSocketSessionClient; the mock transports never disconnect). A fixed
    // timeout on content silence was tried first and produced false "Connection
    // interrupted" alarms any time an instructor spent more than a few seconds
    // on one region, which is normal lecture pacing, not a dropped connection.
    const connectionAware = client as { onConnectionChange?: (listener: (connected: boolean) => void) => () => void };
    if (!connectionAware.onConnectionChange) return;
    return connectionAware.onConnectionChange((connected) => {
      setLive((current) => (connected ? markLiveStateReconnected(current) : markLiveStateStale(current)));
    });
  }, [client]);

  async function join(): Promise<void> {
    try {
      await client.join(sessionId.trim());
      setJoinMessage(`Joined ${sessionId.trim()}. Waiting for the instructor.`);
    } catch {
      setJoinMessage('Could not join this session. Check the code and try again.');
    }
  }

  function updatePreferences(change: Partial<StudentPreferences>): void {
    onPreferencesChange({ ...preferences, ...change });
  }

  function moveMode(currentIndex: number, key: string): void {
    let nextIndex = currentIndex;
    if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % modes.length;
    else if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + modes.length) % modes.length;
    else if (key === 'Home') nextIndex = 0;
    else if (key === 'End') nextIndex = modes.length - 1;
    else return;
    updatePreferences({ mode: modes[nextIndex].id });
    window.setTimeout(() => document.querySelector<HTMLElement>(`#mode-tab-${modes[nextIndex].id}`)?.focus(), 0);
  }

  const panelId = `student-panel-${preferences.mode}`;

  return (
    <section
      className="student-experience"
      aria-labelledby="student-title"
      style={{ fontSize: `${preferences.textScale}rem` }}
    >
      <div className="section-rule">
        <p className="eyebrow"><span aria-hidden="true">/ </span>Student extension</p>
        <span className={`connection-pill ${live.status}`}>{live.status}</span>
      </div>
      <h2 id="student-title">Live lesson</h2>

      <form className="join-form" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void join(); }}>
        <label htmlFor="session-code">Join code from your instructor</label>
        <div>
          <input
            id="session-code"
            className="join-code"
            value={sessionId}
            onChange={(changeEvent) => setSessionId(changeEvent.target.value.toUpperCase())}
            placeholder="e.g. W85UUK"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
          <button type="submit">Join</button>
        </div>
      </form>
      <p role="status" className="supporting-text">{joinMessage}</p>
      <p role="status" className="live-message">{live.message}</p>

      <div className="mode-tabs" role="tablist" aria-label="Choose how to experience this lesson">
        {modes.map((mode, index) => (
          <button
            key={mode.id}
            id={`mode-tab-${mode.id}`}
            type="button"
            role="tab"
            aria-selected={preferences.mode === mode.id}
            aria-controls={panelId}
            tabIndex={preferences.mode === mode.id ? 0 : -1}
            onClick={() => updatePreferences({ mode: mode.id })}
            onKeyDown={(keyEvent) => moveMode(index, keyEvent.key)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`mode-tab-${preferences.mode}`} tabIndex={0}>
        {preferences.mode === 'focus' ? <FocusView pack={pack} assetId={live.assetId} regionId={live.regionId} /> : null}
        {preferences.mode === 'structured-text' ? <StructuredTextView pack={pack} assetId={live.assetId} regionId={live.regionId} /> : null}
        {preferences.mode === 'audio' ? <AudioView pack={pack} assetId={live.assetId} regionId={live.regionId} /> : null}
        {preferences.mode === 'ar' ? (
          <Suspense fallback={<p role="status">Loading the AR scene…</p>}>
            <CellArView regionId={live.regionId} hotspotId={live.hotspotId} reducedMotion={preferences.reducedMotion} />
          </Suspense>
        ) : null}
      </div>

      <fieldset className="display-settings">
        <legend>Display preferences</legend>
        <label htmlFor="reduced-motion-toggle">
          <input
            id="reduced-motion-toggle"
            type="checkbox"
            checked={preferences.reducedMotion}
            onChange={() => updatePreferences({ reducedMotion: !preferences.reducedMotion })}
          />
          Reduce motion
        </label>
        <label htmlFor="text-scale">
          Text size
          <input
            id="text-scale"
            type="range"
            min="0.75"
            max="2"
            step="0.25"
            value={preferences.textScale}
            aria-valuetext={`${Math.round(preferences.textScale * 100)} percent`}
            onChange={(changeEvent) => updatePreferences({ textScale: Number(changeEvent.target.value) })}
          />
        </label>
      </fieldset>
    </section>
  );
}
