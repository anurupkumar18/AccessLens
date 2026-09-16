import React, { useEffect, useState } from 'react';
import type { AccessPack, SessionClient } from '../shared/contracts';
import type { CaptureHost, Scheduler } from '../sources/screen';
import { defaultAiClient, type AiClient } from '../shared/aiClient';
import { createCaptureController, type Clock, type ControllerSnapshot, type IdGenerator } from './captureController';
import { LiveCaptions, type CaptionDeps } from './LiveCaptions';

interface Props {
  client: SessionClient;
  pack: AccessPack;
  host: CaptureHost;
  scheduler?: Scheduler;
  clock?: Clock;
  ids?: IdGenerator;
  /** AI gateway client; defaults to the one configured by VITE_ACCESSLENS_AI_URL. */
  ai?: AiClient | null;
  captionDeps?: CaptionDeps;
}

type Tone = 'idle' | 'live' | 'ok' | 'warn';

interface Banner { glyph: string; label: string; tone: Tone; sentence: string }

const SURFACE_NAMES = { browser: 'a tab', window: 'a window', monitor: 'your screen' } as const;

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
  const sharing = state.surface ? `Sharing ${SURFACE_NAMES[state.surface]}.` : 'Sharing.';
  switch (state.phase) {
    case 'idle':
      return {
        glyph: '○', label: 'Not sharing', tone: state.message ? 'warn' : 'idle',
        sentence: state.message ?? `Not sharing. ${pack.title} is loaded. Click Start to share the window with your slides.`,
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
export function InstructorPanel({ client, pack, host, scheduler, clock, ids, ai = defaultAiClient, captionDeps }: Props): React.ReactElement {
  const [controller] = useState(() => createCaptureController({ client, pack, host, scheduler, clock, ids }));
  const [state, setState] = useState<ControllerSnapshot>(() => controller.getState());
  const [correctAsset, setCorrectAsset] = useState(pack.assets[0].assetId);
  const [correctRegion, setCorrectRegion] = useState('');
  const [indicateRegion, setIndicateRegion] = useState('');
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
  const currentAssetId = state.current.kind === 'matched' ? state.current.assetId : null;
  const currentAsset = currentAssetId ? pack.assets.find(a => a.assetId === currentAssetId) : undefined;
  const correctionAsset = pack.assets.find(a => a.assetId === correctAsset) ?? pack.assets[0];
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

  function submitCorrection(event: React.FormEvent): void {
    event.preventDefault();
    guarded(() => controller.correct({ assetId: correctionAsset.assetId, regionId: correctRegion || undefined }));
  }

  function submitIndication(event: React.FormEvent): void {
    event.preventDefault();
    if (!indicateRegion) { setFormError('Choose a region first.'); return; }
    guarded(() => controller.indicateRegion(indicateRegion));
  }

  function submitCaption(event: React.FormEvent): void {
    event.preventDefault();
    if (!captionText.trim()) { setFormError('Type a caption first.'); return; }
    guarded(() => { controller.sendCaption(captionText); setCaptionText(''); });
  }

  const steps = [
    'Click Start and pick the tab, window, or screen showing your slides.',
    'Read the join code to students. They enter it in their AccessLens.',
    'Present. Reviewed slides are recognised on this device and synced; fix a wrong match below.',
  ];

  return (
    <section className="instructor" aria-labelledby="instructor-heading">
      <div className="section-rule">
        <p className="eyebrow"><span aria-hidden="true">/ </span>Instructor console</p>
        <span className="rule-mark" aria-hidden="true" />
      </div>
      <h2 id="instructor-heading">Instructor</h2>
      <p className="muted">Pack: <mark>{pack.title}</mark> · v{pack.version}</p>
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
        {state.phase === 'idle' && <button type="button" className="primary" onClick={() => { void controller.start(); }}>Start</button>}
        {state.phase === 'sharing' && <button type="button" onClick={() => guarded(() => controller.pause())}>Pause</button>}
        {state.phase === 'paused' && <button type="button" className="primary" onClick={() => guarded(() => controller.resume())}>Resume</button>}
        {active && <button type="button" className="stop" onClick={() => guarded(() => controller.stop())}>Stop</button>}
        {(active || (state.phase === 'idle' && state.sessionId)) && (
          <button type="button" className="quiet" onClick={() => guarded(() => controller.endSession())}>End Session</button>
        )}
      </div>

      <LiveCaptions controller={controller} state={state} pack={pack} ai={ai} deps={captionDeps} />

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

      {active && (
        <form onSubmit={submitCorrection}>
          <h3>Fix a wrong match</h3>
          <p>
            <label htmlFor="correct-asset">Reviewed slide</label>
            <select id="correct-asset" value={correctionAsset.assetId} onChange={e => { setCorrectAsset(e.target.value); setCorrectRegion(''); }}>
              {pack.assets.map(a => <option key={a.assetId} value={a.assetId}>{a.title}</option>)}
            </select>
          </p>
          <p>
            <label htmlFor="correct-region">Region (optional)</label>
            <select id="correct-region" value={correctRegion} onChange={e => setCorrectRegion(e.target.value)}>
              <option value="">No region</option>
              {correctionAsset.regions.map(r => <option key={r.regionId} value={r.regionId}>{r.regionId}</option>)}
            </select>
          </p>
          <button type="submit">Apply correction</button>
        </form>
      )}

      {active && currentAsset && (
        <form onSubmit={submitIndication}>
          <h3>Point students at a region</h3>
          <p>
            <label htmlFor="indicate-region">Region of {currentAsset.title}</label>
            <select id="indicate-region" value={indicateRegion} onChange={e => setIndicateRegion(e.target.value)}>
              <option value="">Choose a region</option>
              {currentAsset.regions.map(r => <option key={r.regionId} value={r.regionId}>{r.regionId}</option>)}
            </select>
          </p>
          <button type="submit">Indicate region</button>
        </form>
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
