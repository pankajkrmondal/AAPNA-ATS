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
import ExportButton from '../components/common/ExportButton';
import useAuth from '../hooks/useAuth';

const { Title, Text } = Typography;

/**
 * Per-module identity colours.
 *
 * DELIBERATELY RAW HEX, and the one set in this file the Aurora Glass token
 * sweep left alone. These are nine arbitrary hues whose only job is to be
 * *distinguishable from each other* in a grid of module chips — they carry no
 * semantic meaning (nothing here is "success" or "warning") and they must not
 * follow a tenant's brand, because a tenant-tinted set would collapse toward
 * one hue and stop doing the only thing it exists to do.
 *
 * Every other colour in this file is now a token. If these ever need theming,
 * they want their own `--module-*` scale, not the semantic palette.
 */
const MODULES_INFO = [
  { key: 'new_mrf',             label: '+ New MRF Request',                 desc: 'Create and submit Manpower Requisition Forms',      icon: '📋', color: '#1890ff' },
  { key: 'search_candidates',   label: 'Search & Edit Candidates',         desc: 'Search, update and manage candidate profiles',      icon: '🔍', color: '#52c41a' },
  { key: 'hr_manual_upload',    label: 'HR Manual Upload',                 desc: 'Upload candidate resumes for future hiring',        icon: '📤', color: '#faad14' },
  { key: 'system_config',       label: 'System Configuration',             desc: 'Manage configuration and automation settings',      icon: '⚙️', color: '#722ed1' },
  { key: 'vendor_upload',       label: 'Vendor Manual Upload',             desc: 'Upload vendor-sourced candidate resumes',           icon: '🏢', color: 'var(--warning)' },
  { key: 'vendor_dashboard',    label: 'Vendor Dashboard',                 desc: 'View status of vendor-submitted candidates',        icon: '📈', color: '#2f54eb' },
  { key: 'candidate_screening', label: 'Candidate Screening',              desc: 'Filter and screen candidates for open positions',   icon: '🎯', color: '#13c2c2' },
  { key: 'screening_analytics', label: 'Recruitment Analytics',            desc: 'Track recruitment performance and hiring metrics', icon: '📊', color: '#eb2f96' },
  { key: 'recruitment_pipeline', label: 'Candidate Pipeline',              desc: 'Track candidates through the interview pipeline (Phase 3)', icon: '🧭', color: '#08979c' },
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

  // Mirror of backend ROLE_RANK (config/roles.js) — a requester may manage
  // accounts of a strictly lower role, or edit their own account.
  const ROLE_RANK = { superadmin: 40, admin: 30, recruiter: 20, hr: 20, vendor: 10 };
  const outranks = (requesterRole, targetRole) =>
    (ROLE_RANK[(requesterRole || '').toLowerCase()] ?? 0) >
    (ROLE_RANK[(targetRole || '').toLowerCase()] ?? 0);

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

    form.setFieldsValue({
      password: pw,
      confirmPassword: pw,
    });

    setAutoGenCreds({ password: pw });
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
        username: record.username,
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
          username: values.username?.trim() || values.email.trim(),
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
          username: values.username?.trim() || values.email,
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
        form.setFields([
          { name: 'email', errors: [err.message] },
          { name: 'username', errors: [err.message] },
        ]);
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
            <Avatar style={{ background: 'var(--gold-bg)', color: 'var(--gold-dark)', border: '1px solid var(--gold-light)', fontWeight: 700 }}>
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
              background: record.is_active ? 'var(--status-approved)' : 'var(--red)',
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
        // Edit: own account, a strictly lower role, or (superadmin only) a peer
        // superadmin's details — the password section is hidden for peers.
        const canEdit = isAuthorized && (isSelf || outranks(currentUser?.role, record.role) || (isSuper && targetIsSuper));
        // Toggle status: lower roles (plus peer superadmins for a superadmin), never self.
        const canToggle = isAuthorized && !isSelf && (outranks(currentUser?.role, record.role) || (isSuper && targetIsSuper));
        // Delete: superadmin only, never self.
        const canDelete = isSuper && !isSelf;
        return (
          <Space>
            <Tooltip title={canEdit ? "Edit" : (!isAuthorized ? "Only Superadmin and Admin role can perform this operation" : "You can only edit your own account and lower-role accounts")}>
              <span>
                <Button
                  type="text"
                  size="small"
                  disabled={!canEdit}
                  icon={<EditOutlined />}
                  onClick={() => openUserModal(record)}
                  style={{ color: !canEdit ? 'var(--border)' : 'var(--gold)' }}
                />
              </span>
            </Tooltip>
            <Tooltip title={!isAuthorized ? "Only Superadmin and Admin role can perform this operation" : (isSelf ? "Cannot deactivate/activate your own account" : (!canToggle ? "You can only change the status of lower-role accounts" : (record.is_active ? 'Deactivate' : 'Activate')))}>
              <span>
                <Button
                  type="text"
                  size="small"
                  disabled={!canToggle}
                  icon={<PoweroffOutlined />}
                  onClick={() => openToggleModal(record)}
                  style={{ color: !canToggle ? 'var(--border)' : 'var(--warning)' }}
                />
              </span>
            </Tooltip>
            <Tooltip title={!isSuper ? "Only a SuperAdmin can delete users" : (isSelf ? "Cannot delete your own account" : "Delete")}>
              <span>
                <Button
                  type="text"
                  size="small"
                  disabled={!canDelete}
                  icon={<DeleteOutlined />}
                  onClick={() => openDeleteModal(record)}
                  style={{ color: !canDelete ? 'var(--border)' : 'var(--red)' }}
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
                  <div className="admin-stat-icon" style={{ color: 'var(--gold)', background: 'rgba(122,146,46,0.10)' }}>
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
                    <Title level={2} className="admin-stat-num" style={{ color: 'var(--success-text)' }}>{stats.active}</Title>
                    <Text type="secondary" style={{ fontSize: 11 }}>Can log in</Text>
                  </div>
                  <div className="admin-stat-icon" style={{ color: 'var(--success-text)', background: 'rgba(22,101,52,0.10)' }}>
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
                    <Title level={2} className="admin-stat-num" style={{ color: 'var(--red)' }}>{stats.inactive}</Title>
                    <Text type="secondary" style={{ fontSize: 11 }}>Access revoked</Text>
                  </div>
                  <div className="admin-stat-icon" style={{ color: 'var(--red)', background: 'rgba(192,57,43,0.10)' }}>
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
                      <Title level={2} className="admin-stat-num" style={{ color: 'var(--kpi-b)' }}>{companies.length}</Title>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {companies.filter((c) => c.is_active).length} active tenants
                      </Text>
                    </div>
                    <div className="admin-stat-icon" style={{ color: 'var(--kpi-b)', background: 'var(--kpi-b-tint)' }}>
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
                borderBottom: '1px solid var(--border)',
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
                  prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
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
              <Space size={8}>
                {/* Exports everything the caller is scoped to, not the
                    client-side filtered view. */}
                <ExportButton
                  request={(cfg) => adminService.exportUsers({}, cfg)}
                  fallbackName="AAPNA-ATS_Admin-Users.csv"
                  rowCount={users.length}
                />
                <Tooltip title={!isAuthorized ? "Only Superadmin and Admin role can perform this operation" : ""}>
                  <span>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      disabled={!isAuthorized}
                      onClick={() => openUserModal()}
                      style={!isAuthorized
                        ? { borderRadius: 6, fontWeight: 600 }
                        : { background: 'var(--gold)', borderColor: 'var(--gold)', borderRadius: 6, fontWeight: 600 }}
                    >
                      Add User
                    </Button>
                  </span>
                </Tooltip>
              </Space>
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
                title={<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Select User</span>}
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
                          borderBottom: '1px solid var(--border-light)',
                          background: selected ? 'var(--gold-bg)' : 'transparent',
                          borderLeft: selected ? '3px solid var(--gold)' : '3px solid transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          transition: 'all 0.1s',
                        }}
                      >
                        <Avatar style={{ background: 'var(--gold-bg)', color: 'var(--gold-dark)', border: '1px solid var(--gold-light)', fontWeight: 700, width: 30, height: 30 }}>
                          {initials || '?'}
                        </Avatar>
                        <div>
                          <Text strong style={{ fontSize: 13, color: selected ? 'var(--gold-dark)' : 'var(--text)', display: 'block' }}>
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
                      <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)', marginTop: 3 }}>
                        {selectedModUser ? `Configure module access for ${selectedModUser.email}` : 'Choose a user from the left to manage their module access'}
                      </div>
                    </div>
                    {autoSaved && (
                      <div style={{ fontSize: 12, color: 'var(--success-text)', fontWeight: 600 }}>✓ Auto-saved</div>
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
                  <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text-3)' }}>
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
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            background: enabled ? 'var(--gold-bg)' : 'var(--ink-4)',
                            borderColor: enabled ? 'var(--gold-light)' : 'var(--border)',
                            transition: 'all 0.2s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div
                              style={{
                                width: 38,
                                height: 38,
                                borderRadius: 8,
                                background: enabled ? 'var(--colorBgContainer)' : 'var(--ink-3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 16,
                                flexShrink: 0,
                                border: enabled ? '1px solid var(--gold-light)' : 'none',
                              }}
                            >
                              {mod.icon}
                            </div>
                            <div>
                              <Text strong style={{ fontSize: 13, color: 'var(--text)' }}>{mod.label}</Text>
                              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{mod.desc}</div>
                              <span
                                style={{
                                  display: 'inline-block',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  marginTop: 4,
                                  background: enabled ? 'rgba(82, 196, 26, 0.14)' : 'rgba(192, 57, 43, 0.12)',
                                  color: enabled ? 'var(--success-text)' : 'var(--red)',
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
                            style={enabled ? { background: 'var(--gold)' } : undefined}
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
                        border: '1px dashed var(--border)',
                        borderRadius: 8,
                        background: userPermissions['hr_admin'] ? 'var(--gold-bg)' : 'var(--colorBgContainer)',
                        borderColor: userPermissions['hr_admin'] ? 'var(--gold-light)' : 'var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--colorBgContainer)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                          🛡️
                        </div>
                        <div>
                          <Text strong style={{ fontSize: 13, color: 'var(--text)' }}>HR Admin Portal Access</Text>
                          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>Grants permission to access this user and permission dashboard</div>
                          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, marginTop: 4, background: userPermissions['hr_admin'] ? 'rgba(82, 196, 26, 0.14)' : 'rgba(192, 57, 43, 0.12)', color: userPermissions['hr_admin'] ? 'var(--success-text)' : 'var(--red)' }}>
                            {userPermissions['hr_admin'] ? '● Enabled' : '● Restricted'}
                          </span>
                        </div>
                      </div>
                      <Switch
                        checked={!!userPermissions['hr_admin']}
                        loading={permsLoading}
                        onChange={(checked) => handlePermissionToggle('hr_admin', checked)}
                        style={userPermissions['hr_admin'] ? { background: 'var(--gold)' } : undefined}
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
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Companies</span>
              <Space size={8}>
                <ExportButton
                  request={(cfg) => adminService.exportCompanies(cfg)}
                  fallbackName="AAPNA-ATS_Admin-Companies.csv"
                  rowCount={companies.length}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => openCompanyModal()}
                  style={{ borderRadius: 6, fontWeight: 600 }}
                >
                  Add Company
                </Button>
              </Space>
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
                      <Avatar style={{ background: 'var(--gold-bg)', color: 'var(--gold-dark)', border: '1px solid var(--gold-light)' }} icon={<BankOutlined />} />
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
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openCompanyModal(r)} style={{ color: 'var(--gold)' }} />
                      </Tooltip>
                      <Tooltip title={r.is_active ? 'Deactivate' : 'Activate'}>
                        <Button type="text" size="small" icon={<PoweroffOutlined />} onClick={() => handleToggleCompany(r)} style={{ color: 'var(--warning)' }} />
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
        width={540}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-dark)', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
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
          <Form.Item
            label="Username (Optional)"
            name="username"
            rules={[{ pattern: /^\S+$/, message: 'Username cannot contain spaces' }]}
            extra="Defaults to the email address. Users can log in with either their username or email."
          >
            <Input placeholder="Leave blank to use the email address" />
          </Form.Item>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

          <Text style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-dark)', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
            Account Settings
          </Text>
          <Form.Item
            label="Role"
            name="role"
            rules={[{ required: true, message: 'Please select a role' }]}
            extra={editingUser?.id === currentUser?.id ? 'You cannot change your own role.' : undefined}
          >
            <Select placeholder="— Select role —" options={roleOptions} disabled={editingUser?.id === currentUser?.id} />
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
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
              <Text style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-dark)', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
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
                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Generates a secure random password</span>
              </div>

              {autoGenCreds && (
                <div style={{ background: 'var(--gold-bg)', border: '1px solid var(--gold-light)', borderRadius: 6, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-dark)', textTransform: 'uppercase' }}>Password</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{autoGenCreds.password}</span>
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => handleCopyText(autoGenCreds.password)}>Copy</Button>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>✉️ These credentials will be emailed to the user upon account creation.</div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <Form.Item
                label="Account Status"
                name="is_active"
                extra={editingUser?.id === currentUser?.id ? 'You cannot change the status of your own account.' : undefined}
              >
                <Select disabled={editingUser?.id === currentUser?.id}>
                  <Select.Option value="1">Active</Select.Option>
                  <Select.Option value="0">Inactive</Select.Option>
                </Select>
              </Form.Item>
              {/* Password reset: self or lower roles only — never a peer superadmin. */}
              {(editingUser?.role || '').toLowerCase() === 'superadmin' && editingUser?.id !== currentUser?.id ? (
                <>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                  <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 12 }}>
                    🔒 A Super Admin&apos;s password can only be changed by the account owner.
                  </Text>
                </>
              ) : (
              <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
              <Text style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-dark)', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 12 }}>
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
                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Generates a secure random password</span>
              </div>

              {autoGenCreds && (
                <div style={{ background: 'var(--gold-bg)', border: '1px solid var(--gold-light)', borderRadius: 6, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-dark)', textTransform: 'uppercase' }}>Generated Password</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{autoGenCreds.password}</span>
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => handleCopyText(autoGenCreds.password)}>Copy</Button>
                  </div>
                </div>
              )}
              </>
              )}
            </div>
          )}
        </Form>
      </Modal>

      {/* STATUS TOGGLE MODAL — deactivation is styled as a warning, activation stays positive */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>{userToToggle?.is_active ? '⚠️' : '✅'}</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{userToToggle?.is_active ? 'Deactivate User?' : 'Activate User?'}</span>
          </div>
        }
        open={toggleModalOpen}
        onOk={confirmToggleStatus}
        onCancel={() => setToggleModalOpen(false)}
        okText={userToToggle?.is_active ? 'Deactivate' : 'Activate'}
        okButtonProps={
          userToToggle?.is_active
            ? { danger: true, type: 'primary' }
            : { type: 'primary' }
        }
        width={420}
      >
        <div style={{ padding: '10px 0' }}>
          {userToToggle?.is_active ? (
            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 6, padding: '12px 14px' }}>
              <Text style={{ fontSize: 13.5, color: 'var(--warn-text)', display: 'block', fontWeight: 600, marginBottom: 4 }}>
                {userToToggle?.first_name} {userToToggle?.last_name} ({userToToggle?.email})
              </Text>
              <Text style={{ fontSize: 13, color: 'var(--text)' }}>
                This user will immediately lose access — any signed-in session is blocked on their
                next action. They can be reactivated at any time.
              </Text>
            </div>
          ) : (
            <Text style={{ fontSize: 13.5, color: 'var(--text)' }}>
              &quot;{userToToggle?.first_name} {userToToggle?.last_name}&quot; will be able to log in again.
            </Text>
          )}
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
