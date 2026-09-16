/**
 * Recorded audio and video -> pcm16 chunks the media service can transcribe.
 *
 * Decoding happens in the browser, so the instructor's file never leaves the
 * device whole: only 16 kHz mono speech, about a minute at a time, reaches AWS.
 * Chrome's `decodeAudioData` reads MP3 and the AAC track of an MP4, and decoding
 * into a 16 kHz context resamples in the same step.
 */

export const SAMPLE_RATE_HZ = 16000;
/** About a minute: well under the service's 5 MB limit and its timeout. */
const TARGET_CHUNK_SECONDS = 55;
/** How far back from the target to look for a quiet place to cut. */
const SEARCH_SECONDS = 8;
const WINDOW_SECONDS = 0.1;

/**
 * Chunk boundaries, as sample offsets, placed at the quietest 100 ms near each
 * target length. Cutting mid-word makes Transcribe mishear the word on both
 * sides of the cut, and a pause is almost always a few seconds away in speech.
 */
export function chunkBoundaries(samples: Float32Array, sampleRate = SAMPLE_RATE_HZ, targetSeconds = TARGET_CHUNK_SECONDS): number[] {
  const target = Math.floor(targetSeconds * sampleRate);
  const search = Math.floor(Math.min(SEARCH_SECONDS, targetSeconds / 2) * sampleRate);
  const window = Math.max(1, Math.floor(WINDOW_SECONDS * sampleRate));
  const boundaries = [0];

  let start = 0;
  while (samples.length - start > target) {
    let cut = start + target;
    let quietest = Infinity;
    for (let offset = start + target - search; offset + window <= start + target; offset += window) {
      let energy = 0;
      for (let i = offset; i < offset + window; i++) energy += samples[i] * samples[i];
      if (energy < quietest) {
        quietest = energy;
        cut = offset + Math.floor(window / 2);
      }
    }
    boundaries.push(cut);
    start = cut;
  }
  boundaries.push(samples.length);
  return boundaries;
}

/** Little-endian pcm16, base64 encoded, as the service expects. */
export function toPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Browser only. Mono 16 kHz samples for any audio Chrome can decode. */
export async function decodeToMono16k(file: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE_HZ);
  const buffer = await context.decodeAudioData(await file.arrayBuffer());
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}
