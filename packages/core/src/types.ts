/**
 * @file types.ts
 * @package @eventgear/core
 * @purpose Common types shared across all EventGear domains
 */

/** ULID string — 26 uppercase alphanumeric characters */
export type ID = string;

/** ISO 8601 date string — "2024-08-15" */
export type ISODateString = string;

/** ISO 8601 datetime string — "2024-08-15T10:00:00Z" */
export type ISODateTimeString = string;

export interface Timestamps {
  readonly createdAt: ISODateTimeString;
  readonly updatedAt: ISODateTimeString;
}

export interface PaginationParams {
  readonly limit?: number | undefined;
  readonly nextToken?: string | undefined; // base64-encoded DynamoDB LastEvaluatedKey
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextToken?: string;
  readonly count: number;
}
