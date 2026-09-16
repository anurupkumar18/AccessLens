/**
 * The media service, and the browser-side preparation that keeps what it is
 * sent small: images are redrawn at most 1568 px on the long edge (the size
 * Claude's vision reads at anyway), audio goes as 16 kHz mono chunks.
 */
import { callService } from '../accessibility/endpoints';
import { bytesToBase64, chunkBoundaries, decodeToMono16k, SAMPLE_RATE_HZ, toPcm16Base64 } from './audio';
import type { TimedWord } from './captions';
import type { AltTextDecision } from './pptx';

const MAX_EDGE_PX = 1568;
/** Transcribe streaming allows 25 concurrent streams per account; stay well inside. */
const TRANSCRIBE_CONCURRENCY = 4;

export interface MediaApi {
  draftAltText(image: Blob, context: string, signal?: AbortSignal): Promise<AltTextDecision>;
  transcribe(media: Blob, lang: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<TimedWord[]>;
}

/** Browser only. JPEG on white, so transparent diagrams do not turn black. */
async function downscale(image: Blob): Promise<{ base64: string; mediaType: string }> {
  const url = URL.createObjectURL(image);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(element.naturalWidth, element.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not draw the image.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!jpeg) throw new Error('This browser could not encode the image.');
    return { base64: bytesToBase64(new Uint8Array(await jpeg.arrayBuffer())), mediaType: 'image/jpeg' };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('This browser')) throw error;
    throw new Error('This image format cannot be read in the browser. Write its alt text by hand.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const mediaApi: MediaApi = {
  async draftAltText(image, context, signal) {
    const { base64, mediaType } = await downscale(image);
    const response = await callService<{ draft: AltTextDecision }>('media', { kind: 'alt-text', image: base64, mediaType, context }, signal);
    return response.draft;
  },

  async transcribe(media, lang, onProgress, signal) {
    let samples: Float32Array;
    try {
      samples = await decodeToMono16k(media);
    } catch {
      throw new Error('No audio track could be decoded from this file. MP4 video needs AAC audio.');
    }
    const boundaries = chunkBoundaries(samples);
    const chunks = boundaries.slice(0, -1).map((start, i) => ({ start, end: boundaries[i + 1] }));
    const results: TimedWord[][] = new Array(chunks.length);
    let next = 0;
    let done = 0;
    onProgress(0, chunks.length);

    const worker = async () => {
      while (next < chunks.length) {
        const index = next++;
        const { start, end } = chunks[index];
        const offset = start / SAMPLE_RATE_HZ;
        const response = await callService<{ words: TimedWord[] }>(
          'media',
          { kind: 'transcribe', audio: toPcm16Base64(samples.subarray(start, end)), lang },
          signal,
        );
        results[index] = response.words.map(word => ({ text: word.text, start: word.start + offset, end: word.end + offset }));
        onProgress(++done, chunks.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRANSCRIBE_CONCURRENCY, chunks.length) }, worker));
    return results.flat();
  },
};
