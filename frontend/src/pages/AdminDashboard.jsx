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
  // Button now comes from src/ui — see the import below.
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
  AuditOutlined,
} from '@ant-design/icons';
import adminService from '../services/adminService';
import ExportButton from '../components/common/ExportButton';
import ReferralLogPanel from '../components/admin/ReferralLogPanel';
import useAuth from '../hooks/useAuth';
import { DesignScope, PageShell, Surface, StatTile, Segmented, Button } from '../ui';
// After '../ui' so page rules win on equal specificity.
import '../styles/pages/admin-dashboard.css';

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
  { key: 'new_mrf',             label: '+ New MRF Request',                 desc: 'Create and submit Manpower Requisition Forms',      icon: '📋', color: 'var(--module-mrf)' },
  { key: 'search_candidates',   label: 'Search & Edit Candidates',         desc: 'Search, update and manage candidate profiles',      icon: '🔍', color: 'var(--module-search)' },
  { key: 'hr_manual_upload',    label: 'HR Manual Upload',                 desc: 'Upload candidate resumes for future hiring',        icon: '📤', color: 'var(--module-hr-upload)' },
  { key: 'system_config',       label: 'System Configuration',             desc: 'Manage configuration and automation settings',      icon: '⚙️', color: 'var(--module-config)' },
  { key: 'vendor_upload',       label: 'Vendor Manual Upload',             desc: 'Upload vendor-sourced candidate resumes',           icon: '🏢', color: 'var(--warning)' },
  { key: 'vendor_dashboard',    label: 'Vendor Dashboard',                 desc: 'View status of vendor-submitted candidates',        icon: '📈', color: 'var(--module-vendor-dash)' },
  { key: 'candidate_screening', label: 'Candidate Screening',              desc: 'Filter and screen candidates for open positions',   icon: '🎯', color: 'var(--module-screening)' },
  { key: 'screening_analytics', label: 'Recruitment Analytics',            desc: 'Track recruitment performance and hiring metrics', icon: '📊', color: 'var(--module-analytics)' },
  { key: 'recruitment_pipeline', label: 'Candidate Pipeline',              desc: 'Track candidates through the interview pipeline (Phase 3)', icon: '🧭', color: 'var(--module-pipeline)' },
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
            <Avatar className="ad-brand-chip">
              {initials || '?'}
            </Avatar>
            <div>
              <Text strong className="ad-body--block">
                {record.first_name} {record.last_name}
              </Text>
              <Text type="secondary" className="ad-caption">
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
      render: (text) => <Text className="ad-mono--sm">{text}</Text>,
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
          ? <Text className="ad-caption">{name}</Text>
          : <Text type="secondary" className="ad-caption">— Global —</Text>;
      },
    }] : []),
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => (
        <Tag
          color={record.is_active ? 'success' : 'error'}
          className="ad-pill"
        >
          <span className={'ad-dot' + (record.is_active ? ' ad-dot--on' : '')} />
          {record.is_active ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date) => <Text type="secondary" className="ad-caption">{date ? date.split('T')[0] : '—'}</Text>,
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
          return <Text type="secondary" className="ad-caption">—</Text>;
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
                  emphasis="text"
                  size="sm"
                  disabled={!canEdit}
                  icon={<EditOutlined />}
                  onClick={() => openUserModal(record)}
                  className={`ad-brand${canEdit ? '' : ' ad-action--off'}`}
                />
              </span>
            </Tooltip>
            <Tooltip title={!isAuthorized ? "Only Superadmin and Admin role can perform this operation" : (isSelf ? "Cannot deactivate/activate your own account" : (!canToggle ? "You can only change the status of lower-role accounts" : (record.is_active ? 'Deactivate' : 'Activate')))}>
              <span>
                <Button
                  emphasis="text"
                  size="sm"
                  disabled={!canToggle}
                  icon={<PoweroffOutlined />}
                  onClick={() => openToggleModal(record)}
                  className={`ad-warn${canToggle ? '' : ' ad-action--off'}`}
                />
              </span>
            </Tooltip>
            <Tooltip title={!isSuper ? "Only a SuperAdmin can delete users" : (isSelf ? "Cannot delete your own account" : "Delete")}>
              <span>
                <Button
                  emphasis="text"
                  size="sm"
                  disabled={!canDelete}
                  icon={<DeleteOutlined />}
                  onClick={() => openDeleteModal(record)}
                  className={`ad-danger${canDelete ? '' : ' ad-action--off'}`}
                />
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <DesignScope>
      <PageShell width="standard" className="admin-portal">
      {/* Capsule / segmented tab bar */}
      <Surface tier={2} padding="compact" className="ad-topbar">
        <Segmented
          aria-label="Admin sections"
          value={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            // Selecting Module Access with nothing chosen used to leave an empty
            // right pane; the tab handler seeds the first non-admin user. Kept here
            // so the behaviour survives the swap.
            if (key === 'modules' && nonAdminUsers.length > 0 && !selectedModUser) {
              handleSelectModUser(nonAdminUsers[0]);
            }
          }}
          options={[
            { value: 'users', label: <><UserOutlined /> User Management</> },
            { value: 'modules', label: <><SettingOutlined /> Module Access</> },
            { value: 'referrals', label: <><AuditOutlined /> Referral Log</> },
            ...(isSuper ? [{ value: 'companies', label: <><BankOutlined /> Companies</> }] : []),
          ]}
        />
        {/* The Referral Log owns its own Refresh (it has its own filters and
            pagination), so this shared one would either do nothing useful or
            reload the wrong list. Hidden there rather than left as a dead icon. */}
        {activeTab !== 'referrals' && (
          <ReloadOutlined
            className="ad-refresh"
            onClick={activeTab === 'companies' ? loadCompanies : loadUsers}
            spin={loading || companiesLoading}
          />
        )}
      </Surface>

      {/* Tab Content 1: User Management */}
      {activeTab === 'users' && (
        <div className="animate-fade-in">
          {/* Stats Metrics Cards */}
          <Row gutter={[16, 16]} className="ui-stagger ad-mb-5">
            <Col xs={24} sm={12} md={isSuper ? 6 : 8}>
              <StatTile
                icon={<TeamOutlined />}
                label="Total Users"
                value={stats.total}
                accent="brand"
                footnote="All registered accounts"
                /* `interactive` added 2026-08-31 — these four already carried footnotes,
                   so they only lacked the hover the lab's baseline tile has. `bloom` on
                   the lead tile only, matching the other KPI rows. */
                interactive
                bloom
              />
            </Col>
            <Col xs={24} sm={12} md={isSuper ? 6 : 8}>
              <StatTile
                icon={<CheckCircleOutlined />}
                label="Active"
                value={stats.active}
                accent="success"
                footnote="Can log in"
                interactive
              />
            </Col>
            <Col xs={24} sm={12} md={isSuper ? 6 : 8}>
              <StatTile
                icon={<CloseCircleOutlined />}
                label="Inactive"
                value={stats.inactive}
                accent="danger"
                footnote="Access revoked"
                interactive
              />
            </Col>
            {isSuper && (
              <Col xs={24} sm={12} md={6}>
                <StatTile
                  icon={<BankOutlined />}
                  label="Companies"
                  value={companies.length}
                  accent="info"
                  footnote={String(companies.filter((c) => c.is_active).length) + ' active tenants'}
                  interactive
                />
              </Col>
            )}
          </Row>

          {/* User Management Toolbar Card */}
          <Surface
            as={Card}
            tier={3}
            padding="none"
            bordered={false}
            styles={{ body: { padding: 0 } }}
          >
            {/* Toolbar */}
            <div className="ad-table-toolbar">
              <Space wrap size={12}>
                <span className="ad-title">User Management</span>
                <Input
                  prefix={<SearchOutlined className="ad-muted" />}
                  placeholder="Search name / email…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ad-search"
                />
                <Select
                  value={roleFilter}
                  onChange={setRoleFilter}
                  className="ad-w-140"
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
                  className="ad-w-130"
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
                    className="ad-w-180"
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
                      emphasis="solid"
                      icon={<PlusOutlined />}
                      disabled={!isAuthorized}
                      onClick={() => openUserModal()}
                      className={isAuthorized ? 'ad-btn--brand' : 'ad-ctl-btn'}
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
          </Surface>
        </div>
      )}

      {/* Tab Content 2: Module Access permissions */}
      {activeTab === 'modules' && (
        <div className="animate-fade-in">
          <Row gutter={[20, 20]}>
            {/* Left User Sider List */}
            <Col xs={24} md={8}>
              <Surface
                as={Card}
                tier={3}
                padding="none"
                title={<span className="ad-sub-legend">Select User</span>}
                bordered={false}
                className="ad-panel"
                styles={{ body: { padding: 0 } }}
              >
                <div className="ad-scroll">
                  {nonAdminUsers.map((u) => {
                    const selected = selectedModUser?.id === u.id;
                    const initials = `${(u.first_name || '')[0] || ''}${(u.last_name || '')[0] || ''}`.toUpperCase();
                    return (
                      <div
                        key={u.id}
                        onClick={() => handleSelectModUser(u)}
                        className={'ad-user-row' + (selected ? ' ad-user-row--selected' : '')}
                      >
                        <Avatar className="ad-brand-chip ad-brand-chip--sm">
                          {initials || '?'}
                        </Avatar>
                        <div>
                          <Text strong className={'ad-mod-name' + (selected ? ' ad-mod-name--selected' : '')}>
                            {u.first_name} {u.last_name}
                          </Text>
                          <Text type="secondary" className="ad-caption">{u.role}</Text>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Surface>
            </Col>

            {/* Right Modules Permission Panel */}
            <Col xs={24} md={16}>
              <Surface
                as={Card}
                tier={3}
                padding="none"
                title={
                  <div className="ad-split--center">
                    <div>
                      <div className="ad-title">
                        {selectedModUser ? `${selectedModUser.first_name} ${selectedModUser.last_name}` : 'Select a user'}
                      </div>
                      <div className="ad-note">
                        {selectedModUser ? `Configure module access for ${selectedModUser.email}` : 'Choose a user from the left to manage their module access'}
                      </div>
                    </div>
                    {autoSaved && (
                      <div className="ad-caption ad-ok">✓ Auto-saved</div>
                    )}
                  </div>
                }
                bordered={false}
              >
                {!selectedModUser ? (
                  <div className="ad-empty">
                    <SolutionOutlined className="ad-empty__icon" />
                    <Title level={4} className="ad-heading">No user selected</Title>
                    <Text type="secondary">Pick a user from the left panel to configure their module access.</Text>
                  </div>
                ) : (
                  <div className="ad-stack">
                    {/* Module Permission Switch Row Grid */}
                    {MODULES_INFO.map((mod) => {
                      const enabled = !!userPermissions[mod.key];
                      return (
                        <div
                          key={mod.key}
                          className={'ad-mod' + (enabled ? ' ad-mod--on' : '')}
                        >
                          <div className="ad-row--wide">
                            <div
                              className="ad-mod-icon"
                            >
                              {mod.icon}
                            </div>
                            <div>
                              <Text strong className="ad-body">{mod.label}</Text>
                              <div className="ad-micro--gap">{mod.desc}</div>
                              <span
                                className={'ad-perm ' + (enabled ? 'ad-perm--on' : 'ad-perm--off')}
                              >
                                {enabled ? '● Enabled' : '● Restricted'}
                              </span>
                            </div>
                          </div>
                          <Switch
                            checked={enabled}
                            loading={permsLoading}
                            onChange={(checked) => handlePermissionToggle(mod.key, checked)}
                            className={enabled ? 'ad-switch--on' : undefined}
                          />
                        </div>
                      );
                    })}

                    {/* HR Admin permission switch explicitly */}
                    <div
                      className={'ad-mod ad-mod--dashed' + (userPermissions['hr_admin'] ? ' ad-mod--on' : '')}
                    >
                      <div className="ad-row--wide">
                        <div className="ad-key">
                          🛡️
                        </div>
                        <div>
                          <Text strong className="ad-body">HR Admin Portal Access</Text>
                          <div className="ad-micro--gap">Grants permission to access this user and permission dashboard</div>
                          <span className={'ad-perm ' + (userPermissions['hr_admin'] ? 'ad-perm--on' : 'ad-perm--off')}>
                            {userPermissions['hr_admin'] ? '● Enabled' : '● Restricted'}
                          </span>
                        </div>
                      </div>
                      <Switch
                        checked={!!userPermissions['hr_admin']}
                        loading={permsLoading}
                        onChange={(checked) => handlePermissionToggle('hr_admin', checked)}
                        className={userPermissions['hr_admin'] ? 'ad-switch--on' : undefined}
                      />
                    </div>
                  </div>
                )}
              </Surface>
            </Col>
          </Row>
        </div>
      )}

      {/* Tab Content 3: Referral Log — the audit trail behind the referral flag.
          Owns its own loading, filters and refresh, so nothing above needs to
          know about it. */}
      {activeTab === 'referrals' && <ReferralLogPanel />}

      {/* Tab Content 4: Companies (superadmin only) */}
      {activeTab === 'companies' && isSuper && (
        <div className="animate-fade-in">
          <Surface
            as={Card}
            tier={3}
            padding="none"
            bordered={false}
            styles={{ body: { padding: 0 } }}
          >
            <div className="ad-table-toolbar">
              <span className="ad-title">Companies</span>
              <Space size={8}>
                <ExportButton
                  request={(cfg) => adminService.exportCompanies(cfg)}
                  fallbackName="AAPNA-ATS_Admin-Companies.csv"
                  rowCount={companies.length}
                />
                <Button
                  emphasis="solid"
                  icon={<PlusOutlined />}
                  onClick={() => openCompanyModal()}
                  className="ad-ctl-btn"
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
                      <Avatar className="ad-brand-chip" icon={<BankOutlined />} />
                      <div>
                        <Text strong className="ad-body--block">{r.name}</Text>
                        <Text type="secondary" className="ad-mono--sm">{r.slug}</Text>
                      </div>
                    </Space>
                  ),
                },
                {
                  title: 'Domain',
                  dataIndex: 'domain',
                  key: 'domain',
                  render: (d) => <Text className="ad-caption">{d || '—'}</Text>,
                },
                {
                  title: 'Users',
                  dataIndex: 'user_count',
                  key: 'user_count',
                  render: (n) => <Text className="ad-caption">{n ?? 0}</Text>,
                },
                {
                  title: 'Status',
                  key: 'status',
                  render: (_, r) => (
                    <Tag color={r.is_active ? 'success' : 'error'} className="ad-pill">
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
                        <Button emphasis="text" size="sm" icon={<EditOutlined />} onClick={() => openCompanyModal(r)} className="ad-brand" />
                      </Tooltip>
                      <Tooltip title={r.is_active ? 'Deactivate' : 'Activate'}>
                        <Button emphasis="text" size="sm" icon={<PoweroffOutlined />} onClick={() => handleToggleCompany(r)} className="ad-warn" />
                      </Tooltip>
                    </Space>
                  ),
                },
              ]}
            />
          </Surface>
        </div>
      )}

      {/* CREATE / EDIT USER MODAL */}
      <Modal
        title={
          <div className="ad-modal-title">
            {editingUser ? 'Edit User Details' : 'Add New User'}
          </div>
        }
        open={userModalOpen}
        onOk={handleSaveUser}
        onCancel={() => setUserModalOpen(false)}
        okText={editingUser ? 'Save Changes' : 'Create User & Send Email'}
        width={540}
      >
        <Form form={form} layout="vertical" className="ad-mt-4">
          <Text className="ad-legend ad-legend--gap">
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

          <hr className="ad-rule" />

          <Text className="ad-legend ad-legend--gap">
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
              <hr className="ad-rule" />
              <Text className="ad-legend ad-legend--gap">
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
              <div className="ad-row ad-row--gap">
                <Button
                  icon={<SafetyOutlined />}
                  onClick={generatePassword}
                 
                >
                  Auto-Generate Password
                </Button>
                <span className="ad-micro">Generates a secure random password</span>
              </div>

              {autoGenCreds && (
                <div className="ad-callout">
                  <div className="ad-split">
                    <span className="ad-legend">Password</span>
                    <span className="ad-mono">{autoGenCreds.password}</span>
                    <Button emphasis="text" size="sm" className="ad-flat" onClick={() => handleCopyText(autoGenCreds.password)}>Copy</Button>
                  </div>
                  <div className="ad-micro--gap-lg">✉️ These credentials will be emailed to the user upon account creation.</div>
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
                  <hr className="ad-rule" />
                  <Text type="secondary" className="ad-caption--block">
                    🔒 A Super Admin&apos;s password can only be changed by the account owner.
                  </Text>
                </>
              ) : (
              <>
              <hr className="ad-rule" />
              <Text className="ad-legend ad-legend--gap">
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
              <div className="ad-row ad-row--gap ad-row--gap-top">
                <Button
                  icon={<SafetyOutlined />}
                  onClick={generatePassword}
                 
                >
                  Auto-Generate Password
                </Button>
                <span className="ad-micro">Generates a secure random password</span>
              </div>

              {autoGenCreds && (
                <div className="ad-callout">
                  <div className="ad-split">
                    <span className="ad-legend">Generated Password</span>
                    <span className="ad-mono">{autoGenCreds.password}</span>
                    <Button emphasis="text" size="sm" className="ad-flat" onClick={() => handleCopyText(autoGenCreds.password)}>Copy</Button>
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
          <div className="ad-row--tight">
            <span className="ad-icon">{userToToggle?.is_active ? '⚠️' : '✅'}</span>
            <span className="ad-title--plain">{userToToggle?.is_active ? 'Deactivate User?' : 'Activate User?'}</span>
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
        <div className="ad-pad-y">
          {userToToggle?.is_active ? (
            <div className="ad-callout ad-callout--warn">
              <Text className="ad-callout__title">
                {userToToggle?.first_name} {userToToggle?.last_name} ({userToToggle?.email})
              </Text>
              <Text className="ad-body">
                This user will immediately lose access — any signed-in session is blocked on their
                next action. They can be reactivated at any time.
              </Text>
            </div>
          ) : (
            <Text className="ad-lede">
              &quot;{userToToggle?.first_name} {userToToggle?.last_name}&quot; will be able to log in again.
            </Text>
          )}
        </div>
      </Modal>

      {/* DELETE USER CONFIRMATION MODAL */}
      <Modal
        title={
          <div className="ad-row--tight">
            <span className="ad-icon">🗑️</span>
            <span className="ad-title--plain">Delete User?</span>
          </div>
        }
        open={deleteModalOpen}
        onOk={confirmDeleteUser}
        onCancel={() => setDeleteModalOpen(false)}
        okText="Delete Permanently"
        okButtonProps={{ danger: true, type: 'primary' }}
        width={400}
      >
        <div className="ad-pad-y">
          <Text className="ad-lede">
            Delete &quot;{userToDelete?.first_name} {userToDelete?.last_name}&quot; ({userToDelete?.email})? This is permanent.
          </Text>
        </div>
      </Modal>

      {/* CREATE / EDIT COMPANY MODAL (superadmin only) */}
      <Modal
        title={
          <div className="ad-modal-title">
            {editingCompany ? 'Edit Company' : 'Add New Company'}
          </div>
        }
        open={companyModalOpen}
        onOk={handleSaveCompany}
        onCancel={() => setCompanyModalOpen(false)}
        okText={editingCompany ? 'Save Changes' : 'Create Company'}
        width={460}
      >
        <Form form={companyForm} layout="vertical" className="ad-mt-4">
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
      </PageShell>
    </DesignScope>
  );
}
