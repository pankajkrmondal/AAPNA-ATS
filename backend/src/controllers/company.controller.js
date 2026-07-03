import prisma from '../config/database.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

/**
 * Company (tenant) management — superadmin only.
 * The owning router (`company.routes.js`) enforces `restrictTo('superadmin')`.
 */

/**
 * Build a URL-safe slug from a company name.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * List all companies with a user count.
 */
export const listCompanies = catchAsync(async (_req, res) => {
  const companies = await prisma.rpa_companies.findMany({
    orderBy: { id: 'asc' },
    include: { _count: { select: { users: true } } },
  });

  const result = companies.map(({ _count, ...c }) => ({
    ...c,
    user_count: _count?.users ?? 0,
  }));

  return res.status(200).json(result);
});

/**
 * Create a new company.
 */
export const createCompany = catchAsync(async (req, res) => {
  const { name, domain } = req.body;
  let { slug } = req.body;

  if (!name || !name.trim()) {
    throw new AppError('Company name is required.', 400);
  }

  slug = (slug && slug.trim()) ? slugify(slug) : slugify(name);
  if (!slug) {
    throw new AppError('Could not derive a valid slug from the company name.', 400);
  }

  // Ensure slug is unique
  const existing = await prisma.rpa_companies.findUnique({ where: { slug } });
  if (existing) {
    throw new AppError('A company with this slug already exists.', 409);
  }

  const company = await prisma.rpa_companies.create({
    data: {
      name: name.trim(),
      slug,
      domain: domain?.trim() || null,
      is_active: true,
    },
  });

  return res.status(201).json(company);
});

/**
 * Update a company's name/domain/slug.
 */
export const updateCompany = catchAsync(async (req, res) => {
  const { id, name, domain } = req.body;
  let { slug } = req.body;

  if (!id) {
    throw new AppError('Company ID is required.', 400);
  }
  const companyId = parseInt(id, 10);

  const existing = await prisma.rpa_companies.findUnique({ where: { id: companyId } });
  if (!existing) {
    throw new AppError('Company not found.', 404);
  }

  // If slug is being changed, normalize and enforce uniqueness.
  if (slug !== undefined) {
    slug = slugify(slug || '');
    if (!slug) {
      throw new AppError('Invalid slug.', 400);
    }
    const clash = await prisma.rpa_companies.findFirst({
      where: { slug, id: { not: companyId } },
    });
    if (clash) {
      throw new AppError('A company with this slug already exists.', 409);
    }
  }

  const company = await prisma.rpa_companies.update({
    where: { id: companyId },
    data: {
      name: name?.trim() ?? existing.name,
      domain: domain !== undefined ? (domain?.trim() || null) : existing.domain,
      slug: slug ?? existing.slug,
    },
  });

  return res.status(200).json(company);
});

/**
 * Activate / deactivate a company. Deactivating locks out all of its users at
 * the next authenticate() check; their live sessions are also wiped.
 */
export const toggleCompanyStatus = catchAsync(async (req, res) => {
  const { id, is_active } = req.body;

  if (id === undefined || is_active === undefined) {
    throw new AppError('id and is_active parameters are required.', 400);
  }
  const companyId = parseInt(id, 10);

  const existing = await prisma.rpa_companies.findUnique({ where: { id: companyId } });
  if (!existing) {
    throw new AppError('Company not found.', 404);
  }

  const company = await prisma.rpa_companies.update({
    where: { id: companyId },
    data: { is_active: !!is_active },
  });

  // When deactivating, force-logout that company's users so the change is immediate.
  if (!is_active) {
    const users = await prisma.rpa_users.findMany({
      where: { company_id: companyId },
      select: { id: true },
    });
    if (users.length) {
      await prisma.rpa_sessions.deleteMany({
        where: { user_id: { in: users.map((u) => u.id) } },
      });
    }
  }

  return res.status(200).json(company);
});
