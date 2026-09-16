import { audioEvent, decodeMessage, transcriptFrom, type TranscriptPiece } from './eventStream';
import { startMicCapture, type MicCapture } from './micCapture';

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

  let stopped = false;
  let mic: MicCapture;
  try {
    mic = await startMicCapture(options.media, options.sampleRate, pcm => {
      if (!stopped && socket.readyState === WebSocket.OPEN) socket.send(audioEvent(pcm));
    });
  } catch (error) {
    socket.close();
    throw error;
  }

  socket.addEventListener('message', message => {
    try {
      for (const piece of transcriptFrom(decodeMessage(message.data as ArrayBuffer))) options.onPiece(piece);
    } catch (error) {
      options.onError(error instanceof Error ? error.message : String(error));
    }
  });
  socket.addEventListener('close', () => {
    mic.stop();
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
