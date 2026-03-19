/**
 * @file types.ts
 * @package @eventgear/db
 * @purpose DynamoDB record type wrappers and key pair types
 *
 * @ai-notes DynamoRecord<T> adds the DynamoDB key fields (PK, SK, GSI*) on top of
 * the domain entity T. Never store raw DynamoRecord in domain code — strip keys before
 * returning from repositories.
 */

export interface KeyPair {
  readonly PK: string;
  readonly SK: string;
}

export interface GSI1Keys {
  readonly GSI1PK?: string;
  readonly GSI1SK?: string;
}

export interface GSI2Keys {
  readonly EntityType?: string;
  readonly CreatedAt?: string;
}

export interface GSI3Keys {
  readonly Status?: string;
  readonly GSI3SK?: string;
}

export type DynamoKeys = KeyPair & GSI1Keys & GSI2Keys & GSI3Keys;

/** A domain entity T as stored in DynamoDB — includes all key fields */
export type DynamoRecord<T> = T & DynamoKeys;
