/**
 * Domain error types. Every error maps deterministically to the contract's
 * common Error envelope: `{ error: { code, message, details? } }`.
 *
 * Principle 16.x: every error has a defined outcome; security errors are never retried.
 */

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Base class for all expected, mapped application errors. */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  /** Security errors must never be retried by callers/queues. */
  readonly retryable: boolean;

  constructor(
    code: string,
    httpStatus: number,
    message: string,
    opts: { details?: Record<string, unknown>; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid token", details?: Record<string, unknown>) {
    super("unauthorized", 401, message, { details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details?: Record<string, unknown>) {
    super("forbidden", 403, message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", details?: Record<string, unknown>) {
    super("not_found", 404, message, { details });
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation error", details?: Record<string, unknown>) {
    super("validation_failed", 422, message, { details });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: Record<string, unknown>) {
    super("conflict", 409, message, { details });
  }
}

/** Raised when an outbound/proactive message is stopped by a safety gate. */
export class GateBlockedError extends AppError {
  constructor(message = "Blocked by a gate", details?: Record<string, unknown>) {
    super("gate_blocked", 409, message, { details });
  }
}

/** Map any thrown value to a safe Error envelope + status (defaults to 500). */
export function toErrorEnvelope(err: unknown): { status: number; body: ErrorEnvelope } {
  if (err instanceof AppError) {
    return { status: err.httpStatus, body: err.toEnvelope() };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "Internal server error" } },
  };
}
