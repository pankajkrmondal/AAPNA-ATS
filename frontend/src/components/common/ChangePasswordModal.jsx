/**
 * ChangePasswordModal — self-service password change for the logged-in user.
 * Verifies the current password server-side; other sessions are invalidated
 * on success while the current one stays alive.
 */
import { useState } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import authService from '../../services/authService';

export default function ChangePasswordModal({ open, onClose }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  const handleOk = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // validation errors are shown inline
    }

    setSaving(true);
    try {
      await authService.changePassword(values.currentPassword, values.newPassword);
      message.success('Password changed successfully.');
      form.resetFields();
      onClose();
    } catch (err) {
      if (err?.status === 400) {
        form.setFields([
          { name: 'currentPassword', errors: [err.message || 'Current password is incorrect.'] },
        ]);
      } else {
        message.error(err?.message || 'Failed to change password.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Change Password"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Change Password"
      confirmLoading={saving}
      destroyOnClose
      width={420}
    >
      <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
        <Form.Item
          name="currentPassword"
          label="Current Password"
          rules={[{ required: true, message: 'Please enter your current password.' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Current password" autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="New Password"
          rules={[
            { required: true, message: 'Please enter a new password.' },
            { min: 8, message: 'Password must be at least 8 characters.' },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Min 8 characters" autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="Confirm New Password"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Please confirm the new password.' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Passwords do not match.'));
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Re-enter new password" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
