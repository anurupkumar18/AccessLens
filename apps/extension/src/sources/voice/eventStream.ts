/**
 * The AWS event-stream binary framing Transcribe streaming speaks over its
 * WebSocket. Small enough to own rather than pull in a codec dependency:
 *
 *   [total length u32][headers length u32][prelude CRC32 u32]
 *   [headers][payload][message CRC32 u32]
 *
 * with each header as [name length u8][name][type u8][value]. Only string
 * headers (type 7) are needed in either direction.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EventMessage {
  headers: Record<string, string>;
  payload: Uint8Array;
}

export function encodeMessage(headers: Record<string, string>, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const headerBytes: number[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = encoder.encode(name);
    const valueBytes = encoder.encode(value);
    headerBytes.push(nameBytes.length, ...nameBytes, 7, (valueBytes.length >> 8) & 0xff, valueBytes.length & 0xff, ...valueBytes);
  }
  const total = 12 + headerBytes.length + payload.length + 4;
  const message = new Uint8Array(total);
  const view = new DataView(message.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headerBytes.length);
  view.setUint32(8, crc32(message.subarray(0, 8)));
  message.set(headerBytes, 12);
  message.set(payload, 12 + headerBytes.length);
  view.setUint32(total - 4, crc32(message.subarray(0, total - 4)));
  return message;
}

/** One PCM chunk as a Transcribe AudioEvent. An empty chunk ends the stream. */
export function audioEvent(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  return encodeMessage({ ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' }, pcm);
}

export function decodeMessage(buffer: ArrayBuffer | Uint8Array): EventMessage {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = view.getUint32(0);
  const headersLength = view.getUint32(4);
  if (total !== bytes.length) throw new Error('event-stream length mismatch');
  if (view.getUint32(8) !== crc32(bytes.subarray(0, 8))) throw new Error('event-stream prelude checksum mismatch');
  if (view.getUint32(total - 4) !== crc32(bytes.subarray(0, total - 4))) throw new Error('event-stream message checksum mismatch');

  const headers: Record<string, string> = {};
  let offset = 12;
  const end = 12 + headersLength;
  while (offset < end) {
    const nameLength = bytes[offset]!;
    const name = decoder.decode(bytes.subarray(offset + 1, offset + 1 + nameLength));
    offset += 1 + nameLength;
    const type = bytes[offset]!;
    offset += 1;
    if (type !== 7) throw new Error(`unsupported event-stream header type ${type}`);
    const valueLength = view.getUint16(offset);
    headers[name] = decoder.decode(bytes.subarray(offset + 2, offset + 2 + valueLength));
    offset += 2 + valueLength;
  }
  return { headers, payload: bytes.subarray(end, total - 4) };
}

export interface TranscriptPiece { text: string; isFinal: boolean }

/** Transcript text out of one Transcribe message; throws on an exception message. */
export function transcriptFrom(message: EventMessage): TranscriptPiece[] {
  const body = decoder.decode(message.payload);
  if (message.headers[':message-type'] === 'exception') {
    const detail = (() => { try { return (JSON.parse(body) as { Message?: string }).Message; } catch { return body; } })();
    throw new Error(`${message.headers[':exception-type'] ?? 'TranscribeError'}: ${detail}`);
  }
  if (message.headers[':event-type'] !== 'TranscriptEvent') return [];
  const parsed = JSON.parse(body) as { Transcript?: { Results?: Array<{ IsPartial?: boolean; Alternatives?: Array<{ Transcript?: string }> }> } };
  return (parsed.Transcript?.Results ?? [])
    .map(result => ({ text: (result.Alternatives?.[0]?.Transcript ?? '').trim(), isFinal: result.IsPartial === false }))
    .filter(piece => piece.text.length > 0);
}
