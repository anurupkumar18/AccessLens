/**
 * The instructor's microphone as 16 kHz mono samples.
 *
 * Only ever opened from a click on "Start live captions" (charter A1). The
 * browser's own permission prompt is the consent step; nothing here retries
 * or works around a denial.
 */
import { SAMPLE_RATE_HZ } from './segmenter';

export interface MicrophoneStream {
  stop(): void;
}

export interface MicrophoneHost {
  open(onSamples: (samples: Float32Array) => void): Promise<MicrophoneStream>;
}

/** Linear resampling, for browsers that ignore the requested context rate. */
export function resample(samples: Float32Array, fromRate: number, toRate = SAMPLE_RATE_HZ): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    out[i] = samples[left] + (samples[right] - samples[left]) * (position - left);
  }
  return out;
}

export const browserMicrophone: MicrophoneHost = {
  async open(onSamples) {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const context = new AudioContext({ sampleRate: SAMPLE_RATE_HZ });
    const source = context.createMediaStreamSource(media);
    // ScriptProcessorNode rather than an AudioWorklet: a worklet module must be
    // loaded from a URL, and the extension's CSP makes that one more thing to
    // break for a feature whose latency is dominated by transcription anyway.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = event => {
      onSamples(resample(new Float32Array(event.inputBuffer.getChannelData(0)), context.sampleRate));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);

    return {
      stop() {
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        media.getTracks().forEach(track => track.stop());
        void context.close();
      },
    };
  },
};
