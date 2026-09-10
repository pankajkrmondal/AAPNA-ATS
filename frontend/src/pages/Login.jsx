/**
 * Login Page — Premium login form with glassmorphism card, animated background,
 * and AAPNA branding. Rendered inside AuthLayout.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Checkbox, Typography, Alert, Space } from 'antd';
import { Button } from '../ui';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import TurnstileWidget from '../components/TurnstileWidget';

const { Text } = Typography;

// Empty site key = Turnstile disabled (widget hidden, no token sent).
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const captchaPending = Boolean(TURNSTILE_SITE_KEY) && !captchaToken;

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      const userData = await login(values.username, values.password, false, captchaToken);
      const isVendor = (userData?.role || '').toLowerCase() === 'vendor';
      navigate(isVendor ? '/vendor-dashboard' : '/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'Invalid username or password. Please try again.');
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
        name="login"
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        size="large"
        requiredMark={false}
      >
        <Form.Item
          label={<span className="auth-field-label">Username or Email</span>}
          name="username"
          rules={[{ required: true, message: 'Please enter username or email' }]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="Enter username or email"
            autoComplete="off"
          />
        </Form.Item>

        <Form.Item
          label={<span className="auth-field-label">Password</span>}
          name="password"
          rules={[{ required: true, message: 'Please enter password' }]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Enter password"
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
