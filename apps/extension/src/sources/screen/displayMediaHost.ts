import type { CaptureHost, CaptureStream, DisplaySurface, Frame } from './captureHost';

/**
 * Frames wider than this are drawn scaled down. A whole Retina screen is
 * 2880x1800, a 20 MB read twice a second; fingerprints are block means, and
 * the pack thresholds were measured across downscaling, so nothing is lost.
 */
export const MAX_SAMPLE_WIDTH = 1280;

/**
 * Chooser hints. Chrome reads these; other browsers ignore unknown members.
 * `selfBrowserSurface: 'exclude'` keeps AccessLens's own tab out of the list
 * (sharing the panel is never what the instructor means), and
 * `surfaceSwitching: 'include'` adds "Share this tab instead" so switching
 * decks does not need Stop and Start. Window and screen stay offered: the
 * slide locator finds the slide inside them.
 */
const DISPLAY_MEDIA_OPTIONS = {
  video: { frameRate: { ideal: 5, max: 15 } },
  audio: false,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  monitorTypeSurfaces: 'include',
} as DisplayMediaStreamOptions;

function surfaceOf(track: MediaStreamTrack | undefined): DisplaySurface | undefined {
  const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  return surface === 'browser' || surface === 'window' || surface === 'monitor' ? surface : undefined;
}

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
      const media = await navigator.mediaDevices.getDisplayMedia(DISPLAY_MEDIA_OPTIONS);
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
        get surface() { return surfaceOf(track); },
        sampleFrame(): Frame | null {
          if (stopped || video.readyState < 2 || video.videoWidth === 0) return null;
          const scale = Math.min(1, MAX_SAMPLE_WIDTH / video.videoWidth);
          const width = Math.max(1, Math.round(video.videoWidth * scale));
          const height = Math.max(1, Math.round(video.videoHeight * scale));
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
