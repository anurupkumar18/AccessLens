#!/usr/bin/env node
/**
 * The one CDK app for AccessLens. Three stacks:
 *
 *   - `AccessLensLiveSession` (Part 4): the temporary live plane, WebSocket
 *     relay and session state.
 *   - `AccessLensAuthoring` (Part 6): the authoring pipeline, its API, the
 *     Step Functions workflow, packs and the viewer sandbox.
 *   - `AccessLensWhisper`: a GPU speech-recognition endpoint for live
 *     captions and voice sync, deployed and destroyed independently of the
 *     other two because it bills hourly whether or not anyone is teaching
 *     (see `whisper-stack.ts`).
 *
 * Deploy them by name (`cdk deploy AccessLensAuthoring`); `make deploy` and
 * `make destroy` name the authoring stack only. The region defaults to the
 * account's only accessible one (`docs/AWS_ACCESS_VERIFICATION.md` §1) and
 * the account comes from the ambient credentials.
 */
import { App } from 'aws-cdk-lib';
import { AccessLensAuthoringStack } from '../lib/access-lens-authoring-stack';
import { LiveSessionStack } from '../lib/live-session-stack';
import { WhisperStack } from '../lib/whisper-stack';

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new LiveSessionStack(app, 'AccessLensLiveSession', {
  env,
  description: 'AccessLens temporary live session service and WebSocket relay',
  // The authoring distribution's URL, from .env.local (make deploy sources it),
  // so the relay can read any published pack the way students do.
  packBaseUrl: process.env.VITE_ACCESSLENS_ASSET_BASE_URL || undefined,
});
new AccessLensAuthoringStack(app, 'AccessLensAuthoring');

// Deployed only on request: a GPU endpoint that bills hourly (see whisper-stack.ts).
new WhisperStack(app, 'AccessLensWhisper', {
  env,
  description: 'AccessLens Whisper speech recognition endpoint for live captions (destroy when not in use)',
});
