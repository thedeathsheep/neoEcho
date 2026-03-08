export class AppError extends Error {
  public readonly code: string
  public readonly status: number
  public readonly details?: unknown

  constructor(message: string, code: string, status: number = 500, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

export class AIServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'AI_SERVICE_ERROR', 502, details)
    this.name = 'AIServiceError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'API key is required') {
    super(message, 'UNAUTHORIZED', 401)
    this.name = 'UnauthorizedError'
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
