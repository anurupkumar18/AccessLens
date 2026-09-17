import React, { Suspense, useEffect, useRef, useState } from 'react';
import type { AccessPack, LiveEvent, RoleCapability, SessionClient } from '../shared/contracts';
import { defaultAiClient, type AiClient } from '../shared/aiClient';
import { AskClass } from './AskClass';
import { StudyChat } from './StudyChat';
import { defaultChatClient, type ChatClient } from '../shared/chatClient';
import { LiveCaptionsView } from './LiveCaptionsView';
import { ScreenReaderAnnouncer } from './ScreenReaderAnnouncer';
import type { StudentPreferences } from '../shared/preferences';
import { FocusView } from '../renderers/FocusView';
import { StructuredTextView } from '../renderers/StructuredTextView';
import { DyslexicTextView } from '../renderers/DyslexicTextView';
import { ScreenAnalysisView } from '../renderers/ScreenAnalysisView';
import { applyLiveEvent, initialStudentLiveState, markLiveStateProtocolInvalid, markLiveStateStale, markLiveStateReconnected } from './liveState';
import { AccessibilityBar } from '../accessibility/AccessibilityBar';
import { createIvsSubscriber, type StreamSubscriber } from '../sources/stream';

// Constructing the subscriber loads nothing and connects to nothing; it joins
// the session's video stage only once the instructor announces a stream.
const defaultSubscriber = createIvsSubscriber();

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
  /** AI gateway client; defaults to the one configured by VITE_ACCESSLENS_AI_URL. */
  ai?: AiClient | null;
  /** Study chat client; defaults to the one configured by VITE_ACCESSLENS_CHAT_URL. */
  chat?: ChatClient | null;
  /** Watches the instructor's live video; defaults to Amazon IVS Real-Time. */
  subscriber?: StreamSubscriber;
}

const allModes: Array<{ id: StudentPreferences['mode']; label: string }> = [
  { id: 'focus', label: 'Focus' },
  { id: 'structured-text', label: 'Read' },
  { id: 'dyslexic', label: 'Reading spacing' },
  { id: 'ar', label: 'AR' },
];

/** AR is offered only when the pack actually carries a scene to render. */
function modesFor(pack: AccessPack): typeof allModes {
  const hasArScene = pack.assets.some((asset) => asset.arScene !== undefined);
  return hasArScene ? allModes : allModes.filter((mode) => mode.id !== 'ar');
}

export function StudentExperience({ client, event, pack, preferences, onPreferencesChange, ai = defaultAiClient, chat = defaultChatClient, subscriber = defaultSubscriber }: Props): React.ReactElement {
  const [sessionId, setSessionId] = useState('');
  const [joinMessage, setJoinMessage] = useState('Type the join code your instructor reads out, then press Join.');
  const [live, setLive] = useState(initialStudentLiveState);
  const [capability, setCapability] = useState<RoleCapability | null>(null);
  // Read and Dyslexic show the whole lesson for the student to move through
  // in any order; only Focus (and AR) follow the instructor's position. There
  // is no spoken mode: the student's own screen reader reads the reviewed
  // descriptions from the text modes.

  // Kept so a student can be caught up from where they actually stopped
  // following, rather than from an arbitrary "last five minutes".
  const [history, setHistory] = useState<LiveEvent[]>([]);
  const [lastSeenSequence, setLastSeenSequence] = useState(0);

  // A different pack is a different lesson: the shell swaps the pack in when
  // the session names one this build did not hold (fetched from the published
  // distribution), and the event already seen must then be judged against
  // the new pack rather than stay refused for the old one.
  useEffect(() => { setLive(initialStudentLiveState); }, [pack.packId, pack.version]);
  useEffect(() => {
    if (!event) return;
    setLive((current) => applyLiveEvent(current, event, pack));
    // Bounded: a long lecture should not grow this without limit, and a recap
    // only ever needs the recent past.
    setHistory((current) => [...current, event].slice(-200));
  }, [event, pack]);

  useEffect(() => {
    // "Seen" means the tab was visible when the event arrived. Coming back to
    // a backgrounded tab is exactly the moment "what did I miss" is for.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const sequence = (event as { sequence?: number } | null)?.sequence;
    if (typeof sequence === 'number') setLastSeenSequence(sequence);
  }, [event]);

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

  useEffect(() => {
    // The network wrapper emits this only after rejecting a payload against the
    // shared schema. Do not surface the raw event: the safe action is to freeze
    // the last reviewed state and say that the next update was not trustworthy.
    const protocolAware = client as { onInvalidEvent?: (listener: () => void) => () => void };
    if (!protocolAware.onInvalidEvent) return;
    return protocolAware.onInvalidEvent(() => {
      setLive(markLiveStateProtocolInvalid);
    });
  }, [client]);

  const currentAsset = pack.assets.find((asset) => asset.assetId === live.assetId);
  const currentRegion = currentAsset?.regions.find((region) => region.regionId === live.regionId);
  const currentRegionText = currentRegion?.shortDescription ?? '';
  const captionsActive = history.some((item) => item.type === 'caption.appended');

  // Live video of the instructor's tab or window. It lives beside the modes,
  // not in `live.status`: subscribing, failing or stopping never changes what
  // the text modes show. The pane exists while the instructor's
  // `stream.started` is in force and this connection holds a stage token.
  const streaming = live.stream !== undefined;
  const streamSurface = live.stream?.surface;
  const streamToken = capability?.streamToken;
  const [video, setVideo] = useState<MediaStream | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!streaming || !streamToken) return;
    setVideo(null);
    setVideoError(null);
    void subscriber.subscribe(streamToken, { onVideo: setVideo, onError: setVideoError });
    return () => { subscriber.stop(); setVideo(null); };
  }, [streaming, streamToken, subscriber]);
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    // `autoPlay` on the element does the playing; muted inline video needs no gesture.
    element.srcObject = video;
  }, [video]);

  async function join(): Promise<void> {
    try {
      setCapability(await client.join(sessionId.trim()));
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
      className={`student-experience font-${preferences.fontFamily} spacing-${preferences.lineSpacing} width-${preferences.contentWidth}${preferences.highContrast ? ' high-contrast' : ''}`}
      aria-labelledby="student-title"
      style={{ fontSize: `${preferences.textScale}rem` }}
    >
      <a className="skip-link" href={`#${panelId}`}>Skip to the lesson</a>
      <ScreenReaderAnnouncer pack={pack} assetId={live.assetId} regionId={live.regionId} enabled={preferences.announceChanges} />
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
      {/* The one live region that follows the instructor. aria-atomic so the
          whole sentence is read, not the words that changed. */}
      <p role="status" aria-atomic="true" className="live-message">{live.message}</p>

      {preferences.captionsEnabled && live.captions.length > 0 ? (
        <div className="caption-track" role="log" aria-label="Live captions">
          <p className="eyebrow">Instructor captions</p>
          {live.captions.map((caption, index) => (
            <p key={index} className={caption.isFinal ? 'caption-line' : 'caption-line pending'}>{caption.text}</p>
          ))}
          <p className="supporting-text">Captions are instructor speech, not a reviewed description.</p>
        </div>
      ) : null}
      {/* Independently built on integ/ui-api (docs/INTEGRATION_SWOT_20260916.md
          §5 Weaknesses): a second, always-on caption view with its own
          screen-reader-announce toggle. Left wired in alongside the toggleable
          track above rather than unilaterally deciding which one wins. */}
      <LiveCaptionsView client={client} />

      {streaming && (
        <section className="live-video" aria-label="Instructor's live slide video">
          {streamToken ? (
            <>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                aria-label={`Live video of the instructor's ${streamSurface === 'browser' ? 'tab' : 'window'}`}
              />
              <p role="status" className="supporting-text">
                {videoError ?? (video ? `Live video of the instructor's ${streamSurface === 'browser' ? 'tab' : 'window'}. The text below follows the lesson too.` : 'Connecting to the instructor\u2019s live video\u2026')}
              </p>
            </>
          ) : (
            <p role="status" className="supporting-text">The instructor is streaming live video, but this connection has no video access. The lesson text still works.</p>
          )}
        </section>
      )}

      <p id="mode-help" className="supporting-text">
        Screen readers read every description here. Focus announces the slide and region the instructor is on; Read and Reading spacing hold the whole lesson.
      </p>
      <div className="mode-tabs" role="tablist" aria-label="Choose how to experience this lesson" aria-describedby="mode-help">
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

      <div className="student-content" id={panelId} role="tabpanel" aria-labelledby={`mode-tab-${activeMode}`} tabIndex={0}>
        {live.analysis && activeMode !== 'ar' ? <ScreenAnalysisView analysis={live.analysis} mode={activeMode === 'structured-text' ? 'read' : activeMode} /> : null}
        {!live.analysis && activeMode === 'focus' ? <FocusView pack={pack} assetId={live.assetId} regionId={live.regionId} pointer={live.pointer} /> : null}
        {!live.analysis && activeMode === 'structured-text' ? <StructuredTextView pack={pack} /> : null}
        {!live.analysis && activeMode === 'dyslexic' ? <DyslexicTextView pack={pack} /> : null}
        {activeMode === 'ar' ? (
          <Suspense fallback={<p role="status">Loading the AR scene…</p>}>
            <CellArView regionId={live.regionId} hotspotId={live.hotspotId} reducedMotion={preferences.reducedMotion} />
          </Suspense>
        ) : null}
      </div>

      {chat
        ? <StudyChat pack={pack} capability={capability} client={chat} assetId={live.assetId} regionId={live.regionId} />
        : <AskClass pack={pack} capability={capability} ai={ai} />}

      <fieldset className="display-settings">
        <legend>Screen reader</legend>
        <label htmlFor="announce-changes-toggle">
          <input
            id="announce-changes-toggle"
            type="checkbox"
            checked={preferences.announceChanges}
            onChange={() => updatePreferences({ announceChanges: !preferences.announceChanges })}
          />
          Announce slide changes to my screen reader
        </label>
        <p className="supporting-text">Works with VoiceOver, NVDA, JAWS, Narrator, and ChromeVox. These settings stay on this device.</p>
      </fieldset>

      <AccessibilityBar
        events={history}
        event={event}
        pack={pack}
        currentText={currentRegionText}
        lastSeenSequence={lastSeenSequence}
        captionsActive={captionsActive}
        showCaptions={preferences.captionsEnabled}
        reducedMotion={preferences.reducedMotion}
      />

      <fieldset className="display-settings">
        <legend>Display preferences</legend>
        <label htmlFor="font-family">
          Font
          <select id="font-family" value={preferences.fontFamily} onChange={(changeEvent) => updatePreferences({ fontFamily: changeEvent.target.value as StudentPreferences['fontFamily'] })}>
            <option value="system">System sans-serif</option>
            <option value="serif">Serif</option>
            <option value="monospace">Monospace</option>
          </select>
        </label>
        <label htmlFor="reduced-motion-toggle">
          <input
            id="reduced-motion-toggle"
            type="checkbox"
            checked={preferences.reducedMotion}
            onChange={() => updatePreferences({ reducedMotion: !preferences.reducedMotion })}
          />
          Reduce motion
        </label>
        <label htmlFor="captions-toggle">
          <input
            id="captions-toggle"
            type="checkbox"
            checked={preferences.captionsEnabled}
            onChange={() => updatePreferences({ captionsEnabled: !preferences.captionsEnabled })}
          />
          Show instructor captions
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
        <label htmlFor="line-spacing">
          Line spacing
          <select id="line-spacing" value={preferences.lineSpacing} onChange={(changeEvent) => updatePreferences({ lineSpacing: changeEvent.target.value as StudentPreferences['lineSpacing'] })}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
        </label>
        <label htmlFor="content-width">
          Reading width
          <select id="content-width" value={preferences.contentWidth} onChange={(changeEvent) => updatePreferences({ contentWidth: changeEvent.target.value as StudentPreferences['contentWidth'] })}>
            <option value="standard">Standard</option>
            <option value="narrow">Narrow</option>
            <option value="wide">Wide</option>
          </select>
        </label>
        <label htmlFor="high-contrast-toggle">
          <input
            id="high-contrast-toggle"
            type="checkbox"
            checked={preferences.highContrast}
            onChange={() => updatePreferences({ highContrast: !preferences.highContrast })}
          />
          Higher contrast
        </label>
      </fieldset>
    </section>
  );
}
