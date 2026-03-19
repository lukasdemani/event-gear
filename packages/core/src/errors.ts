/**
 * @file errors.ts
 * @package @eventgear/core
 * @purpose Typed error hierarchy for all EventGear domains
 *
 * @ai-notes All errors extend AppError. Handlers map error.code to HTTP status.
 * Add new error types here; never use plain Error in business logic.
 */

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(
    message: string,
    readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.context ? { context: this.context } : {}),
    };
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;

  constructor(entityType: string, id: string) {
    super(`${entityType} not found: ${id}`, { entityType, id });
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly httpStatus = 409;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;

  constructor(
    message: string,
    readonly validationErrors: Array<{ field: string; message: string }>
  ) {
    super(message, { validationErrors });
  }
}

export class UnauthorizedError extends AppError {
  readonly code = 'UNAUTHORIZED';
  readonly httpStatus = 401;

  constructor(message = 'Authentication required') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;

  constructor(message = 'Insufficient permissions') {
    super(message);
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR';
  readonly httpStatus = 500;

  constructor(message = 'An internal error occurred', context?: Record<string, unknown>) {
    super(message, context);
  }
}
