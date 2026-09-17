import workletUrl from './pcmCapture.worklet.js?url';
import { audioEvent, decodeMessage, transcriptFrom, type TranscriptPiece } from './eventStream';
import { downsampleToPcm16 } from './pcm';

export interface CaptionStream { stop(): void }

export interface CaptionStreamOptions {
  /** Presigned Transcribe streaming URL from the AI gateway. */
  url: string;
  sampleRate: number;
  /** Microphone stream the instructor granted from a click (charter A1). */
  media: MediaStream;
  onPiece(piece: TranscriptPiece): void;
  onError(message: string): void;
  onClosed(): void;
}

/**
 * Streams the instructor's microphone to Amazon Transcribe and reports the
 * transcript. Audio goes from this page straight to Transcribe over the
 * presigned WebSocket: never to the relay, never stored by AccessLens. Only
 * the caller decides what, if any, text leaves as a caption event.
 */
export async function startCaptionStream(options: CaptionStreamOptions): Promise<CaptionStream> {
  const socket = new WebSocket(options.url);
  socket.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not reach Amazon Transcribe.')), { once: true });
  });

  const context = new AudioContext();
  let stopped = false;
  const cleanup = () => {
    options.media.getTracks().forEach(track => track.stop());
    void context.close().catch(() => undefined);
  };

  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    socket.close();
    cleanup();
    throw error;
  }
  const source = context.createMediaStreamSource(options.media);
  const capture = new AudioWorkletNode(context, 'pcm-capture');
  // A worklet is only pulled while connected to the destination; a silent gain keeps it running without playing the mic back.
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(capture).connect(silent).connect(context.destination);

  capture.port.onmessage = (message: MessageEvent<Float32Array>) => {
    if (stopped || socket.readyState !== WebSocket.OPEN) return;
    socket.send(audioEvent(downsampleToPcm16(message.data, context.sampleRate, options.sampleRate)));
  };

  socket.addEventListener('message', message => {
    try {
      for (const piece of transcriptFrom(decodeMessage(message.data as ArrayBuffer))) options.onPiece(piece);
    } catch (error) {
      options.onError(error instanceof Error ? error.message : String(error));
    }
  });
  socket.addEventListener('close', () => {
    capture.port.onmessage = null;
    source.disconnect();
    cleanup();
    options.onClosed();
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (socket.readyState === WebSocket.OPEN) {
        // An empty AudioEvent tells Transcribe the stream is over so it can flush the last result.
        socket.send(audioEvent(new Uint8Array(0)));
        setTimeout(() => socket.close(), 1500);
      }
      options.media.getTracks().forEach(track => track.stop());
    },
  };
}
