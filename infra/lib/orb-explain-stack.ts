/**
 * The orb's explanation endpoint (charter amendment, see
 * `docs/ORB_CHARTER_AMENDMENT.md`).
 *
 * Kept as its own stack rather than added to `LiveSessionStack` for two
 * reasons. The live plane is the instructor-led product and must be
 * deployable, destroyable, and reasoned about without dragging a language
 * model into it; and if the orb turns out to be the wrong idea, deleting this
 * file and one line of `bin/accesslens.ts` removes it completely.
 *
 * A Function URL rather than API Gateway: there is one route, no authorizer,
 * and no WebSocket. API Gateway would add a component whose only job is to
 * forward.
 */
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Code,
  Function as LambdaFunction,
  FunctionUrlAuthType,
  HttpMethod,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface OrbExplainStackProps extends StackProps {
  /** Override when an account has different Bedrock model access. */
  readonly modelId?: string;
}

export class OrbExplainStack extends Stack {
  constructor(scope: Construct, id: string, props: OrbExplainStackProps = {}) {
    super(scope, id, props);

    const logs = new LogGroup(this, 'OrbExplainLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const handler = new LambdaFunction(this, 'OrbExplainHandler', {
      code: Code.fromAsset(join(repoRoot, 'services/orb-explain/dist')),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_22_X,
      // Diagram generation is the slow path; explanation is well under this.
      timeout: Duration.seconds(60),
      memorySize: 512,
      logGroup: logs,
      environment: props.modelId ? { ORB_MODEL_ID: props.modelId } : {},
    });

    // Invocation only -- no model management, listing, or training.
    //
    // The foundation-model ARN is deliberately wildcarded across regions. The
    // model in use is a cross-region inference profile (`us.anthropic.…`),
    // which routes a request to whichever region has capacity, so the role
    // needs the underlying model in *all* of them. Scoping this to
    // `this.region` looks tighter and fails at runtime with AccessDenied --
    // which is exactly how this was found.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }),
    );

    const url = handler.addFunctionUrl({
      // NONE, deliberately and narrowly. The caller is a content script on an
      // arbitrary page, so there is no origin to authorise and no user identity
      // to check. The endpoint stores nothing, returns only generated text, and
      // holds no caller credentials -- so the exposure is model spend, not data.
      // That is acceptable for a temporary event account and is NOT acceptable
      // for anything that outlives it; see the amendment doc.
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [HttpMethod.POST],
        allowedHeaders: ['content-type'],
      },
    });

    new CfnOutput(this, 'OrbExplainUrl', {
      value: url.url,
      description: 'Set this as orbEndpoint in the extension’s local storage',
    });
  }
}
