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
import { CorsHttpMethod, HttpApi, HttpMethod, WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { CfnGuardrail, CfnGuardrailVersion } from 'aws-cdk-lib/aws-bedrock';
import { Code, FunctionUrlAuthType, HttpMethod as LambdaHttpMethod, InvokeMode, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { WHISPER_ENDPOINT_NAME } from './whisper-stack.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This package is ESM, so `__dirname` does not exist.
const here = dirname(fileURLToPath(import.meta.url));

export interface LiveSessionStackProps extends StackProps {
  /** Public base URL of the published asset distribution (packs/<id>/<version>.json). */
  packBaseUrl?: string;
  /**
   * Bedrock Knowledge Base over the instructor's uploaded course files, when
   * the team's retrieval work provides one. The study chat then offers the
   * model a course search; without it the chat still answers from the lesson.
   */
  studyChatKnowledgeBaseId?: string;
}
// The Lambda source lives in services/, a sibling of infra/, so CDK needs the
// repository root as the bundling project root rather than this package.
const repoRoot = join(here, '../..');

const CONNECTIONS_BY_SESSION_INDEX = 'connections-by-session';

export class LiveSessionStack extends Stack {
  constructor(scope: Construct, id: string, props?: LiveSessionStackProps) {
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
        // Where published packs live, so a session may teach any pack the
        // authoring pipeline published and not only the one bundled here.
        ...(props?.packBaseUrl ? { PACK_BASE_URL: props.packBaseUrl } : {}),
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

    // ---- AI routes (services/ai-gateway) -------------------------------------
    //
    // A plain HTTPS API beside the relay, not more WebSocket routes: these are
    // request/response calls, and keeping them off the relay means a slow model
    // call can never delay a live slide event. The function verifies the same
    // HMAC role capability the relay issues, so it shares the relay's secret.
    const aiLogs = new LogGroup(this, 'AiLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const bedrockModelId = 'us.anthropic.claude-sonnet-4-6';
    const aiHandler = new LambdaFunction(this, 'AiHandler', {
      code: Code.fromAsset(join(repoRoot, 'services/ai-gateway/dist')),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      logGroup: aiLogs,
      environment: {
        CAPABILITY_SECRET: SecretValue.secretsManager(capabilitySecret.secretArn).unsafeUnwrap(),
        BEDROCK_MODEL_ID: bedrockModelId,
        // By name, not reference: the endpoint's stack is deployed only when wanted,
        // and the route answers whisper-unavailable while it does not exist.
        WHISPER_ENDPOINT_NAME,
      },
    });

    // Least privilege per route. Bedrock: the one model this account can invoke
    // (docs/AWS_ACCESS_VERIFICATION.md §3), through its cross-region inference
    // profile, which also needs the underlying foundation model in each region
    // the profile routes to. Polly and Transcribe streaming have no
    // resource-level ARNs for these actions.
    aiHandler.addToRolePolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/${bedrockModelId}`,
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*',
      ],
    }));
    aiHandler.addToRolePolicy(new PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
    aiHandler.addToRolePolicy(new PolicyStatement({ actions: ['transcribe:StartStreamTranscriptionWebSocket'], resources: ['*'] }));
    aiHandler.addToRolePolicy(new PolicyStatement({
      actions: ['sagemaker:InvokeEndpoint'],
      resources: [`arn:aws:sagemaker:${this.region}:${this.account}:endpoint/${WHISPER_ENDPOINT_NAME}`],
    }));

    const aiApi = new HttpApi(this, 'AiApi', {
      apiName: 'accesslens-ai',
      description: 'AccessLens grounded answers, reviewed-text speech, and caption stream authorization',
      // Extension pages call from a chrome-extension:// origin that differs per
      // install. Every route requires a signed capability in the body and no
      // cookie is ever involved, so a wildcard origin grants nothing by itself.
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.POST],
        allowHeaders: ['content-type'],
        maxAge: Duration.hours(1),
      },
    });
    const aiIntegration = new HttpLambdaIntegration('AiIntegration', aiHandler);
    for (const path of ['/ask', '/speak', '/transcribe-url', '/transcribe-chunk']) {
      aiApi.addRoutes({ path, methods: [HttpMethod.POST], integration: aiIntegration });
    }

    // ---- Study chat (services/ai-gateway/src/chatHandler.ts) ------------------
    //
    // Its own function behind a Function URL, because the reply streams and API
    // Gateway's HTTP API buffers. Claude through the Converse API, screened by a
    // Bedrock Guardrail on both the student's message and the reply.
    const chatGuardrail = new CfnGuardrail(this, 'StudyChatGuardrail', {
      name: 'accesslens-study-chat',
      description: 'Screens student study chat messages and the replies they get',
      blockedInputMessaging: "I can't help with that one. Let's keep the chat about your lesson: try asking about something on the slides.",
      blockedOutputsMessaging: "I can't give that reply. Try asking about the lesson another way.",
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'MISCONDUCT', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          // Lessons discuss violence (history, biology), so only the clearest cases.
          { type: 'VIOLENCE', inputStrength: 'LOW', outputStrength: 'LOW' },
          // Prompt attacks come in on messages and course passages, never out.
          { type: 'PROMPT_ATTACK', inputStrength: 'MEDIUM', outputStrength: 'NONE' },
        ],
      },
      topicPolicyConfig: {
        topicsConfig: [{
          name: 'Graded work answers',
          type: 'DENY',
          definition: 'Requests to be given the answers to a graded quiz, test, exam, or homework assignment so they can be submitted, or to have graded work written for the student. Practice questions and explanations are not this topic.',
          examples: [
            "Give me the answers to tonight's graded homework.",
            'Write my lab report so I can hand it in.',
            'What should I put for question 3 on the quiz I have to submit?',
          ],
        }],
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: 'EMAIL', action: 'ANONYMIZE' },
          { type: 'PHONE', action: 'ANONYMIZE' },
          { type: 'ADDRESS', action: 'ANONYMIZE' },
          { type: 'PASSWORD', action: 'BLOCK' },
          { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
        ],
      },
      wordPolicyConfig: { managedWordListsConfig: [{ type: 'PROFANITY' }] },
    });
    // A numbered version, so a later edit to the guardrail cannot change what a deployed chat enforces.
    const chatGuardrailVersion = new CfnGuardrailVersion(this, 'StudyChatGuardrailVersion', {
      guardrailIdentifier: chatGuardrail.attrGuardrailId,
      description: 'Study chat guardrail as deployed with the chat function',
    });

    const chatLogs = new LogGroup(this, 'StudyChatLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const knowledgeBaseId = props?.studyChatKnowledgeBaseId;
    const chatHandler = new LambdaFunction(this, 'StudyChatHandler', {
      code: Code.fromAsset(join(repoRoot, 'services/ai-gateway/dist')),
      handler: 'chat.handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(90),
      memorySize: 1024,
      logGroup: chatLogs,
      environment: {
        CAPABILITY_SECRET: SecretValue.secretsManager(capabilitySecret.secretArn).unsafeUnwrap(),
        BEDROCK_MODEL_ID: bedrockModelId,
        GUARDRAIL_ID: chatGuardrail.attrGuardrailId,
        GUARDRAIL_VERSION: chatGuardrailVersion.attrVersion,
        ...(knowledgeBaseId ? { KNOWLEDGE_BASE_ID: knowledgeBaseId } : {}),
        // Published, instructor-reviewed packs the chat can ground in, besides the bundled ones.
        ...(props?.packBaseUrl ? { PACK_BASE_URL: props.packBaseUrl } : {}),
      },
    });
    chatHandler.addToRolePolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/${bedrockModelId}`,
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*',
      ],
    }));
    chatHandler.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:ApplyGuardrail'], resources: [chatGuardrail.attrGuardrailArn] }));
    if (knowledgeBaseId) {
      chatHandler.addToRolePolicy(new PolicyStatement({
        actions: ['bedrock:Retrieve'],
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${knowledgeBaseId}`],
      }));
    }
    const chatUrl = chatHandler.addFunctionUrl({
      // Same reasoning as the AI API's CORS: every request carries a signed
      // capability that the function verifies, and no cookie is involved.
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.RESPONSE_STREAM,
      cors: { allowedOrigins: ['*'], allowedMethods: [LambdaHttpMethod.POST], allowedHeaders: ['content-type'], maxAge: Duration.hours(1) },
    });
    new CfnOutput(this, 'StudyChatUrl', {
      value: chatUrl.url,
      description: 'VITE_ACCESSLENS_CHAT_URL for .env.local',
    });
    new CfnOutput(this, 'StudyChatGuardrailId', { value: chatGuardrail.attrGuardrailId });

    new CfnOutput(this, 'AiApiUrl', {
      value: aiApi.apiEndpoint,
      description: 'VITE_ACCESSLENS_AI_URL for .env.local',
    });

    new CfnOutput(this, 'WebSocketUrl', {
      value: stage.url,
      description: 'VITE_ACCESSLENS_WS_URL for .env.local',
    });
    new CfnOutput(this, 'SessionsTableName', { value: sessions.tableName });
    new CfnOutput(this, 'ConnectionsTableName', { value: connections.tableName });
  }
}
