export enum DeployEnv {
  STAGING = 'staging',
  PROD = 'prod',
}

export interface EnvironmentConfig {
  awsAccount?: string;
  awsRegion: string;
}

export const ENVIRONMENT_CONFIG: Record<DeployEnv, EnvironmentConfig> = {
  [DeployEnv.STAGING]: {
    awsRegion: 'eu-west-1',
  },
  [DeployEnv.PROD]: {
    awsRegion: 'eu-west-1',
  },
};

export const getEnvironmentConfig = (env: DeployEnv): EnvironmentConfig => {
  const config = ENVIRONMENT_CONFIG[env];
  if (!config) {
    throw new Error(`Environment configuration not found for: ${env}`);
  }
  return config;
};

export const validateEnvironment = (env: string): DeployEnv => {
  if (!Object.values(DeployEnv).includes(env as DeployEnv)) {
    throw new Error(`Invalid environment: ${env}. Allowed values: ${Object.values(DeployEnv).join(', ')}`);
  }
  return env as DeployEnv;
};
