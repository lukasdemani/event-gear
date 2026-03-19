/**
 * @file index.ts
 * @package @eventgear/config
 * @purpose Environment variable parsing, validation, and typed config access
 *
 * @outputs Validated, typed configuration object — throws at startup if required vars missing
 *
 * @ai-notes All environment variable access goes through this package.
 * Never use process.env directly in domain or package code.
 * Config is validated with Zod at Lambda cold start.
 */
import { z } from 'zod';

const configSchema = z.object({
  // AWS
  awsRegion: z.string().default('us-east-1'),
  awsAccountId: z.string(),

  // DynamoDB
  dynamoTableName: z.string(),
  dynamoEndpoint: z.string().optional(), // local dev only

  // EventBridge
  eventBridgeBusName: z.string(),

  // Bedrock
  bedrockAgentId: z.string().optional(),
  bedrockAgentAliasId: z.string().optional(),
  bedrockKnowledgeBaseId: z.string().optional(),
  bedrockRegion: z.string().default('us-east-1'),

  // Auth
  jwtSecret: z.string(),
  cognitoUserPoolId: z.string().optional(),
  cognitoClientId: z.string().optional(),

  // Feature flags
  featureAiAssistant: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // Runtime
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse({
    awsRegion: process.env['AWS_REGION'],
    awsAccountId: process.env['AWS_ACCOUNT_ID'],
    dynamoTableName: process.env['DYNAMODB_TABLE_NAME'],
    dynamoEndpoint: process.env['DYNAMODB_ENDPOINT'],
    eventBridgeBusName: process.env['EVENTBRIDGE_BUS_NAME'],
    bedrockAgentId: process.env['BEDROCK_AGENT_ID'],
    bedrockAgentAliasId: process.env['BEDROCK_AGENT_ALIAS_ID'],
    bedrockKnowledgeBaseId: process.env['BEDROCK_KNOWLEDGE_BASE_ID'],
    bedrockRegion: process.env['BEDROCK_REGION'],
    jwtSecret: process.env['JWT_SECRET'],
    cognitoUserPoolId: process.env['COGNITO_USER_POOL_ID'],
    cognitoClientId: process.env['COGNITO_CLIENT_ID'],
    featureAiAssistant: process.env['FEATURE_AI_ASSISTANT'],
    nodeEnv: process.env['NODE_ENV'],
    logLevel: process.env['LOG_LEVEL'],
  });

  if (!result.success) {
    throw new Error(
      `Invalid configuration:\n${result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`
    );
  }

  return result.data;
}

// Singleton — loaded once per Lambda cold start
let _config: Config | undefined;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// For testing — reset the singleton
export function resetConfig(): void {
  _config = undefined;
}
