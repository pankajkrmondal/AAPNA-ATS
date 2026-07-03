/**
 * Login Page — Premium login form with glassmorphism card, animated background,
 * and AAPNA branding. Rendered inside AuthLayout.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Checkbox, Typography, Alert, Space } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import useAuth from '../hooks/useAuth';

const { Text } = Typography;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      const userData = await login(values.username, values.password);
      const isVendor = (userData?.role || '').toLowerCase() === 'vendor';
      navigate(isVendor ? '/vendor-dashboard' : '/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'Invalid username or password. Please try again.');
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
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13 }}>Username</span>}
          name="username"
          rules={[{ required: true, message: 'Please enter username' }]}
          style={{ marginBottom: 20 }}
        >
          <Input
            prefix={<UserOutlined style={{ color: 'rgba(122, 146, 46, 0.55)', marginRight: 4 }} />}
            placeholder="Enter username"
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

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            className="cta-primary"
            style={{
              height: 48,
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            Sign In
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
