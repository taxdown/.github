import * as path from 'path';
import { Construct } from 'constructs';
import {
  Stack,
  StackProps,
  CfnOutput,
  Duration,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNodejs,
  aws_ssm as ssm,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { DeployEnv } from '../config/environments.js';

export interface AgenticCodeownersStackProps extends StackProps {
  deployEnv: DeployEnv;
}

export class AgenticCodeownersStack extends Stack {
  constructor(scope: Construct, id: string, props: AgenticCodeownersStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;

    // Secrets stored in SSM Parameter Store.
    // Create these before deploying:
    //   aws ssm put-parameter --name /agentic-codeowners/<env>/webhook-secret --type SecureString --value <value>
    //   aws ssm put-parameter --name /agentic-codeowners/<env>/app-id --type String --value <value>
    //   aws ssm put-parameter --name /agentic-codeowners/<env>/app-private-key --type SecureString --value <value>
    //   aws ssm put-parameter --name /agentic-codeowners/<env>/anthropic-api-key --type SecureString --value <value>
    const webhookSecret = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, 'WebhookSecret', { parameterName: `/agentic-codeowners/${deployEnv}/webhook-secret` },
    ).stringValue;

    const appId = ssm.StringParameter.fromStringParameterName(
      this, 'AppId', `/agentic-codeowners/${deployEnv}/app-id`,
    ).stringValue;

    const appPrivateKey = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, 'AppPrivateKey', { parameterName: `/agentic-codeowners/${deployEnv}/app-private-key` },
    ).stringValue;

    const anthropicApiKey = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, 'AnthropicApiKey', { parameterName: `/agentic-codeowners/${deployEnv}/anthropic-api-key` },
    ).stringValue;

    const webhookHandler = new lambdaNodejs.NodejsFunction(this, 'WebhookHandler', {
      entry: path.join(__dirname, '../../src/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      // Long timeout: the handler returns 202 immediately but Lambda must stay
      // alive long enough to complete the async assessPR() processing.
      // TODO: replace with SQS + separate processor Lambda for reliability.
      timeout: Duration.minutes(3),
      memorySize: 256,
      bundling: {
        minify: true,
        sourceMap: false,
        // External modules provided by the Lambda runtime
        externalModules: [],
      },
      environment: {
        DEPLOY_ENV: deployEnv,
        WEBHOOK_SECRET: webhookSecret,
        APP_ID: appId,
        APP_PRIVATE_KEY: appPrivateKey,
        ANTHROPIC_API_KEY: anthropicApiKey,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Lambda Function URL — public HTTPS endpoint.
    // Authentication is handled by HMAC signature verification inside the handler.
    const fnUrl = webhookHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new CfnOutput(this, 'WebhookUrl', {
      value: fnUrl.url,
      description: 'GitHub App webhook URL — configure this in the GitHub App settings',
    });

    new CfnOutput(this, 'FunctionName', {
      value: webhookHandler.functionName,
      description: 'Lambda function name',
    });
  }
}
