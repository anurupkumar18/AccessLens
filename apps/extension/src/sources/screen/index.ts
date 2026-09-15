// Public surface of the screen source. Tests and the instructor module import
// only from here.
export type { Frame, CaptureStream, CaptureHost } from './captureHost';
export { fingerprintFrame, hammingDistance, isFingerprint, FINGERPRINT_PREFIX } from './fingerprint';
export { matchFingerprint, assertPackFingerprints, DEFAULT_MATCH_OPTIONS } from './matcher';
export type { MatchDecision, MatchOptions } from './matcher';
export { createSampler, timeoutScheduler, DEFAULT_SAMPLE_INTERVAL_MS } from './sampler';
export type { Scheduler, SchedulerHandle, Sampler } from './sampler';
export { createDisplayMediaHost } from './displayMediaHost';
