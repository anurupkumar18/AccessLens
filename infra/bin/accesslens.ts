#!/usr/bin/env node
/**
 * CDK entry point for AccessLens.
 *
 * Region defaults to the account's only accessible one (see
 * `docs/AWS_ACCESS_VERIFICATION.md` section 1); the account comes from the
 * ambient credentials, so this deploys wherever the current AWS profile points.
 *
 * Each concern is its own stack, so the instructor-led live plane can be
 * deployed, destroyed, and reasoned about without the AI services attached to
 * it -- and so removing one is deleting a file rather than untangling a graph.
 */
import { App } from 'aws-cdk-lib';
import { AccessibilityServicesStack } from '../lib/accessibility-services-stack.js';
import { LiveSessionStack } from '../lib/live-session-stack.js';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new LiveSessionStack(app, 'AccessLensLiveSession', {
  env,
  description: 'AccessLens temporary live session service and WebSocket relay',
});

// Captions, catch-up, and translation. Separate from the live plane so the
// instructor-led product stays deployable without them.
new AccessibilityServicesStack(app, 'AccessLensAccessibility', {
  env,
  description: 'AccessLens accessibility services: captions, recap, translate and speak',
});
