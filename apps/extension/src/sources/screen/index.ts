// Public surface of the screen source. Tests and the instructor module import
// only from here.
export type { Frame, CaptureStream, CaptureHost, DisplaySurface } from './captureHost';
export { fingerprintFrame, hammingDistance, isFingerprint, FINGERPRINT_PREFIX, FINGERPRINT_ALGORITHM, FINGERPRINT_BITS, TIE_EPSILON } from './fingerprint';
export { matchFingerprint, matchOptionsFor, assertPackFingerprints, DEFAULT_MATCH_OPTIONS } from './matcher';
export type { MatchDecision, MatchOptions } from './matcher';
export { cropToAspect, SLIDE_ASPECT } from './letterbox';
export { createSampler, timeoutScheduler, wholeFrameFingerprint, DEFAULT_SAMPLE_INTERVAL_MS } from './sampler';
export { createSlideLocator } from './locate';
export type { SlideLocator } from './locate';
export type { Scheduler, SchedulerHandle, Sampler } from './sampler';
export { createDisplayMediaHost } from './displayMediaHost';
