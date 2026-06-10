/**
 * AuthContext — Manages authentication state across the app.
 * Handles login, logout, token persistence, and auto-verification on mount.
 */
import { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import authService from '../services/authService';
import adminService from '../services/adminService';

/** @type {React.Context} */
export const AuthContext = createContext(null);

/**
 * AuthProvider wraps the app and exposes auth state + actions.
 * @param {{ children: React.ReactNode }} props
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Verify token on mount */
  useEffect(() => {
    let cancelled = false;

    const verifyAuth = async () => {
      const token = localStorage.getItem('ats_token');
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await authService.getCurrentUser();
        if (!cancelled) {
          setUser(response.data?.data?.user ?? response.data?.user ?? response.data);
        }
      } catch {
        // Token is invalid / expired — clean up
        localStorage.removeItem('ats_token');
        localStorage.removeItem('ats_user');
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    verifyAuth();
    return () => { cancelled = true; };
  }, []);

  /**
   * Log in with credentials.
   * @param {string} username
   * @param {string} password
   * @param {boolean} [isAdminPortal=false]
   * @returns {Promise<object>} user data
   */
  const login = useCallback(async (username, password, isAdminPortal = false) => {
    const response = await authService.login(username, password);
    const { token, user: userData } = response.data.data;

    if (isAdminPortal) {
      const verifyRes = await adminService.verifyToken(token);
      if (!verifyRes.data || !verifyRes.data.authorized) {
        throw new Error('Access denied. This portal is for HR Admins only.');
      }
    }

    localStorage.setItem('ats_token', token);
    localStorage.setItem('ats_user', JSON.stringify(userData));
    setUser(userData);

    return userData;
  }, []);

  /** Log out and clear persisted data. */
  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Best-effort; still clear local state
    } finally {
      localStorage.removeItem('ats_token');
      localStorage.removeItem('ats_user');
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
  }), [user, isLoading, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
