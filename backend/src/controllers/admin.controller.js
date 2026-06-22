import crypto from 'crypto';
import prisma from '../config/database.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import { sendCredentialEmail } from '../services/emailNotification.service.js';

/**
 * Default module permissions seeded when a user is created, keyed by role.
 * - vendor: only the vendor-facing surfaces.
 * - recruiter: every module except the admin-portal gate (`hr_admin`).
 * admin/superadmin need no rows — they bypass `checkModuleAccess` entirely.
 * Keys must match the canonical module keys managed in the Admin Dashboard
 * (see AdminDashboard MODULES_INFO) and checked by the routes/ModuleRoute.
 */
const DEFAULT_MODULES_BY_ROLE = {
  vendor: ['vendor_dashboard', 'vendor_upload'],
  recruiter: [
    'new_mrf',
    'search_candidates',
    'hr_manual_upload',
    'system_config',
    'vendor_upload',
    'candidate_screening',
    'screening_analytics',
    'vendor_dashboard',
  ],
};

/**
 * Verify token and check if the user is authorized for HR Admin Portal.
 */
export const verifyToken = catchAsync(async (req, res) => {
  const userRole = (req.user.role || '').toLowerCase();
  // If the user's role is 'admin' or 'superadmin', they bypass checks
  const isAdminRole = userRole === 'admin' || userRole === 'superadmin';

  if (isAdminRole) {
    return res.status(200).json({
      authorized: true,
      username: req.user.username,
      role: req.user.role,
      user_id: req.user.id,
    });
  }

  // Check if they have the 'hr_admin' permission in the module permissions table
  const hrAdminPermission = await prisma.rpa_module_permissions.findFirst({
    where: {
      user_id: req.user.id,
      module_key: 'hr_admin',
      is_enabled: true,
    },
  });

  if (!hrAdminPermission) {
    return res.status(403).json({
      authorized: false,
      error: 'Forbidden',
      message: 'Access denied. HR Admin privileges required.',
    });
  }

  return res.status(200).json({
    authorized: true,
    username: req.user.username,
    role: req.user.role,
    user_id: req.user.id,
  });
});

/**
 * List all users.
 */
export const listUsers = catchAsync(async (req, res) => {
  const users = await prisma.rpa_users.findMany({
    orderBy: {
      id: 'desc',
    },
  });

  // Strip hashes for security
  const safeUsers = users.map(({ password_hash, ...user }) => user);

  return res.status(200).json(safeUsers);
});

/**
 * Check if email duplicate exists.
 */
export const checkEmail = catchAsync(async (req, res) => {
  const email = req.query.email;

  if (!email) {
    throw new AppError('Email query parameter is required.', 400);
  }

  const existingUser = await prisma.rpa_users.findFirst({
    where: {
      email: {
        equals: email.trim(),
        mode: 'insensitive',
      },
    },
  });

  return res.status(200).json({ exists: !!existingUser });
});

/**
 * Create a new user with SHA512 + Salt password.
 */
export const createUser = catchAsync(async (req, res) => {
  const { first_name, last_name, email, username, role, password, is_active, is_approved } = req.body;

  if (!email || !username || !role || !password) {
    throw new AppError('Required fields: email, username, role, password', 400);
  }

  // Check duplicates
  const existingUser = await prisma.rpa_users.findFirst({
    where: {
      OR: [
        { email: { equals: email.trim(), mode: 'insensitive' } },
        { username: { equals: username.trim(), mode: 'insensitive' } },
      ],
    },
  });

  if (existingUser) {
    return res.status(409).json({
      error: 'EMAIL_EXISTS',
      message: 'Email or Username is already registered.',
    });
  }

  // Single-instance SuperAdmin check
  if (role && role.trim().toLowerCase() === 'superadmin') {
    const superadminCount = await prisma.rpa_users.count({
      where: { role: 'superadmin' }
    });
    if (superadminCount > 0) {
      throw new AppError('Only one SuperAdmin account is permitted in the system.', 400);
    }
  }

  // Generate Salt + Hash
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHash('sha512').update(password + salt).digest('hex');
  const password_hash = `${salt}:${hash}`;

  const normalizedRole = role.trim().toLowerCase();

  const newUser = await prisma.rpa_users.create({
    data: {
      first_name: first_name?.trim(),
      last_name: last_name?.trim(),
      email: email.trim(),
      username: username.trim(),
      role: normalizedRole,
      password_hash,
      is_active: is_active ?? true,
      // is_approved is not enforced at login for any role; we set it true on
      // creation for data consistency (admin-created accounts are implicitly approved).
      is_approved: is_approved ?? true,
    },
  });

  // Seed default module permissions for the role so the user can use their
  // surfaces immediately (e.g. vendors get vendor_dashboard + vendor_upload).
  const defaultModules = DEFAULT_MODULES_BY_ROLE[normalizedRole] || [];
  if (defaultModules.length > 0) {
    await prisma.rpa_module_permissions.createMany({
      data: defaultModules.map((module_key) => ({
        user_id: newUser.id,
        module_key,
        is_enabled: true,
        updated_at: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  // Send credentials email in the background
  sendCredentialEmail({ user: newUser, plainTextPassword: password, isNewUser: true });

  const { password_hash: _, ...safeUser } = newUser;
  return res.status(201).json(safeUser);
});

/**
 * Update an existing user.
 */
export const updateUser = catchAsync(async (req, res) => {
  const { id, first_name, last_name, email, username, role, password, is_active } = req.body;

  if (!id) {
    throw new AppError('User ID is required for update.', 400);
  }

  const userId = parseInt(id, 10);

  const existingUser = await prisma.rpa_users.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new AppError('User not found.', 404);
  }

  // Hierarchy check: Admins cannot modify SuperAdmin accounts
  const targetUserRole = (existingUser.role || '').toLowerCase();
  const requesterRole = (req.user.role || '').toLowerCase();
  if (requesterRole === 'admin' && targetUserRole === 'superadmin') {
    throw new AppError('Admins are not permitted to modify SuperAdmin accounts.', 403);
  }

  // Single-instance check if changing role to superadmin
  if (role && role.trim().toLowerCase() === 'superadmin') {
    const existingSuperadmin = await prisma.rpa_users.findFirst({
      where: {
        role: 'superadmin',
        id: { not: userId }
      }
    });
    if (existingSuperadmin) {
      throw new AppError('Only one SuperAdmin account is permitted in the system.', 400);
    }
  }

  const updateData = {
    first_name: first_name?.trim(),
    last_name: last_name?.trim(),
    email: email?.trim(),
    username: username?.trim(),
    role: role ? role.trim().toLowerCase() : undefined,
    is_active: is_active ?? existingUser.is_active,
  };

  // If a new password is provided, rehash it
  if (password && password.trim() !== '') {
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha512').update(password + salt).digest('hex');
    updateData.password_hash = `${salt}:${hash}`;
  }

  const updatedUser = await prisma.rpa_users.update({
    where: { id: userId },
    data: updateData,
  });

  // If a new password was provided, send credentials update email in the background
  if (password && password.trim() !== '') {
    sendCredentialEmail({ user: updatedUser, plainTextPassword: password, isNewUser: false });
  }

  const { password_hash: _, ...safeUser } = updatedUser;
  return res.status(200).json(safeUser);
});

/**
 * Delete a user.
 */
export const deleteUser = catchAsync(async (req, res) => {
  const { id } = req.body;

  if (!id) {
    throw new AppError('User ID is required.', 400);
  }

  const userId = parseInt(id, 10);

  const existingUser = await prisma.rpa_users.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new AppError('User not found.', 404);
  }

  // Hierarchy check: Admins cannot modify SuperAdmin accounts
  const targetUserRole = (existingUser.role || '').toLowerCase();
  const requesterRole = (req.user.role || '').toLowerCase();
  if (requesterRole === 'admin' && targetUserRole === 'superadmin') {
    throw new AppError('Admins are not permitted to modify SuperAdmin accounts.', 403);
  }

  await prisma.rpa_users.delete({
    where: { id: userId },
  });

  return res.status(200).json({ success: true, message: 'User deleted successfully.' });
});

/**
 * Toggle a user's active status.
 */
export const toggleStatus = catchAsync(async (req, res) => {
  const { id, is_active } = req.body;

  if (id === undefined || is_active === undefined) {
    throw new AppError('id and is_active parameters are required.', 400);
  }

  const userId = parseInt(id, 10);

  const existingUser = await prisma.rpa_users.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new AppError('User not found.', 404);
  }

  // Hierarchy check: Admins cannot modify SuperAdmin accounts
  const targetUserRole = (existingUser.role || '').toLowerCase();
  const requesterRole = (req.user.role || '').toLowerCase();
  if (requesterRole === 'admin' && targetUserRole === 'superadmin') {
    throw new AppError('Admins are not permitted to modify SuperAdmin accounts.', 403);
  }

  await prisma.rpa_users.update({
    where: { id: userId },
    data: {
      is_active: !!is_active,
    },
  });

  return res.status(200).json({ success: true, message: 'User status updated successfully.' });
});

/**
 * Get module access permissions for a specific user.
 */
export const getModulesAccess = catchAsync(async (req, res) => {
  const userIdStr = req.query.user_id;

  if (!userIdStr) {
    throw new AppError('user_id query parameter is required.', 400);
  }

  const userId = parseInt(userIdStr, 10);

  const permissions = await prisma.rpa_module_permissions.findMany({
    where: { user_id: userId },
    orderBy: { module_key: 'asc' },
  });

  return res.status(200).json(permissions);
});

/**
 * Set module access permission for a specific user.
 */
export const setModulesAccess = catchAsync(async (req, res) => {
  const { user_id, module_key, is_enabled } = req.body;

  if (user_id === undefined || !module_key || is_enabled === undefined) {
    throw new AppError('Required body parameters: user_id, module_key, is_enabled', 400);
  }

  const userId = parseInt(user_id, 10);

  // Check user exists first to prevent database foreign key violation
  const userExists = await prisma.rpa_users.findUnique({
    where: { id: userId }
  });

  if (!userExists) {
    throw new AppError('Target user not found.', 404);
  }

  // Hierarchy check: Admins cannot modify SuperAdmin permissions
  const targetUserRole = (userExists.role || '').toLowerCase();
  const requesterRole = (req.user.role || '').toLowerCase();
  if (requesterRole === 'admin' && targetUserRole === 'superadmin') {
    throw new AppError('Admins are not permitted to modify SuperAdmin permissions.', 403);
  }

  const permission = await prisma.rpa_module_permissions.upsert({
    where: {
      user_id_module_key: {
        user_id: userId,
        module_key,
      },
    },
    create: {
      user_id: userId,
      module_key,
      is_enabled: !!is_enabled,
      updated_at: new Date(),
    },
    update: {
      is_enabled: !!is_enabled,
      updated_at: new Date(),
    },
  });

  // Invalidate user sessions immediately so new permissions take effect
  await prisma.rpa_sessions.deleteMany({
    where: { user_id: userId },
  });

  return res.status(200).json(permission);
});
