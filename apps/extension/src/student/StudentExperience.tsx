import React, { Suspense, useEffect, useState } from 'react';
import type { AccessPack, LiveEvent, SessionClient } from '../shared/contracts';
import type { StudentPreferences } from '../shared/preferences';
import { FocusView } from '../renderers/FocusView';
import { StructuredTextView } from '../renderers/StructuredTextView';
import { AudioView } from '../renderers/AudioView';
import { DyslexicTextView } from '../renderers/DyslexicTextView';
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

const allModes: Array<{ id: StudentPreferences['mode']; label: string }> = [
  { id: 'focus', label: 'Focus' },
  { id: 'structured-text', label: 'Read' },
  { id: 'audio', label: 'Hear' },
  { id: 'dyslexic', label: 'Dyslexic' },
  { id: 'ar', label: 'AR' },
];

/** AR is offered only when the pack actually carries a scene to render. */
function modesFor(pack: AccessPack): typeof allModes {
  const hasArScene = pack.assets.some((asset) => asset.arScene !== undefined);
  return hasArScene ? allModes : allModes.filter((mode) => mode.id !== 'ar');
}

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

  const modes = modesFor(pack);
  // A saved preference can name a mode this pack does not offer.
  const activeMode = modes.some((mode) => mode.id === preferences.mode) ? preferences.mode : 'focus';
  const panelId = `student-panel-${activeMode}`;

  return (
    <section
      className="student-experience"
      aria-labelledby="student-title"
      style={{ fontSize: `${preferences.textScale}rem` }}
    >
      <div className="student-heading">
        <div>
          <p className="eyebrow">Student extension</p>
          <h2 id="student-title">Live lesson</h2>
        </div>
        <span className={`connection-pill ${live.status}`}>{live.status}</span>
      </div>

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
            aria-selected={activeMode === mode.id}
            aria-controls={panelId}
            tabIndex={activeMode === mode.id ? 0 : -1}
            onClick={() => updatePreferences({ mode: mode.id })}
            onKeyDown={(keyEvent) => moveMode(index, keyEvent.key)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`mode-tab-${activeMode}`} tabIndex={0}>
        {activeMode === 'focus' ? <FocusView pack={pack} assetId={live.assetId} regionId={live.regionId} /> : null}
        {activeMode === 'structured-text' ? <StructuredTextView pack={pack} assetId={live.assetId} regionId={live.regionId} /> : null}
        {activeMode === 'audio' ? <AudioView pack={pack} assetId={live.assetId} regionId={live.regionId} /> : null}
        {activeMode === 'dyslexic' ? <DyslexicTextView pack={pack} assetId={live.assetId} regionId={live.regionId} /> : null}
        {activeMode === 'ar' ? (
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
