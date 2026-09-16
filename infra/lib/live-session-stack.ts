/**
 * The AccessLens temporary live plane (A6, A7, A8).
 *
 * Mirrors the `AWS` subgraph in `SYSTEM_DESIGN.md` §5: an API Gateway WebSocket
 * API in front of Lambda, with DynamoDB holding temporary session and
 * connection state under a TTL, and CloudWatch receiving only what `log.ts`
 * allows through.
 *
 * Three choices worth stating, because each one is a place a default would have
 * been wrong:
 *
 *   - **`RemovalPolicy.DESTROY` and no point-in-time recovery.** Everything here
 *     is temporary by contract. A retained table full of session rows after the
 *     hackathon would be exactly the durable record the charter says this system
 *     does not keep.
 *   - **A one-week log retention.** Operational telemetry is for debugging a
 *     live demo, not for building a history of who taught what and when.
 *   - **A generated secret, not a parameter.** The capability-signing key is
 *     created in Secrets Manager and read by the Lambda at deploy time. It never
 *     appears in the template, in `cdk.out/`, or in a shell history.
 */
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This package is ESM, so `__dirname` does not exist.
const here = dirname(fileURLToPath(import.meta.url));
// The Lambda source lives in services/, a sibling of infra/, so CDK needs the
// repository root as the bundling project root rather than this package.
const repoRoot = join(here, '../..');

const CONNECTIONS_BY_SESSION_INDEX = 'connections-by-session';

export class LiveSessionStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const sessions = new Table(this, 'Sessions', {
      partitionKey: { name: 'sessionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const connections = new Table(this, 'Connections', {
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Broadcasting needs "every connection in this session". Without this index
    // that is a full table scan on every single event -- workable for a demo
    // with three clients, and quietly quadratic in a real classroom.
    connections.addGlobalSecondaryIndex({
      indexName: CONNECTIONS_BY_SESSION_INDEX,
      partitionKey: { name: 'sessionId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    const capabilitySecret = new Secret(this, 'CapabilitySecret', {
      description: 'HMAC key for AccessLens role capabilities',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // An explicit log group rather than `logRetention`, which is deprecated and
    // provisions an extra custom-resource Lambda purely to set retention -- more
    // moving parts, and more IAM, than a one-week retention is worth.
    const relayLogs = new LogGroup(this, 'RelayLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // `Code.fromAsset` over a pre-built bundle rather than `NodejsFunction`.
    // NodejsFunction bundles implicitly by shelling out to esbuild from the
    // project root, which here is the repository root -- where esbuild is not a
    // dependency and where adding one would mean editing Part 1's package.json.
    // Building in `services/live-session` (`npm run build`) keeps every tool
    // this part needs inside the directories this part owns, and makes the
    // artifact something you can inspect before it is deployed.
    const handler = new LambdaFunction(this, 'RelayHandler', {
      code: Code.fromAsset(join(repoRoot, 'services/live-session/dist')),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      logGroup: relayLogs,
      environment: {
        SESSIONS_TABLE: sessions.tableName,
        CONNECTIONS_TABLE: connections.tableName,
        CONNECTIONS_BY_SESSION_INDEX,
        // Resolved at deployment, so the value lives in Secrets Manager and in
        // the function's environment -- never in the source or the template.
        CAPABILITY_SECRET: SecretValue.secretsManager(capabilitySecret.secretArn).unsafeUnwrap(),
      },
    });

    sessions.grantReadWriteData(handler);
    connections.grantReadWriteData(handler);

    const api = new WebSocketApi(this, 'LiveSessionApi', {
      apiName: 'accesslens-live-session',
      description: 'AccessLens instructor-to-student semantic event relay',
      // The integration ids are spelled out rather than 'Connect'/'Default'
      // because the short forms collide: with this API's construct id,
      // `Default` makes the $default route's CfnIntegration and CfnRoute hash to
      // the same CloudFormation logical id (LiveSessionApidefaultRouteC9BCC36C)
      // and synthesis fails with "section 'Resources' already contains". CDK
      // logical ids are a truncated hash of the construct path, so collisions
      // are rare but real -- and the error names the id, never the two
      // constructs that produced it.
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', handler),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', handler),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('DefaultIntegration', handler),
      },
    });

    const stage = new WebSocketStage(this, 'DemoStage', {
      webSocketApi: api,
      stageName: 'demo',
      autoDeploy: true,
    });

    // Posting back to a connection is a separate permission from invoking the
    // API. Without it the relay validates everything correctly and delivers
    // nothing.
    api.grantManageConnections(handler);

    new CfnOutput(this, 'WebSocketUrl', {
      value: stage.url,
      description: 'VITE_ACCESSLENS_WS_URL for .env.local',
    });
    new CfnOutput(this, 'SessionsTableName', { value: sessions.tableName });
    new CfnOutput(this, 'ConnectionsTableName', { value: connections.tableName });
  }
}
