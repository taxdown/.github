import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { PullRequestContext } from './github';

const SUPPORTED_ACTIONS = ['opened', 'synchronize', 'reopened'];

const sm = new SecretsManagerClient({});
const lambdaClient = new LambdaClient({});
let webhookSecret: string | undefined;

const loadWebhookSecret = async (): Promise<void> => {
  if (webhookSecret) return;
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: process.env.WEBHOOK_SECRET_NAME! }));
  webhookSecret = SecretString ?? '';
};

const verifySignature = (body: string, signature: string, secret: string): boolean => {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  await loadWebhookSecret();

  const signature = event.headers['x-hub-signature-256'] ?? '';
  const githubEvent = event.headers['x-github-event'] ?? '';
  const body = event.body ?? '';

  if (!webhookSecret) {
    console.error('WEBHOOK_SECRET not configured');
    return { statusCode: 500, body: 'Internal server error' };
  }

  if (!verifySignature(body, signature, webhookSecret)) {
    console.warn('Invalid webhook signature');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (githubEvent !== 'pull_request') {
    return { statusCode: 200, body: 'Event ignored' };
  }

  const payload = JSON.parse(body);
  const { action, pull_request: pr, repository, installation } = payload;

  if (!SUPPORTED_ACTIONS.includes(action)) {
    return { statusCode: 200, body: 'Action ignored' };
  }

  if (pr.draft) {
    return { statusCode: 200, body: 'Draft PR ignored' };
  }

  const [owner, repo] = repository.full_name.split('/');

  const ctx: PullRequestContext = {
    owner,
    repo,
    prNumber: pr.number,
    author: pr.user.login,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    installationId: installation.id,
  };

  console.log(JSON.stringify({
    event: githubEvent,
    action,
    repo: repository.full_name,
    pr: pr.number,
    author: pr.user.login,
    installationId: installation.id,
  }));

  // Invoke processor Lambda asynchronously — respond 202 immediately to GitHub
  await lambdaClient.send(new InvokeCommand({
    FunctionName: process.env.PROCESSOR_FUNCTION_NAME!,
    InvocationType: 'Event',
    Payload: JSON.stringify({ ctx, action }),
  }));

  return { statusCode: 202, body: 'Accepted' };
};
