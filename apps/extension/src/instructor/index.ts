// Public surface of the instructor module. Tests and the shell import only
// from here.
export { createCaptureController, systemClock, randomIds, UNMATCHED_DEBOUNCE, SHARING_REQUIRED_MESSAGE } from './captureController';
export type {
  CaptureController, ControllerOptions, ControllerSnapshot, CapturePhase, CurrentState, Correction, Clock, IdGenerator,
} from './captureController';
