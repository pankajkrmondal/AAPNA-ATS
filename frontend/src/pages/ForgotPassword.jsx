/**
 * ForgotPassword — request a password reset link by username or email.
 * Always shows the same generic success state regardless of whether the
 * account exists (anti-enumeration). Rendered inside AuthLayout.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Form, Input, Button, Alert, Result } from 'antd';
import { UserOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import authService from '../services/authService';
import TurnstileWidget from '../components/TurnstileWidget';

// Empty site key = Turnstile disabled (widget hidden, no token sent).
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export default function ForgotPassword() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef(null);

  const captchaPending = Boolean(TURNSTILE_SITE_KEY) && !captchaToken;

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      await authService.forgotPassword(values.login.trim(), captchaToken);
      setSubmitted(true);
    } catch (err) {
      // 429 (rate limit) or server errors; never account-existence info.
      setError(err?.message || 'Something went wrong. Please try again later.');
      // Turnstile tokens are single-use: request a fresh challenge for the retry
      setCaptchaToken('');
      captchaRef.current?.reset();
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="animate-fade-in">
        <Result
          status="success"
          title="Check your email"
          subTitle="If an account exists for that username or email, a password reset link has been sent. The link expires in 30 minutes."
          extra={
            <Link to="/login">
              <Button type="primary" className="cta-primary" style={{ borderRadius: 10, fontWeight: 700 }}>
                Back to Sign In
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

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
        name="forgotPassword"
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        size="large"
        requiredMark={false}
      >
        <Form.Item
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13 }}>Username or Email</span>}
          name="login"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
          style={{ marginBottom: 28 }}
        >
          <Input
            prefix={<UserOutlined style={{ color: 'rgba(79, 47, 184, 0.55)', marginRight: 4 }} />}
            placeholder="Enter your username or email"
            autoComplete="off"
            style={{ borderRadius: 10, height: 46 }}
          />
        </Form.Item>

        {TURNSTILE_SITE_KEY && (
          <Form.Item style={{ marginBottom: 20 }}>
            <TurnstileWidget
              ref={captchaRef}
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setCaptchaToken}
              action="forgot-password"
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
            Send Reset Link
          </Button>
        </Form.Item>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Link to="/login" style={{ fontSize: 13.5, fontWeight: 600 }}>
            <ArrowLeftOutlined style={{ fontSize: 12, marginRight: 6 }} />
            Back to sign in
          </Link>
        </div>
      </Form>
    </div>
  );
}
