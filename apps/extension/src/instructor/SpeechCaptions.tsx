import React, { useEffect, useRef, useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import { isRelayCapability, type AiClient } from '../shared/aiClient';
import { spokenRegion } from '../sources/voice/spokenRegion';
import { startCaptionStream, type CaptionStream, type CaptionStreamOptions } from '../sources/voice/transcribeStream';
import { startWhisperCaptions, type WhisperStreamOptions } from '../sources/voice/whisperStream';
import type { CaptureController, ControllerSnapshot } from './captureController';

/** Partial captions are sent at most this often; finals always go. Each one is a relay event. */
export const PARTIAL_CAPTION_INTERVAL_MS = 1200;

export interface CaptionDeps {
  getMicrophone(): Promise<MediaStream>;
  startStream(options: CaptionStreamOptions): Promise<CaptionStream>;
  startWhisper(options: WhisperStreamOptions): Promise<CaptionStream>;
  now(): number;
}

const browserDeps: CaptionDeps = {
  getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }),
  startStream: startCaptionStream,
  startWhisper: options => startWhisperCaptions(options),
  now: () => Date.now(),
};

export type CaptionEngine = 'whisper' | 'transcribe';

const ENGINES: Record<CaptionEngine, { label: string; hint: string; consent: string; on: string }> = {
  whisper: {
    label: 'Whisper on Amazon SageMaker',
    hint: 'a caption after each pause',
    consent: 'Turning captions on sends your microphone audio, a few seconds at a time, to Whisper running on Amazon SageMaker in this project\'s AWS account, to turn speech into text.',
    on: 'Captions are on. Whisper captions each phrase when you pause; students see your words as text.',
  },
  transcribe: {
    label: 'Amazon Transcribe',
    hint: 'word by word',
    consent: 'Turning captions on sends your microphone audio to Amazon Transcribe (AWS) to turn speech into text.',
    on: 'Captions are on. Students see your words as text.',
  },
};

interface Props {
  controller: CaptureController;
  state: ControllerSnapshot;
  pack: AccessPack;
  ai: AiClient | null;
  deps?: CaptionDeps;
}

type Status = 'off' | 'starting' | 'on';

/**
 * Instructor live captions through Whisper on SageMaker or Amazon Transcribe
 * (charter A2 decision in services/ai-gateway/README.md). Off until the
 * instructor clicks Start, which is also what opens the microphone (A1). The
 * notice names the service the audio goes to; only caption text reaches students.
 */
export function LiveCaptions({ controller, state, pack, ai, deps = browserDeps }: Props): React.ReactElement | null {
  const [status, setStatus] = useState<Status>('off');
  const [note, setNote] = useState('Captions are off.');
  const [preview, setPreview] = useState('');
  const [followVoice, setFollowVoice] = useState(true);
  const [engine, setEngine] = useState<CaptionEngine>('whisper');
  const stream = useRef<CaptionStream | null>(null);
  const latest = useRef({ state, followVoice, lastPartialAt: Number.NEGATIVE_INFINITY, lastPartial: '' });
  latest.current.state = state;
  latest.current.followVoice = followVoice;

  const sessionOpen = state.sessionId !== null && state.phase !== 'closed';

  useEffect(() => {
    if (!sessionOpen && stream.current) {
      stream.current.stop();
      stream.current = null;
      setStatus('off');
      setNote('Captions stopped because the session ended.');
    }
  }, [sessionOpen]);

  useEffect(() => () => { stream.current?.stop(); stream.current = null; }, []);

  if (!sessionOpen) return null;

  const capability = controller.getCapability();
  const available = ai !== null && isRelayCapability(capability);

  function onPiece({ text, isFinal }: { text: string; isFinal: boolean }): void {
    const ref = latest.current;
    setPreview(text);
    if (!isFinal) {
      const now = deps.now();
      if (text === ref.lastPartial || now - ref.lastPartialAt < PARTIAL_CAPTION_INTERVAL_MS) return;
      ref.lastPartialAt = now;
      ref.lastPartial = text;
      controller.caption(text, false);
      return;
    }
    ref.lastPartial = '';
    controller.caption(text, true);
    const current = ref.state.current;
    if (!ref.followVoice || current.kind !== 'matched') return;
    const asset = pack.assets.find(candidate => candidate.assetId === current.assetId);
    const regionId = asset ? spokenRegion(text, asset.regions) : null;
    if (regionId && regionId !== current.regionId) {
      try {
        controller.indicateRegion(regionId);
        setNote(`Heard "${asset!.regions.find(r => r.regionId === regionId)?.label ?? regionId}", so students moved there.`);
      } catch { /* the slide changed under us; the next final will try again */ }
    }
  }

  async function start(): Promise<void> {
    if (!ai || !isRelayCapability(capability)) return;
    setStatus('starting');
    setNote('Asking for your microphone…');
    let media: MediaStream;
    try {
      media = await deps.getMicrophone();
    } catch {
      setStatus('off');
      setNote('The microphone was not allowed. Chrome does not show the permission prompt inside the side panel: use "Open in a full tab", then allow the microphone.');
      return;
    }
    try {
      const onError = (message: string) => setNote(`Captions hit a problem: ${message}`);
      const onClosed = () => {
        stream.current = null;
        setStatus('off');
        setNote(current => (current.startsWith('Captions hit a problem') ? current : 'Captions are off.'));
      };
      if (engine === 'whisper') {
        const signed = capability;
        stream.current = await deps.startWhisper({ media, transcribe: wav => ai.transcribeClip(signed, wav), onPiece, onError, onClosed });
      } else {
        const grant = await ai.transcribeUrl(capability);
        stream.current = await deps.startStream({ url: grant.url, sampleRate: grant.sampleRate, media, onPiece, onError, onClosed });
      }
      setStatus('on');
      setNote(ENGINES[engine].on);
    } catch {
      media.getTracks().forEach(track => track.stop());
      setStatus('off');
      setNote('Could not start captions. Check the connection and try again.');
    }
  }

  function stop(): void {
    stream.current?.stop();
    stream.current = null;
    setStatus('off');
    setNote('Captions are off.');
  }

  return (
    <section className="live-captions" aria-labelledby="captions-heading">
      <h3 id="captions-heading">Live captions</h3>
      <p className="consent">
        {ENGINES[engine].consent} Students get only the text. AccessLens does not record or keep your audio.
      </p>
      {available ? (
        <>
          <p className="caption-option">
            <input id="caption-follow" type="checkbox" checked={followVoice} onChange={() => setFollowVoice(!followVoice)} />
            <label htmlFor="caption-follow">Move students to the parts of the slide I name</label>
          </p>
          <fieldset className="caption-engine" disabled={status !== 'off'}>
            <legend>Speech recognition</legend>
            {(Object.keys(ENGINES) as CaptionEngine[]).map(id => (
              <p key={id} className="caption-option">
                <input id={`caption-engine-${id}`} type="radio" name="caption-engine" checked={engine === id} onChange={() => setEngine(id)} />
                <label htmlFor={`caption-engine-${id}`}>{ENGINES[id].label} <span className="muted">({ENGINES[id].hint})</span></label>
              </p>
            ))}
          </fieldset>
          {status === 'on'
            ? <button type="button" onClick={stop}>Stop captions</button>
            : <button type="button" className="primary" disabled={status === 'starting'} onClick={() => { void start(); }}>Start captions</button>}
          <p role="status" aria-live="polite" className="supporting-text">{note}</p>
          {preview && <p className="caption-preview"><span className="eyebrow">Last heard</span>{preview}</p>}
        </>
      ) : (
        <p className="notice">Live captions need the AWS session. Set VITE_ACCESSLENS_AI_URL and VITE_ACCESSLENS_WS_URL, then start a new session.</p>
      )}
    </section>
  );
}
