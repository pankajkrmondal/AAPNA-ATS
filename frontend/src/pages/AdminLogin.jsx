/**
 * AdminLogin Page — Premium login form for HR Admin system access.
 * Replicates the legacy Welcome Back layout with custom badges and icons.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Alert } from 'antd';
import { Button } from '../ui';
import { LoginOutlined, UserOutlined, LockOutlined } from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import adminService from '../services/adminService';
import TurnstileWidget from '../components/TurnstileWidget';

// Empty site key = Turnstile disabled (widget hidden, no token sent).
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export default function AdminLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef(null);
  const { login, logout } = useAuth();
  const navigate = useNavigate();

  const captchaPending = Boolean(TURNSTILE_SITE_KEY) && !captchaToken;

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      // Log in and verify admin portal permissions in one operation
      await login(values.username, values.password, true, captchaToken);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'Invalid username or password. Please try again.');
      // Clean up session in case verification failed
      localStorage.removeItem('ats_token');
      localStorage.removeItem('ats_user');
      // Turnstile tokens are single-use: request a fresh challenge for the retry
      setCaptchaToken('');
      captchaRef.current?.reset();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
        />
      )}

      <Form
        name="adminLogin"
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        size="large"
        requiredMark={false}
      >
        <Form.Item
          label={<span className="auth-field-label auth-field-label--caps">Username or Email</span>}
          name="username"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="Enter your username or email"
            autoComplete="off"
          />
        </Form.Item>

        <Form.Item
          label={<span className="auth-field-label auth-field-label--caps">Password</span>}
          name="password"
          rules={[{ required: true, message: 'Please enter your password' }]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Enter your password"
            autoComplete="new-password"
          />
        </Form.Item>

        {TURNSTILE_SITE_KEY && (
          <Form.Item>
            <TurnstileWidget
              ref={captchaRef}
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setCaptchaToken}
            />
          </Form.Item>
        )}

        <Form.Item>
          <Button
            htmlType="submit"
            loading={loading}
            disabled={captchaPending}
            icon={<LoginOutlined />}
            block
            emphasis="solid" size="lg"
          >
            Sign In
          </Button>
        </Form.Item>

        <div className="auth-form-actions">
          <Link to="/forgot-password" className="auth-link">
            Forgot password?
          </Link>
        </div>
      </Form>
    </div>
  );
}
