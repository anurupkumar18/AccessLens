import type { CaptureHost, CaptureStream, Frame } from './captureHost';

/**
 * Production CaptureHost. Constructing it does nothing. requestStream() calls
 * navigator.mediaDevices.getDisplayMedia() from the side-panel document,
 * which opens the browser's tab/window/screen chooser (charter A1), plays the
 * stream into a detached video element, and samples it through a canvas.
 * Frames are read on demand and handed straight to the fingerprint pass; the
 * raw stream never leaves this document (charter A2).
 *
 * The system design places sampling in an offscreen extension document. That
 * swap needs `offscreen` and `desktopCapture` manifest permissions and a
 * second Vite entry (Part 1) and is deferred; see docs/PART2_HANDOFF.md.
 */
export function createDisplayMediaHost(): CaptureHost {
  return {
    async requestStream(): Promise<CaptureStream> {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = media;
      await video.play();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        media.getTracks().forEach(t => t.stop());
        throw new Error('2D canvas context is unavailable');
      }
      const endedListeners = new Set<() => void>();
      let stopped = false;
      const [track] = media.getVideoTracks();
      track?.addEventListener('ended', () => {
        if (stopped) return;
        stopped = true;
        video.srcObject = null;
        endedListeners.forEach(l => l());
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
          media.getTracks().forEach(t => t.stop());
          video.srcObject = null;
        },
        onEnded(listener: () => void): () => void {
          endedListeners.add(listener);
          return () => endedListeners.delete(listener);
        },
      };
    },
  };
}
