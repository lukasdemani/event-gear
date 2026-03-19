/**
 * @file base-repository.ts
 * @package @eventgear/db
 * @purpose Abstract base class providing typed DynamoDB CRUD and query methods
 *
 * @inputs  Entity types via generics, DynamoDB key pairs, query params
 * @outputs Domain entities (DynamoDB keys stripped), PaginatedResult for list operations
 *
 * @dependencies @aws-sdk/lib-dynamodb, @eventgear/config, @eventgear/core
 * @ai-notes All repository classes extend BaseRepository<PrimaryEntityType>.
 *   Methods are generic (e.g., query<U>()) so one repository can handle multiple entity types.
 *   stripKeys removes all DynamoDB key fields before returning to callers.
 *   nextToken in PaginatedResult is a base64-encoded LastEvaluatedKey — never expose raw DynamoDB keys.
 *   TABLE_NAME is read from config on each call to support test config resets.
 */
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NativeAttributeValue } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '@eventgear/config';
import type { PaginatedResult, PaginationParams } from '@eventgear/core';
import type { DynamoRecord, KeyPair } from './types.js';
import { getDynamoDocumentClient } from './client.js';

/** Shape of DynamoDB query parameters accepted by query() and queryPaginated() */
export interface QueryParams {
  IndexName?: string;
  KeyConditionExpression: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, NativeAttributeValue>;
  FilterExpression?: string;
  ScanIndexForward?: boolean;
  Limit?: number;
}

/**
 * Fields stripped from every DynamoDB record before returning to domain callers.
 * PascalCase fields are DynamoDB infrastructure keys; domain entities use camelCase.
 * - Status (GSI3PK): domain entities use lowercase 'status' — both stored, uppercase stripped
 * - CreatedAt (GSI2SK): domain entities use lowercase 'createdAt' — both stored, uppercase stripped
 * - EntityType: DynamoDB-only field, not part of any domain entity
 */
const DYNAMO_KEY_FIELDS = new Set([
  'PK',
  'SK',
  'GSI1PK',
  'GSI1SK',
  'EntityType',
  'CreatedAt',
  'Status',
  'GSI3SK',
]);

export abstract class BaseRepository<T extends object> {
  private get tableName(): string {
    return getConfig().dynamoTableName;
  }

  private get docClient() {
    return getDynamoDocumentClient();
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /** Get a single item by its primary key. Returns null if not found. */
  protected async getItem<U = T>(key: KeyPair): Promise<U | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: key as Record<string, NativeAttributeValue>,
      }),
    );
    if (!result.Item) return null;
    return this.stripKeys<U>(result.Item as DynamoRecord<U>);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /** Put (create or replace) an item in the table. */
  protected async putItem<U = T>(item: DynamoRecord<U>): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item as Record<string, NativeAttributeValue>,
      }),
    );
  }

  /**
   * Update specific fields on an existing item using SET expressions.
   * Callers pass a plain object of field:value pairs to update.
   */
  protected async updateItem(
    key: KeyPair,
    updates: Record<string, NativeAttributeValue>,
  ): Promise<void> {
    const entries = Object.entries(updates);
    if (entries.length === 0) return;

    const updateParts: string[] = [];
    const attrNames: Record<string, string> = {};
    const attrValues: Record<string, NativeAttributeValue> = {};

    entries.forEach(([field, value], i) => {
      const nameKey = `#f${i}`;
      const valKey = `:v${i}`;
      updateParts.push(`${nameKey} = ${valKey}`);
      attrNames[nameKey] = field;
      attrValues[valKey] = value;
    });

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key as Record<string, NativeAttributeValue>,
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
      }),
    );
  }

  /** Delete an item by its primary key. */
  protected async deleteItem(key: KeyPair): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: key as Record<string, NativeAttributeValue>,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** Run a DynamoDB query and return all matching items (up to 1 MB / DynamoDB page). */
  protected async query<U = T>(params: QueryParams): Promise<U[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: params.KeyConditionExpression,
        ...(params.IndexName !== undefined ? { IndexName: params.IndexName } : {}),
        ...(params.ExpressionAttributeNames !== undefined
          ? { ExpressionAttributeNames: params.ExpressionAttributeNames }
          : {}),
        ...(params.ExpressionAttributeValues !== undefined
          ? { ExpressionAttributeValues: params.ExpressionAttributeValues }
          : {}),
        ...(params.FilterExpression !== undefined
          ? { FilterExpression: params.FilterExpression }
          : {}),
        ...(params.ScanIndexForward !== undefined
          ? { ScanIndexForward: params.ScanIndexForward }
          : {}),
        ...(params.Limit !== undefined ? { Limit: params.Limit } : {}),
      }),
    );
    const items = result.Items ?? [];
    return items.map((item) => this.stripKeys<U>(item as DynamoRecord<U>));
  }

  /**
   * Paginated DynamoDB query.
   * Decodes nextToken from base64 → LastEvaluatedKey.
   * Encodes response LastEvaluatedKey → base64 nextToken.
   */
  protected async queryPaginated<U = T>(
    params: QueryParams,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<U>> {
    const exclusiveStartKey = pagination.nextToken
      ? (JSON.parse(
          Buffer.from(pagination.nextToken, 'base64').toString('utf-8'),
        ) as Record<string, NativeAttributeValue>)
      : undefined;

    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: params.KeyConditionExpression,
        ...(params.IndexName !== undefined ? { IndexName: params.IndexName } : {}),
        ...(params.ExpressionAttributeNames !== undefined
          ? { ExpressionAttributeNames: params.ExpressionAttributeNames }
          : {}),
        ...(params.ExpressionAttributeValues !== undefined
          ? { ExpressionAttributeValues: params.ExpressionAttributeValues }
          : {}),
        ...(params.FilterExpression !== undefined
          ? { FilterExpression: params.FilterExpression }
          : {}),
        ...(params.ScanIndexForward !== undefined
          ? { ScanIndexForward: params.ScanIndexForward }
          : {}),
        ...(pagination.limit !== undefined ? { Limit: pagination.limit } : {}),
        ...(exclusiveStartKey !== undefined
          ? { ExclusiveStartKey: exclusiveStartKey }
          : {}),
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      this.stripKeys<U>(item as DynamoRecord<U>),
    );

    const nextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    return {
      items,
      count: items.length,
      ...(nextToken !== undefined ? { nextToken } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Key stripping utility
  // ---------------------------------------------------------------------------

  /**
   * Remove all DynamoDB infrastructure key fields from a record,
   * returning only the domain entity fields.
   *
   * Strips: PK, SK, GSI1PK, GSI1SK, EntityType, CreatedAt, Status, GSI3SK
   * Domain entities use camelCase equivalents (status, createdAt) stored separately.
   * Repositories write BOTH the domain field (lowercase) and the GSI key (PascalCase).
   */
  protected stripKeys<U = T>(record: DynamoRecord<U>): U {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
      if (!DYNAMO_KEY_FIELDS.has(k)) {
        result[k] = v;
      }
    }
    return result as U;
  }
}
