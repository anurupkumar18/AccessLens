import React, { useEffect, useState } from 'react';
import type { AccessPack, SessionClient } from '../shared/contracts';
import type { CaptureHost, Scheduler } from '../sources/screen';
import type { ScreenAnalyzer } from '../sources/screen/screenAnalyzer';
import type { SlidesSource } from '../sources/slides';
import { createIvsPublisher, type StreamPublisher } from '../sources/stream';
import { defaultAiClient, type AiClient } from '../shared/aiClient';
import type { MicrophoneHost } from '../sources/audio/microphone';
import { createCaptureController, STREAM_UNAVAILABLE_MESSAGE, type CaptureController, type Clock, type ControllerSnapshot, type IdGenerator } from './captureController';
import { LiveCaptions, type CaptionDeps } from './SpeechCaptions';
import { createLiveCaptions, type LiveCaptionsState, type Transcriber } from './liveCaptions';

interface Props {
  client: SessionClient;
  pack: AccessPack;
  host: CaptureHost;
  scheduler?: Scheduler;
  clock?: Clock;
  ids?: IdGenerator;
  analyzer?: ScreenAnalyzer;
  /** AI gateway client; defaults to the one configured by VITE_ACCESSLENS_AI_URL. */
  ai?: AiClient | null;
  captionDeps?: CaptionDeps;
  microphone?: MicrophoneHost;
  transcribe?: Transcriber;
  /** Offered as "Follow Google Slides" when this build can watch tabs. */
  slides?: SlidesSource;
  /** Publishes live video of the shared tab or window; defaults to Amazon IVS Real-Time. */
  publisher?: StreamPublisher;
  /** When supplied, capture must be started from this persistent full-tab view. */
  fullTabUrl?: string;
}

// Constructing the publisher loads nothing and connects to nothing; video
// starts only from the Stream button below (charter A1).
const defaultPublisher = createIvsPublisher();

type Tone = 'idle' | 'live' | 'ok' | 'warn';

interface Banner { glyph: string; label: string; tone: Tone; sentence: string }

const SURFACE_NAMES = { browser: 'a tab', window: 'a window', monitor: 'your screen', slides: 'Google Slides' } as const;

/** One banner per state: glyph and label carry the meaning, colour only reinforces it. */
function banner(state: ControllerSnapshot, pack: AccessPack): Banner {
  // Windows and whole screens carry toolbars and other windows around the
  // slide, so when nothing matches there, say what usually fixes it.
  const unmatchedHint = state.surface === 'window' || state.surface === 'monitor'
    ? ' Make the slide bigger and keep other windows off it, or share the tab or a full-screen slideshow.'
    : '';
  const where = state.current.kind === 'matched'
    ? ` Current slide: ${state.current.title}. Region: ${state.current.regionId ?? 'none'}.`
    : state.current.kind === 'unmatched'
      ? ` Unmatched: the shared screen is not a reviewed slide. Students see nothing new until you pick the slide below.${unmatchedHint}`
      : state.surface === 'window' || state.surface === 'monitor'
        ? ' Looking for a reviewed slide anywhere in what you shared.'
        : ' Looking for a reviewed slide.';
  const sharing = state.surface === 'slides' ? 'Following Google Slides.' : state.surface ? `Sharing ${SURFACE_NAMES[state.surface]}.` : 'Sharing.';
  if (state.phase === 'sharing' && state.surface === 'slides') {
    const synced = state.current.kind === 'matched';
    return {
      glyph: synced ? '●' : '◉', label: synced ? 'Following Slides · Synced' : 'Following Slides', tone: synced ? 'ok' : 'live',
      sentence: state.message ?? `${sharing}${synced ? where : ' Waiting for you to present.'}`,
    };
  }
  switch (state.phase) {
    case 'idle':
      return {
        glyph: '○', label: 'Not sharing', tone: state.message ? 'warn' : 'idle',
        sentence: state.message ?? `Not sharing. ${pack.title} is loaded. Click Follow Google Slides, or Start to share a window.`,
      };
    case 'starting':
      return { glyph: '◔', label: 'Waiting for you', tone: 'live', sentence: state.message ?? 'Waiting for the browser dialog.' };
    case 'sharing':
      return {
        glyph: state.current.kind === 'unmatched' ? '⚠' : state.current.kind === 'matched' ? '●' : '◉',
        label: state.current.kind === 'unmatched' ? 'Sharing · Unmatched' : state.current.kind === 'matched' ? 'Sharing · Synced' : 'Sharing',
        tone: state.current.kind === 'unmatched' ? 'warn' : state.current.kind === 'matched' ? 'ok' : 'live',
        sentence: `${sharing}${where}`,
      };
    case 'paused':
      return { glyph: '❙❙', label: 'Paused', tone: 'warn', sentence: `Paused. Students see the last shared moment.${where}` };
    case 'closed':
      return { glyph: '■', label: 'Session ended', tone: 'idle', sentence: state.message ?? 'Session ended.' };
  }
}

function stepIndex(state: ControllerSnapshot): number {
  if (state.phase === 'closed') return 4;
  if (state.phase === 'sharing' || state.phase === 'paused') return state.current.kind === 'fresh' ? 2 : 3;
  return 1;
}

/**
 * Side-panel UI for the instructor. Every action goes through the controller;
 * the panel holds identifiers and strings only. Start is the only path that
 * reaches CaptureHost.requestStream() (charter A1).
 */
export function InstructorPanel({ client, pack, host, scheduler, clock, ids, analyzer, ai = defaultAiClient, captionDeps, microphone, transcribe, slides, publisher = defaultPublisher, fullTabUrl }: Props): React.ReactElement {
  const [controller] = useState(() => createCaptureController({ client, pack, host, scheduler, clock, ids, analyzer, slides, publisher }));
  const [state, setState] = useState<ControllerSnapshot>(() => controller.getState());
  const [captionText, setCaptionText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    return () => {
      unsubscribe();
      // Unmounting (switching role or pack away from this panel) must not
      // silently drop an open session: a student would keep showing the last
      // live moment with no signal that the instructor left. End it properly
      // so students see an explicit, honest "session ended" rather than a
      // connection that quietly stops updating.
      const current = controller.getState();
      if (current.phase !== 'closed' && current.sessionId !== null) controller.endSession();
      controller.dispose();
    };
  }, [controller]);

  const active = state.phase === 'sharing' || state.phase === 'paused';
  const current = state.current;
  const currentAsset = current.kind === 'matched' ? pack.assets.find((asset) => asset.assetId === current.assetId) : undefined;
  const b = banner(state, pack);
  const step = stepIndex(state);

  function guarded(action: () => void): void {
    try {
      setFormError(null);
      action();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  function submitCaption(event: React.FormEvent): void {
    event.preventDefault();
    if (!captionText.trim()) { setFormError('Type a caption first.'); return; }
    guarded(() => { controller.sendCaption(captionText); setCaptionText(''); });
  }

  const steps = [
    slides ? 'Click Follow Google Slides. Present your deck whenever you like; the session finds it.' : 'Click Start and pick the tab, window, or screen showing your slides.',
    'Read the join code to students. They enter it in their AccessLens.',
    'Present. Reviewed slides are recognised on this device and synced to students, who read and listen at their own pace.',
  ];

  return (
    <section className="instructor" aria-labelledby="instructor-heading">
      <div className="section-rule">
        <p className="eyebrow"><span aria-hidden="true">/ </span>Instructor console</p>
        <span className="rule-mark" aria-hidden="true" />
      </div>
      <h2 id="instructor-heading">Instructor</h2>
      <p className="muted">Pack: <mark>{pack.title}</mark> · v{pack.version}</p>
      {analyzer ? <p className="supporting-text" role="status">AI screen analysis is enabled. Shared frames are sent transiently to the configured AWS analyzer; they are not stored.</p> : <p className="supporting-text" role="note">AI screen analysis is not configured. The offline reviewed-pack demo matcher is being used.</p>}
      <div className="panel-grid">
      <div className="console">
      <div className="status" data-tone={b.tone}>
        <span className="glyph" aria-hidden="true">{b.glyph}</span>
        <span className="label">{b.label}</span>
        <p role="status" aria-live="polite">{b.sentence}</p>
      </div>

      {state.sessionId && (
        <div className="join">
          <p className="hint">Join code for students</p>
          <code aria-label={`Join code ${state.sessionId.split('').join(' ')}`}>{state.sessionId}</code>
        </div>
      )}

      <div role="group" aria-label="Capture controls">
        {state.phase === 'idle' && slides && <button type="button" className="primary" onClick={() => { void controller.followSlides(); }}>Follow Google Slides</button>}
        {state.phase === 'idle' && fullTabUrl
          ? <a className={slides ? 'full-tab-link' : 'button primary'} href={fullTabUrl} target="_blank" rel="noopener">Open in a full tab to share</a>
          : state.phase === 'idle' && <button type="button" className={slides ? undefined : 'primary'} onClick={() => { void controller.start(); }}>{slides ? 'Share a window instead' : 'Start'}</button>}
        {state.phase === 'sharing' && <button type="button" onClick={() => guarded(() => controller.pause())}>Pause</button>}
        {state.phase === 'paused' && <button type="button" className="primary" onClick={() => guarded(() => controller.resume())}>Resume</button>}
        {active && <button type="button" className="stop" onClick={() => guarded(() => controller.stop())}>Stop</button>}
        {(active || (state.phase === 'idle' && state.sessionId)) && (
          <button type="button" className="quiet" onClick={() => guarded(() => controller.endSession())}>End Session</button>
        )}
      </div>
      {state.phase === 'idle' && fullTabUrl && (
        <p className="caption-option muted" role="note">
          This side panel closes when Chrome switches to the tab you share. Open the instructor in a full tab first so sharing stays active.
        </p>
      )}

      {state.sessionId && state.phase !== 'closed' && (state.surface === 'slides' || state.surface === 'browser' ? (
        // Neither sees the mouse: Slides following reads only the tab's URL, and
        // a tab capture never includes the pointer. Say so instead of offering a
        // checkbox that cannot do anything.
        <p className="caption-option muted" role="note">
          {state.surface === 'slides'
            ? 'Following Google Slides moves students between slides only: it never sees your screen, so it cannot see your mouse. To point students at parts of a slide, click Stop, then Share a window instead and pick the window showing your slides.'
            : 'A tab share has no mouse pointer, so students follow slide changes only. To point students at parts of a slide, click Stop, then Start and pick a window or your entire screen.'}
        </p>
      ) : (
        <p className="caption-option">
          <input id="follow-pointer" type="checkbox" checked={state.followPointer} onChange={() => controller.setFollowPointer(!state.followPointer)} />
          <label htmlFor="follow-pointer">
            Move students to the part of the slide under my mouse
            <span className="muted"> (sharing a window or your entire screen; a tab share has no mouse pointer)</span>
          </label>
        </p>
      ))}

      {active && (
        <div className="stream" role="group" aria-label="Live video for students">
          {state.stream.status === 'on' ? (
            <>
              <p className="stream-label" data-tone="live">
                <span className="glyph" aria-hidden="true">▶</span>
                Streaming {state.stream.surface === 'browser' ? 'a tab' : 'a window'}
              </p>
              <button type="button" className="stop" onClick={() => guarded(() => controller.stopStreaming())}>Stop streaming</button>
            </>
          ) : (
            <button
              type="button"
              disabled={state.stream.status === 'starting' || state.stream.status === 'unavailable'}
              onClick={() => { void controller.startStreaming(); }}
            >
              {state.stream.status === 'starting' ? 'Opening the browser dialog…' : 'Stream this window'}
            </button>
          )}
          <p role="status" className="stream-note">
            {state.stream.status === 'unavailable'
              ? STREAM_UNAVAILABLE_MESSAGE
              : state.stream.status === 'off' && state.stream.message
                ? state.stream.message
                : state.stream.status === 'on'
                  ? 'Students see live video of this surface next to their text and audio. Only this tab or window is streamed, never your whole screen.'
                  : 'Optional: stream live video of the shared tab or window to students. Your whole screen is never streamed.'}
          </p>
        </div>
      )}

      <LiveCaptions controller={controller} state={state} pack={pack} ai={ai} deps={captionDeps} />

      {active && <LiveCaptionsControl controller={controller} microphone={microphone} transcribe={transcribe} />}

      </div>
      <div className="guide">
      <h3>How this works</h3>
      <ol className="steps" aria-label="Session steps">
        {steps.map((text, i) => {
          const n = i + 1;
          return (
            <li key={n} aria-current={step === n ? 'step' : undefined} data-done={step > n}>
              <span className="n" aria-hidden="true"><span>{n}</span></span>
              <span>{text}</span>
            </li>
          );
        })}
      </ol>

      {active && currentAsset?.arScene && (
        <div className="ar-launch-control">
          <h3>Make this slide interactive</h3>
          <p className="supporting-text">
            Find the first reviewed AR concept for this slide and focus it for students.
          </p>
          <button type="button" onClick={() => guarded(() => controller.findAr())}>
            Find AR for this slide
          </button>
        </div>
      )}

      {active && currentAsset && (
        <form onSubmit={submitCaption}>
          <h3>Add a live caption</h3>
          <p>
            <label htmlFor="caption-text">Caption for {currentAsset.title} (280 characters max)</label>
            <input
              id="caption-text"
              type="text"
              maxLength={280}
              value={captionText}
              onChange={e => setCaptionText(e.target.value)}
              placeholder="Short instructor-authored line, not a transcript"
            />
          </p>
          <button type="submit">Send caption</button>
        </form>
      )}

      {formError && <p role="alert">{formError}</p>}
      </div>
      </div>
    </section>
  );
}

const CAPTION_LANGUAGES: [string, string][] = [
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

/**
 * Live captions for the open session. Mounted only while sharing or paused,
 * so unmounting (Stop, End Session) is what turns the microphone off.
 */
function LiveCaptionsControl({ controller, microphone, transcribe }: {
  controller: CaptureController;
  microphone?: MicrophoneHost;
  transcribe?: Transcriber;
}): React.ReactElement {
  const [lang, setLang] = useState('en-US');
  const langRef = React.useRef(lang);
  langRef.current = lang;
  const [captions] = useState(() => createLiveCaptions({
    publish: caption => controller.appendCaption(caption),
    sessionId: () => controller.getState().sessionId,
    lang: () => langRef.current,
    microphone,
    transcribe,
  }));
  const [state, setState] = useState<LiveCaptionsState>(() => captions.getState());

  useEffect(() => {
    const unsubscribe = captions.subscribe(setState);
    return () => { unsubscribe(); captions.stop(); };
  }, [captions]);

  const on = state.phase === 'listening' || state.phase === 'starting';
  const status = state.phase === 'listening'
    ? '● Captioning: students see what you say.'
    : state.phase === 'starting' ? '◔ Waiting for microphone permission.' : '○ Live captions are off.';

  return (
    <div className="live-captions" aria-labelledby="live-captions-heading">
      <h3 id="live-captions-heading">Live captions</h3>
      <p>
        <label htmlFor="live-captions-lang">Language you are speaking</label>
        <select id="live-captions-lang" value={lang} onChange={e => setLang(e.target.value)}>
          {CAPTION_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </p>
      <p role="status" aria-live="polite">{status}</p>
      {on
        ? <button type="button" className="stop" onClick={() => captions.stop()}>Stop live captions</button>
        : <button type="button" className="primary" onClick={() => { void captions.start(); }}>Start live captions</button>}
      {state.backlog >= 3 && <p className="a11y-notice">Captions are {state.backlog} sentences behind. Pausing briefly lets them catch up.</p>}
      {state.message && <p role={state.phase === 'error' ? 'alert' : undefined} className="a11y-notice">{state.message}</p>}
      {state.lastCaption && (
        <p className="supporting-text">Last caption sent: <q>{state.lastCaption}</q></p>
      )}
      <p className="supporting-text">Your microphone audio goes to AWS Transcribe only to make captions; it is not recorded or stored. Captions are automatic and can be wrong.</p>
    </div>
  );
}
