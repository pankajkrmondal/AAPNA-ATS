/**
 * Standardised API response helpers.
 * Every controller should use these to keep response shapes consistent.
 */

/**
 * Send a success response.
 * @param {import('express').Response} res
 * @param {*} data - Payload
 * @param {string} [message='Success']
 * @param {number} [statusCode=200]
 */
export function success(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
}

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {string} [message='Something went wrong']
 * @param {number} [statusCode=500]
 * @param {*} [errors=null] - Optional validation errors or details
 */
export function error(res, message = 'Something went wrong', statusCode = 500, errors = null) {
  const body = {
    status: 'error',
    message,
  };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

/**
 * Send a paginated success response.
 * @param {import('express').Response} res
 * @param {Array} data - Array of items for the current page
 * @param {number} page - Current page (1-indexed)
 * @param {number} limit - Items per page
 * @param {number} total - Total matching items across all pages
 * @param {string} [message='Success']
 */
export function paginated(res, data, page, limit, total, message = 'Success') {
  return res.status(200).json({
    status: 'success',
    message,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
}
