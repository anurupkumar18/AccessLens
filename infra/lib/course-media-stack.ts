/**
 * Course materials: a professor uploads anything, students get it with alt
 * text and captions, and nobody reviews or clicks anything in between.
 *
 *   upload (presigned PUT) -> S3 uploads/ -> Worker (container Lambda)
 *     documents/images -> Bedrock alt text -> manifest -> ready
 *     audio/video      -> ffmpeg -> Transcribe job -> EventBridge -> Finish -> ready
 *
 * The worker needs LibreOffice and ffmpeg, so it is a container image. The
 * image is built by CodeBuild inside the account during `cdk deploy` rather
 * than by a local Docker daemon: whoever deploys -- a laptop without Docker,
 * or CI -- runs the same single command.
 */
import { CfnOutput, CustomResource, Duration, RemovalPolicy, Size, Stack, type StackProps } from 'aws-cdk-lib';
import { BuildSpec, ComputeType, LinuxBuildImage, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaTarget } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Code, DockerImageCode, DockerImageFunction, Function as LambdaFunction, FunctionUrlAuthType, HttpMethod, Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption, EventType, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Provider } from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const service = join(repoRoot, 'services/course-media');

/** Matches RETENTION_DAYS in services/course-media/src/store.ts. */
const RETENTION_DAYS = 90;

const bedrockInvoke = (account: string) => new PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  // Cross-region inference profiles route by capacity, so the model must be
  // allowed in every region (see accessibility-services-stack.ts).
  resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:*:${account}:inference-profile/*`],
});

export class CourseMediaStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const bucket = new Bucket(this, 'Materials', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Uploads go straight from the extension to S3 with a presigned PUT, and
      // students' video and caption tracks load cross-origin from it.
      cors: [{
        allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.HEAD],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        exposedHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
        maxAge: 3600,
      }],
      lifecycleRules: [{ expiration: Duration.days(RETENTION_DAYS) }, { abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const table = new Table(this, 'Items', {
      partitionKey: { name: 'classCode', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const environment = { COURSE_MEDIA_TABLE: table.tableName, COURSE_MEDIA_BUCKET: bucket.bucketName };
    const logs = (name: string) => new LogGroup(this, `${name}Logs`, { retention: RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY });

    // ---- Worker image, built in the account ---------------------------------
    const repository = new Repository(this, 'WorkerImages', { removalPolicy: RemovalPolicy.DESTROY, emptyOnDelete: true });
    // The Dockerfile plus the bundled worker (`npm run build` in the service).
    // Its hash is the image tag, so any change to either rebuilds the image.
    const source = new Asset(this, 'WorkerSource', { path: join(service, 'worker') });

    const build = new Project(this, 'WorkerImageBuild', {
      source: Source.s3({ bucket: source.bucket, path: source.s3ObjectKey }),
      environment: { buildImage: LinuxBuildImage.STANDARD_7_0, privileged: true, computeType: ComputeType.LARGE },
      environmentVariables: { REPOSITORY_URI: { value: repository.repositoryUri } },
      timeout: Duration.minutes(40),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${REPOSITORY_URI%%/*}',
              'docker build -t $REPOSITORY_URI:$IMAGE_TAG .',
              'docker push $REPOSITORY_URI:$IMAGE_TAG',
            ],
          },
        },
      }),
    });
    repository.grantPullPush(build);
    source.grantRead(build);

    // One inline module, two functions: onEvent starts the build and
    // isComplete polls it. They must be separate Lambdas with separate
    // handlers -- pointing both at `index.handler` makes every poll start
    // another build, which is how the first deploy failed.
    const buildHandlers = Code.fromInline(`
const { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } = require('@aws-sdk/client-codebuild');
const codebuild = new CodeBuildClient({});
exports.handler = async (event) => {
  if (event.RequestType === 'Delete') return { PhysicalResourceId: event.PhysicalResourceId };
  const tag = event.ResourceProperties.ImageTag;
  const out = await codebuild.send(new StartBuildCommand({
    projectName: event.ResourceProperties.ProjectName,
    environmentVariablesOverride: [{ name: 'IMAGE_TAG', value: tag, type: 'PLAINTEXT' }],
  }));
  return { PhysicalResourceId: tag, Data: { BuildId: out.build.id } };
};
exports.isComplete = async (event) => {
  if (event.RequestType === 'Delete') return { IsComplete: true };
  const out = await codebuild.send(new BatchGetBuildsCommand({ ids: [event.Data.BuildId] }));
  const build = out.builds && out.builds[0];
  const status = build && build.buildStatus;
  if (status === 'SUCCEEDED') return { IsComplete: true };
  if (status === 'IN_PROGRESS') return { IsComplete: false };
  throw new Error('Worker image build ' + status + ': ' + (build && build.logs && build.logs.deepLink));
};`);
    const buildStarter = new LambdaFunction(this, 'StartImageBuild', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      code: buildHandlers,
    });
    const buildChecker = new LambdaFunction(this, 'CheckImageBuild', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.isComplete',
      timeout: Duration.minutes(1),
      code: buildHandlers,
    });
    buildStarter.addToRolePolicy(new PolicyStatement({ actions: ['codebuild:StartBuild'], resources: [build.projectArn] }));
    buildChecker.addToRolePolicy(new PolicyStatement({ actions: ['codebuild:BatchGetBuilds'], resources: [build.projectArn] }));

    const provider = new Provider(this, 'ImageBuildProvider', {
      onEventHandler: buildStarter,
      isCompleteHandler: buildChecker,
      queryInterval: Duration.seconds(30),
      totalTimeout: Duration.minutes(45),
    });
    const image = new CustomResource(this, 'WorkerImage', {
      serviceToken: provider.serviceToken,
      properties: { ProjectName: build.projectName, ImageTag: source.assetHash },
    });

    const worker = new DockerImageFunction(this, 'Worker', {
      code: DockerImageCode.fromEcr(repository, { tagOrDigest: source.assetHash }),
      memorySize: 3008,
      ephemeralStorageSize: Size.gibibytes(10),
      timeout: Duration.minutes(15),
      logGroup: logs('Worker'),
      environment,
    });
    worker.node.addDependency(image);
    bucket.grantReadWrite(worker);
    table.grantReadWriteData(worker);
    worker.addToRolePolicy(bedrockInvoke(this.account));
    worker.addToRolePolicy(new PolicyStatement({ actions: ['transcribe:StartTranscriptionJob'], resources: ['*'] }));
    bucket.addEventNotification(EventType.OBJECT_CREATED, new LambdaDestination(worker), { prefix: 'uploads/' });

    // ---- Transcription finisher --------------------------------------------
    const finish = new LambdaFunction(this, 'FinishCaptions', {
      code: Code.fromAsset(join(service, 'dist/finish')),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(2),
      memorySize: 512,
      logGroup: logs('FinishCaptions'),
      environment,
    });
    bucket.grantReadWrite(finish);
    table.grantReadWriteData(finish);
    finish.addToRolePolicy(new PolicyStatement({ actions: ['transcribe:GetTranscriptionJob'], resources: ['*'] }));
    new Rule(this, 'TranscriptionFinished', {
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Job State Change'],
        detail: { TranscriptionJobStatus: ['COMPLETED', 'FAILED'], TranscriptionJobName: [{ prefix: 'accesslens-' }] },
      },
      targets: [new LambdaTarget(finish)],
    });

    // ---- API ------------------------------------------------------------------
    const api = new LambdaFunction(this, 'Api', {
      code: Code.fromAsset(join(service, 'dist/api')),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      logGroup: logs('Api'),
      environment,
    });
    bucket.grantReadWrite(api);
    bucket.grantDelete(api);
    table.grantReadWriteData(api);
    const url = api.addFunctionUrl({
      // Same posture as the other extension-facing services: the caller is an
      // extension with no identity to check. Uploads need the class's
      // instructor key; reading a class needs its code.
      authType: FunctionUrlAuthType.NONE,
      cors: { allowedOrigins: ['*'], allowedMethods: [HttpMethod.POST], allowedHeaders: ['content-type'] },
    });

    new CfnOutput(this, 'CourseMediaUrl', { value: url.url, description: 'VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT' });
  }
}
