/**
 * Whisper on SageMaker: speech recognition for the instructor's live captions
 * and voice-driven region sync (`services/ai-gateway` route `/transcribe-chunk`).
 *
 * A separate stack from the live plane on purpose. A GPU endpoint bills by the
 * hour whether or not anyone is teaching, so it must be possible to create it
 * for a rehearsal or demo and destroy it afterwards without touching the relay:
 *
 *   npx cdk deploy -c withWhisper=true AccessLensWhisper    # about 10-15 minutes to InService
 *   npx cdk destroy -c withWhisper=true AccessLensWhisper   # stops the hourly charge
 *
 * The AI gateway refers to the endpoint by its fixed name and answers
 * `whisper-unavailable` while it does not exist, so neither stack depends on
 * the other being deployed.
 *
 * Audio arrives as short WAV clips, is transcribed in memory, and is not stored:
 * no data capture is configured on the endpoint, and the container logs only
 * its own operational lines (charter A2 decision,
 * `docs/work/decisions/2026-09-16-transcribe-live-captions.md`).
 */
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnEndpoint, CfnEndpointConfig, CfnModel } from 'aws-cdk-lib/aws-sagemaker';
import type { Construct } from 'constructs';

/** Fixed so the gateway's IAM policy and environment can name it without a cross-stack reference. */
export const WHISPER_ENDPOINT_NAME = 'accesslens-whisper';

/** Hugging Face inference DLC (transformers 4.51.3, PyTorch 2.6, CUDA 12.4), from AWS's published image list. */
const DLC_ACCOUNT = '763104351884';
const DLC_REPOSITORY = 'huggingface-pytorch-inference';
const DLC_TAG = '2.6.0-transformers4.51.3-gpu-py312-cu124-ubuntu22.04';

export class WhisperStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const role = new Role(this, 'WhisperExecutionRole', {
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      description: 'Pulls the Hugging Face inference image and writes endpoint logs and metrics',
    });
    role.addToPolicy(new PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));
    role.addToPolicy(new PolicyStatement({
      actions: ['ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage'],
      resources: [`arn:aws:ecr:${this.region}:${DLC_ACCOUNT}:repository/${DLC_REPOSITORY}`],
    }));
    role.addToPolicy(new PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/sagemaker/Endpoints/${WHISPER_ENDPOINT_NAME}*`],
    }));
    role.addToPolicy(new PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: { StringEquals: { 'cloudwatch:namespace': ['/aws/sagemaker/Endpoints', 'AWS/SageMaker'] } },
    }));

    const model = new CfnModel(this, 'WhisperModel', {
      executionRoleArn: role.roleArn,
      primaryContainer: {
        image: `${DLC_ACCOUNT}.dkr.ecr.${this.region}.amazonaws.com/${DLC_REPOSITORY}:${DLC_TAG}`,
        environment: {
          // Distilled large-v3 decoder: near large-v3 accuracy at several times its speed,
          // which is what a caption a few seconds behind speech needs.
          HF_MODEL_ID: 'openai/whisper-large-v3-turbo',
          HF_TASK: 'automatic-speech-recognition',
        },
      },
    });
    model.node.addDependency(role);

    const config = new CfnEndpointConfig(this, 'WhisperEndpointConfig', {
      productionVariants: [{
        variantName: 'whisper',
        modelName: model.attrModelName,
        initialInstanceCount: 1,
        // One NVIDIA A10G. The account allows two for endpoints.
        instanceType: 'ml.g5.xlarge',
        // The image is about 13 GB and the model downloads at startup.
        containerStartupHealthCheckTimeoutInSeconds: 1200,
      }],
    });

    const endpoint = new CfnEndpoint(this, 'WhisperEndpoint', {
      endpointName: WHISPER_ENDPOINT_NAME,
      endpointConfigName: config.attrEndpointConfigName,
    });

    // CloudFormation exposes no EndpointName attribute, only the ARN; the name is fixed anyway.
    const output = new CfnOutput(this, 'WhisperEndpointName', {
      value: WHISPER_ENDPOINT_NAME,
      description: 'SageMaker endpoint the AI gateway calls for /transcribe-chunk. Destroy this stack when not in use.',
    });
    output.node.addDependency(endpoint);
  }
}
