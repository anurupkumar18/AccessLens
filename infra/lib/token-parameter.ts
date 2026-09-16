import { ArnFormat, CustomResource, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/** Generates the deployment bearer token without putting a secret in CDK source. */
export class TokenParameter extends Construct {
  readonly parameterName: string;
  readonly parameterArn: string;
  readonly token: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const generator = new lambda.Function(this, 'Generator', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      code: lambda.Code.fromInline(`
        const crypto = require('node:crypto');
        const { SSMClient, PutParameterCommand, DeleteParameterCommand } = require('@aws-sdk/client-ssm');
        const https = require('node:https');
        const ssm = new SSMClient({});
        exports.handler = async (event) => {
          const send = (status, data) => new Promise((resolve, reject) => {
            const body = JSON.stringify({ Status: status, Reason: data.Reason || 'See CloudWatch logs', PhysicalResourceId: data.PhysicalResourceId || 'accesslens-api-token', StackId: event.StackId, RequestId: event.RequestId, LogicalResourceId: event.LogicalResourceId, Data: data.Data || {} });
            const request = https.request(event.ResponseURL, { method: 'PUT', headers: { 'content-type': '', 'content-length': Buffer.byteLength(body) } }, response => { response.on('data', () => {}); response.on('end', resolve); });
            request.on('error', reject); request.write(body); request.end();
          });
          const name = event.ResourceProperties.ParameterName;
          try {
            if (event.RequestType === 'Delete') {
              try {
                await ssm.send(new DeleteParameterCommand({ Name: name }));
              } catch (error) {
                // CloudFormation retries deletes; a missing parameter is already
                // in the desired state and must not strand the stack.
                if (error?.name !== 'ParameterNotFound') throw error;
              }
              await send('SUCCESS', { PhysicalResourceId: name });
              return;
            }
            const value = crypto.randomBytes(32).toString('base64url');
            await ssm.send(new PutParameterCommand({ Name: name, Type: 'SecureString', Value: value, Overwrite: true }));
            await send('SUCCESS', { PhysicalResourceId: name, Data: { ParameterName: name, Token: value } });
          } catch (error) {
            console.error('token_parameter_failure', error);
            await send('FAILED', { PhysicalResourceId: name, Reason: 'Parameter operation failed' });
          }
        };
      `),
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['ssm:PutParameter', 'ssm:DeleteParameter'],
          resources: [Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter/accesslens/authoring/api-token',
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          })],
        }),
      ],
    });

    const resource = new CustomResource(this, 'Resource', {
      resourceType: 'Custom::AccessLensApiToken',
      serviceToken: generator.functionArn,
      properties: { ParameterName: '/accesslens/authoring/api-token' },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.parameterName = resource.getAttString('ParameterName');
    this.parameterArn = Stack.of(this).formatArn({
      service: 'ssm',
      resource: 'parameter/accesslens/authoring/api-token',
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    this.token = resource.getAttString('Token');
  }
}
