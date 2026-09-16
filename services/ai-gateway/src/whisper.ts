/**
 * Whisper (large-v3-turbo on SageMaker, `infra/lib/whisper-stack.ts`) for the
 * instructor's live captions: one short spoken clip in, its text out.
 *
 * The extension cuts the microphone into clips at pauses and posts each one
 * here as 16 kHz mono 16-bit WAV. Nothing is stored: the clip is checked,
 * passed to the endpoint in memory, and only the text comes back. Like the
 * Transcribe path, this is remote audio processing under the charter A2
 * decision (docs/work/decisions/2026-09-16-transcribe-live-captions.md).
 */

export const WHISPER_SAMPLE_RATE = 16000;
export const WHISPER_MIN_SECONDS = 0.25;
export const WHISPER_MAX_SECONDS = 12;
/**
 * Root-mean-square level (16-bit sample units, about -47 dBFS) below which a
 * whole clip counts as silence and is never sent. Whisper does not return
 * nothing for silence: it invents text, typically "Thank you." or "you".
 */
export const SILENCE_RMS = 150;
const CAPTION_MAX_LENGTH = 500;

/** Stock phrases Whisper produces from noise, learned from subtitled video; no lecture says them. */
const HALLUCINATIONS = new Set([
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subtitles by the amaraorg community',
]);

/** Calls the endpoint with a WAV clip and returns its parsed JSON response. */
export type InvokeWhisper = (wav: Uint8Array) => Promise<unknown>;

export type ClipResult =
  | { status: 'ok'; text: string }
  | { status: 'invalid'; reason: 'audio-not-wav' | 'audio-format-unsupported' | 'audio-too-short' | 'audio-too-long' }
  | { status: 'unavailable' };

interface Pcm16 { samples: Int16Array; sampleRate: number; channels: number; bitsPerSample: number; format: number }

/** Reads a RIFF/WAVE container's fmt and data chunks. Null if it is not one. */
export function readWav(bytes: Uint8Array): Pcm16 | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let format = 0, channels = 0, sampleRate = 0, bitsPerSample = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      const length = Math.min(size, bytes.length - body) & ~1;
      const samples = new Int16Array(length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(body + i * 2, true);
      return { samples, sampleRate, channels, bitsPerSample, format };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/** The text in a Hugging Face ASR pipeline response: `{ text }`, or a one-item list of it. */
function textFrom(response: unknown): string | null {
  const item = Array.isArray(response) ? response[0] : response;
  const text = item && typeof item === 'object' ? (item as { text?: unknown }).text : undefined;
  return typeof text === 'string' ? text : null;
}

export async function transcribeClip(wav: Uint8Array, invoke: InvokeWhisper): Promise<ClipResult> {
  const audio = readWav(wav);
  if (!audio) return { status: 'invalid', reason: 'audio-not-wav' };
  if (audio.format !== 1 || audio.channels !== 1 || audio.bitsPerSample !== 16 || audio.sampleRate !== WHISPER_SAMPLE_RATE) {
    return { status: 'invalid', reason: 'audio-format-unsupported' };
  }
  const seconds = audio.samples.length / WHISPER_SAMPLE_RATE;
  if (seconds < WHISPER_MIN_SECONDS) return { status: 'invalid', reason: 'audio-too-short' };
  if (seconds > WHISPER_MAX_SECONDS) return { status: 'invalid', reason: 'audio-too-long' };
  if (rms(audio.samples) < SILENCE_RMS) return { status: 'ok', text: '' };

  let response: unknown;
  try {
    response = await invoke(wav);
  } catch {
    return { status: 'unavailable' };
  }
  const raw = textFrom(response);
  if (raw === null) return { status: 'unavailable' };
  const text = raw.replace(/\s+/g, ' ').trim();
  const words = text.toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (HALLUCINATIONS.has(words)) return { status: 'ok', text: '' };
  return { status: 'ok', text: text.slice(0, CAPTION_MAX_LENGTH) };
}
