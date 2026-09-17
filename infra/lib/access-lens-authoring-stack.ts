import { Duration, CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { ROUTES, type RouteSpec } from '../../services/shared/api';
import { AgentsExtension } from './agents-extension';
import { HarnessExtension } from './harness-extension';
import { IngestExtension } from './ingest-extension';
import { LibraryExtension } from './library-extension';
import { PipelineExtensionPoints } from './pipeline-extension';
import { StateMachinesExtension } from './state-machines-extension';
import { VectorsExtension } from './vectors-extension';

const ROOT = process.cwd();

/**
 * Instructors sign in with Google (D12). API Gateway verifies each ID token
 * against Google's issuer; the audience is this deployment's own OAuth web
 * client plus the Google Cloud SDK's public client, so `gcloud auth
 * print-identity-token` works for scripts. Any verified Google account is an
 * instructor for now (D13); students never call this API.
 */
const GOOGLE_ISSUER = 'https://accounts.google.com';
const GCLOUD_CLIENT_ID = '32555940559.apps.googleusercontent.com';
/** Synth-only placeholder so `cdk destroy` and tests work without context; the deploy script needs the real one. */
const UNCONFIGURED_CLIENT_ID = 'unconfigured.apps.googleusercontent.com';
const API_HANDLER_BY_OPERATION: Record<string, string> = {
  getHealth: 'getHealth.ts',
  getMe: 'getMe.ts',
  createUpload: 'createUpload.ts',
  createJob: 'createJob.ts',
  getJob: 'getJob.ts',
  getJobDraft: 'getJobDraft.ts',
  reviewJob: 'reviewJob.ts',
  publishJob: 'publishJob.ts',
  listPackVersions: 'listPackVersions.ts',
  getPack: 'getPack.ts',
  getArtifactManifest: 'getArtifactManifest.ts',
  createProfile: 'createProfile.ts',
  getProfile: 'getProfile.ts',
  deleteProfile: 'deleteProfile.ts',
  registerDocument: 'registerDocument.ts',
  getDocument: 'getDocument.ts',
  deleteDocument: 'deleteDocument.ts',
  searchProfile: 'searchProfile.ts',
};

export class AccessLensAuthoringStack extends Stack {
  readonly decks: s3.Bucket;
  readonly catalog: s3.Bucket;
  readonly packs: s3.Bucket;
  readonly artifacts: s3.Bucket;
  readonly library: s3.Bucket;
  readonly viewer: s3.Bucket;
  readonly jobs: dynamodb.Table;
  readonly instructors: dynamodb.Table;
  readonly profiles: dynamodb.Table;
  readonly documents: dynamodb.Table;
  readonly libraryExtension: LibraryExtension;
  readonly distribution: cloudfront.Distribution;
  readonly api: apigateway.HttpApi;
  stateMachine!: sfn.StateMachine;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' }, ...props });

    this.decks = this.bucket('Decks', {
      lifecycleRules: [{ expiration: Duration.days(7) }],
      // The instructor's browser PUTs the deck straight to the presigned URL
      // (extension origin or a local dev tab), so the bucket must answer CORS.
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: ['*'], allowedHeaders: ['content-type'], maxAge: 300 }],
    });
    this.catalog = this.bucket('Catalog');
    this.packs = this.bucket('Packs');
    this.artifacts = this.bucket('Artifacts');
    this.library = this.bucket('Library');
    this.viewer = this.bucket('Viewer');

    this.jobs = this.table('Jobs', { partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING }, timeToLiveAttribute: 'expiresAt' });
    // An instructor's published packs are listed from their own jobs (`GET /v1/me`).
    this.jobs.addGlobalSecondaryIndex({
      indexName: 'ownerSub-index',
      partitionKey: { name: 'ownerSub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
    // Two roles (D13): students never reach this API; instructors get a record
    // on first sign-in and own course profiles, whose documents are indexed
    // for retrieval.
    this.instructors = this.table('Instructors', { partitionKey: { name: 'sub', type: dynamodb.AttributeType.STRING } });
    this.profiles = this.table('Profiles', { partitionKey: { name: 'profileId', type: dynamodb.AttributeType.STRING } });
    this.profiles.addGlobalSecondaryIndex({
      indexName: 'ownerSub-index',
      partitionKey: { name: 'ownerSub', type: dynamodb.AttributeType.STRING },
    });
    this.documents = this.table('LibraryDocuments', { partitionKey: { name: 'docId', type: dynamodb.AttributeType.STRING } });
    this.documents.addGlobalSecondaryIndex({
      indexName: 'profileId-index',
      partitionKey: { name: 'profileId', type: dynamodb.AttributeType.STRING },
    });
    this.libraryExtension = new LibraryExtension(this, 'CourseLibrary', { root: ROOT, library: this.library, documents: this.documents });

    const viewerOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.viewer);
    const packsOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.packs);
    const artifactsOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.artifacts);
    // The hosted shell lives under /app/ on the same distribution as the viewer
    // and the published packs, so it is same-origin with everything it loads.
    const appIndex = new cloudfront.Function(this, 'AppIndexRewrite', {
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri === '/app' || r.uri === '/app/') { r.uri = '/app/index.html'; } return r; }",
      ),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: viewerOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: appIndex, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        'packs/*': {
          origin: packsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          // Published packs, media, and artifacts are public reads fetched
          // cross-origin by the extension dev server and the viewer host.
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        },
        'media/*': {
          origin: packsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          // Published packs, media, and artifacts are public reads fetched
          // cross-origin by the extension dev server and the viewer host.
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        },
        'artifacts/*': {
          origin: artifactsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          // Published packs, media, and artifacts are public reads fetched
          // cross-origin by the extension dev server and the viewer host.
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        },
      },
      comment: 'AccessLens temporary viewer and published asset distribution',
    });
    this.distribution.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const viewerDeployment = new s3deploy.BucketDeployment(this, 'ViewerDeployment', {
      sources: [s3deploy.Source.asset(`${ROOT}/apps/viewer/dist`)],
      destinationBucket: this.viewer,
      prune: true,
      // The shell under app/ is its own deployment; the viewer's prune must not remove it.
      exclude: ['app/*'],
      retainOnDelete: false,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
    viewerDeployment.node.defaultChild && (viewerDeployment.node.defaultChild as { applyRemovalPolicy?: (policy: RemovalPolicy) => void }).applyRemovalPolicy?.(RemovalPolicy.DESTROY);

    // The instructor and student shell, built by infra/scripts/deploy.sh with
    // `--base /app/` from the same source as the extension.
    const appDeployment = new s3deploy.BucketDeployment(this, 'AppDeployment', {
      sources: [s3deploy.Source.asset(`${ROOT}/dist-web`)],
      destinationBucket: this.viewer,
      destinationKeyPrefix: 'app',
      prune: true,
      retainOnDelete: false,
      distribution: this.distribution,
      distributionPaths: ['/app/*'],
    });
    appDeployment.node.defaultChild && (appDeployment.node.defaultChild as { applyRemovalPolicy?: (policy: RemovalPolicy) => void }).applyRemovalPolicy?.(RemovalPolicy.DESTROY);

    const googleClientId = (this.node.tryGetContext('googleClientId') as string | undefined) || UNCONFIGURED_CLIENT_ID;
    const authorizer = new apigatewayAuthorizers.HttpJwtAuthorizer('GoogleSignIn', GOOGLE_ISSUER, {
      jwtAudience: [googleClientId, GCLOUD_CLIENT_ID],
      identitySource: ['$request.header.Authorization'],
    });

    this.api = new apigateway.HttpApi(this, 'HttpApi', {
      apiName: 'AccessLensAuthoring',
      createDefaultStage: true,
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [apigateway.CorsHttpMethod.GET, apigateway.CorsHttpMethod.POST, apigateway.CorsHttpMethod.DELETE, apigateway.CorsHttpMethod.OPTIONS],
        maxAge: Duration.minutes(5),
      },
    });
    this.api.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const pipeline = new PipelineExtensionPoints(this, 'Pipeline', {
      root: ROOT,
      decks: this.decks,
      packs: this.packs,
      catalog: this.catalog,
      jobs: this.jobs,
      publicBaseUrl: `https://${this.distribution.domainName}`,
      retrieve: this.libraryExtension.retrieve,
    });
    this.stateMachine = pipeline.stateMachine;

    for (const route of ROUTES) {
      const handlerFile = API_HANDLER_BY_OPERATION[route.operationId];
      if (!handlerFile) throw new Error(`No Lambda handler mapped for ${route.operationId}`);
      const handler = this.nodeFunction(route.operationId, handlerFile, this.environmentFor(route));
      this.applyLeastPrivilege(route, handler);
      const integration = new integrations.HttpLambdaIntegration(`${route.operationId}Integration`, handler);
      this.api.addRoutes({
        path: route.path,
        methods: [httpMethod(route)],
        integration,
        authorizer,
      });
    }

    new IngestExtension(this, 'IngestExtension');
    new AgentsExtension(this, 'AgentsExtension');
    new HarnessExtension(this, 'HarnessExtension');
    new StateMachinesExtension(this, 'StateMachinesExtension');
    new VectorsExtension(this, 'VectorsExtension');

    this.output('StateMachineArn', this.stateMachine.stateMachineArn);
    this.output('ApiUrl', this.api.url ?? '');
    this.output('ViewerUrl', `https://${this.distribution.domainName}`);
    this.output('AppUrl', `https://${this.distribution.domainName}/app/`);
    this.output('AssetBaseUrl', `https://${this.distribution.domainName}`);
    this.output('GoogleClientId', googleClientId);
    this.output('VectorBucketName', this.libraryExtension.vectorBucketName);
    this.output('DecksBucketName', this.decks.bucketName);
    this.output('CatalogBucketName', this.catalog.bucketName);
    this.output('PacksBucketName', this.packs.bucketName);
    this.output('ArtifactsBucketName', this.artifacts.bucketName);
    this.output('LibraryBucketName', this.library.bucketName);
    this.output('ViewerBucketName', this.viewer.bucketName);
  }

  private bucket(id: string, props: Pick<s3.BucketProps, 'lifecycleRules' | 'cors'> = {}): s3.Bucket {
    const bucket = new s3.Bucket(this, id, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      ...props,
    });
    bucket.applyRemovalPolicy(RemovalPolicy.DESTROY);
    return bucket;
  }

  private table(id: string, props: dynamodb.TableProps): dynamodb.Table {
    const table = new dynamodb.Table(this, id, {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      ...props,
    });
    table.applyRemovalPolicy(RemovalPolicy.DESTROY);
    return table;
  }

  private nodeFunction(id: string, file: string, environment: Record<string, string> = {}): nodejs.NodejsFunction {
    const fn = new nodejs.NodejsFunction(this, `${id}Function`, {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${ROOT}/services/api/${file}`,
      handler: 'handler',
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment,
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node22',
      },
    });
    fn.applyRemovalPolicy(RemovalPolicy.DESTROY);
    fn.role?.applyRemovalPolicy(RemovalPolicy.DESTROY);
    return fn;
  }

  private environmentFor(route: RouteSpec): Record<string, string> {
    switch (route.operationId) {
      case 'createUpload':
        return { DECKS_BUCKET: this.decks.bucketName };
      case 'createJob':
        return {
          JOBS_TABLE: this.jobs.tableName,
          PACKS_BUCKET: this.packs.bucketName,
          DECKS_BUCKET: this.decks.bucketName,
          CATALOG_BUCKET: this.catalog.bucketName,
          STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
          ASSET_BASE_URL: `https://${this.distribution.domainName}`,
        };
      case 'getJob':
        return { JOBS_TABLE: this.jobs.tableName };
      case 'getJobDraft':
      case 'reviewJob':
      case 'publishJob':
        return {
          JOBS_TABLE: this.jobs.tableName,
          PACKS_BUCKET: this.packs.bucketName,
          ARTIFACTS_BUCKET: this.artifacts.bucketName,
          ASSET_BASE_URL: `https://${this.distribution.domainName}`,
          PUBLIC_BASE_URL: `https://${this.distribution.domainName}`,
        };
      case 'listPackVersions':
        return { PACKS_BUCKET: this.packs.bucketName, ASSET_BASE_URL: `https://${this.distribution.domainName}` };
      case 'getPack':
        return { PACKS_BUCKET: this.packs.bucketName };
      case 'getArtifactManifest':
        return { ARTIFACTS_BUCKET: this.artifacts.bucketName };
      case 'getMe':
        return { INSTRUCTORS_TABLE: this.instructors.tableName, JOBS_TABLE: this.jobs.tableName, ASSET_BASE_URL: `https://${this.distribution.domainName}`, ...this.libraryEnvironment() };
      case 'createProfile':
      case 'getProfile':
      case 'deleteProfile':
      case 'registerDocument':
      case 'getDocument':
      case 'deleteDocument':
      case 'searchProfile':
        return this.libraryEnvironment();
      default:
        return {};
    }
  }

  private libraryEnvironment(): Record<string, string> {
    return {
      LIBRARY_BUCKET: this.library.bucketName,
      VECTOR_BUCKET: this.libraryExtension.vectorBucketName,
      PROFILES_TABLE: this.profiles.tableName,
      DOCUMENTS_TABLE: this.documents.tableName,
      DECKS_BUCKET: this.decks.bucketName,
      INDEXER_FUNCTION_NAME: this.libraryExtension.indexer.functionName,
    };
  }

  private applyLeastPrivilege(route: RouteSpec, fn: lambda.Function): void {
    switch (route.operationId) {
      case 'createUpload':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [this.decks.arnForObjects('*')] }));
        break;
      case 'createJob':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:PutItem'], resources: [this.jobs.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [this.decks.bucketArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:StartExecution'], resources: [this.stateMachine.stateMachineArn] }));
        break;
      case 'getJobDraft':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [this.jobs.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject', 's3:ListBucket'], resources: [this.packs.arnForObjects('staging/*'), this.packs.bucketArn] }));
        break;
      case 'reviewJob':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'], resources: [this.jobs.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'], resources: [this.packs.arnForObjects('staging/*'), this.packs.bucketArn] }));
        break;
      case 'publishJob':
        // The one principal that may write outside staging/. It does so only
        // after publishPack has checked every asset's review decision (hard
        // rule 2), and only under the three published prefixes.
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'], resources: [this.jobs.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject', 's3:ListBucket'], resources: [this.packs.arnForObjects('*'), this.packs.bucketArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['s3:PutObject'],
          resources: [this.packs.arnForObjects('packs/*'), this.packs.arnForObjects('media/*'), this.packs.arnForObjects('artifacts/*')],
        }));
        // Edited descriptions are re-spoken at publish time with the pipeline's voice.
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
        break;
      case 'getJob':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [this.jobs.tableArn] }));
        break;
      case 'listPackVersions':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [this.packs.bucketArn] }));
        break;
      case 'getPack':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [this.packs.arnForObjects('*')] }));
        break;
      case 'getArtifactManifest':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [this.artifacts.arnForObjects('*')] }));
        break;
      // The course library (spec section 9, D13). Profiles and documents are
      // the instructor's own; the search route is the one reader of vectors
      // besides the pipeline's retrieval Lambda.
      case 'getMe':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'], resources: [this.instructors.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${this.profiles.tableArn}/index/ownerSub-index`, `${this.jobs.tableArn}/index/ownerSub-index`] }));
        break;
      case 'createProfile':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:PutItem'], resources: [this.profiles.tableArn] }));
        this.libraryExtension.grantVectors(fn, ['s3vectors:CreateIndex', 's3vectors:GetIndex']);
        break;
      case 'getProfile':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [this.profiles.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${this.documents.tableArn}/index/profileId-index`] }));
        break;
      case 'deleteProfile':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'], resources: [this.profiles.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'], resources: [this.documents.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${this.documents.tableArn}/index/profileId-index`] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [this.library.bucketArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:DeleteObject'], resources: [this.library.arnForObjects('library/*')] }));
        this.libraryExtension.grantVectors(fn, ['s3vectors:DeleteIndex', 's3vectors:DeleteVectors']);
        break;
      case 'registerDocument':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [this.profiles.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:PutItem'], resources: [this.documents.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [this.decks.bucketArn, this.library.bucketArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [this.decks.arnForObjects('uploads/*')] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject', 's3:DeleteObject'], resources: [this.library.arnForObjects('library/*')] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [this.libraryExtension.indexer.functionArn] }));
        this.libraryExtension.grantVectors(fn, ['s3vectors:DeleteVectors']);
        break;
      case 'getDocument':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [this.profiles.tableArn, this.documents.tableArn] }));
        break;
      case 'deleteDocument':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [this.profiles.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'], resources: [this.documents.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [this.library.bucketArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:DeleteObject'], resources: [this.library.arnForObjects('library/*')] }));
        this.libraryExtension.grantVectors(fn, ['s3vectors:DeleteVectors']);
        break;
      case 'searchProfile':
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [this.profiles.tableArn] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [this.library.arnForObjects('library/*')] }));
        this.libraryExtension.grantVectors(fn, ['s3vectors:QueryVectors', 's3vectors:GetVectors', 's3vectors:GetIndex']);
        this.libraryExtension.grantTitan(fn, this);
        break;
      default:
        break;
    }
  }

  private output(name: string, value: string): void {
    new CfnOutput(this, name, { value, description: `AccessLens ${name}` });
  }
}

function httpMethod(route: RouteSpec): apigateway.HttpMethod {
  switch (route.method) {
    case 'GET': return apigateway.HttpMethod.GET;
    case 'POST': return apigateway.HttpMethod.POST;
    case 'DELETE': return apigateway.HttpMethod.DELETE;
  }
}
