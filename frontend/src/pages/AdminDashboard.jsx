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
  BankOutlined,
  TeamOutlined,
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
  { key: 'vendor_dashboard',    label: 'Vendor Dashboard',                 desc: 'View status of vendor-submitted candidates',        icon: '📈', color: '#2f54eb' },
  { key: 'candidate_screening', label: 'Candidate Screening',              desc: 'Filter and screen candidates for open positions',   icon: '🎯', color: '#13c2c2' },
  { key: 'screening_analytics', label: 'Recruitment Screening Analytics',  desc: 'Track recruitment performance and analytics',       icon: '📊', color: '#eb2f96' },
];

// Per-role badge metadata — distinct, on-brand colors so the hierarchy reads at a glance.
const ROLE_META = {
  superadmin: { label: 'Super Admin', cls: 'role-badge--superadmin' },
  admin:      { label: 'Admin',       cls: 'role-badge--admin' },
  recruiter:  { label: 'Recruiter',   cls: 'role-badge--recruiter' },
  vendor:     { label: 'Vendor',      cls: 'role-badge--vendor' },
};

/** Colored, uppercase role pill. */
function RoleBadge({ role }) {
  const key = (role || '').toLowerCase();
  const meta = ROLE_META[key] || { label: role || '—', cls: 'role-badge--admin' };
  return <span className={`role-badge ${meta.cls}`}>{meta.label}</span>;
}

export default function AdminDashboard() {
  const { user: currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState('users'); // 'users' or 'modules'
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState(''); // superadmin only

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

  // Companies (superadmin only)
  const [companies, setCompanies] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [companyForm] = Form.useForm();

  const isAuthorized = useMemo(() => {
    return currentUser?.role && ['admin', 'superadmin'].includes(currentUser.role.toLowerCase());
  }, [currentUser]);

  const isSuper = useMemo(
    () => (currentUser?.role || '').toLowerCase() === 'superadmin',
    [currentUser],
  );

  // Roles a requester may assign. A company admin may assign Company Admin /
  // Recruiter / Vendor within their own company; a superadmin can additionally
  // assign the global Super Admin role.
  const roleOptions = useMemo(() => {
    const base = [
      { value: 'admin', label: 'Company Admin' },
      { value: 'recruiter', label: 'Recruiter' },
      { value: 'vendor', label: 'Vendor' },
    ];
    return isSuper ? [{ value: 'superadmin', label: 'Super Admin' }, ...base] : base;
  }, [isSuper]);

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

  // Load companies (superadmin only)
  const loadCompanies = async () => {
    setCompaniesLoading(true);
    try {
      const res = await adminService.listCompanies();
      setCompanies(res.data || []);
    } catch (err) {
      message.error('Failed to load companies.');
    } finally {
      setCompaniesLoading(false);
    }
  };

  useEffect(() => {
    if (isSuper) loadCompanies();
  }, [isSuper]);

  // Map company_id -> name for the User table column (covers the superadmin's
  // cross-company view; the backend also returns company_name on each user).
  const companyNameById = useMemo(() => {
    const map = {};
    companies.forEach((c) => { map[c.id] = c.name; });
    return map;
  }, [companies]);

  // Open the Company create/edit modal
  const openCompanyModal = (record = null) => {
    setEditingCompany(record);
    companyForm.resetFields();
    if (record) {
      companyForm.setFieldsValue({ name: record.name, slug: record.slug, domain: record.domain });
    }
    setCompanyModalOpen(true);
  };

  const handleSaveCompany = async () => {
    try {
      const values = await companyForm.validateFields();
      if (editingCompany) {
        await adminService.updateCompany({ id: editingCompany.id, ...values });
        message.success('Company updated.');
      } else {
        await adminService.createCompany(values);
        message.success('Company created.');
      }
      setCompanyModalOpen(false);
      loadCompanies();
    } catch (err) {
      if (err?.errorFields) return; // form validation error — already shown
      message.error(err?.data?.message || 'Failed to save company.');
    }
  };

  const handleToggleCompany = async (record) => {
    try {
      await adminService.toggleCompanyStatus(record.id, !record.is_active);
      message.success(`Company ${!record.is_active ? 'activated' : 'deactivated'}.`);
      loadCompanies();
    } catch (err) {
      message.error('Failed to change company status.');
    }
  };

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const nameText = `${u.first_name || ''} ${u.last_name || ''} ${u.email || ''} ${u.username || ''}`.toLowerCase();
      const matchesSearch = nameText.includes(searchQuery.toLowerCase());
      const matchesRole = !roleFilter || (u.role || '').toLowerCase() === roleFilter.toLowerCase();
      const matchesStatus = !statusFilter || (statusFilter === 'active' ? u.is_active : !u.is_active);
      const matchesCompany = !companyFilter || String(u.company_id) === String(companyFilter);
      return matchesSearch && matchesRole && matchesStatus && matchesCompany;
    });
  }, [users, searchQuery, roleFilter, statusFilter, companyFilter]);

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
        company_id: record.company_id ?? undefined,
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
        // Only superadmin assigns a company. A superadmin account is global
        // (company_id null); every other role carries its selected company.
        if (isSuper) {
          payload.company_id = values.role === 'superadmin' ? null : values.company_id;
        }

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
        // Only superadmin may reassign a user's company. Driven by the chosen
        // role so a promotion to superadmin clears the company (global).
        if (isSuper) {
          payload.company_id = values.role === 'superadmin' ? null : values.company_id;
        }

        await adminService.updateUser(payload);
        message.success('User updated successfully.');
      }
      setUserModalOpen(false);
      loadUsers();
    } catch (err) {
      if (err?.errorFields) return; // form validation error — inline messages already shown
      if (err?.data?.error === 'EMAIL_EXISTS') {
        form.setFields([{ name: 'email', errors: [err.message] }]);
      } else {
        message.error(err?.message || 'An error occurred while saving user.');
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
      render: (role) => <RoleBadge role={role} />,
    },
    ...(isSuper ? [{
      title: 'Company',
      key: 'company',
      render: (_, record) => {
        const name = record.company_name || companyNameById[record.company_id];
        return name
          ? <Text style={{ fontSize: 12 }}>{name}</Text>
          : <Text type="secondary" style={{ fontSize: 12 }}>— Global —</Text>;
      },
    }] : []),
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
        // Only a superadmin may see/manage superadmin accounts.
        const targetIsSuper = (record.role || '').toLowerCase() === 'superadmin';
        if (targetIsSuper && !isSuper) {
          return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        }
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
    <div className="admin-portal" style={{ padding: '28px 24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Capsule / segmented tab bar */}
      <div className="admin-tabbar">
        <div className="admin-tabs">
          <Button
            type="text"
            className={`admin-tab ${activeTab === 'users' ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab('users')}
            icon={<UserOutlined />}
          >
            User Management
          </Button>
          <Button
            type="text"
            className={`admin-tab ${activeTab === 'modules' ? 'admin-tab--active' : ''}`}
            onClick={() => {
              setActiveTab('modules');
              if (nonAdminUsers.length > 0 && !selectedModUser) {
                handleSelectModUser(nonAdminUsers[0]);
              }
            }}
            icon={<SettingOutlined />}
          >
            Module Access
          </Button>
          {isSuper && (
            <Button
              type="text"
              className={`admin-tab ${activeTab === 'companies' ? 'admin-tab--active' : ''}`}
              onClick={() => setActiveTab('companies')}
              icon={<BankOutlined />}
            >
              Companies
            </Button>
          )}
        </div>
        <ReloadOutlined
          style={{ color: 'var(--gold)', cursor: 'pointer', fontSize: 16 }}
          onClick={activeTab === 'companies' ? loadCompanies : loadUsers}
          spin={loading || companiesLoading}
        />
      </div>

      {/* Tab Content 1: User Management */}
      {activeTab === 'users' && (
        <div className="animate-fade-in">
          {/* Stats Metrics Cards */}
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} md={isSuper ? 6 : 8}>
              <Card bordered={false} className="admin-stat animate-fade-in-up stagger-1">
                <div className="admin-stat-body">
                  <div>
                    <Text type="secondary" className="admin-stat-label">Total Users</Text>
                    <Title level={2} className="admin-stat-num">{stats.total}</Title>
                    <Text type="secondary" style={{ fontSize: 11 }}>All registered accounts</Text>
                  </div>
                  <div className="admin-stat-icon" style={{ color: '#7a922e', background: 'rgba(122,146,46,0.10)' }}>
                    <TeamOutlined />
                  </div>
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={isSuper ? 6 : 8}>
              <Card bordered={false} className="admin-stat animate-fade-in-up stagger-2">
                <div className="admin-stat-body">
                  <div>
                    <Text type="secondary" className="admin-stat-label">Active</Text>
                    <Title level={2} className="admin-stat-num" style={{ color: '#166534' }}>{stats.active}</Title>
                    <Text type="secondary" style={{ fontSize: 11 }}>Can log in</Text>
                  </div>
                  <div className="admin-stat-icon" style={{ color: '#166534', background: 'rgba(22,101,52,0.10)' }}>
                    <CheckCircleOutlined />
                  </div>
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={isSuper ? 6 : 8}>
              <Card bordered={false} className="admin-stat animate-fade-in-up stagger-3">
                <div className="admin-stat-body">
                  <div>
                    <Text type="secondary" className="admin-stat-label">Inactive</Text>
                    <Title level={2} className="admin-stat-num" style={{ color: '#c0392b' }}>{stats.inactive}</Title>
                    <Text type="secondary" style={{ fontSize: 11 }}>Access revoked</Text>
                  </div>
                  <div className="admin-stat-icon" style={{ color: '#c0392b', background: 'rgba(192,57,43,0.10)' }}>
                    <CloseCircleOutlined />
                  </div>
                </div>
              </Card>
            </Col>
            {isSuper && (
              <Col xs={24} sm={12} md={6}>
                <Card bordered={false} className="admin-stat animate-fade-in-up stagger-4">
                  <div className="admin-stat-body">
                    <div>
                      <Text type="secondary" className="admin-stat-label">Companies</Text>
                      <Title level={2} className="admin-stat-num" style={{ color: '#1d6fb8' }}>{companies.length}</Title>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {companies.filter((c) => c.is_active).length} active tenants
                      </Text>
                    </div>
                    <div className="admin-stat-icon" style={{ color: '#1d6fb8', background: 'rgba(29,111,184,0.10)' }}>
                      <BankOutlined />
                    </div>
                  </div>
                </Card>
              </Col>
            )}
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
                  style={{ width: 140 }}
                  options={[
                    { value: '', label: 'All Roles' },
                    ...(isSuper ? [{ value: 'superadmin', label: 'Super Admin' }] : []),
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
                {isSuper && (
                  <Select
                    value={companyFilter}
                    onChange={setCompanyFilter}
                    style={{ width: 180 }}
                    showSearch
                    optionFilterProp="label"
                    options={[
                      { value: '', label: 'All Companies' },
                      ...companies.map((c) => ({ value: String(c.id), label: c.name })),
                    ]}
                  />
                )}
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

      {/* Tab Content 3: Companies (superadmin only) */}
      {activeTab === 'companies' && isSuper && (
        <div className="animate-fade-in">
          <Card
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)' }}
            styles={{ body: { padding: 0 } }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #dde2d0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Companies</span>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => openCompanyModal()}
                style={{ background: '#7a922e', borderColor: '#7a922e', borderRadius: 6, fontWeight: 600 }}
              >
                Add Company
              </Button>
            </div>
            <Table
              dataSource={companies}
              rowKey="id"
              loading={companiesLoading}
              pagination={false}
              columns={[
                {
                  title: 'Company',
                  key: 'name',
                  render: (_, r) => (
                    <Space>
                      <Avatar style={{ background: '#eef3da', color: '#5c6f1f', border: '1px solid #b8cc6e' }} icon={<BankOutlined />} />
                      <div>
                        <Text strong style={{ fontSize: 13, display: 'block' }}>{r.name}</Text>
                        <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.slug}</Text>
                      </div>
                    </Space>
                  ),
                },
                {
                  title: 'Domain',
                  dataIndex: 'domain',
                  key: 'domain',
                  render: (d) => <Text style={{ fontSize: 12 }}>{d || '—'}</Text>,
                },
                {
                  title: 'Users',
                  dataIndex: 'user_count',
                  key: 'user_count',
                  render: (n) => <Text style={{ fontSize: 12 }}>{n ?? 0}</Text>,
                },
                {
                  title: 'Status',
                  key: 'status',
                  render: (_, r) => (
                    <Tag color={r.is_active ? 'success' : 'error'} style={{ borderRadius: 999, fontWeight: 600, fontSize: 11, padding: '1px 10px' }}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </Tag>
                  ),
                },
                {
                  title: 'Actions',
                  key: 'actions',
                  align: 'right',
                  render: (_, r) => (
                    <Space>
                      <Tooltip title="Edit">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openCompanyModal(r)} style={{ color: '#7a922e' }} />
                      </Tooltip>
                      <Tooltip title={r.is_active ? 'Deactivate' : 'Activate'}>
                        <Button type="text" size="small" icon={<PoweroffOutlined />} onClick={() => handleToggleCompany(r)} style={{ color: '#fa8c16' }} />
                      </Tooltip>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
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
            <Select placeholder="— Select role —" options={roleOptions} />
          </Form.Item>

          {/* Company assignment — superadmin only. Required for every non-superadmin role. */}
          {isSuper && (
            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) => prev.role !== cur.role}
            >
              {({ getFieldValue }) =>
                getFieldValue('role') === 'superadmin' ? null : (
                  <Form.Item
                    label="Company"
                    name="company_id"
                    rules={[{ required: true, message: 'Please assign a company' }]}
                  >
                    <Select
                      placeholder="— Select company —"
                      options={companies.map((c) => ({ value: c.id, label: c.name }))}
                      showSearch
                      optionFilterProp="label"
                    />
                  </Form.Item>
                )
              }
            </Form.Item>
          )}

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

      {/* CREATE / EDIT COMPANY MODAL (superadmin only) */}
      <Modal
        title={
          <div style={{ fontSize: 16, fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
            {editingCompany ? 'Edit Company' : 'Add New Company'}
          </div>
        }
        open={companyModalOpen}
        onOk={handleSaveCompany}
        onCancel={() => setCompanyModalOpen(false)}
        okText={editingCompany ? 'Save Changes' : 'Create Company'}
        okButtonProps={{ style: { background: '#7a922e', borderColor: '#7a922e' } }}
        width={460}
      >
        <Form form={companyForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Company Name" name="name" rules={[{ required: true, message: 'Company name is required' }]}>
            <Input placeholder="e.g. AAPNA Infotech" />
          </Form.Item>
          <Form.Item
            label="Slug"
            name="slug"
            tooltip="URL-safe identifier. Leave blank to derive from the name."
          >
            <Input placeholder="e.g. aapna" disabled={!!editingCompany} />
          </Form.Item>
          <Form.Item label="Email Domain (optional)" name="domain">
            <Input placeholder="e.g. aapnainfotech.com" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
