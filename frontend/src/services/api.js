/**
 * Axios API Instance
 * Central HTTP client with JWT token injection and 401 handling.
 */
import axios from 'axios';

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

      // Only redirect if we're not already on the login page
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }

    // Build a consistent error shape
    const formattedError = {
      status: response?.status || 0,
      message:
        response?.data?.message ||
        response?.data?.error ||
        error.message ||
        'An unexpected error occurred',
      data: response?.data || null,
    };

    return Promise.reject(formattedError);
  },
);

export default api;
