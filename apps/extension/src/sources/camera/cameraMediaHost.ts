import type { CaptureHost, CaptureStream, Frame } from '../screen/captureHost';

/**
 * Local-only camera source. Constructing this host cannot prompt or activate a
 * device; `requestStream` must be invoked from the instructor's explicit click.
 * Frames are sampled only on demand and never leave this document.
 */
export function createCameraMediaHost(): CaptureHost {
  return {
    async requestStream(): Promise<CaptureStream> {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable in this browser.');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = media;
      await video.play();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        media.getTracks().forEach((track) => track.stop());
        throw new Error('Camera frames are unavailable in this browser.');
      }

      const endedListeners = new Set<() => void>();
      let stopped = false;
      const [track] = media.getVideoTracks();
      track?.addEventListener('ended', () => {
        if (stopped) return;
        stopped = true;
        video.srcObject = null;
        endedListeners.forEach((listener) => listener());
      });

      return {
        sampleFrame(): Frame | null {
          if (stopped || video.readyState < 2 || video.videoWidth === 0) return null;
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          context.drawImage(video, 0, 0, width, height);
          const image = context.getImageData(0, 0, width, height);
          return { width, height, data: image.data };
        },
        stop(): void {
          if (stopped) return;
          stopped = true;
          media.getTracks().forEach((track) => track.stop());
          video.srcObject = null;
        },
        onEnded(listener: () => void): () => void {
          endedListeners.add(listener);
          return () => endedListeners.delete(listener);
        },
        videoTrack(): MediaStreamTrack | null {
          return stopped || !track || track.readyState === 'ended' ? null : track;
        },
      };
    },
  };
}
