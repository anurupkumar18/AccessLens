/**
 * The accessibility services: captions, catch-up, translation, and course
 * media preparation (alt text and recorded-media captions).
 *
 * One stack rather than three, because they share a shape exactly — a single
 * Lambda behind a Function URL, called from a browser extension on an
 * arbitrary page — and because three near-identical stacks would triple the
 * deploy time for no isolation benefit. They are still separate *functions*,
 * so one failing or being throttled cannot take the others down.
 *
 * Kept out of `LiveSessionStack` for the same reason `OrbExplainStack` is: the
 * instructor-led live plane must remain deployable and reasonable about
 * without dragging AI services into it.
 */
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
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

interface ServiceSpec {
  readonly id: string;
  readonly directory: string;
  /** Seconds. Speech synthesis and model calls are slower than a translation. */
  readonly timeout: number;
  readonly memory: number;
  readonly policies: { actions: string[]; resources: string[] }[];
  readonly environment?: Record<string, string>;
}

export class AccessibilityServicesStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // Wildcarded across regions on purpose: `us.anthropic.*` is a
    // cross-region inference profile that routes by capacity, so scoping
    // to this.region looks tighter and fails at runtime with AccessDenied.
    const bedrockInvoke = {
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    };

    const specs: ServiceSpec[] = [
      {
        id: 'Captions',
        directory: 'services/captions',
        // Transcribe streaming holds the connection open for the audio chunk.
        timeout: 60,
        memory: 512,
        policies: [{ actions: ['transcribe:StartStreamTranscription'], resources: ['*'] }],
      },
      {
        id: 'Recap',
        directory: 'services/recap',
        timeout: 60,
        memory: 512,
        policies: [bedrockInvoke],
      },
      {
        id: 'TranslateSpeak',
        directory: 'services/translate-speak',
        timeout: 30,
        memory: 512,
        policies: [{ actions: ['translate:TranslateText', 'polly:SynthesizeSpeech', 'comprehend:DetectDominantLanguage'], resources: ['*'] }],
      },
      {
        // Instructor course media: draft alt text for images and slide
        // pictures, timed transcripts for recorded audio and video. The
        // extension sends about a minute of audio per call, several in
        // parallel, so the timeout covers one chunk rather than a lecture.
        id: 'MediaAccess',
        directory: 'services/media-access',
        timeout: 120,
        memory: 512,
        policies: [bedrockInvoke, { actions: ['transcribe:StartStreamTranscription'], resources: ['*'] }],
      },
    ];

    for (const spec of specs) {
      const logs = new LogGroup(this, `${spec.id}Logs`, {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });

      const handler = new LambdaFunction(this, `${spec.id}Handler`, {
        code: Code.fromAsset(join(repoRoot, spec.directory, 'dist')),
        handler: 'index.handler',
        runtime: Runtime.NODEJS_22_X,
        timeout: Duration.seconds(spec.timeout),
        memorySize: spec.memory,
        logGroup: logs,
        environment: spec.environment ?? {},
      });

      for (const policy of spec.policies) {
        handler.addToRolePolicy(new PolicyStatement({ effect: Effect.ALLOW, ...policy }));
      }

      const url = handler.addFunctionUrl({
        // NONE, for the same narrow reason as the orb: the caller is a content
        // script on an arbitrary page, so there is no origin to authorise and
        // no user identity to check. These endpoints store nothing and hold no
        // caller credentials, so the exposure is service spend rather than
        // data. Acceptable for a temporary event account, and NOT acceptable
        // for anything that outlives it.
        authType: FunctionUrlAuthType.NONE,
        cors: {
          allowedOrigins: ['*'],
          allowedMethods: [HttpMethod.POST],
          allowedHeaders: ['content-type'],
        },
      });

      new CfnOutput(this, `${spec.id}Url`, {
        value: url.url,
        description: `Endpoint for the ${spec.id} service`,
      });
    }
  }
}
