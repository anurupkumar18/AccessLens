import workletUrl from './pcmCapture.worklet.js?url';
import { downsampleToPcm16 } from './pcm';

export interface MicCapture { stop(): void }

/**
 * Reads a granted microphone stream as mono 16-bit PCM at `sampleRate`, in
 * about 85 ms chunks. The stream was opened from the instructor's click
 * (charter A1); stopping the capture also stops its tracks.
 */
export async function startMicCapture(media: MediaStream, sampleRate: number, onPcm: (pcm16: Uint8Array) => void): Promise<MicCapture> {
  const context = new AudioContext();
  const release = () => {
    media.getTracks().forEach(track => track.stop());
    void context.close().catch(() => undefined);
  };
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    release();
    throw error;
  }
  const source = context.createMediaStreamSource(media);
  const capture = new AudioWorkletNode(context, 'pcm-capture');
  // A worklet is only pulled while connected to the destination; a silent gain keeps it running without playing the mic back.
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(capture).connect(silent).connect(context.destination);

  let stopped = false;
  capture.port.onmessage = (message: MessageEvent<Float32Array>) => {
    if (!stopped) onPcm(downsampleToPcm16(message.data, context.sampleRate, sampleRate));
  };
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      capture.port.onmessage = null;
      source.disconnect();
      release();
    },
  };
}
