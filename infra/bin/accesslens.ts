#!/usr/bin/env node
/**
 * The one CDK app for AccessLens. Each concern is its own stack, so the
 * instructor-led live plane can be deployed, destroyed, and reasoned about
 * without the services attached to it -- and so removing one is deleting a
 * file rather than untangling a graph:
 *
 *   - `AccessLensLiveSession` (Part 4): the temporary live plane, WebSocket
 *     relay and session state, plus the AI gateway routes.
 *   - `AccessLensAuthoring` (Part 6): the authoring pipeline, its API, the
 *     Step Functions workflow, packs and the viewer sandbox.
 *   - `AccessLensAccessibility`: captions, catch-up, translation and speech.
 *   - `AccessLensDistribution`: the packed extension, install page and
 *     reviewed pack assets.
 *   - `AccessLensOrbExplain`: the orb's Bedrock-backed explanation endpoint.
 *   - `AccessLensWhisper`: a GPU speech-recognition endpoint for live
 *     captions and voice sync, deployed and destroyed independently because
 *     it bills hourly whether or not anyone is teaching (see `whisper-stack.ts`).
 *   - `AccessLensGitHubDeploy`: only with `-c withDeployRole=true`.
 *
 * Deploy them by name (`cdk deploy AccessLensAuthoring`); `make deploy` and
 * `make destroy` name the authoring stack only. The region defaults to the
 * account's only accessible one (`docs/AWS_ACCESS_VERIFICATION.md` §1) and
 * the account comes from the ambient credentials.
 */
import { App } from 'aws-cdk-lib';
import { AccessLensAuthoringStack } from '../lib/access-lens-authoring-stack';
import { AccessibilityServicesStack } from '../lib/accessibility-services-stack.js';
import { CourseMediaStack } from '../lib/course-media-stack.js';
import { DistributionStack } from '../lib/distribution-stack.js';
import { GitHubDeployRoleStack } from '../lib/github-deploy-role-stack.js';
import { LiveSessionStack } from '../lib/live-session-stack';
import { OrbExplainStack } from '../lib/orb-explain-stack.js';
import { WhisperStack } from '../lib/whisper-stack';

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// Created first so the relay below can read published packs from its distribution.
const authoring = new AccessLensAuthoringStack(app, 'AccessLensAuthoring');

new LiveSessionStack(app, 'AccessLensLiveSession', {
  env,
  description: 'AccessLens temporary live session service and WebSocket relay',
  // Where published packs live, so the relay can read any of them the way
  // students do. .env.local can override it; otherwise it is the authoring
  // distribution itself, so a deploy that sets nothing (CI) still resolves
  // packs instead of refusing every one that is not bundled.
  packBaseUrl: process.env.VITE_ACCESSLENS_ASSET_BASE_URL || `https://${authoring.distribution.distributionDomainName}`,
  // Set when the team's Knowledge Base over the instructors' S3 uploads exists:
  // `cdk deploy -c studyChatKnowledgeBaseId=XXXXXXXXXX AccessLensLiveSession`.
  studyChatKnowledgeBaseId: app.node.tryGetContext('studyChatKnowledgeBaseId') || process.env.STUDY_CHAT_KNOWLEDGE_BASE_ID || undefined,
});
// Captions, catch-up, and translation. Separate from the live plane so the
// instructor-led product stays deployable without them.
new AccessibilityServicesStack(app, 'AccessLensAccessibility', {
  env,
  description: 'AccessLens accessibility services: captions, recap, translate and speak',
});

// Course materials: automatic alt text and captions for anything a professor
// uploads, delivered to students in the extension.
new CourseMediaStack(app, 'AccessLensCourseMedia', {
  env,
  description: 'AccessLens course materials: automatic alt text and captions',
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

// Deployed only on request: a GPU endpoint that bills hourly (see whisper-stack.ts).
// Behind a context flag so `cdk deploy --all`, which CI runs on every push,
// never starts it: `npx cdk deploy -c withWhisper=true AccessLensWhisper`.
if (app.node.tryGetContext('withWhisper') === 'true') {
  new WhisperStack(app, 'AccessLensWhisper', {
    env,
    description: 'AccessLens Whisper speech recognition endpoint for live captions (destroy when not in use)',
  });
}
