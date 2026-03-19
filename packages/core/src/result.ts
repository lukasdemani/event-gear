/**
 * @file result.ts
 * @package @eventgear/core
 * @purpose The Result<T, E> pattern — explicit success/failure without throwing
 *
 * @inputs  Any value T for success, any AppError for failure
 * @outputs Discriminated union type that callers must handle
 *
 * @ai-notes NEVER throw from business logic (service.ts files).
 * Always return Result<T>. Handlers convert errors to HTTP responses.
 * Use `ok(data)` and `err(error)` constructors, not object literals.
 */
import type { AppError } from './errors.js';

export type Result<T, E extends AppError = AppError> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { success: false, error };
}
