/**
 * Axios API Instance
 * Central HTTP client with JWT token injection and 401 handling.
 */
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
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
