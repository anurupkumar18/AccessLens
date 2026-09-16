#!/usr/bin/env node
/**
 * CDK entry point for AccessLens Part 4.
 *
 * Region defaults to the account's only accessible one (see
 * `docs/AWS_ACCESS_VERIFICATION.md` §1); the account comes from the ambient
 * credentials, so this deploys wherever the current AWS profile points.
 */
import { App } from 'aws-cdk-lib';
import { LiveSessionStack } from '../lib/live-session-stack.js';
import { OrbExplainStack } from '../lib/orb-explain-stack.js';

const app = new App();

new LiveSessionStack(app, 'AccessLensLiveSession', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'AccessLens temporary live session service and WebSocket relay',
});

// The orb's explanation endpoint. A separate stack so the instructor-led live
// plane above can be deployed, destroyed, and reasoned about without it.
new OrbExplainStack(app, 'AccessLensOrbExplain', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'AccessLens orb: Bedrock-backed page explanation endpoint',
});
