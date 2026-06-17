/**
 * AdminDashboard Page — HR Admin control panel.
 * Contains:
 *   1) User Management (Stats, Search, Table, Add/Edit User Modal, Delete User Modal)
 *   2) Module Access (User Sidebar, Modules Switch grid with auto-save and session invalidation)
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Row,
  Col,
  Card,
  Table,
  Button,
  Input,
  Select,
  Modal,
  Form,
  Switch,
  Tag,
  Avatar,
  Space,
  Typography,
  message,
  Tooltip,
} from 'antd';
import {
  UserOutlined,
  SearchOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PoweroffOutlined,
  SettingOutlined,
  SolutionOutlined,
  ReloadOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import adminService from '../services/adminService';
import useAuth from '../hooks/useAuth';

const { Title, Text } = Typography;

const MODULES_INFO = [
  { key: 'new_mrf',             label: '+ New MRF Request',                 desc: 'Create and submit Manpower Requisition Forms',      icon: '📋', color: '#1890ff' },
  { key: 'search_candidates',   label: 'Search & Edit Candidates',         desc: 'Search, update and manage candidate profiles',      icon: '🔍', color: '#52c41a' },
  { key: 'hr_manual_upload',    label: 'HR Manual Upload',                 desc: 'Upload candidate resumes for future hiring',        icon: '📤', color: '#faad14' },
  { key: 'system_config',       label: 'System Configuration',             desc: 'Manage configuration and automation settings',      icon: '⚙️', color: '#722ed1' },
  { key: 'vendor_upload',       label: 'Vendor Manual Upload',             desc: 'Upload vendor-sourced candidate resumes',           icon: '🏢', color: '#fa8c16' },
  { key: 'candidate_screening', label: 'Candidate Screening',              desc: 'Filter and screen candidates for open positions',   icon: '🎯', color: '#13c2c2' },
  { key: 'screening_analytics', label: 'Recruitment Screening Analytics',  desc: 'Track recruitment performance and analytics',       icon: '📊', color: '#eb2f96' },
];

export default function AdminDashboard() {
  const { user: currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState('users'); // 'users' or 'modules'
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Selected User for Module Permissions
  const [selectedModUser, setSelectedModUser] = useState(null);
  const [userPermissions, setUserPermissions] = useState({});
  const [permsLoading, setPermsLoading] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);

  // Modals state
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form] = Form.useForm();
  const [autoGenCreds, setAutoGenCreds] = useState(null);

  // Delete Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

  // Toggle status Modal
  const [toggleModalOpen, setToggleModalOpen] = useState(false);
  const [userToToggle, setUserToToggle] = useState(null);

  const isAuthorized = useMemo(() => {
    return currentUser?.role && ['admin', 'superadmin'].includes(currentUser.role.toLowerCase());
  }, [currentUser]);

  const nonAdminUsers = useMemo(() => {
    return users.filter((u) => !['admin', 'superadmin'].includes((u.role || '').toLowerCase()));
  }, [users]);

  // Auto-select first non-admin user when list loads and activeTab is modules
  useEffect(() => {
    if (activeTab === 'modules' && !selectedModUser && nonAdminUsers.length > 0) {
      handleSelectModUser(nonAdminUsers[0]);
    }
  }, [activeTab, nonAdminUsers, selectedModUser]);

  // Load all users
  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await adminService.listUsers();
      setUsers(res.data || []);
    } catch (err) {
      message.error('Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const nameText = `${u.first_name || ''} ${u.last_name || ''} ${u.email || ''} ${u.username || ''}`.toLowerCase();
      const matchesSearch = nameText.includes(searchQuery.toLowerCase());
      const matchesRole = !roleFilter || (u.role || '').toLowerCase() === roleFilter.toLowerCase();
      const matchesStatus = !statusFilter || (statusFilter === 'active' ? u.is_active : !u.is_active);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    return {
      total: users.length,
      active: users.filter((u) => u.is_active).length,
      inactive: users.filter((u) => !u.is_active).length,
    };
  }, [users]);

  // Load permissions for selected sidebar user
  const handleSelectModUser = async (userRecord) => {
    setSelectedModUser(userRecord);
    setPermsLoading(true);
    setAutoSaved(false);
    try {
      const res = await adminService.getModulesAccess(userRecord.id);
      const permMap = {};
      MODULES_INFO.forEach((m) => {
        permMap[m.key] = false;
      });
      (res.data || []).forEach((p) => {
        permMap[p.module_key] = p.is_enabled;
      });
      setUserPermissions(permMap);
    } catch (err) {
      message.error('Failed to load user permissions.');
    } finally {
      setPermsLoading(false);
    }
  };

  // Toggle permission switcher
  const handlePermissionToggle = async (moduleKey, checked) => {
    if (!selectedModUser) return;
    try {
      await adminService.setModulesAccess(selectedModUser.id, moduleKey, checked);
      setUserPermissions((prev) => ({
        ...prev,
        [moduleKey]: checked,
      }));
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 3000);
    } catch (err) {
      message.error('Failed to update permission.');
    }
  };

  // Auto-generate password generator
  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
    let pw = '';
    for (let i = 0; i < 12; i++) {
      pw += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const fn = (form.getFieldValue('first_name') || 'user').toLowerCase().trim();
    const ln = (form.getFieldValue('last_name') || 'name').toLowerCase().trim();
    const sfx = Math.floor(100 + Math.random() * 900);
    const generatedUsername = `${fn}.${ln}${sfx}`;

    form.setFieldsValue({
      password: pw,
      confirmPassword: pw,
    });

    setAutoGenCreds({ username: generatedUsername, password: pw });
    message.info('Password auto-generated!');
  };

  // Copy text helper
  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    message.success('Copied to clipboard!');
  };

  // Open User Create/Edit Modal
  const openUserModal = (record = null) => {
    setEditingUser(record);
    setAutoGenCreds(null);
    form.resetFields();
    if (record) {
      form.setFieldsValue({
        first_name: record.first_name,
        last_name: record.last_name,
        email: record.email,
        role: record.role,
        is_active: record.is_active ? '1' : '0',
      });
    }
    setUserModalOpen(true);
  };

  // Save User
  const handleSaveUser = async () => {
    try {
      const values = await form.validateFields();
      if (!editingUser) {
        // Create user
        if (values.password !== values.confirmPassword) {
          form.setFields([
            { name: 'confirmPassword', errors: ['Passwords do not match.'] },
          ]);
          return;
        }

        const payload = {
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email,
          username: autoGenCreds?.username || `${values.first_name.toLowerCase()}.${values.last_name.toLowerCase()}${Math.floor(100+Math.random()*900)}`,
          role: values.role,
          password: values.password,
          is_active: true,
          is_approved: true,
        };

        // Check email first
        const emailCheck = await adminService.checkEmail(payload.email);
        if (emailCheck.data && emailCheck.data.exists) {
          form.setFields([
            { name: 'email', errors: ['This email is already registered.'] },
          ]);
          return;
        }

        await adminService.createUser(payload);
        message.success(`User created successfully! Welcome email sent to ${payload.email}.`);
      } else {
        // Update user
        if (values.password && values.password !== values.confirmPassword) {
          form.setFields([
            { name: 'confirmPassword', errors: ['Passwords do not match.'] },
          ]);
          return;
        }

        const payload = {
          id: editingUser.id,
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email,
          role: values.role,
          is_active: values.is_active === '1',
        };
        if (values.password) {
          payload.password = values.password;
        }

        await adminService.updateUser(payload);
        message.success('User updated successfully.');
      }
      setUserModalOpen(false);
      loadUsers();
    } catch (err) {
      if (err?.data?.error === 'EMAIL_EXISTS') {
        form.setFields([{ name: 'email', errors: [err.message] }]);
      } else {
        message.error('An error occurred while saving user.');
      }
    }
  };

  // Open Toggle active status modal
  const openToggleModal = (record) => {
    setUserToToggle(record);
    setToggleModalOpen(true);
  };

  const confirmToggleStatus = async () => {
    if (!userToToggle) return;
    try {
      await adminService.toggleStatus(userToToggle.id, !userToToggle.is_active);
      message.success(`User ${!userToToggle.is_active ? 'activated' : 'deactivated'} successfully.`);
      setToggleModalOpen(false);
      loadUsers();
    } catch (err) {
      message.error('Failed to change user status.');
    }
  };

  // Open Delete modal
  const openDeleteModal = (record) => {
    setUserToDelete(record);
    setDeleteModalOpen(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await adminService.deleteUser(userToDelete.id);
      message.success('User deleted permanently.');
      setDeleteModalOpen(false);
      loadUsers();
    } catch (err) {
      message.error('Failed to delete user.');
    }
  };

  // AntD Users Table Columns
  const tableColumns = [
    {
      title: 'User',
      key: 'user',
      render: (_, record) => {
        const initials = `${(record.first_name || '')[0] || ''}${(record.last_name || '')[0] || ''}`.toUpperCase();
        return (
          <Space>
            <Avatar style={{ background: '#eef3da', color: '#5c6f1f', border: '1px solid #b8cc6e', fontWeight: 700 }}>
              {initials || '?'}
            </Avatar>
            <div>
              <Text strong style={{ fontSize: 13, display: 'block' }}>
                {record.first_name} {record.last_name}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {record.email}
              </Text>
            </div>
          </Space>
        );
      },
    },
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (text) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{text}</Text>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role) => (
        <span
          style={{
            background: '#eef3da',
            color: '#5c6f1f',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 5,
            textTransform: 'uppercase',
            letterSpacing: '0.4px',
          }}
        >
          {role}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => (
        <Tag
          color={record.is_active ? 'success' : 'error'}
          style={{
            borderRadius: 999,
            fontWeight: 600,
            fontSize: 11,
            padding: '1px 10px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: record.is_active ? '#52c41a' : '#ff4d4f',
              marginRight: 6,
              verticalAlign: 'middle',
            }}
          />
          {record.is_active ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date) => <Text type="secondary" style={{ fontSize: 12 }}>{date ? date.split('T')[0] : '—'}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_, record) => {
        const isSelf = record.id === currentUser?.id;
        return (
          <Space>
            <Tooltip title={isAuthorized ? "Edit" : "Only Superadmin and Admin role can perform this operation"}>
              <span>
                <Button
                  type="text"
                  size="small"
                  disabled={!isAuthorized}
                  icon={<EditOutlined />}
                  onClick={() => openUserModal(record)}
                  style={{ color: !isAuthorized ? '#d9d9d9' : '#7a922e' }}
                />
              </span>
            </Tooltip>
            <Tooltip title={!isAuthorized ? "Only Superadmin and Admin role can perform this operation" : (isSelf ? "Cannot deactivate/activate your own account" : (record.is_active ? 'Deactivate' : 'Activate'))}>
              <span>
                <Button
                  type="text"
                  size="small"
                  disabled={isSelf || !isAuthorized}
                  icon={<PoweroffOutlined />}
                  onClick={() => openToggleModal(record)}
                  style={{ color: (isSelf || !isAuthorized) ? '#d9d9d9' : '#fa8c16' }}
                />
              </span>
            </Tooltip>
            <Tooltip title={!isAuthorized ? "Only Superadmin and Admin role can perform this operation" : (isSelf ? "Cannot delete your own account" : "Delete")}>
              <span>
                <Button
                  type="text"
                  size="small"
                  disabled={isSelf || !isAuthorized}
                  icon={<DeleteOutlined />}
                  onClick={() => openDeleteModal(record)}
                  style={{ color: (isSelf || !isAuthorized) ? '#d9d9d9' : '#ff4d4f' }}
                />
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Tab Navigation header */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #dde2d0',
          padding: '0 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            type="text"
            onClick={() => setActiveTab('users')}
            style={{
              height: 52,
              borderRadius: 0,
              borderBottom: activeTab === 'users' ? '2px solid #7a922e' : '2px solid transparent',
              color: activeTab === 'users' ? '#5c6f1f' : '#6b7561',
              fontWeight: 600,
              fontSize: 13,
            }}
            icon={<UserOutlined />}
          >
            User Management
          </Button>
          <Button
            type="text"
            onClick={() => {
              setActiveTab('modules');
              if (nonAdminUsers.length > 0 && !selectedModUser) {
                handleSelectModUser(nonAdminUsers[0]);
              }
            }}
            style={{
              height: 52,
              borderRadius: 0,
              borderBottom: activeTab === 'modules' ? '2px solid #7a922e' : '2px solid transparent',
              color: activeTab === 'modules' ? '#5c6f1f' : '#6b7561',
              fontWeight: 600,
              fontSize: 13,
            }}
            icon={<SettingOutlined />}
          >
            Module Access
          </Button>
        </div>
        <div>
          <ReloadOutlined style={{ color: '#7a922e', cursor: 'pointer' }} onClick={loadUsers} spin={loading} />
        </div>
      </div>

      {/* Tab Content 1: User Management */}
      {activeTab === 'users' && (
        <div className="animate-fade-in">
          {/* Stats Metrics Cards */}
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={8}>
              <Card
                bordered={false}
                style={{
                  borderRadius: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', right: -15, top: -15, width: 50, height: 50, borderRadius: '50%', background: '#eef3da', opacity: 0.6 }} />
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>
                  Total Users
                </Text>
                <Title level={2} style={{ margin: '8px 0 0 0', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 34 }}>
                  {stats.total}
                </Title>
                <Text type="secondary" style={{ fontSize: 11 }}>All registered accounts</Text>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                bordered={false}
                style={{
                  borderRadius: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', right: -15, top: -15, width: 50, height: 50, borderRadius: '50%', background: '#f0fdf4', opacity: 0.6 }} />
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>
                  Active
                </Text>
                <Title level={2} style={{ margin: '8px 0 0 0', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 34, color: '#166534' }}>
                  {stats.active}
                </Title>
                <Text type="secondary" style={{ fontSize: 11 }}>Can log in</Text>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                bordered={false}
                style={{
                  borderRadius: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', right: -15, top: -15, width: 50, height: 50, borderRadius: '50%', background: '#fdf2f0', opacity: 0.6 }} />
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>
                  Inactive
                </Text>
                <Title level={2} style={{ margin: '8px 0 0 0', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 34, color: '#c0392b' }}>
                  {stats.inactive}
                </Title>
                <Text type="secondary" style={{ fontSize: 11 }}>Access revoked</Text>
              </Card>
            </Col>
          </Row>

          {/* User Management Toolbar Card */}
          <Card
            bordered={false}
            style={{
              borderRadius: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)',
            }}
            styles={{ body: { padding: 0 } }}
          >
            {/* Toolbar */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #dde2d0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <Space wrap size={12}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>User Management</span>
                <Input
                  prefix={<SearchOutlined style={{ color: '#6b7561' }} />}
                  placeholder="Search name / email…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: 220, borderRadius: 6 }}
                />
                <Select
                  value={roleFilter}
                  onChange={setRoleFilter}
                  style={{ width: 130 }}
                  options={[
                    { value: '', label: 'All Roles' },
                    { value: 'admin', label: 'Admin' },
                    { value: 'recruiter', label: 'Recruiter' },
                    { value: 'vendor', label: 'Vendor' },
                  ]}
                />
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  style={{ width: 130 }}
                  options={[
                    { value: '', label: 'All Status' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                />
              </Space>
              <Tooltip title={!isAuthorized ? "Only Superadmin and Admin role can perform this operation" : ""}>
                <span>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={!isAuthorized}
                    onClick={() => openUserModal()}
                    style={{ background: !isAuthorized ? '#d9d9d9' : '#7a922e', borderColor: !isAuthorized ? '#d9d9d9' : '#7a922e', borderRadius: 6, fontWeight: 600 }}
                  >
                    Add User
                  </Button>
                </span>
              </Tooltip>
            </div>

            {/* Users Table */}
            <Table
              dataSource={filteredUsers}
              columns={tableColumns}
              rowKey="id"
              loading={loading}
              pagination={{
                pageSize: 10,
                showSizeChanger: false,
                style: { paddingRight: 20 },
              }}
            />
          </Card>
        </div>
      )}

      {/* Tab Content 2: Module Access permissions */}
      {activeTab === 'modules' && (
        <div className="animate-fade-in">
          <Row gutter={[20, 20]}>
            {/* Left User Sider List */}
            <Col xs={24} md={8}>
              <Card
                title={<span style={{ fontSize: 12, fontWeight: 700, color: '#6b7561', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Select User</span>}
                bordered={false}
                style={{
                  borderRadius: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                  height: '100%',
                }}
                styles={{ body: { padding: 0 } }}
              >
                <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                  {nonAdminUsers.map((u) => {
                    const selected = selectedModUser?.id === u.id;
                    const initials = `${(u.first_name || '')[0] || ''}${(u.last_name || '')[0] || ''}`.toUpperCase();
                    return (
                      <div
                        key={u.id}
                        onClick={() => handleSelectModUser(u)}
                        style={{
                          padding: '12px 16px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f0f2eb',
                          background: selected ? '#eef3da' : 'transparent',
                          borderLeft: selected ? '3px solid #7a922e' : '3px solid transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          transition: 'all 0.1s',
                        }}
                      >
                        <Avatar style={{ background: '#eef3da', color: '#5c6f1f', border: '1px solid #b8cc6e', fontWeight: 700, width: 30, height: 30 }}>
                          {initials || '?'}
                        </Avatar>
                        <div>
                          <Text strong style={{ fontSize: 13, color: selected ? '#5c6f1f' : 'var(--text)', display: 'block' }}>
                            {u.first_name} {u.last_name}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>{u.role}</Text>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Col>

            {/* Right Modules Permission Panel */}
            <Col xs={24} md={16}>
              <Card
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                        {selectedModUser ? `${selectedModUser.first_name} ${selectedModUser.last_name}` : 'Select a user'}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 400, color: '#6b7561', marginTop: 3 }}>
                        {selectedModUser ? `Configure module access for ${selectedModUser.email}` : 'Choose a user from the left to manage their module access'}
                      </div>
                    </div>
                    {autoSaved && (
                      <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>✓ Auto-saved</div>
                    )}
                  </div>
                }
                bordered={false}
                style={{
                  borderRadius: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}
              >
                {!selectedModUser ? (
                  <div style={{ textAlign: 'center', padding: '60px 24px', color: '#6b7561' }}>
                    <SolutionOutlined style={{ fontSize: 48, opacity: 0.3, marginBottom: 14 }} />
                    <Title level={4} style={{ fontSize: 14, margin: '0 0 5px 0' }}>No user selected</Title>
                    <Text type="secondary">Pick a user from the left panel to configure their module access.</Text>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Module Permission Switch Row Grid */}
                    {MODULES_INFO.map((mod) => {
                      const enabled = !!userPermissions[mod.key];
                      return (
                        <div
                          key={mod.key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '16px 18px',
                            border: '1px solid #dde2d0',
                            borderRadius: 8,
                            background: enabled ? '#eef3da' : '#f8f9f5',
                            borderColor: enabled ? '#b8cc6e' : '#dde2d0',
                            transition: 'all 0.2s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div
                              style={{
                                width: 38,
                                height: 38,
                                borderRadius: 8,
                                background: enabled ? '#ffffff' : 'rgba(0,0,0,0.04)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 16,
                                flexShrink: 0,
                                border: enabled ? '1px solid #b8cc6e' : 'none',
                              }}
                            >
                              {mod.icon}
                            </div>
                            <div>
                              <Text strong style={{ fontSize: 13, color: 'var(--text)' }}>{mod.label}</Text>
                              <div style={{ fontSize: 11.5, color: '#6b7561', marginTop: 2 }}>{mod.desc}</div>
                              <span
                                style={{
                                  display: 'inline-block',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  marginTop: 4,
                                  background: enabled ? '#f0fdf4' : '#fdf2f0',
                                  color: enabled ? '#166534' : '#c0392b',
                                }}
                              >
                                {enabled ? '● Enabled' : '● Restricted'}
                              </span>
                            </div>
                          </div>
                          <Switch
                            checked={enabled}
                            loading={permsLoading}
                            onChange={(checked) => handlePermissionToggle(mod.key, checked)}
                            style={{ background: enabled ? '#7a922e' : '#d9d9d9' }}
                          />
                        </div>
                      );
                    })}

                    {/* HR Admin permission switch explicitly */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 18px',
                        border: '1px dashed #dde2d0',
                        borderRadius: 8,
                        background: userPermissions['hr_admin'] ? '#eef3da' : '#ffffff',
                        borderColor: userPermissions['hr_admin'] ? '#b8cc6e' : '#dde2d0',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 8, background: '#ffffff', border: '1px solid #dde2d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                          🛡️
                        </div>
                        <div>
                          <Text strong style={{ fontSize: 13, color: 'var(--text)' }}>HR Admin Portal Access</Text>
                          <div style={{ fontSize: 11.5, color: '#6b7561', marginTop: 2 }}>Grants permission to access this user and permission dashboard</div>
                          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, marginTop: 4, background: userPermissions['hr_admin'] ? '#f0fdf4' : '#fdf2f0', color: userPermissions['hr_admin'] ? '#166534' : '#c0392b' }}>
                            {userPermissions['hr_admin'] ? '● Enabled' : '● Restricted'}
                          </span>
                        </div>
                      </div>
                      <Switch
                        checked={!!userPermissions['hr_admin']}
                        loading={permsLoading}
                        onChange={(checked) => handlePermissionToggle('hr_admin', checked)}
                        style={{ background: userPermissions['hr_admin'] ? '#7a922e' : '#d9d9d9' }}
                      />
                    </div>
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        </div>
      )}

      {/* CREATE / EDIT USER MODAL */}
      <Modal
        title={
          <div style={{ fontSize: 16, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
            {editingUser ? 'Edit User Details' : 'Add New User'}
          </div>
        }
        open={userModalOpen}
        onOk={handleSaveUser}
        onCancel={() => setUserModalOpen(false)}
        okText={editingUser ? 'Save Changes' : 'Create User & Send Email'}
        okButtonProps={{ style: { background: '#7a922e', borderColor: '#7a922e' } }}
        width={540}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 11, fontWeight: 700, color: '#5c6f1f', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
            Personal Information
          </Text>
          <Row gutter={14}>
            <Col span={12}>
              <Form.Item label="First Name" name="first_name" rules={[{ required: true, message: 'First name is required' }]}>
                <Input placeholder="e.g. Priya" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Last Name" name="last_name" rules={[{ required: true, message: 'Last name is required' }]}>
                <Input placeholder="e.g. Sharma" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="Email Address"
            name="email"
            rules={[
              { required: true, message: 'Email address is required' },
              { type: 'email', message: 'Enter a valid email address' },
            ]}
          >
            <Input placeholder="priya.sharma@aapnainfotech.com" disabled={!!editingUser} />
          </Form.Item>

          <hr style={{ border: 'none', borderTop: '1px solid #dde2d0', margin: '16px 0' }} />

          <Text style={{ fontSize: 11, fontWeight: 700, color: '#5c6f1f', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
            Account Settings
          </Text>
          <Form.Item label="Role" name="role" rules={[{ required: true, message: 'Please select a role' }]}>
            <Select placeholder="— Select role —">
              <Select.Option value="admin">Admin</Select.Option>
              <Select.Option value="recruiter">Recruiter</Select.Option>
              <Select.Option value="vendor">Vendor</Select.Option>
            </Select>
          </Form.Item>

          {!editingUser ? (
            <div>
              <hr style={{ border: 'none', borderTop: '1px solid #dde2d0', margin: '16px 0' }} />
              <Text style={{ fontSize: 11, fontWeight: 700, color: '#5c6f1f', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
                Set Password
              </Text>
              <Row gutter={14}>
                <Col span={12}>
                  <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Password is required' }]}>
                    <Input.Password placeholder="Min 8 characters" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Confirm Password" name="confirmPassword" rules={[{ required: true, message: 'Please confirm password' }]}>
                    <Input.Password placeholder="Re-enter" />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Button
                  icon={<SafetyOutlined />}
                  onClick={generatePassword}
                  style={{ borderRadius: 6 }}
                >
                  Auto-Generate Password
                </Button>
                <span style={{ fontSize: 11.5, color: '#6b7561' }}>Generates a secure random password</span>
              </div>

              {autoGenCreds && (
                <div style={{ background: '#eef3da', border: '1px solid #b8cc6e', borderRadius: 6, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#5c6f1f', textTransform: 'uppercase' }}>Username</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{autoGenCreds.username}</span>
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => handleCopyText(autoGenCreds.username)}>Copy</Button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#5c6f1f', textTransform: 'uppercase' }}>Password</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{autoGenCreds.password}</span>
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => handleCopyText(autoGenCreds.password)}>Copy</Button>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#6b7561', marginTop: 8 }}>✉️ These credentials will be emailed to the user upon account creation.</div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <Form.Item label="Account Status" name="is_active">
                <Select>
                  <Select.Option value="1">Active</Select.Option>
                  <Select.Option value="0">Inactive</Select.Option>
                </Select>
              </Form.Item>
              <hr style={{ border: 'none', borderTop: '1px solid #dde2d0', margin: '16px 0' }} />
              <Text style={{ fontSize: 11, fontWeight: 700, color: '#5c6f1f', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
                Change Password (Optional)
              </Text>
              <Row gutter={14}>
                <Col span={12}>
                  <Form.Item label="New Password" name="password">
                    <Input.Password placeholder="Leave blank to keep current" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Confirm New Password" name="confirmPassword">
                    <Input.Password placeholder="Re-enter" />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, marginTop: 8 }}>
                <Button
                  icon={<SafetyOutlined />}
                  onClick={generatePassword}
                  style={{ borderRadius: 6 }}
                >
                  Auto-Generate Password
                </Button>
                <span style={{ fontSize: 11.5, color: '#6b7561' }}>Generates a secure random password</span>
              </div>

              {autoGenCreds && (
                <div style={{ background: '#eef3da', border: '1px solid #b8cc6e', borderRadius: 6, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#5c6f1f', textTransform: 'uppercase' }}>Generated Password</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{autoGenCreds.password}</span>
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => handleCopyText(autoGenCreds.password)}>Copy</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Form>
      </Modal>

      {/* STATUS TOGGLE MODAL */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{userToToggle?.is_active ? 'Deactivate User?' : 'Activate User?'}</span>
          </div>
        }
        open={toggleModalOpen}
        onOk={confirmToggleStatus}
        onCancel={() => setToggleModalOpen(false)}
        okText="Confirm"
        okButtonProps={{ style: { background: '#7a922e', borderColor: '#7a922e' } }}
        width={400}
      >
        <div style={{ padding: '10px 0' }}>
          <Text style={{ fontSize: 13.5, color: 'var(--text)' }}>
            {userToToggle?.is_active
              ? `"${userToToggle?.first_name} ${userToToggle?.last_name}" will lose login access.`
              : `"${userToToggle?.first_name} ${userToToggle?.last_name}" will be able to log in again.`}
          </Text>
        </div>
      </Modal>

      {/* DELETE USER CONFIRMATION MODAL */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗑️</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Delete User?</span>
          </div>
        }
        open={deleteModalOpen}
        onOk={confirmDeleteUser}
        onCancel={() => setDeleteModalOpen(false)}
        okText="Delete Permanently"
        okButtonProps={{ danger: true, type: 'primary' }}
        width={400}
      >
        <div style={{ padding: '10px 0' }}>
          <Text style={{ fontSize: 13.5, color: 'var(--text)' }}>
            Delete &quot;{userToDelete?.first_name} {userToDelete?.last_name}&quot; ({userToDelete?.email})? This is permanent.
          </Text>
        </div>
      </Modal>
    </div>
  );
}
