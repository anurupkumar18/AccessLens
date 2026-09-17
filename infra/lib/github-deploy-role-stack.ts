/**
 * An OIDC role GitHub Actions can assume to deploy.
 *
 * The obvious approach -- put AWS keys in repository secrets -- does not work
 * here. Workshop Studio issues short-lived session tokens that expire within
 * hours, so a secret copied in at 9am is dead by lunchtime, and with five
 * people and their agents pushing, the failure would land on whoever pushed
 * next rather than whoever pasted the key.
 *
 * GitHub's OIDC provider issues a signed token per workflow run instead. AWS
 * trusts that token, scoped to one repository, so there is no long-lived
 * credential anywhere: not in the repo, not in a secret, not on a laptop.
 *
 * The trust policy is deliberately narrow on repository and deliberately open
 * on ref. Every agent works on its own branch, and pinning to `main` would mean
 * nothing deploys until the final merge -- exactly when nobody wants to find
 * out the deploy is broken. Restrict by ref before this outlives the event.
 */
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import {
  Effect,
  OpenIdConnectPrincipal,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface GitHubDeployRoleStackProps extends StackProps {
  /** `owner/repo` allowed to assume the role. */
  readonly repository: string;
  /** Reuse an existing provider ARN when the account already has one. */
  readonly existingProviderArn?: string;
}

export class GitHubDeployRoleStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubDeployRoleStackProps) {
    super(scope, id, props);

    const [owner, repository, extra] = props.repository.split('/');
    if (!owner || !repository || extra) {
      throw new Error(`GitHub repository must be owner/repo, received ${props.repository}`);
    }

    // An account may only ever hold one provider for a given issuer, and a
    // second stack trying to create it fails with EntityAlreadyExists.
    const provider = props.existingProviderArn
      ? OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GitHubOidc',
          props.existingProviderArn,
        )
      : new OpenIdConnectProvider(this, 'GitHubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    const role = new Role(this, 'GitHubDeployRole', {
      roleName: 'AccessLensGitHubDeploy',
      description: 'Assumed by GitHub Actions to deploy AccessLens stacks',
      assumedBy: new OpenIdConnectPrincipal(provider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        // GitHub supports both its original repository subject and the newer
        // customized template that includes immutable owner/repository IDs.
        // Keep the visible owner/repository names fixed in both forms; the
        // wildcards cover only GitHub-issued numeric IDs and the permitted
        // ref/environment suffix.
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${props.repository}:*`,
            `repo:${owner}@*/${repository}@*:*`,
          ],
        },
      }),
    });

    // CDK deploys by assuming the bootstrap roles, so this role needs to reach
    // those rather than hold deploy permissions itself. That keeps the blast
    // radius at "whatever CDK bootstrap already allows" instead of widening it.
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    // Reading stack outputs, and publishing the built extension and pack assets
    // to the distribution bucket.
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
          'cloudfront:CreateInvalidation',
        ],
        resources: ['*'],
      }),
    );

    new CfnOutput(this, 'GitHubDeployRoleArn', {
      value: role.roleArn,
      description: 'Set as repository variable AWS_DEPLOY_ROLE_ARN in GitHub',
    });
  }
}
