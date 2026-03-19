/**
 * @file client.ts
 * @package @eventgear/db
 * @purpose Singleton DynamoDB client and DocumentClient factory functions
 *
 * @inputs  AWS config from @eventgear/config (region, optional local endpoint)
 * @outputs DynamoDBClient (raw) and DynamoDBDocumentClient (marshalled) singletons
 *
 * @dependencies @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, @eventgear/config
 * @ai-notes Clients are created lazily on first call, then cached for subsequent calls.
 *   DYNAMODB_ENDPOINT in config enables local DynamoDB (docker) for dev/testing.
 *   Never create client instances outside this module — always use these functions.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '@eventgear/config';

let _dynamoClient: DynamoDBClient | undefined;
let _docClient: DynamoDBDocumentClient | undefined;

/**
 * Returns the raw DynamoDBClient singleton.
 * Lazily initialized on first call.
 */
export function getDynamoClient(): DynamoDBClient {
  if (!_dynamoClient) {
    const config = getConfig();
    _dynamoClient = new DynamoDBClient({
      region: config.awsRegion,
      ...(config.dynamoEndpoint !== undefined ? { endpoint: config.dynamoEndpoint } : {}),
    });
  }
  return _dynamoClient;
}

/**
 * Returns the DynamoDBDocumentClient singleton.
 * Wraps getDynamoClient() with automatic marshalling/unmarshalling.
 * removeUndefinedValues: true prevents DynamoDB from rejecting items with undefined fields.
 */
export function getDynamoDocumentClient(): DynamoDBDocumentClient {
  if (!_docClient) {
    _docClient = DynamoDBDocumentClient.from(getDynamoClient(), {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
        convertClassInstanceToMap: false,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
  }
  return _docClient;
}

/** Reset singletons — used in tests to force re-initialization with new config */
export function resetClients(): void {
  _dynamoClient = undefined;
  _docClient = undefined;
}
