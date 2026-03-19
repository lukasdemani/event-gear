/**
 * @file index.ts
 * @package @eventgear/core
 * @purpose Public API for the core package — shared types, errors, result pattern, utilities
 *
 * @exports Result<T, E> — success/failure type for all business logic
 * @exports AppError hierarchy — typed errors used across all domains
 * @exports Common types — Timestamps, Pagination, ID utilities
 *
 * @ai-notes This is the foundation package. Every domain imports from here.
 * Do not add domain-specific logic here — only truly shared primitives.
 */

// Result pattern
export type { Result } from './result.js';
export { ok, err } from './result.js';

// Errors
export {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  InternalError,
} from './errors.js';

// Common types
export type {
  ID,
  ISODateString,
  ISODateTimeString,
  Timestamps,
  PaginationParams,
  PaginatedResult,
} from './types.js';

// Utilities
export { generateId, generateCorrelationId } from './id.js';
export { formatDate, parseDate } from './date.js';

// HTTP helpers (for Lambda handlers)
export { successResponse, errorResponse, createMockAPIGatewayEvent } from './http.js';
