#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AgenticCodeownersStack } from '../lib/stack.js';
import { DeployEnv, validateEnvironment } from '../config/environments.js';

const app = new cdk.App();

const deployEnvString = process.env.DEPLOY_ENV ?? DeployEnv.STAGING;
const deployEnv = validateEnvironment(deployEnvString);

// eslint-disable-next-line no-new
new AgenticCodeownersStack(app, `AgenticCodeowners-${deployEnv}`, {
  env: {
    region: process.env.AWS_REGION ?? 'eu-west-1',
    account: process.env.AWS_ACCOUNT_ID,
  },
  deployEnv,
});
