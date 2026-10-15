/**
 * "About AAPNA" text for candidate emails (Phase 3 "Do Now", N17).
 *
 * Plain text kept in rpa_settings under COMPANY_PROFILE_KEY, edited by admins
 * on the Settings page and added under the body of keyword shortlist emails
 * (utils/candidateEmailBlocks.js companyBlockHtml). Empty = nothing is added.
 * RT writes it once; it rarely changes.
 */
import prisma from '../config/database.js';

export const COMPANY_PROFILE_KEY = 'company_profile_text';
export const COMPANY_PROFILE_MAX_LENGTH = 3000;

/** @returns {Promise<{text: string}>} */
export async function getCompanyProfile() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: COMPANY_PROFILE_KEY } });
  return { text: row?.value || '' };
}

/** @returns {Promise<string>} the text, '' when unset */
export async function getCompanyProfileText() {
  return (await getCompanyProfile()).text;
}

/**
 * @param {string} text - plain text; trimmed, at most COMPANY_PROFILE_MAX_LENGTH
 * @returns {Promise<{text: string}>}
 */
export async function saveCompanyProfileText(text) {
  const value = String(text ?? '').trim().slice(0, COMPANY_PROFILE_MAX_LENGTH);
  await prisma.rpa_settings.upsert({
    where: { key: COMPANY_PROFILE_KEY },
    update: { value },
    create: { key: COMPANY_PROFILE_KEY, value },
  });
  return { text: value };
}

export default { getCompanyProfile, getCompanyProfileText, saveCompanyProfileText, COMPANY_PROFILE_KEY };
