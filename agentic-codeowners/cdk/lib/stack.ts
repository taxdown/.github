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
  aws_secretsmanager as secretsmanager,
  aws_apigatewayv2 as apigwv2,
  aws_apigatewayv2_integrations as apigwv2int,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { DeployEnv } from '../config/environments';

export interface AgenticCodeownersStackProps extends StackProps {
  deployEnv: DeployEnv;
}

export class AgenticCodeownersStack extends Stack {
  constructor(scope: Construct, id: string, props: AgenticCodeownersStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;

    // app-id is not sensitive — stored in SSM as plain String.
    const appId = ssm.StringParameter.fromStringParameterName(
      this, 'AppId', `/agentic-codeowners/${deployEnv}/app-id`,
    ).stringValue;

    // Sensitive secrets stored in Secrets Manager.
    const webhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'WebhookSecret', `agentic-codeowners/${deployEnv}/webhook-secret`,
    );
    const appPrivateKey = secretsmanager.Secret.fromSecretNameV2(
      this, 'AppPrivateKey', `agentic-codeowners/${deployEnv}/app-private-key`,
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this, 'AnthropicApiKey', `agentic-codeowners/${deployEnv}/anthropic-api-key`,
    );

    const bundling = {
      minify: true,
      sourceMap: false,
      externalModules: ['@aws-sdk/*'],
    };

    // Processor Lambda — does the actual risk assessment (invoked async by webhook handler)
    const processorHandler = new lambdaNodejs.NodejsFunction(this, 'ProcessorHandler', {
      entry: path.join(__dirname, '../../src/processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(3),
      memorySize: 256,
      bundling,
      environment: {
        DEPLOY_ENV: deployEnv,
        APP_ID: appId,
        APP_PRIVATE_KEY_NAME: appPrivateKey.secretName,
        ANTHROPIC_API_KEY_NAME: anthropicApiKey.secretName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    appPrivateKey.grantRead(processorHandler);
    anthropicApiKey.grantRead(processorHandler);

    // Webhook Lambda — validates signature and invokes processor async, responds 202 immediately
    const webhookHandler = new lambdaNodejs.NodejsFunction(this, 'WebhookHandler', {
      entry: path.join(__dirname, '../../src/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 128,
      bundling,
      environment: {
        DEPLOY_ENV: deployEnv,
        WEBHOOK_SECRET_NAME: webhookSecret.secretName,
        PROCESSOR_FUNCTION_NAME: processorHandler.functionName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    webhookSecret.grantRead(webhookHandler);
    processorHandler.grantInvoke(webhookHandler);

    // HTTP API Gateway — public HTTPS endpoint
    const api = new apigwv2.HttpApi(this, 'WebhookApi', {
      apiName: `agentic-codeowners-${deployEnv}`,
    });

    api.addRoutes({
      path: '/webhook',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2int.HttpLambdaIntegration('WebhookIntegration', webhookHandler),
    });

    new CfnOutput(this, 'WebhookUrl', {
      value: `${api.apiEndpoint}/webhook`,
      description: 'GitHub App webhook URL — configure this in the GitHub App settings',
    });

    new CfnOutput(this, 'WebhookFunctionName', {
      value: webhookHandler.functionName,
      description: 'Webhook Lambda function name',
    });

    new CfnOutput(this, 'ProcessorFunctionName', {
      value: processorHandler.functionName,
      description: 'Processor Lambda function name',
    });
  }
}
