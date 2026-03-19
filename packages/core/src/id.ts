/**
 * @file id.ts
 * @package @eventgear/core
 * @purpose ID and correlation ID generation using ULID
 *
 * @ai-notes All entity IDs are ULIDs — lexicographically sortable, URL-safe.
 * Format: 26 chars, e.g. "01J9ABC123DEF456GHI789JKL0"
 * Never use UUID or Math.random() for entity IDs.
 */
import { ulid } from 'ulid';

export function generateId(): string {
  return ulid();
}

export function generateCorrelationId(): string {
  return `corr_${ulid()}`;
}
