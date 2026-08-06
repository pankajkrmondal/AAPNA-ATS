/**
 * Custom application error class.
 * Extends native Error with HTTP status code and operational flag.
 *
 * Operational errors are expected (e.g. 404, 401) and safe to return to the client.
 * Programming errors (isOperational = false) will be masked with a generic message.
 */
export default class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code (e.g. 400, 404, 500)
   */
  constructor(message, statusCode) {
    super(message);

    /** @type {number} */
    this.statusCode = statusCode;

    /** @type {string} 'fail' for 4xx, 'error' for 5xx */
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

    /** @type {boolean} true for expected / operational errors */
    this.isOperational = true;

    // Capture the stack trace, omitting the constructor call itself
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AIModelError extends AppError {
  constructor(message, statusCode = 503) {
    super(message, statusCode);
    this.name = 'AIModelError';
  }
}
