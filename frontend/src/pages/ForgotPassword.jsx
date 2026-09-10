/**
 * ForgotPassword — request a password reset link by username or email.
 * Always shows the same generic success state regardless of whether the
 * account exists (anti-enumeration). Rendered inside AuthLayout.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Form, Input, Alert, Result } from 'antd';
import { Button } from '../ui';
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
              <Button emphasis="solid">
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
          label={<span className="auth-field-label">Username or Email</span>}
          name="login"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="Enter your username or email"
            autoComplete="off"
          />
        </Form.Item>

        {TURNSTILE_SITE_KEY && (
          <Form.Item>
            <TurnstileWidget
              ref={captchaRef}
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setCaptchaToken}
              action="forgot-password"
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
            Send Reset Link
          </Button>
        </Form.Item>

        <div className="auth-form-actions">
          <Link to="/login" className="auth-link">
            <ArrowLeftOutlined className="auth-back-icon" />
            Back to sign in
          </Link>
        </div>
      </Form>
    </div>
  );
}
