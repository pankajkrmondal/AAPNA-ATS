/**
 * externalCall.js — one log line per call to an outside service (N42).
 *
 * Each line says which service, which operation, how long it took and how it
 * ended, and (through the logger) which request or job made it. That is what
 * lets a developer see, from one ref, that "the upload failed because the AI
 * call timed out after 120 s". Bodies, headers and query strings are never
 * logged: they carry tokens and candidate data.
 *
 * Levels: success → "http" (kept in combined.log, not printed in production),
 * a non-2xx answer or a thrown error → "warn".
 */
import logger from '../config/logger.js';
import { templatePath } from './logMask.js';

function describeUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.host}${templatePath(u.pathname)}`;
  } catch {
    return 'unknown-url';
  }
}

function write(level, service, op, ms, extra) {
  logger.log(level, `[external] ${service} ${op} ${extra.outcome} in ${ms} ms`, {
    external: { service, op, ms, ...extra },
  });
}

/**
 * Time and log any async call to an outside service.
 * @template T
 * @param {string} service  e.g. "graph", "zeko", "openrouter", "gemini", "cohere"
 * @param {string} op       short operation name, e.g. "mail.send"
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function logExternal(service, op, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    write('http', service, op, Date.now() - started, { outcome: 'ok' });
    return result;
  } catch (err) {
    write('warn', service, op, Date.now() - started, {
      outcome: 'failed',
      error: `${err?.name || 'Error'}: ${String(err?.message || err).slice(0, 300)}`,
      ...(err?.status ? { status: err.status } : {}),
    });
    throw err;
  }
}

/**
 * fetch() that logs the call (method, host and templated path, status, time).
 * Drop-in: same arguments and return value as fetch.
 * @param {string} service
 * @param {string|URL} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function tracedFetch(service, url, options = {}) {
  const op = `${(options.method || 'GET').toUpperCase()} ${describeUrl(url)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, options);
    const ms = Date.now() - started;
    if (res.ok) write('http', service, op, ms, { outcome: `ok ${res.status}`, status: res.status });
    else write('warn', service, op, ms, { outcome: `HTTP ${res.status}`, status: res.status });
    return res;
  } catch (err) {
    write('warn', service, op, Date.now() - started, {
      outcome: 'network error',
      error: `${err?.name || 'Error'}: ${String(err?.cause?.code || err?.message || err).slice(0, 300)}`,
    });
    throw err;
  }
}
