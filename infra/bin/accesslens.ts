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
import { DistributionStack } from '../lib/distribution-stack.js';
import { GitHubDeployRoleStack } from '../lib/github-deploy-role-stack.js';
import { LiveSessionStack } from '../lib/live-session-stack.js';
import { OrbExplainStack } from '../lib/orb-explain-stack.js';

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

// Where the packed extension, the install page, and the reviewed pack assets
// are served from.
new DistributionStack(app, 'AccessLensDistribution', {
  env,
  description: 'AccessLens extension download and reviewed pack assets',
});

// Only deployed once, by a human, to let CI deploy everything else without a
// long-lived credential. Behind a context flag because it is the one stack that
// grants standing access.
if (app.node.tryGetContext('withDeployRole') === 'true') {
  new GitHubDeployRoleStack(app, 'AccessLensGitHubDeploy', {
    env,
    repository: app.node.tryGetContext('repository') ?? 'anurupkumar18/Mind-Machine',
    existingProviderArn: app.node.tryGetContext('oidcProviderArn'),
    description: 'GitHub Actions OIDC deploy role',
  });
}

// The orb's explanation endpoint. Separate so the instructor-led live plane
// above can be deployed and destroyed without it -- and so dropping the orb is
// deleting a file plus these six lines. See docs/ORB_CHARTER_AMENDMENT.md.
new OrbExplainStack(app, 'AccessLensOrbExplain', {
  env,
  description: 'AccessLens orb: Bedrock-backed page explanation endpoint',
});
