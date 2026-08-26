/**
 * Shared 429 handler factory for express-rate-limit.
 * Produces a friendly message that tells the user how long to wait,
 * computed from the limiter's actual reset time for this client.
 */

/**
 * @param {string} whatHappened - Lead sentence, e.g. "Too many failed login attempts."
 * @returns {import('express-rate-limit').Options['handler']}
 */
export function friendlyRateLimitHandler(whatHappened) {
  return (req, res) => {
    const resetTime = req.rateLimit?.resetTime; // Date | undefined
    const minutes = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 60000))
      : null;

    const wait = minutes
      ? (minutes === 1 ? 'in about a minute' : `in about ${minutes} minutes`)
      : 'in a few minutes';

    return res.status(429).json({
      status: 'error',
      message: `${whatHappened} Please try again ${wait}.`,
    });
  };
}

export default friendlyRateLimitHandler;
