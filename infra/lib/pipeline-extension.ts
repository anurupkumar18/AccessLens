import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { authoringStateMachine } from '../../services/publish/workflow';

export interface PipelineExtensionProps {
  root: string;
  decks: s3.Bucket;
  packs: s3.Bucket;
  catalog: s3.Bucket;
  jobs: dynamodb.Table;
  publicBaseUrl: string;
  /** The course-library retrieval Lambda (spec section 9.4); the workflow calls it before each Sonnet stage. */
  retrieve?: lambda.IFunction;
}

/**
 * The only two models this account may invoke (hard rule 12). Sonnet is
 * reached through the us.* cross-region inference profile, which Bedrock
 * resolves to a foundation model in one of the US regions, so the grant
 * names the profile and the model in every region the profile may route to.
 */
const SONNET_RESOURCES = (stack: Stack) => [
  `arn:aws:bedrock:${stack.region}:${stack.account}:inference-profile/us.anthropic.claude-sonnet-4-6`,
  'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*',
];

/**
 * Stage 1 to stage 4 plus the review wait (spec section 8), as one Step
 * Functions Standard workflow over the Lambdas below. The definition itself
 * is services/publish/workflow.ts; this construct only provides the ARNs and
 * the least privilege each stage needs. Visualization stages (5 to 8) are
 * not deployed yet, so the definition takes its spine-only shape and every
 * slide is a clean no-visual.
 */
export class PipelineExtensionPoints extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: PipelineExtensionProps) {
    super(scope, id);
    const stack = Stack.of(this);

    // Stage 1. A container because it carries LibreOffice and Poppler; built
    // for x86_64 whatever the deploying machine is (see the Dockerfile).
    const ingest = new lambda.DockerImageFunction(this, 'IngestFunction', {
      code: lambda.DockerImageCode.fromImageAsset(props.root, {
        file: 'services/ingest/Dockerfile',
        platform: ecrAssets.Platform.LINUX_AMD64,
        exclude: ['node_modules', '.worktrees', '.claude', 'dist', 'cdk.out', 'infra/cdk.out', '.git', 'apps/viewer/dist'],
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 3008,
      timeout: Duration.minutes(10),
      ephemeralStorageSize: undefined,
      environment: { DECKS_BUCKET: props.decks.bucketName, PACKS_BUCKET: props.packs.bucketName },
    });
    this.destroy(ingest);
    props.decks.grantRead(ingest);
    props.packs.grantReadWrite(ingest, 'staging/*');

    const analyst = this.agentFunction('DeckAnalyst', 'services/pack-author/analyst.ts', props, stack);
    const packAuthor = this.agentFunction('PackAuthor', 'services/pack-author/index.ts', props, stack);

    // Stage 4. Polly is the only model-ish service this function may call.
    const audio = this.stageFunction('Audio', 'services/audio/index.ts', props);
    audio.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));

    const definition = authoringStateMachine({
      ingest: ingest.functionArn,
      analyst: analyst.functionArn,
      packAuthor: packAuthor.functionArn,
      audio: audio.functionArn,
      ...(props.retrieve ? { retrieve: props.retrieve.functionArn } : {}),
    });

    const logGroup = new logs.LogGroup(this, 'AuthoringLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.stateMachine = new sfn.StateMachine(this, 'Authoring', {
      stateMachineName: 'AccessLensAuthoring',
      definitionBody: sfn.DefinitionBody.fromString(JSON.stringify(definition)),
      timeout: Duration.hours(2),
      logs: { destination: logGroup, level: sfn.LogLevel.ERROR },
    });
    this.stateMachine.applyRemovalPolicy(RemovalPolicy.DESTROY);
    this.stateMachine.role.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // The definition drives the job record directly (dynamodb:updateItem and
    // getItem service integrations), so the machine's role needs the table.
    props.jobs.grantReadWriteData(this.stateMachine);
    for (const fn of [ingest, analyst, packAuthor, audio]) fn.grantInvoke(this.stateMachine);
    props.retrieve?.grantInvoke(this.stateMachine);
  }

  /** A Sonnet-calling stage: Bedrock on the two allowed models and nothing else beyond its bucket. */
  private agentFunction(id: string, entry: string, props: PipelineExtensionProps, stack: Stack): nodejs.NodejsFunction {
    const fn = this.stageFunction(id, entry, props, { VIZ_PROMPT_DIR: '/var/task/prompts' }, true);
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: SONNET_RESOURCES(stack),
    }));
    return fn;
  }

  private stageFunction(
    id: string,
    entry: string,
    props: PipelineExtensionProps,
    environment: Record<string, string> = {},
    withPrompts = false,
  ): nodejs.NodejsFunction {
    const fn = new nodejs.NodejsFunction(this, `${id}Function`, {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${props.root}/${entry}`,
      projectRoot: props.root,
      depsLockFilePath: `${props.root}/package-lock.json`,
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        PACKS_BUCKET: props.packs.bucketName,
        JOBS_TABLE: props.jobs.tableName,
        PUBLIC_BASE_URL: props.publicBaseUrl,
        ASSET_BASE_URL: props.publicBaseUrl,
        ...environment,
      },
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node22',
        // The agent prompts are files the stage reads at runtime
        // (docs/prompts/viz/<role>.md, hard rule 7). They ride along inside
        // the bundle rather than being inlined into TypeScript.
        commandHooks: withPrompts ? {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `mkdir -p ${outputDir}/prompts`,
            `cp ${inputDir}/docs/prompts/viz/*.md ${outputDir}/prompts/`,
          ],
        } : undefined,
      },
    });
    this.destroy(fn);
    props.packs.grantReadWrite(fn, 'staging/*');
    props.packs.grantRead(fn, 'staging/*');
    return fn;
  }

  private destroy(fn: lambda.Function): void {
    fn.applyRemovalPolicy(RemovalPolicy.DESTROY);
    fn.role?.applyRemovalPolicy(RemovalPolicy.DESTROY);
  }
}
