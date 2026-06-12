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
      await login(values.username, values.password);
      navigate('/dashboard', { replace: true });
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
          label={<span style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>Username</span>}
          name="username"
          rules={[{ required: true, message: 'Please enter username' }]}
          style={{ marginBottom: 18 }}
        >
          <Input
            placeholder="Enter username"
            autoComplete="off"
            style={{ borderRadius: 8, height: 42 }}
          />
        </Form.Item>

        <Form.Item
          label={<span style={{ fontWeight: 600, color: '#374151', fontSize: 13 }}>Password</span>}
          name="password"
          rules={[{ required: true, message: 'Please enter password' }]}
          style={{ marginBottom: 24 }}
        >
          <Input.Password
            placeholder="Enter password"
            autoComplete="new-password"
            style={{ borderRadius: 8, height: 42 }}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            style={{
              height: 44,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 15,
              background: '#005f56',
              border: 'none',
            }}
          >
            Sign In
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
