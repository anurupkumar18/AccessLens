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
import { PipelineExtensionPoints } from './pipeline-extension';
import { StateMachinesExtension } from './state-machines-extension';
import { TokenParameter } from './token-parameter';
import { VectorsExtension } from './vectors-extension';

const ROOT = process.cwd();
const API_HANDLER_BY_OPERATION: Record<string, string> = {
  getHealth: 'getHealth.ts',
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
  readonly profiles: dynamodb.Table;
  readonly documents: dynamodb.Table;
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
    this.profiles = this.table('Profiles', { partitionKey: { name: 'profileId', type: dynamodb.AttributeType.STRING } });
    this.documents = this.table('Documents', {
      partitionKey: { name: 'profileId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'docId', type: dynamodb.AttributeType.STRING },
    });

    const token = new TokenParameter(this, 'ApiToken');
    const viewerOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.viewer);
    const packsOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.packs);
    const artifactsOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.artifacts);
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: viewerOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        'packs/*': {
          origin: packsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        'media/*': {
          origin: packsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        'artifacts/*': {
          origin: artifactsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
      comment: 'AccessLens temporary viewer and published asset distribution',
    });
    this.distribution.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const viewerDeployment = new s3deploy.BucketDeployment(this, 'ViewerDeployment', {
      sources: [s3deploy.Source.asset(`${ROOT}/apps/viewer/dist`)],
      destinationBucket: this.viewer,
      prune: true,
      retainOnDelete: false,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
    viewerDeployment.node.defaultChild && (viewerDeployment.node.defaultChild as { applyRemovalPolicy?: (policy: RemovalPolicy) => void }).applyRemovalPolicy?.(RemovalPolicy.DESTROY);

    const authorizerFunction = this.nodeFunction('BearerAuthorizer', 'authorizer.ts', {
      TOKEN_PARAMETER_NAME: token.parameterName,
    });
    authorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [token.parameterArn],
    }));
    const authorizer = new apigatewayAuthorizers.HttpLambdaAuthorizer('BearerAuthorizer', authorizerFunction, {
      responseTypes: [apigatewayAuthorizers.HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: Duration.seconds(30),
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
    this.output('AssetBaseUrl', `https://${this.distribution.domainName}`);
    this.output('TokenParameterName', token.parameterName);
    this.output('BearerToken', token.token);
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
      default:
        return {};
    }
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
      default:
        // V2's not-implemented routes intentionally have no data-plane access.
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
