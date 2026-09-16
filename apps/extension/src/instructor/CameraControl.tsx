import React, { useEffect, useRef, useState } from 'react';
import type { CaptureHost, CaptureStream } from '../sources/screen';

type CameraPhase = 'off' | 'starting' | 'on';

interface Props {
  host: CaptureHost;
}

/**
 * Camera source lifecycle only. It does not recognise objects or emit an event:
 * that future adapter must be reviewed separately and retain the manual region
 * fallback below. This control exists so camera permission can never be implicit.
 */
export function CameraControl({ host }: Props): React.ReactElement {
  const [phase, setPhase] = useState<CameraPhase>('off');
  const [message, setMessage] = useState('Camera is off. No camera stream is active.');
  const stream = useRef<CaptureStream | null>(null);
  const unsubscribeEnded = useRef<(() => void) | null>(null);

  function release(message_: string): void {
    unsubscribeEnded.current?.();
    unsubscribeEnded.current = null;
    stream.current?.stop();
    stream.current = null;
    setPhase('off');
    setMessage(message_);
  }

  useEffect(() => () => { release('Camera stopped because this control closed.'); }, []);

  async function start(): Promise<void> {
    if (phase !== 'off') return;
    setPhase('starting');
    setMessage('Waiting for camera permission. No camera stream is active until you approve the browser prompt.');
    try {
      // Deliberately starts inside this explicit click handler (charter A1).
      const requested = host.requestStream();
      const next = await requested;
      stream.current = next;
      unsubscribeEnded.current = next.onEnded(() => {
        if (stream.current !== next) return;
        stream.current = null;
        unsubscribeEnded.current = null;
        setPhase('off');
        setMessage('The browser ended the camera. No camera stream is active.');
      });
      setPhase('on');
      setMessage('Camera is on locally. Video and frames stay on this device and are not sent to students or the relay.');
    } catch (error) {
      setPhase('off');
      setMessage(error instanceof Error ? `Camera unavailable: ${error.message}` : 'Camera unavailable. No camera stream is active.');
    }
  }

  return (
    <section className="camera-source" aria-labelledby="camera-source-title">
      <h3 id="camera-source-title">Physical demonstration camera (stretch)</h3>
      <p role="status" aria-live="polite">{message}</p>
      {phase === 'off' ? <button type="button" onClick={() => { void start(); }}>Start local camera</button> : null}
      {phase === 'starting' ? <button type="button" disabled>Waiting for permission</button> : null}
      {phase === 'on' ? <button type="button" className="stop" onClick={() => release('Camera stopped. No camera stream is active.')}>Stop local camera</button> : null}
      <p className="supporting-text">Use the reviewed-region controls for the same lesson meaning if the camera is denied, unclear, or unavailable. AccessLens does not guess objects, faces, or gestures.</p>
    </section>
  );
}
