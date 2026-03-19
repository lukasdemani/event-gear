/**
 * @file index.ts
 * @package @eventgear/db
 * @purpose Public API for the DynamoDB package
 *
 * @exports DynamoDB client, BaseRepository, table schema, key builders
 *
 * @ai-notes This package owns all DynamoDB interaction patterns.
 * Domains import BaseRepository and extend it — never use the SDK directly in domain code.
 * All key patterns are defined in schema.ts — refer there before writing queries.
 */

export { getDynamoClient, getDynamoDocumentClient } from './client.js';
export { BaseRepository } from './base-repository.js';
export { TABLE_NAME, getTableName, buildKey, GSI, EntityType } from './schema.js';
export type { DynamoRecord, KeyPair } from './types.js';
