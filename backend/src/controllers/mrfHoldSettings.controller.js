/**
 * Settings › MRF Approval & Hold.
 *
 * Who may change what (plan §7, decisions P6 / P11):
 *   - everyone signed in (staff) may READ it;
 *   - the approver-absence window: Admin / Super Admin only — an HR Admin
 *     Recruiter must not be able to open the window that lets them decide;
 *   - the hold rules (default / maximum hold length, release time): HR Admin
 *     Recruiter and above; plain Recruiters see them read-only.
 *
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md
 */
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { success } from '../utils/apiResponse.js';
import { canDecideOnBehalf, isAdminTier, isRecruiterTier } from '../config/roles.js';
import {
  dateLabel,
  holdDateBounds,
  isAbsenceActive,
  validateAbsence,
  validateHoldRules,
} from '../utils/mrfApprovalRules.js';
import {
  getAbsence,
  getHoldRules,
  hrAdminRecruiterEmails,
  listOnBehalfUsers,
  saveAbsence,
  saveHoldRules,
} from '../services/mrfHoldSettings.service.js';
import { getApproverRoster } from '../services/mrfApproval.service.js';
import { sendMrfAbsenceNoticeEmail } from '../services/emailNotification.service.js';
import { rescheduleMrfHoldSweepJob } from '../jobs/mrfHoldSweep.js';

function absenceView(absence) {
  return {
    ...absence,
    from_label: absence.from ? dateLabel(absence.from) : null,
    to_label: absence.to ? dateLabel(absence.to) : null,
    in_effect: isAbsenceActive(absence),
  };
}

/**
 * @desc    Everything the Settings card shows, plus what this user may change.
 * @route   GET /api/settings/mrf-approval
 * @access  Private (staff)
 */
export const getMrfApprovalSettings = catchAsync(async (req, res) => {
  if (!isRecruiterTier(req.user?.role)) throw new AppError('You do not have permission to view this setting.', 403);
  const [approvers, onBehalfUsers, absence, rules] = await Promise.all([
    getApproverRoster().catch(() => []),
    listOnBehalfUsers(),
    getAbsence(),
    getHoldRules(),
  ]);
  return success(res, {
    approvers: approvers.map((a) => ({ name: a.name, email: a.email, title: a.title || null })),
    on_behalf_users: onBehalfUsers,
    absence: absenceView(absence),
    hold_rules: rules,
    hold_bounds: holdDateBounds(rules),
    features: {
      hold: config.mrfHold.enabled,
      on_behalf: config.mrfHold.delegateDecisionEnabled,
    },
    can: {
      edit_absence: isAdminTier(req.user?.role),
      edit_hold_rules: canDecideOnBehalf(req.user?.role),
      manage_held: canDecideOnBehalf(req.user?.role),
    },
  }, 'MRF approval settings retrieved');
});

/**
 * @desc    Save the hold rules.
 * @route   PUT /api/settings/mrf-approval/hold-rules
 * @body    { defaultDays, maxDays, releaseTime: 'HH:MM' }
 * @access  Private (HR Admin Recruiter and above)
 */
export const saveMrfHoldRules = catchAsync(async (req, res) => {
  if (!canDecideOnBehalf(req.user?.role)) {
    throw new AppError('Only an HR Admin Recruiter, Admin or Super Admin can change the hold rules.', 403);
  }
  const check = validateHoldRules(req.body || {});
  if (!check.ok) throw new AppError(check.error, 400);
  const before = await getHoldRules();
  const saved = await saveHoldRules(check.rules);
  if (before.releaseTime !== saved.releaseTime) {
    await rescheduleMrfHoldSweepJob().catch((err) => logger.error(`[MRF Hold] reschedule failed: ${err.message}`));
  }
  logger.info(`[MRF Hold] hold rules changed by ${req.user?.username}: ${JSON.stringify(before)} -> ${JSON.stringify(saved)}`);
  return success(res, { hold_rules: saved, hold_bounds: holdDateBounds(saved) }, 'Hold rules saved');
});

/**
 * @desc    Mark the approvers away (or back). Opening a window emails the
 *          approvers and every HR Admin Recruiter.
 * @route   PUT /api/settings/mrf-approval/absence
 * @body    { active: boolean, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', note?: string }
 * @access  Private (Admin / Super Admin)
 */
export const saveMrfApproverAbsence = catchAsync(async (req, res) => {
  if (!isAdminTier(req.user?.role)) {
    throw new AppError('Only an Admin or Super Admin can mark the approvers away.', 403);
  }
  const check = validateAbsence(req.body || {});
  if (!check.ok) throw new AppError(check.error, 400);
  const before = await getAbsence();
  const saved = await saveAbsence(check.absence, req.user);
  logger.info(`[MRF approval] approver absence set by ${req.user?.username}: ${JSON.stringify({ active: saved.active, from: saved.from, to: saved.to })}`);

  // Tell people when a window opens or its dates change.
  const opened = saved.active && (!before.active || before.from !== saved.from || before.to !== saved.to);
  if (opened) {
    Promise.all([getApproverRoster().catch(() => []), hrAdminRecruiterEmails(), listOnBehalfUsers()])
      .then(([approvers, hrAdmins, onBehalf]) => sendMrfAbsenceNoticeEmail({
        recipients: [...approvers, ...hrAdmins],
        absence: { ...saved, fromLabel: dateLabel(saved.from), toLabel: dateLabel(saved.to) },
        onBehalfNames: onBehalf.filter((u) => u.role === 'hr_admin_recruiter').map((u) => u.name),
      }))
      .catch((err) => logger.error(`[MRF approval] absence notice failed: ${err.message}`));
  }
  return success(res, { absence: absenceView(saved) }, saved.active ? 'Approvers marked away' : 'Approvers marked available');
});
