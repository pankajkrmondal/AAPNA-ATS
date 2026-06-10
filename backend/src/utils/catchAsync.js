/**
 * Wraps an async Express route handler to automatically catch rejected promises
 * and forward them to the Express error-handling middleware.
 *
 * Usage:
 *   router.get('/items', catchAsync(async (req, res) => { ... }));
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise<void>
 * @returns {Function} Express middleware
 */
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default catchAsync;
