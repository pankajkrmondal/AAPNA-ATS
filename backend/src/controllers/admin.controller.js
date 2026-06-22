import crypto from 'crypto';
import prisma from '../config/database.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import { sendCredentialEmail } from '../services/emailNotification.service.js';
import { restrictToCompanyScope } from '../middleware/auth.js';
import {
  ROLES,
  ADMIN_ASSIGNABLE_ROLES,
  isAdminTier,
  isSuperadmin,
  normalizeRole,
} from '../config/roles.js';

/**
 * Flatten the `company` relation into a `company_name` field and drop the hash.
 * @param {Object} user - rpa_users row, optionally with `company` included
 * @returns {Object} sanitized user
 */
function toSafeUser(user) {
  const { password_hash, company, ...rest } = user;
  return { ...rest, company_name: company?.name ?? null };
}

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
  // If the user's role is 'admin' or 'superadmin', they bypass checks
  if (isAdminTier(req.user.role)) {
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
 * List users in scope.
 * - superadmin: all users (optional ?company_id= filter)
 * - admin:      only users in their own company
 */
export const listUsers = catchAsync(async (req, res) => {
  const where = {};

  if (isSuperadmin(req.user.role)) {
    if (req.query.company_id) {
      where.company_id = parseInt(req.query.company_id, 10);
    }
  } else {
    // Company admin — hard-scope to their own company, and never expose
    // superadmin (global) accounts to them.
    where.company_id = req.user.company_id;
    where.NOT = { role: { equals: ROLES.SUPERADMIN, mode: 'insensitive' } };
  }

  const users = await prisma.rpa_users.findMany({
    where,
    orderBy: { id: 'desc' },
    include: { company: true },
  });

  return res.status(200).json(users.map(toSafeUser));
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

  const requesterIsSuper = isSuperadmin(req.user.role);
  const targetRole = normalizeRole(role);

  // Resolve the effective company + role based on the requester's tier.
  let companyId;
  if (requesterIsSuper) {
    // Superadmin may assign any role. company_id is required for every role
    // except superadmin (which is global).
    if (targetRole === ROLES.SUPERADMIN) {
      companyId = null;
    } else {
      companyId = req.body.company_id ? parseInt(req.body.company_id, 10) : null;
      if (!companyId) {
        throw new AppError('A company is required for this role.', 400);
      }
      const company = await prisma.rpa_companies.findUnique({ where: { id: companyId } });
      if (!company) {
        throw new AppError('Selected company does not exist.', 404);
      }
    }
  } else {
    // Company admin — can only create admin/recruiter/vendor inside their own company.
    if (!ADMIN_ASSIGNABLE_ROLES.includes(targetRole)) {
      throw new AppError('Admins cannot create SuperAdmin accounts.', 403);
    }
    if (!req.user.company_id) {
      throw new AppError('Your account is not associated with a company.', 400);
    }
    companyId = req.user.company_id;
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

  // Multiple superadmins are allowed. Only a superadmin requester can create one
  // (a company admin is restricted to ADMIN_ASSIGNABLE_ROLES above).

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
      role: targetRole,
      company_id: companyId,
      password_hash,
      is_active: is_active ?? true,
      // is_approved is not enforced at login for any role; we set it true on
      // creation for data consistency (admin-created accounts are implicitly approved).
      is_approved: is_approved ?? true,
    },
    include: { company: true },
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

  return res.status(201).json(toSafeUser(newUser));
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
  const targetUserRole = normalizeRole(existingUser.role);
  if (!isSuperadmin(req.user.role) && targetUserRole === ROLES.SUPERADMIN) {
    throw new AppError('Admins are not permitted to modify SuperAdmin accounts.', 403);
  }

  // Tenant scope: company admins may only touch users in their own company.
  restrictToCompanyScope(req.user, existingUser);

  const requesterIsSuper = isSuperadmin(req.user.role);
  const newRole = role ? normalizeRole(role) : undefined;

  // A company admin may assign admin/recruiter/vendor, but never superadmin.
  if (!requesterIsSuper && newRole && !ADMIN_ASSIGNABLE_ROLES.includes(newRole)) {
    throw new AppError('Admins cannot grant the SuperAdmin role.', 403);
  }

  // Multiple superadmins are allowed; only a superadmin requester may promote
  // someone into the role (enforced by the admin-escalation check above).

  const updateData = {
    first_name: first_name?.trim(),
    last_name: last_name?.trim(),
    email: email?.trim(),
    username: username?.trim(),
    role: newRole,
    is_active: is_active ?? existingUser.is_active,
  };

  // Only superadmin may reassign a user's company.
  if (requesterIsSuper && req.body.company_id !== undefined) {
    const targetCompanyId = req.body.company_id === null ? null : parseInt(req.body.company_id, 10);
    if (targetCompanyId !== null) {
      const company = await prisma.rpa_companies.findUnique({ where: { id: targetCompanyId } });
      if (!company) {
        throw new AppError('Selected company does not exist.', 404);
      }
    }
    updateData.company_id = targetCompanyId;
  }

  // If a new password is provided, rehash it
  if (password && password.trim() !== '') {
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha512').update(password + salt).digest('hex');
    updateData.password_hash = `${salt}:${hash}`;
  }

  const updatedUser = await prisma.rpa_users.update({
    where: { id: userId },
    data: updateData,
    include: { company: true },
  });

  // If a new password was provided, send credentials update email in the background
  if (password && password.trim() !== '') {
    sendCredentialEmail({ user: updatedUser, plainTextPassword: password, isNewUser: false });
  }

  return res.status(200).json(toSafeUser(updatedUser));
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
  if (!isSuperadmin(req.user.role) && normalizeRole(existingUser.role) === ROLES.SUPERADMIN) {
    throw new AppError('Admins are not permitted to modify SuperAdmin accounts.', 403);
  }

  // Tenant scope: company admins may only delete users in their own company.
  restrictToCompanyScope(req.user, existingUser);

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
  if (!isSuperadmin(req.user.role) && normalizeRole(existingUser.role) === ROLES.SUPERADMIN) {
    throw new AppError('Admins are not permitted to modify SuperAdmin accounts.', 403);
  }

  // Tenant scope: company admins may only toggle users in their own company.
  restrictToCompanyScope(req.user, existingUser);

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

  // Load the target so we can enforce tenant scope before exposing anything.
  const targetUser = await prisma.rpa_users.findUnique({ where: { id: userId } });
  if (!targetUser) {
    throw new AppError('Target user not found.', 404);
  }

  // Non-superadmins cannot read a superadmin's permissions.
  if (!isSuperadmin(req.user.role) && normalizeRole(targetUser.role) === ROLES.SUPERADMIN) {
    throw new AppError('You do not have permission to view this user.', 403);
  }

  // Tenant scope: company admins may only read users in their own company.
  restrictToCompanyScope(req.user, targetUser);

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
  if (!isSuperadmin(req.user.role) && normalizeRole(userExists.role) === ROLES.SUPERADMIN) {
    throw new AppError('Admins are not permitted to modify SuperAdmin permissions.', 403);
  }

  // Tenant scope: company admins may only set permissions for users in their own company.
  restrictToCompanyScope(req.user, userExists);

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
