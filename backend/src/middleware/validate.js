import AppError from '../utils/AppError.js';

/**
 * Lightweight request-validation middleware factory.
 *
 * Instead of pulling in a heavy validation library (Joi / Zod), we define
 * schemas as plain objects describing expected shape & constraints:
 *
 * ```js
 * const loginSchema = {
 *   body: {
 *     username: { type: 'string', required: true, min: 1 },
 *     password: { type: 'string', required: true, min: 1 },
 *   },
 * };
 *
 * router.post('/login', validate(loginSchema), controller.login);
 * ```
 *
 * Supported checks per field:
 *   - required (boolean)
 *   - type     ('string' | 'number' | 'boolean' | 'object' | 'array')
 *   - min      (min length for strings / arrays, min value for numbers)
 *   - max      (max length for strings / arrays, max value for numbers)
 *   - enum     (array of allowed values)
 *   - pattern  (RegExp for strings)
 *
 * @param {Object} schema  - { body?: {…}, query?: {…}, params?: {…} }
 * @returns {import('express').RequestHandler}
 */
const validate = (schema) => {
  return (req, _res, next) => {
    const errors = [];

    for (const source of ['body', 'query', 'params']) {
      const rules = schema[source];
      if (!rules) continue;

      const data = req[source] || {};

      for (const [field, constraints] of Object.entries(rules)) {
        const value = data[field];

        // Required check
        if (constraints.required && (value === undefined || value === null || value === '')) {
          errors.push(`${source}.${field} is required.`);
          continue; // skip further checks when missing
        }

        // If optional and not present, skip remaining checks
        if (value === undefined || value === null) continue;

        // Type check
        if (constraints.type) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== constraints.type) {
            errors.push(`${source}.${field} must be of type ${constraints.type}.`);
            continue;
          }
        }

        // Min / max for strings and arrays (length) or numbers (value)
        if (constraints.min !== undefined) {
          if ((typeof value === 'string' || Array.isArray(value)) && value.length < constraints.min) {
            errors.push(`${source}.${field} must have at least ${constraints.min} characters.`);
          } else if (typeof value === 'number' && value < constraints.min) {
            errors.push(`${source}.${field} must be at least ${constraints.min}.`);
          }
        }

        if (constraints.max !== undefined) {
          if ((typeof value === 'string' || Array.isArray(value)) && value.length > constraints.max) {
            errors.push(`${source}.${field} must have at most ${constraints.max} characters.`);
          } else if (typeof value === 'number' && value > constraints.max) {
            errors.push(`${source}.${field} must be at most ${constraints.max}.`);
          }
        }

        // Enum check
        if (constraints.enum && !constraints.enum.includes(value)) {
          errors.push(`${source}.${field} must be one of: ${constraints.enum.join(', ')}.`);
        }

        // Pattern (regex) check
        if (constraints.pattern && typeof value === 'string' && !constraints.pattern.test(value)) {
          errors.push(`${source}.${field} has an invalid format.`);
        }
      }
    }

    if (errors.length > 0) {
      const err = new AppError(`Validation failed: ${errors.join(' ')}`, 400);
      err.name = 'ValidationError';
      err.validationErrors = errors;
      return next(err);
    }

    next();
  };
};

export default validate;
