/**
 * Axios API Instance
 * Central HTTP client with JWT token injection and 401 handling.
 */
import axios from 'axios';
import { reportError } from './errorReporter';

// In dev we rely on the Vite proxy (baseURL '/api'). For staging/production
// builds, set VITE_API_URL to the backend origin (e.g. https://ats.aapnainfotech.com).
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor — attach JWT bearer token if present.
 */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('ats_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Pages opened from an emailed link by people who need no ATS session (MRF
 * approvers, hiring managers, candidates, interviewers). A stale token left in
 * the browser makes AuthContext's /auth/me return 401 on mount; redirecting
 * then bounced an MRF approver from their approval link to the login page and
 * lost the link. Keep in step with the public routes in App.jsx.
 */
const isPublicLinkPage = (pathname) =>
  /^\/mrf\/[^/]+\/approve\/?$/.test(pathname) ||
  ['/mrf-submit', '/missing-jd-upload', '/scorecard/', '/documents/'].some((p) => pathname.startsWith(p));

/**
 * Response interceptor — normalise errors and handle 401 (unauthorized).
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const { response } = error;

    if (response?.status === 401) {
      // Token expired or invalid → clear state and redirect
      localStorage.removeItem('ats_token');
      localStorage.removeItem('ats_user');

      // Only redirect if we're not already on the login page, and never away
      // from a public emailed-link page (the stale token is simply dropped).
      const { pathname } = window.location;
      if (!pathname.includes('/login') && !isPublicLinkPage(pathname)) {
        window.location.href = '/login';
      }
    }

    // The request's reference (N42): in the error body as `ref`, and in the
    // x-request-id header. Shown to the user on server errors only, so HR can
    // quote it ("ref: K7Q2MX"); validation messages stay as they are.
    const status = response?.status || 0;
    const ref = response?.data?.ref || response?.headers?.['x-request-id'] || null;
    let message =
      response?.data?.message ||
      response?.data?.error ||
      error.message ||
      'An unexpected error occurred';
    if (status >= 500 && ref && !message.includes(ref)) {
      message = `${message} (ref: ${ref})`;
    }

    // A server error without a ref never reached our error handler (a proxy
    // 502/504), and a timeout never reached the server at all: neither is in the
    // server's error log, so record them from here.
    if ((status >= 500 && !response?.data?.ref) || error.code === 'ECONNABORTED') {
      reportError({
        kind: 'api',
        message: `${error.config?.method?.toUpperCase() || 'GET'} ${error.config?.url || ''} failed: ${status || error.code || 'network'} ${error.message || ''}`.trim(),
        ref: ref || undefined,
        apiStatus: status || undefined,
        apiPath: error.config?.url,
      });
    }

    // Build a consistent error shape
    const formattedError = {
      status,
      message,
      ref,
      data: response?.data || null,
    };

    return Promise.reject(formattedError);
  },
);

export default api;
