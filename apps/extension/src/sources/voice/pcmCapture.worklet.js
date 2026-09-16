// AudioWorklet processor: batches the first microphone channel into ~85 ms
// Float32 chunks and posts them to the page, which downsamples and frames them
// for Transcribe. Plain JS because worklet modules load as separate files.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(4096);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.chunk.length - this.filled);
        this.chunk.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.chunk.length) {
          this.port.postMessage(this.chunk.slice());
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
