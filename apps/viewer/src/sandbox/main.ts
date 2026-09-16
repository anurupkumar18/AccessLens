import { SandboxRuntime } from './runtime';

const parentOrigin = (() => {
  try {
    // In production the parent is the viewer origin. A sandboxed frame has an
    // opaque own origin, so document.referrer is the reliable concrete target.
    return document.referrer ? new URL(document.referrer).origin : window.location.origin;
  } catch {
    return window.location.origin;
  }
})();

const runtime = new SandboxRuntime({
  window,
  document,
  fetch,
  parentOrigin,
});
runtime.start();
