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

function describe(state: ControllerSnapshot, pack: AccessPack): string {
  const where = state.current.kind === 'matched'
    ? ` Current slide: ${state.current.title}. Region: ${state.current.regionId ?? 'none'}.`
    : state.current.kind === 'unmatched'
      ? ' Unmatched: the shared screen is not a reviewed slide. Choose the correct slide below.'
      : ' Looking for a reviewed slide.';
  switch (state.phase) {
    case 'idle':
      return state.message ?? `Not sharing. Pack loaded: ${pack.title}. Click Start to share a tab, window, or screen.`;
    case 'starting':
      return state.message ?? 'Waiting for the browser dialog.';
    case 'sharing':
      return `Sharing.${where}`;
    case 'paused':
      return `Paused. Students see the last shared moment.${where}`;
    case 'closed':
      return state.message ?? 'Session ended.';
  }
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

  return (
    <section aria-labelledby="instructor-heading">
      <h2 id="instructor-heading">Instructor session</h2>
      <p>Pack: {pack.title} (v{pack.version})</p>
      <p role="status" aria-live="polite">{describe(state, pack)}</p>
      {state.sessionId && (
        <p>Join code: <strong>{state.sessionId}</strong></p>
      )}
      <div role="group" aria-label="Capture controls">
        {state.phase === 'idle' && <button type="button" onClick={() => { void controller.start(); }}>Start</button>}
        {state.phase === 'sharing' && <button type="button" onClick={() => guarded(() => controller.pause())}>Pause</button>}
        {state.phase === 'paused' && <button type="button" onClick={() => guarded(() => controller.resume())}>Resume</button>}
        {active && <button type="button" onClick={() => guarded(() => controller.stop())}>Stop</button>}
        {(active || (state.phase === 'idle' && state.sessionId)) && (
          <button type="button" onClick={() => guarded(() => controller.endSession())}>End Session</button>
        )}
      </div>
      {active && (
        <form onSubmit={submitCorrection}>
          <h3>Correct the slide</h3>
          <p>
            <label htmlFor="correct-asset">Reviewed slide</label>{' '}
            <select id="correct-asset" value={correctionAsset.assetId} onChange={e => { setCorrectAsset(e.target.value); setCorrectRegion(''); }}>
              {pack.assets.map(a => <option key={a.assetId} value={a.assetId}>{a.title}</option>)}
            </select>
          </p>
          <p>
            <label htmlFor="correct-region">Region (optional)</label>{' '}
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
          <h3>Indicate a region on the current slide</h3>
          <p>
            <label htmlFor="indicate-region">Region of {currentAsset.title}</label>{' '}
            <select id="indicate-region" value={indicateRegion} onChange={e => setIndicateRegion(e.target.value)}>
              <option value="">Choose a region</option>
              {currentAsset.regions.map(r => <option key={r.regionId} value={r.regionId}>{r.regionId}</option>)}
            </select>
          </p>
          <button type="submit">Indicate region</button>
        </form>
      )}
      {formError && <p role="alert">{formError}</p>}
    </section>
  );
}
