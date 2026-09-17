import { describe, expect, it } from 'vitest';
import { createPointerTracker } from './pointer';
import { loadSlideFrame, scaleFrame, withPointer } from './fixtures';

// A reviewed slide filling a 1280x720 capture, the way a full-screen slideshow arrives.
const slide = scaleFrame(loadSlideFrame('slide-03'), 1280, 720);
const whole = { x: 0, y: 0, width: 1280, height: 720 };
const near = (position: { x: number; y: number } | null, x: number, y: number) =>
  position !== null && Math.abs(position.x - x / 1280) < 0.03 && Math.abs(position.y - y / 720) < 0.04;

describe('createPointerTracker', () => {
  it('reports nothing while the slide holds still', () => {
    const tracker = createPointerTracker();
    for (let i = 0; i < 4; i++) expect(tracker.observe(slide, whole)).toBeNull();
  });

  it('follows a moving pointer to where its tip is', () => {
    const tracker = createPointerTracker();
    tracker.observe(slide, whole);
    const path = [[200, 150], [640, 360], [1000, 500], [300, 600]];
    for (const [x, y] of path) expect(near(tracker.observe(withPointer(slide, x, y), whole), x, y)).toBe(true);
  });

  it('picks the new spot, not the one left behind, when a resting pointer moves on', () => {
    const tracker = createPointerTracker();
    tracker.observe(slide, whole);
    tracker.observe(withPointer(slide, 300, 200), whole);
    tracker.observe(withPointer(slide, 300, 200), whole); // at rest: absorbed into the background
    expect(tracker.observe(withPointer(slide, 300, 200), whole)).toBeNull();
    expect(near(tracker.observe(withPointer(slide, 900, 450), whole), 900, 450)).toBe(true);
    // Resting at the new spot, it is still there, not back at the old one.
    expect(near(tracker.observe(withPointer(slide, 900, 450), whole), 900, 450)).toBe(true);
  });

  it('treats the whole slide changing as content, not a pointer', () => {
    const tracker = createPointerTracker();
    tracker.observe(slide, whole);
    expect(tracker.observe(scaleFrame(loadSlideFrame('slide-05'), 1280, 720), whole)).toBeNull();
  });

  it('starts over when the slide moves on screen', () => {
    const tracker = createPointerTracker();
    tracker.observe(slide, whole);
    expect(tracker.observe(withPointer(slide, 640, 360), { x: 40, y: 0, width: 1200, height: 675 })).toBeNull();
  });
});
