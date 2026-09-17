/**
 * Microphone samples to what Transcribe streaming takes: 16 kHz, mono,
 * signed 16-bit little-endian PCM. Averaging each output sample's source span
 * doubles as the low-pass filter a straight decimation would need.
 */
export function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate = 16000): Uint8Array {
  if (inputRate < outputRate) throw new Error(`Cannot upsample ${inputRate} Hz to ${outputRate} Hz`);
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const out = new DataView(new ArrayBuffer(length * 2));
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}
