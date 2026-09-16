import React, { useEffect, useState } from 'react';
import type { AccessPack, SessionClient } from '../shared/contracts';
import type { CaptureHost, Scheduler } from '../sources/screen';
import { createCaptureController, type Clock, type ControllerSnapshot, type IdGenerator } from './captureController';

interface Props {
  client: SessionClient;
  pack: AccessPack;
  host: CaptureHost;
  scheduler?: Scheduler;
  clock?: Clock;
  ids?: IdGenerator;
}

type Tone = 'idle' | 'live' | 'ok' | 'warn';

interface Banner { glyph: string; label: string; tone: Tone; sentence: string }

/** One banner per state: glyph and label carry the meaning, colour only reinforces it. */
function banner(state: ControllerSnapshot, pack: AccessPack): Banner {
  const where = state.current.kind === 'matched'
    ? ` Current slide: ${state.current.title}. Region: ${state.current.regionId ?? 'none'}.`
    : state.current.kind === 'unmatched'
      ? ' Unmatched: the shared screen is not a reviewed slide. Students see nothing new until you pick the slide below.'
      : ' Looking for a reviewed slide.';
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
        sentence: `Sharing.${where}`,
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
export function InstructorPanel({ client, pack, host, scheduler, clock, ids }: Props): React.ReactElement {
  const [controller] = useState(() => createCaptureController({ client, pack, host, scheduler, clock, ids }));
  const [state, setState] = useState<ControllerSnapshot>(() => controller.getState());
  const [correctAsset, setCorrectAsset] = useState(pack.assets[0].assetId);
  const [correctRegion, setCorrectRegion] = useState('');
  const [indicateRegion, setIndicateRegion] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    return () => { unsubscribe(); controller.dispose(); };
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

  const steps = [
    'Click Start and pick the window or tab showing your slides.',
    'Read the join code to students. They enter it in their AccessLens.',
    'Present. Reviewed slides are recognised on this device and synced; fix a wrong match below.',
  ];

  return (
    <section aria-labelledby="instructor-heading">
      <h2 id="instructor-heading">Instructor</h2>
      <p className="muted">Pack: {pack.title} · v{pack.version}</p>
      <div className="panel-grid">
      <div>
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

      </div>
      <div>
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

      {formError && <p role="alert">{formError}</p>}
      </div>
      </div>
    </section>
  );
}
