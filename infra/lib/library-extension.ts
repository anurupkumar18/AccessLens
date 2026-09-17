import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import { Construct } from 'constructs';

export interface LibraryExtensionProps {
  root: string;
  library: s3.Bucket;
  documents: dynamodb.Table;
  facts: dynamodb.Table;
  courseAssistantEnabled: boolean;
}

/** The one embedding model this account may call (hard rule 12), from Lambda only. */
export const TITAN_EMBED_RESOURCES = (stack: Stack) => [
  `arn:aws:bedrock:${stack.region}::foundation-model/amazon.titan-embed-text-v2:0`,
];

/**
 * The course library (spec section 9): one S3 Vectors bucket with an index
 * per profile, the indexing Lambda (in the ingest container, which carries
 * LibreOffice and Poppler) and the retrieval Lambda the authoring workflow
 * calls before each Sonnet stage. Route Lambdas get their grants from the
 * stack; this construct owns the two workers and the vector bucket.
 */
export class LibraryExtension extends Construct {
  readonly vectorBucket: s3vectors.CfnVectorBucket;
  readonly vectorBucketName: string;
  readonly indexer: lambda.DockerImageFunction;
  readonly retrieve: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: LibraryExtensionProps) {
    super(scope, id);
    const stack = Stack.of(this);

    // CloudFormation now has a native vector bucket resource, so no custom
    // resource is needed for it. Indexes are created per profile at runtime
    // by the createProfile route and removed by deleteProfile; destroy.sh
    // deletes any that remain before the stack delete.
    this.vectorBucketName = `accesslens-library-${stack.account}`;
    this.vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', { vectorBucketName: this.vectorBucketName });
    this.vectorBucket.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const environment = {
      LIBRARY_BUCKET: props.library.bucketName,
      VECTOR_BUCKET: this.vectorBucketName,
      DOCUMENTS_TABLE: props.documents.tableName,
      FACTS_TABLE: props.facts.tableName,
      COURSE_ASSISTANT_ENABLED: props.courseAssistantEnabled ? 'true' : 'false',
    };

    this.indexer = new lambda.DockerImageFunction(this, 'IndexerFunction', {
      code: lambda.DockerImageCode.fromImageAsset(props.root, {
        file: 'services/ingest/Dockerfile',
        platform: ecrAssets.Platform.LINUX_AMD64,
        exclude: ['node_modules', '.worktrees', '.claude', 'dist', 'cdk.out', 'infra/cdk.out', '.git', 'apps/viewer/dist'],
        cmd: ['library.handler'],
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 3008,
      timeout: Duration.minutes(15),
      environment,
    });
    this.destroy(this.indexer);
    props.library.grantReadWrite(this.indexer, 'library/*');
    props.library.grantRead(this.indexer);
    props.documents.grantReadWriteData(this.indexer);
    props.facts.grantReadWriteData(this.indexer);
    this.grantVectors(this.indexer, ['s3vectors:PutVectors', 's3vectors:QueryVectors', 's3vectors:GetVectors', 's3vectors:GetIndex', 's3vectors:CreateIndex']);
    this.grantTitan(this.indexer, stack);

    this.retrieve = new nodejs.NodejsFunction(this, 'RetrieveFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${props.root}/services/library/src/retrieveHandler.ts`,
      projectRoot: props.root,
      depsLockFilePath: `${props.root}/package-lock.json`,
      handler: 'handler',
      timeout: Duration.minutes(2),
      memorySize: 1024,
      environment,
      bundling: { minify: true, sourceMap: false, target: 'node22' },
    });
    this.destroy(this.retrieve);
    props.library.grantRead(this.retrieve, 'library/*');
    props.library.grantRead(this.retrieve);
    this.grantVectors(this.retrieve, ['s3vectors:QueryVectors', 's3vectors:GetVectors', 's3vectors:GetIndex']);
    this.grantTitan(this.retrieve, stack);
  }

  /** The vector bucket and every index in it. */
  vectorResources(): string[] {
    return [this.vectorBucket.attrVectorBucketArn, `${this.vectorBucket.attrVectorBucketArn}/index/*`];
  }

  grantVectors(fn: lambda.Function, actions: string[]): void {
    fn.addToRolePolicy(new iam.PolicyStatement({ actions, resources: this.vectorResources() }));
  }

  grantTitan(fn: lambda.Function, stack: Stack): void {
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: TITAN_EMBED_RESOURCES(stack) }));
  }

  private destroy(fn: lambda.Function): void {
    fn.applyRemovalPolicy(RemovalPolicy.DESTROY);
    fn.role?.applyRemovalPolicy(RemovalPolicy.DESTROY);
  }
}
