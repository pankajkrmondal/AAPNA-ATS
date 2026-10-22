/**
 * ResetPassword — set a new password using the emailed reset token
 * (?token=…). Handles missing/expired/used tokens with a path back to
 * requesting a new link. Rendered inside AuthLayout.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Alert, Result } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import authService from '../services/authService';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      await authService.resetPassword(token, values.newPassword);
      setDone(true);
    } catch (err) {
      // 400s carry a specific message (expired / invalid / already used).
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="animate-fade-in">
        <Result
          status="warning"
          title="Invalid reset link"
          subTitle="This link is missing its reset token. Please use the full link from your email, or request a new one."
          extra={
            <Link to="/forgot-password">
              <Button type="primary" className="cta-primary" style={{ borderRadius: 10, fontWeight: 700 }}>
                Request a New Link
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (done) {
    return (
      <div className="animate-fade-in">
        <Result
          status="success"
          title="Password reset"
          subTitle="Your password has been changed and all existing sessions were signed out. Sign in with your new password."
          extra={
            <Link to="/login">
              <Button type="primary" className="cta-primary" style={{ borderRadius: 10, fontWeight: 700 }}>
                Sign In
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
          action={
            <Link to="/forgot-password" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
              Request a new link
            </Link>
          }
        />
      )}

      <Form
        name="resetPassword"
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        size="large"
        requiredMark={false}
      >
        <Form.Item
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13 }}>New Password</span>}
          name="newPassword"
          rules={[
            { required: true, message: 'Please enter a new password' },
            { min: 8, message: 'Password must be at least 8 characters' },
          ]}
          style={{ marginBottom: 20 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: 'rgba(122, 146, 46, 0.55)', marginRight: 4 }} />}
            placeholder="Min 8 characters"
            autoComplete="new-password"
            style={{ borderRadius: 10, height: 46 }}
          />
        </Form.Item>

        <Form.Item
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13 }}>Confirm New Password</span>}
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Please confirm the new password' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Passwords do not match'));
              },
            }),
          ]}
          style={{ marginBottom: 28 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: 'rgba(122, 146, 46, 0.55)', marginRight: 4 }} />}
            placeholder="Re-enter new password"
            autoComplete="new-password"
            style={{ borderRadius: 10, height: 46 }}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            className="cta-primary"
            style={{ height: 48, borderRadius: 10, fontWeight: 700, fontSize: 15 }}
          >
            Reset Password
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
