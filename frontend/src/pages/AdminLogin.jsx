/**
 * AdminLogin Page — Premium login form for HR Admin system access.
 * Replicates the legacy Welcome Back layout with custom badges and icons.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
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
          style={{ marginBottom: 20, borderRadius: 8 }}
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
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Username or Email</span>}
          name="username"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
          style={{ marginBottom: 20 }}
        >
          <Input
            prefix={<UserOutlined style={{ color: 'rgba(79, 47, 184, 0.55)', marginRight: 4 }} />}
            placeholder="Enter your username or email"
            autoComplete="off"
            style={{ borderRadius: 10, height: 46 }}
          />
        </Form.Item>

        <Form.Item
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Password</span>}
          name="password"
          rules={[{ required: true, message: 'Please enter your password' }]}
          style={{ marginBottom: 28 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: 'rgba(79, 47, 184, 0.55)', marginRight: 4 }} />}
            placeholder="Enter your password"
            autoComplete="new-password"
            style={{ borderRadius: 10, height: 46 }}
          />
        </Form.Item>

        {TURNSTILE_SITE_KEY && (
          <Form.Item style={{ marginBottom: 20 }}>
            <TurnstileWidget
              ref={captchaRef}
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setCaptchaToken}
            />
          </Form.Item>
        )}

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            disabled={captchaPending}
            icon={<LoginOutlined />}
            block
            className="cta-primary"
            style={{
              height: 48,
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              // .cta-primary forces the gradient with !important, so signal the
              // disabled (captcha pending) state explicitly
              opacity: captchaPending ? 0.55 : 1,
            }}
          >
            Sign In
          </Button>
        </Form.Item>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Link to="/forgot-password" style={{ fontSize: 13.5, fontWeight: 600 }}>
            Forgot password?
          </Link>
        </div>
      </Form>
    </div>
  );
}
