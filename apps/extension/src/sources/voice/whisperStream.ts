import { AiUnavailableError } from '../../shared/aiClient';
import type { TranscriptPiece } from './eventStream';
import { startMicCapture, type MicCapture } from './micCapture';
import { SpeechSegmenter } from './segmenter';
import type { CaptionStream } from './transcribeStream';
import { encodeWav } from './wav';

export const WHISPER_SAMPLE_RATE = 16000;

export interface WhisperStreamOptions {
  /** Microphone stream the instructor granted from a click (charter A1). */
  media: MediaStream;
  /** Sends one WAV clip to Whisper through the AI gateway and resolves its text. */
  transcribe(wav: Uint8Array): Promise<string>;
  onPiece(piece: TranscriptPiece): void;
  onError(message: string): void;
  onClosed(): void;
}

/**
 * Live captions through Whisper on Amazon SageMaker. Whisper transcribes clips
 * rather than a stream, so the microphone is cut at the instructor's pauses and
 * each clip's text arrives as one final caption, a second or two after the
 * pause. Clips are sent as soon as they end but reported in speaking order.
 * Audio goes to the AI gateway only as those clips and is never stored.
 */
export async function startWhisperCaptions(options: WhisperStreamOptions, startMic = startMicCapture): Promise<CaptionStream> {
  const segmenter = new SpeechSegmenter({ sampleRate: WHISPER_SAMPLE_RATE });
  let stopped = false;
  let mic: MicCapture | undefined;
  let inOrder: Promise<void> = Promise.resolve();
  /** Clips in a row that failed; one is a hiccup, two means Whisper is not answering. */
  let failuresInARow = 0;

  function close(): void {
    if (stopped) return;
    stopped = true;
    mic?.stop();
    options.onClosed();
  }

  function send(clip: Uint8Array): void {
    const text = options.transcribe(encodeWav(clip, WHISPER_SAMPLE_RATE));
    text.catch(() => undefined); // handled in order below
    inOrder = inOrder.then(async () => {
      try {
        const words = (await text).trim();
        failuresInARow = 0;
        if (words && !stopped) options.onPiece({ text: words, isFinal: true });
      } catch (error) {
        if (stopped) return;
        const status = error instanceof AiUnavailableError ? error.status : null;
        failuresInARow += 1;
        // 503: the endpoint is not running. 404: the deployed AI API has no Whisper route. A
        // missing route also arrives as a network error, because API Gateway's 404 carries no
        // CORS headers, so two failures in a row mean the same thing.
        if (status === 503 || status === 404 || (status !== 429 && failuresInARow >= 2)) {
          options.onError('Whisper is not running on AWS right now. Choose Amazon Transcribe instead.');
          close();
        } else if (status === 429) {
          options.onError('Too much speech this minute: some of it was not captioned.');
        } else {
          options.onError('One stretch of speech could not be captioned.');
        }
      }
    });
  }

  mic = await startMic(options.media, WHISPER_SAMPLE_RATE, pcm => {
    if (stopped) return;
    for (const clip of segmenter.push(pcm)) send(clip);
  });

  return { stop: close };
}
