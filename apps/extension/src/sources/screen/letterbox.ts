import type { Frame } from './captureHost';

/**
 * Every Access Pack slide is 16:9 and the pack fingerprints were computed
 * over the full slide image. Presentation viewers (Google Slides present
 * mode, Chrome's PDF viewer, Keynote in a window) centre the slide inside
 * the shared frame and pad the rest with bars. The dhash12 grid is laid
 * over the whole frame, so the bars shift every block boundary and the
 * distance to the correct slide climbs past the match threshold.
 */
export const SLIDE_ASPECT = 16 / 9;

/** Aspect differences below this are treated as already matching. */
const ASPECT_TOLERANCE = 0.02;

/**
 * Returns the centred sub-frame with the slide's aspect ratio. A frame that
 * already has that aspect is returned as-is. This is geometry only: it does
 * not look at pixel content, so a slide with a uniform edge region is
 * cropped identically to any other. Raw pixels never leave the caller.
 */
export function cropToAspect(frame: Frame, aspect: number = SLIDE_ASPECT): Frame {
  const { width, height } = frame;
  if (width === 0 || height === 0) return frame;
  const current = width / height;
  if (Math.abs(current - aspect) / aspect < ASPECT_TOLERANCE) return frame;

  let cropWidth = width;
  let cropHeight = height;
  if (current < aspect) {
    // Taller than the slide: bars above and below.
    cropHeight = Math.round(width / aspect);
  } else {
    // Wider than the slide: bars left and right.
    cropWidth = Math.round(height * aspect);
  }
  const offsetX = Math.floor((width - cropWidth) / 2);
  const offsetY = Math.floor((height - cropHeight) / 2);

  const data = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    const sourceStart = ((y + offsetY) * width + offsetX) * 4;
    data.set(frame.data.subarray(sourceStart, sourceStart + cropWidth * 4), y * cropWidth * 4);
  }
  return { width: cropWidth, height: cropHeight, data };
}
