/**
 * Errors the application throws on purpose. The central error handler turns
 * them into HTTP responses; anything else is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not allowed') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class GoneError extends AppError {
  constructor(message = 'This link has expired') {
    super(410, 'LINK_EXPIRED', message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please slow down') {
    super(429, 'RATE_LIMITED', message);
  }
}
