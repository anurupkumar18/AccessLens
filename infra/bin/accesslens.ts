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
import { DistributionStack } from '../lib/distribution-stack.js';
import { GitHubDeployRoleStack } from '../lib/github-deploy-role-stack.js';

const app = new App();

new LiveSessionStack(app, 'AccessLensLiveSession', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'AccessLens temporary live session service and WebSocket relay',
});

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// Where the packed extension, the install page, and the reviewed pack assets
// are served from.
new DistributionStack(app, 'AccessLensDistribution', {
  env,
  description: 'AccessLens extension download and reviewed pack assets',
});

// Only deployed once, by a human, to let CI deploy everything else without a
// long-lived credential. Skipped unless explicitly asked for, because it is the
// one stack that grants standing access.
if (app.node.tryGetContext('withDeployRole') === 'true') {
  new GitHubDeployRoleStack(app, 'AccessLensGitHubDeploy', {
    env,
    repository: app.node.tryGetContext('repository') ?? 'anurupkumar18/Mind-Machine',
    existingProviderArn: app.node.tryGetContext('oidcProviderArn'),
    description: 'GitHub Actions OIDC deploy role',
  });
}
