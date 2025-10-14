// Custom error classes for better error handling

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public data?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, data?: any) {
    super(400, message, data);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class XRPLError extends AppError {
  constructor(message: string, data?: any) {
    super(500, message, data);
    this.name = 'XRPLError';
  }
}

export class IPFSError extends AppError {
  constructor(message: string, data?: any) {
    super(500, message, data);
    this.name = 'IPFSError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, data?: any) {
    super(500, message, data);
    this.name = 'DatabaseError';
  }
}

// Helper function to format error responses
export function formatErrorResponse(error: Error | AppError) {
  if (error instanceof AppError) {
    return {
      success: false,
      error: {
        name: error.name,
        message: error.message,
        statusCode: error.statusCode,
        data: error.data,
      },
    };
  }

  // Unknown errors
  return {
    success: false,
    error: {
      name: 'InternalServerError',
      message: error.message || 'An unexpected error occurred',
      statusCode: 500,
    },
  };
}

// Helper to check if error is an AppError
export function isAppError(error: any): error is AppError {
  return error instanceof AppError;
}
