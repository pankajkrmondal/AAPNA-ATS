/**
 * Login Page — Premium login form with glassmorphism card, animated background,
 * and AAPNA branding. Rendered inside AuthLayout.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Checkbox, Typography, Alert, Space } from 'antd';
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
          style={{ marginBottom: 20, borderRadius: 8 }}
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
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13 }}>Username or Email</span>}
          name="username"
          rules={[{ required: true, message: 'Please enter username or email' }]}
          style={{ marginBottom: 20 }}
        >
          <Input
            prefix={<UserOutlined style={{ color: 'rgba(122, 146, 46, 0.55)', marginRight: 4 }} />}
            placeholder="Enter username or email"
            autoComplete="off"
            style={{ borderRadius: 10, height: 46 }}
          />
        </Form.Item>

        <Form.Item
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13 }}>Password</span>}
          name="password"
          rules={[{ required: true, message: 'Please enter password' }]}
          style={{ marginBottom: 28 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: 'rgba(122, 146, 46, 0.55)', marginRight: 4 }} />}
            placeholder="Enter password"
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
            block
            className="cta-primary"
            style={{
              height: 48,
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 15,
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
