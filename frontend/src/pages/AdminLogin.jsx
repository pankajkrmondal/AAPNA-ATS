/**
 * AdminLogin Page — Premium login form for HR Admin system access.
 * Replicates the legacy Welcome Back layout with custom badges and icons.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
import { LoginOutlined, UserOutlined, LockOutlined } from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import adminService from '../services/adminService';

export default function AdminLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, logout } = useAuth();
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      // Log in and verify admin portal permissions in one operation
      await login(values.username, values.password, true);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'Invalid username or password. Please try again.');
      // Clean up session in case verification failed
      localStorage.removeItem('ats_token');
      localStorage.removeItem('ats_user');
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
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Username</span>}
          name="username"
          rules={[{ required: true, message: 'Please enter your username' }]}
          style={{ marginBottom: 18 }}
        >
          <Input
            prefix={<UserOutlined style={{ color: 'rgba(0, 95, 86, 0.45)', marginRight: 4 }} />}
            placeholder="Enter your username"
            autoComplete="off"
            style={{ borderRadius: 8, height: 42 }}
          />
        </Form.Item>

        <Form.Item
          label={<span style={{ fontWeight: 600, color: 'var(--text)', opacity: 0.9, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Password</span>}
          name="password"
          rules={[{ required: true, message: 'Please enter your password' }]}
          style={{ marginBottom: 24 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: 'rgba(0, 95, 86, 0.45)', marginRight: 4 }} />}
            placeholder="Enter your password"
            autoComplete="new-password"
            style={{ borderRadius: 8, height: 42 }}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            icon={<LoginOutlined />}
            block
            style={{
              height: 44,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
              background: 'linear-gradient(135deg, #005f56 0%, #007a6f 100%)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 12px rgba(0, 95, 86, 0.25)',
              transition: 'all 0.2s',
            }}
          >
            Sign In
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
