/**
 * errorReporter — sends browser errors to the backend error log (N42), so a
 * screen that crashes in someone's browser shows up on Super Admin → Logs &
 * errors instead of only in that browser's console.
 *
 * Reported: uncaught errors, unhandled promise rejections, screens caught by
 * ErrorBoundary, and failed API calls the server never logged itself (a proxy
 * 502/504 or a timeout — a normal server error is already recorded on the
 * server with the same ref).
 *
 * Only for signed-in users (POST /api/errors needs a token). Uses fetch, not
 * the shared axios instance, so a failed report can never trigger the 401
 * redirect or report itself. Query strings are stripped, repeats of the same
 * error within a minute are dropped, and at most 20 reports go per page load.
 */

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

const DEDUPE_MS = 60_000;
const MAX_PER_PAGE_LOAD = 20;
const recent = new Map();
let sent = 0;
let installed = false;

/** Browser noise that is not our bug. */
const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i, // cross-origin script with no details
  /chrome-extension:|moz-extension:|safari-extension:/i,
];

const pathOnly = (url) => {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return String(url || '').split(/[?#]/)[0];
  }
};

/**
 * Report one error. Never throws and never awaits anything the caller needs.
 * @param {object} p
 * @param {'window'|'promise'|'render'|'api'} p.kind
 * @param {unknown} [p.error]
 * @param {string} [p.message]
 * @param {string} [p.componentStack]
 * @param {string} [p.component]
 * @param {string} [p.ref]       the API ref, when the error came from a call
 * @param {number} [p.apiStatus]
 * @param {string} [p.apiPath]
 */
export function reportError({ kind, error, message, componentStack, component, ref, apiStatus, apiPath } = {}) {
  try {
    const token = localStorage.getItem('ats_token');
    if (!token || sent >= MAX_PER_PAGE_LOAD) return;

    const err = error instanceof Error ? error : null;
    const text = String(message || err?.message || error || 'Unknown error').slice(0, 1000);
    const stack = err?.stack ? String(err.stack).slice(0, 6000) : undefined;
    if (IGNORE.some((re) => re.test(text) || (stack && re.test(stack)))) return;

    const key = `${kind}|${text}|${pathOnly(window.location.href)}`;
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < DEDUPE_MS) return;
    recent.set(key, now);
    sent += 1;

    fetch(`${API_BASE}/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      keepalive: true,
      body: JSON.stringify({
        kind,
        name: err?.name,
        message: text,
        stack,
        componentStack: componentStack ? String(componentStack).slice(0, 4000) : undefined,
        component,
        page: pathOnly(window.location.href),
        ref,
        apiStatus,
        apiPath: apiPath ? pathOnly(apiPath) : undefined,
      }),
    }).catch(() => {});
  } catch {
    // Reporting must never cause a second error.
  }
}

/** Install the global listeners once (main.jsx). */
export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    // Resource load failures (img/script) have no `error` and are not ours to chase here.
    if (!event.error && !event.message) return;
    reportError({ kind: 'window', error: event.error, message: event.message });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    // Rejected API calls already carry { status, message } and are handled by
    // their callers; the server or the api interceptor records the real ones.
    if (reason && typeof reason === 'object' && 'status' in reason && 'message' in reason && !(reason instanceof Error)) return;
    reportError({ kind: 'promise', error: reason instanceof Error ? reason : null, message: reason instanceof Error ? undefined : String(reason) });
  });
}

export default { reportError, installErrorReporter };
