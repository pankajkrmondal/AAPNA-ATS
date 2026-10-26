/**
 * formsLinks.service.js — Forms & Links (L08): every link the ATS has sent, in
 * one list, with who got it, whether they acted on it and when it expires; and
 * Copy, Re-send, Renew and Revoke.
 *
 * "If Recruiter wants to access some links, right now they are not accessible
 * easily… I have sent a link to interviewer post interview, I can't find the
 * link from the app easily." Design approved 23 Oct as recommended (D1–D10):
 * docs/Phase 3 Enhancements or Feedback/Forms & Links — design for approval.html.
 *
 * NO NEW TABLES. Every link is already stored with its status and expiry:
 *   scorecard      rpa_interview_scorecard
 *   meeting        rpa_interview_schedule.teams_join_url
 *   recording      rpa_recording_share_link
 *   documents      rpa_document_requests (+ rpa_candidate_documents)
 *   profile        rpa_cv.cvMissingToken (hidden unless searched: one per upload)
 *   zeko           rpa_zeko_candidate_pipeline + rpa_zeko_jobs.slug
 *   evalground     rpa_assessment_invites (the link pasted into the invite)
 *   mrf_form       rpa_mrf_jd_send
 *   mrf_approval   rpa_mrf_approval_tokens (status only: never copied, D3)
 *
 * THE LIST NEVER CARRIES A URL. A link is read only when someone clicks Copy,
 * and that copy is recorded (D4): on the candidate's timeline, or in the
 * processing log for an MRF link.
 *
 * ACCESS. Staff only (the router's requireStaff). The pipeline-backed types
 * (scorecards, meetings, recordings, documents, tests) appear only for people
 * who can open the Candidate Pipeline (the recruitment_pipeline module), the
 * same rule as the board; everyone else sees MRF and standing links only.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { isAdminTier } from '../config/roles.js';
import { fmtDate, fmtDateTimeIst } from '../utils/dateFormat.js';
import { shareUrlFor } from '../utils/recordingShareModel.js';
import {
  LINK_TYPES, PIPELINE_TYPES, STATES, firstUrlIn, linkActions, linkMessage, linkStatus, tileCounts, tileFlags,
} from '../utils/formsLinksModel.js';

const PER_TYPE_LIMIT = 1000;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const mrfRef = (id) => (id ? `MRF-${Number(id)}` : null);

/**
 * Can this user see the pipeline's links? Admin tier, or the module toggle:
 * the same rule as checkModuleAccess('recruitment_pipeline'). A lookup error
 * fails closed (MRF rows only) but is logged, so it cannot hide silently.
 */
export async function canSeePipelineLinks(user) {
  if (!user) return false;
  if (isAdminTier(user.role)) return true;
  if (!Number.isInteger(Number(user.id))) return false;
  try {
    const p = await prisma.rpa_module_permissions.findFirst({
      where: { user_id: Number(user.id), module_key: 'recruitment_pipeline', is_enabled: true },
      select: { module_key: true },
    });
    return Boolean(p);
  } catch (err) {
    logger.error(`Forms & Links: module check failed for user ${user.id}: ${err.message}`);
    return false;
  }
}

/** The candidate columns every pipeline-backed adapter joins in. */
const CANDIDATE_JOIN = (pipelineIdSql) => Prisma.sql`
  LEFT JOIN public.rpa_candidate_pipeline p ON p.id = ${pipelineIdSql}
  LEFT JOIN public.rpa_shortlisted_candidates sc ON sc.id = p.shortlist_id
  LEFT JOIN public.rpa_mrf m ON m.id = COALESCE(p.mrf_id, sc.mrf_id)`;
const CANDIDATE_COLS = Prisma.raw(`p.id AS pipeline_id, p.cv_id, sc.candidate_name, sc.shortlisted_by,
  m.id AS mrf_id, COALESCE(m.position_hiring_for, sc.position_applied) AS role`);

const candidateOf = (r) => ({
  pipelineId: num(r.pipeline_id), cvId: num(r.cv_id), name: r.candidate_name || null,
});

// ── adapters: one per link type, each returning the shared row shape ─────

async function scorecards() {
  const rows = await prisma.$queryRaw`
    SELECT s.id, s.stage_key, s.recipient_email, s.recipient_name, s.status AS card_status, s.token_expires_at,
           s.sent_at, s.opened_at, s.submitted_at, s.created_at, st.label AS stage_label, ${CANDIDATE_COLS}
    FROM public.rpa_interview_scorecard s
    ${CANDIDATE_JOIN(Prisma.sql`s.pipeline_id`)}
    LEFT JOIN public.rpa_pipeline_stages st ON st.stage_key = s.stage_key
    ORDER BY s.created_at DESC LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => ({
    type: 'scorecard', id: num(r.id),
    title: `Scorecard · ${r.stage_label || r.stage_key}`, sub: 'Interviewer feedback form',
    recipientName: r.recipient_name || null, recipientEmail: r.recipient_email, recipientKind: 'interviewer',
    candidate: candidateOf(r), role: r.role, mrfRef: mrfRef(r.mrf_id), ownedBy: r.shortlisted_by,
    roundLabel: r.stage_label || r.stage_key,
    sentAt: r.sent_at || r.created_at, sentBy: 'Automatic, after the interview',
    expiresAt: r.token_expires_at,
    raw: { cardStatus: r.card_status, sentAt: r.sent_at, openedAt: r.opened_at, submittedAt: r.submitted_at, expiresAt: r.token_expires_at },
  }));
}

async function meetings() {
  const rows = await prisma.$queryRaw`
    SELECT sch.id, sch.stage_key, sch.interviewer_name, sch.interviewer_email, sch.scheduled_start_at, sch.scheduled_end_at,
           sch.invite_sent_at, sch.created_at, u.username AS booked_by, st.label AS stage_label, ${CANDIDATE_COLS}
    FROM public.rpa_interview_schedule sch
    ${CANDIDATE_JOIN(Prisma.sql`sch.pipeline_id`)}
    LEFT JOIN public.rpa_pipeline_stages st ON st.stage_key = sch.stage_key
    LEFT JOIN public.rpa_users u ON u.id = sch.created_by
    WHERE sch.teams_join_url IS NOT NULL AND sch.cancelled_at IS NULL AND sch.superseded_at IS NULL
      AND COALESCE(sch.status, '') <> 'cancelled'
    ORDER BY sch.scheduled_start_at DESC LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => {
    const panel = String(r.interviewer_email || '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
      type: 'meeting', id: num(r.id),
      title: `Teams meeting · ${r.stage_label || r.stage_key}`, sub: r.scheduled_start_at ? fmtDateTimeIst(r.scheduled_start_at) : '',
      recipientName: r.candidate_name ? `${r.candidate_name}${panel.length ? ` + ${panel.length} interviewer${panel.length === 1 ? '' : 's'}` : ''}` : null,
      recipientEmail: 'candidate and panel', recipientKind: 'candidate',
      candidate: candidateOf(r), role: r.role, mrfRef: mrfRef(r.mrf_id), ownedBy: r.shortlisted_by,
      roundLabel: r.stage_label || r.stage_key, startsAt: r.scheduled_start_at,
      sentAt: r.invite_sent_at || r.created_at, sentBy: r.booked_by ? `by ${r.booked_by}` : null,
      expiresAt: r.scheduled_end_at,
      raw: { startsAt: r.scheduled_start_at, endsAt: r.scheduled_end_at },
    };
  });
}

async function recordings() {
  const rows = await prisma.$queryRaw`
    SELECT l.id, l.expires_at, l.revoked_at, l.view_count, l.created_by, l.created_at, rec.stage_key,
           st.label AS stage_label, ${CANDIDATE_COLS}
    FROM public.rpa_recording_share_link l
    JOIN public.rpa_interview_recording rec ON rec.id = l.recording_id
    ${CANDIDATE_JOIN(Prisma.sql`l.pipeline_id`)}
    LEFT JOIN public.rpa_pipeline_stages st ON st.stage_key = rec.stage_key
    ORDER BY l.created_at DESC LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => ({
    type: 'recording', id: num(r.id),
    title: `Recording share · ${r.stage_label || r.stage_key}`, sub: 'No-login recording link',
    recipientName: 'Shared outside the ATS', recipientEmail: 'external viewer', recipientKind: 'interviewer',
    candidate: candidateOf(r), role: r.role, mrfRef: mrfRef(r.mrf_id), ownedBy: r.shortlisted_by,
    roundLabel: r.stage_label || r.stage_key,
    sentAt: r.created_at, sentBy: r.created_by ? `by ${r.created_by}` : null,
    expiresAt: r.expires_at,
    raw: { revokedAt: r.revoked_at, viewCount: num(r.view_count), expiresAt: r.expires_at },
  }));
}

async function documentRequests() {
  const rows = await prisma.$queryRaw`
    SELECT d.id, d.token_status, d.requested_at, d.last_reminded_at, d.reminder_count, u.username AS requested_by,
           (SELECT COUNT(*)::int FROM public.rpa_candidate_documents x WHERE x.request_id = d.id) AS total,
           (SELECT COUNT(*)::int FROM public.rpa_candidate_documents x WHERE x.request_id = d.id AND (x.uploaded_at IS NOT NULL OR x.file_url IS NOT NULL)) AS uploaded,
           (SELECT COUNT(*)::int FROM public.rpa_candidate_documents x WHERE x.request_id = d.id AND x.status = 'verified') AS verified,
           ${CANDIDATE_COLS}, sc.candidate_email
    FROM public.rpa_document_requests d
    ${CANDIDATE_JOIN(Prisma.sql`d.pipeline_id`)}
    LEFT JOIN public.rpa_users u ON u.id = d.requested_by
    ORDER BY d.requested_at DESC LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => ({
    type: 'documents', id: num(r.id),
    title: 'Document upload', sub: `${r.total || 0} document${r.total === 1 ? '' : 's'} requested`,
    recipientName: r.candidate_name, recipientEmail: r.candidate_email || 'candidate', recipientKind: 'candidate',
    candidate: candidateOf(r), role: r.role, mrfRef: mrfRef(r.mrf_id), ownedBy: r.shortlisted_by,
    sentAt: r.requested_at, sentBy: r.requested_by ? `by ${r.requested_by}` : null,
    expiresAt: null,
    raw: { tokenStatus: r.token_status, total: r.total, uploaded: r.uploaded, verified: r.verified },
  }));
}

async function profileForms({ q }) {
  const term = q ? `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = await prisma.$queryRaw`
    SELECT c.id, c."Name", c."EmailID", c."PositionApplied", c."cvMissingTokenStatus", c.details_requested_at,
           c.details_completed_at, c."createdAt"
    FROM public.rpa_cv c
    WHERE c."cvMissingToken" IS NOT NULL
      ${term ? Prisma.sql`AND (c."Name" ILIKE ${term} OR c."EmailID" ILIKE ${term})` : Prisma.empty}
    ORDER BY COALESCE(c.details_requested_at, c."createdAt") DESC LIMIT ${term ? 200 : PER_TYPE_LIMIT}`;
  return rows.map((r) => ({
    type: 'profile', id: num(r.id),
    title: 'Complete-profile form', sub: 'asks for missing details',
    recipientName: r.Name, recipientEmail: r.EmailID, recipientKind: 'candidate',
    candidate: { pipelineId: null, cvId: num(r.id), name: r.Name }, role: r.PositionApplied, mrfRef: null, ownedBy: null,
    sentAt: r.details_requested_at || r.createdAt, sentBy: 'Automatic, after upload',
    expiresAt: null,
    raw: { tokenStatus: r.cvMissingTokenStatus, completedAt: r.details_completed_at },
  }));
}

async function zekoInterviews() {
  // candidate_id is the SHORTLIST id (assignCandidateToZekoJob), not the CV's.
  const rows = await prisma.$queryRaw`
    SELECT z.id, z.stage, z.status, z.link_sent_at, z.completed_at, z.interview_end_at, z.created_at, z.candidate_email,
           j.slug, COALESCE(j.role_name, j.title) AS job_role,
           sc.candidate_name, sc.shortlisted_by, sc.cv_id, sc.mrf_id, COALESCE(m.position_hiring_for, sc.position_applied) AS role,
           (SELECT p2.id FROM public.rpa_candidate_pipeline p2 WHERE p2.shortlist_id = sc.id ORDER BY p2.id DESC LIMIT 1) AS pipeline_id
    FROM public.rpa_zeko_candidate_pipeline z
    LEFT JOIN public.rpa_zeko_jobs j ON j.zeko_id = z.zeko_job_id
    LEFT JOIN public.rpa_shortlisted_candidates sc ON sc.id = z.candidate_id
    LEFT JOIN public.rpa_mrf m ON m.id = sc.mrf_id
    WHERE z.cancelled_at IS NULL AND COALESCE(z.status, '') <> 'cancelled'
    ORDER BY z.created_at DESC LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => ({
    type: 'zeko', id: num(r.id),
    title: `Zeko AI interview · ${r.stage === 'fn' || r.stage === 'functional' ? 'Functional screening' : 'HR screening'}`, sub: 'AI interview window',
    recipientName: r.candidate_name, recipientEmail: r.candidate_email || 'candidate', recipientKind: 'candidate',
    candidate: candidateOf(r), role: r.role || r.job_role, mrfRef: mrfRef(r.mrf_id), ownedBy: r.shortlisted_by,
    sentAt: r.link_sent_at || r.created_at, sentBy: null,
    expiresAt: r.interview_end_at,
    raw: { zekoStatus: r.status, completedAt: r.completed_at, expiresAt: r.interview_end_at, slug: r.slug },
  }));
}

async function evalgroundInvites() {
  const rows = await prisma.$queryRaw`
    SELECT a.id, a.method, a.sent_at, a.deadline_at, u.username AS sent_by,
           EXISTS (SELECT 1 FROM public.rpa_assessment_results ar WHERE ar.pipeline_id = a.pipeline_id AND ar.created_at >= a.sent_at) AS has_result,
           ${CANDIDATE_COLS}, sc.candidate_email
    FROM public.rpa_assessment_invites a
    ${CANDIDATE_JOIN(Prisma.sql`a.pipeline_id`)}
    LEFT JOIN public.rpa_users u ON u.id = a.created_by
    WHERE a.withdrawn_at IS NULL
    ORDER BY a.sent_at DESC LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => ({
    type: 'evalground', id: num(r.id),
    title: 'Evalground test', sub: 'Online test invite',
    recipientName: r.candidate_name, recipientEmail: r.candidate_email || 'candidate', recipientKind: 'candidate',
    candidate: candidateOf(r), role: r.role, mrfRef: mrfRef(r.mrf_id), ownedBy: r.shortlisted_by,
    sentAt: r.sent_at, sentBy: r.sent_by ? `by ${r.sent_by}` : null,
    expiresAt: r.deadline_at,
    raw: { hasResult: r.has_result, expiresAt: r.deadline_at },
  }));
}

async function mrfForms() {
  const rows = await prisma.$queryRaw`
    SELECT j.id, j.first_name, j.last_name, j.email, j.role, j.mrfstatus, j.created_at, j.mrf_id
    FROM public.rpa_mrf_jd_send j
    ORDER BY j.created_at DESC NULLS LAST LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => {
    const s = String(r.mrfstatus || '').toLowerCase();
    return {
      type: 'mrf_form', id: num(r.id), mrfId: num(r.mrf_id),
      title: 'MRF request form', sub: r.role,
      recipientName: `${r.first_name || ''} ${r.last_name || ''}`.trim() || null, recipientEmail: r.email, recipientKind: 'hiring_manager',
      candidate: null, role: r.role, mrfRef: r.mrf_id ? mrfRef(r.mrf_id) : 'not raised yet', ownedBy: null,
      sentAt: r.created_at, sentBy: null, expiresAt: null,
      raw: { submitted: s === 'managersubmitted' || s === 'manager submitted' || Boolean(r.mrf_id), closed: s === 'closed' },
    };
  });
}

async function mrfApprovals() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (t.mrf_id, lower(t.approver_email))
           t.id, t.mrf_id, t.approver_email, t.approver_name, t.issued_at, t.expires_at, t.first_opened_at,
           t.open_count, t.used_at, t.revoked_at, t.revoked_reason, m.position_hiring_for
    FROM public.rpa_mrf_approval_tokens t
    JOIN public.rpa_mrf m ON m.id = t.mrf_id
    -- Undecided requisitions only (plus the link that decided one): a decided
    -- MRF's other links are history, not something to act on.
    WHERE lower(COALESCE(m.approval_status, 'pending')) IN ('pending', 'waiting', 'pendingfromleader') OR t.used_at IS NOT NULL
    ORDER BY t.mrf_id, lower(t.approver_email), t.issued_at DESC
    LIMIT ${PER_TYPE_LIMIT}`;
  return rows.map((r) => ({
    type: 'mrf_approval', id: num(r.id), mrfId: num(r.mrf_id),
    title: 'MRF approval · approve / reject', sub: 'Personal link, never copied',
    recipientName: r.approver_name || null, recipientEmail: r.approver_email, recipientKind: 'approver',
    candidate: null, role: r.position_hiring_for, mrfRef: mrfRef(r.mrf_id), ownedBy: null,
    sentAt: r.issued_at, sentBy: 'when the MRF was submitted', expiresAt: r.expires_at,
    raw: { usedAt: r.used_at, revokedAt: r.revoked_at, revokedReason: r.revoked_reason, openCount: num(r.open_count), expiresAt: r.expires_at },
  }));
}

// ── the list ───────────────────────────────────────────────────────────

const TAB_OF_KIND = { interviewer: 'interviewers', candidate: 'candidates', hiring_manager: 'hm_approvers', approver: 'hm_approvers' };

function finish(row, now) {
  const s = linkStatus(row.type, row.raw, now);
  const { raw, ...rest } = row;
  const out = {
    ...rest,
    key: `${row.type}:${row.id}`,
    typeLabel: LINK_TYPES[row.type]?.label || row.type,
    groups: LINK_TYPES[row.type]?.group || [TAB_OF_KIND[row.recipientKind] || 'candidates'],
    state: s.state, status: s.status, detail: s.detail, notDelivered: s.notDelivered,
    actions: linkActions(row.type, s.state),
  };
  out.flags = tileFlags(out, now);
  return out;
}

/**
 * Every link, filtered (D6 default: open and expired, any date, newest first;
 * complete-profile forms hidden until searched or switched on).
 *
 * @param {object} user
 * @param {object} q - { tab, types[], states[], sentDays, mine, search, candidate, mrf, mrfRequest, includeProfiles, page, pageSize }
 */
export async function listLinks(user, q = {}) {
  const now = Date.now();
  const seePipeline = await canSeePipelineLinks(user);
  const search = String(q.search || '').trim();
  const includeProfiles = q.includeProfiles === true || q.includeProfiles === 'true' || Boolean(search);

  const adapters = {
    mrf_form: () => mrfForms(),
    mrf_approval: () => mrfApprovals(),
    ...(seePipeline ? {
      scorecard: () => scorecards(),
      meeting: () => meetings(),
      recording: () => recordings(),
      documents: () => documentRequests(),
      zeko: () => zekoInterviews(),
      evalground: () => evalgroundInvites(),
      ...(includeProfiles || q.onlyType === 'profile' ? { profile: () => profileForms({ q: search }) } : {}),
    } : {}),
  };
  // `onlyType`: a Copy needs one row's state, not the whole list.
  const jobs = Object.entries(adapters)
    .filter(([type]) => !q.onlyType || type === q.onlyType)
    .map(([, run]) => run());
  const settled = await Promise.allSettled(jobs);
  const all = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') all.push(...s.value);
    else logger.warn(`Forms & Links: one link type could not be loaded: ${s.reason?.message}`);
  }
  let rows = all.map((r) => finish(r, now));

  // Narrowing that also shapes the tiles and tab counts.
  if (q.candidate) rows = rows.filter((r) => String(r.candidate?.pipelineId) === String(q.candidate) || String(r.candidate?.cvId) === String(q.candidate));
  // ?mrf= is the requisition; ?mrfRequest= is the hiring manager's request row,
  // which has a form link before any requisition number exists (MRF details).
  if (q.mrf || q.mrfRequest) {
    rows = rows.filter((r) => (q.mrf && (r.mrfRef === mrfRef(q.mrf) || String(r.mrfId) === String(q.mrf)))
      || (q.mrfRequest && r.type === 'mrf_form' && String(r.id) === String(q.mrfRequest)));
  }
  if (q.mine === true || q.mine === 'true') rows = rows.filter((r) => r.ownedBy && r.ownedBy === user?.username);
  if (q.sentDays) {
    const since = now - Number(q.sentDays) * 86400000;
    rows = rows.filter((r) => r.sentAt && new Date(r.sentAt).getTime() >= since);
  }
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter((r) => [r.recipientName, r.recipientEmail, r.candidate?.name, r.role, r.mrfRef, r.title]
      .some((v) => String(v || '').toLowerCase().includes(s)));
  }

  const tiles = tileCounts(rows, now);

  const tab = q.tab && q.tab !== 'all' ? q.tab : null;
  const types = Array.isArray(q.types) ? q.types : String(q.types || '').split(',').filter(Boolean);
  const states = Array.isArray(q.states) ? q.states : String(q.states || 'open,expired').split(',').filter(Boolean);
  const tile = q.tile || null;
  const byState = (r) => (tile ? r.flags[tile] : (!states.length || states.includes('all') || states.includes(r.state)));
  const byTab = (r) => !tab || r.groups.includes(tab);
  const byType = (r) => !types.length || types.includes(r.type);

  // Facet counts: each one respects every filter except its own, so the
  // numbers on the tabs and chips match the list they lead to.
  const stated = rows.filter(byState);
  const tabCounts = { all: 0, interviewers: 0, candidates: 0, hm_approvers: 0 };
  for (const r of stated.filter(byType)) {
    tabCounts.all += 1;
    for (const g of r.groups) tabCounts[g] = (tabCounts[g] || 0) + 1;
  }
  const typeCounts = {};
  for (const r of stated.filter(byTab)) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;

  const list = stated.filter(byTab).filter(byType);
  list.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));

  const pageSize = Math.min(Math.max(Number(q.pageSize) || 10, 1), 100);
  const page = Math.max(Number(q.page) || 1, 1);
  return {
    total: list.length,
    page,
    pageSize,
    rows: list.slice((page - 1) * pageSize, page * pageSize),
    tiles,
    tabCounts,
    typeCounts,
    profileFormsHidden: !includeProfiles,
    seePipeline,
  };
}

const SUMMARY_TTL_MS = 60 * 1000;
const summaryCache = new Map();

/**
 * The Dashboard's "Links waiting for a response: N" row (D8). Building it reads
 * every link type (~3 s on staging), and the Dashboard asks on every visit, so
 * each user's counts are kept for a minute.
 */
export async function linksSummary(user) {
  const key = String(user?.id ?? 'anon');
  const hit = summaryCache.get(key);
  if (hit && hit.at > Date.now() - SUMMARY_TTL_MS) return hit.value;
  const r = await listLinks(user, { pageSize: 1 });
  const value = { waiting: r.tiles.waiting, expired: r.tiles.expiredNoResponse, notDelivered: r.tiles.notDelivered, expiring48h: r.tiles.expiring48h };
  summaryCache.set(key, { at: Date.now(), value });
  if (summaryCache.size > 500) summaryCache.delete(summaryCache.keys().next().value);
  return value;
}

// ── standing forms ─────────────────────────────────────────────────────

/** Links that are the same for everyone, plus the JD and test paper of every open MRF (D10). */
export async function standingForms() {
  const base = config.cors.frontendUrl;
  // Open MRFs: approved, not closed, not yet filled.
  const mrfs = await prisma.rpa_mrf.findMany({
    where: { approval_status: { in: ['approved', 'completed'] }, closed_at: null, filled_at: null },
    select: { id: true, position_hiring_for: true, jd_document_link: true, question_paper: true, created_at: true },
    orderBy: { id: 'desc' },
    take: 200,
  });
  return {
    forms: [
      { key: 'mrf_blank', title: 'MRF request form (blank)', body: 'For a hiring manager to raise a new requisition. It then goes to the approvers as usual.', url: `${base}/mrf-submit` },
      { key: 'login', title: 'ATS sign-in', body: 'For recruiters, admins and vendors who have an account.', url: `${base}/login` },
      { key: 'forgot', title: 'Forgot password', body: 'For anyone with an account who cannot sign in.', url: `${base}/forgot-password` },
    ],
    mrfs: mrfs.map((m) => ({
      mrfId: Number(m.id), mrfRef: mrfRef(m.id), role: m.position_hiring_for,
      date: m.created_at || null,
      jdUrl: m.jd_document_link || null, testUrl: m.question_paper || null,
    })),
  };
}

// ── copy, re-send, renew, revoke ───────────────────────────────────────

/** The URL behind one link (read only on Copy), and the row it belongs to. */
async function resolveLink(type, id, user) {
  if (PIPELINE_TYPES.has(type) && !(await canSeePipelineLinks(user))) {
    throw new AppError('Pipeline links are visible to people who can open the Candidate Pipeline.', 403);
  }
  const base = config.cors.frontendUrl;
  const big = BigInt(id);
  const finder = {
    scorecard: async () => {
      const r = await prisma.rpa_interview_scorecard.findUnique({ where: { id: big } });
      return r && { url: `${base}/scorecard/${r.token}`, pipelineId: r.pipeline_id, stageKey: r.stage_key };
    },
    meeting: async () => {
      const r = await prisma.rpa_interview_schedule.findUnique({ where: { id: big } });
      return r && { url: r.teams_join_url, pipelineId: r.pipeline_id, stageKey: r.stage_key, meetingId: r.teams_meeting_id, passcode: r.teams_passcode };
    },
    recording: async () => {
      const r = await prisma.rpa_recording_share_link.findUnique({ where: { id: big } });
      if (!r) return null;
      if (r.revoked_at || new Date(r.expires_at).getTime() <= Date.now()) throw new AppError('This recording link no longer works.', 409);
      const rec = await prisma.rpa_interview_recording.findUnique({ where: { id: r.recording_id }, select: { stage_key: true } });
      return { url: shareUrlFor(r.token, config.publicBaseUrl), pipelineId: r.pipeline_id, stageKey: rec?.stage_key || 'tech1' };
    },
    documents: async () => {
      const r = await prisma.rpa_document_requests.findUnique({ where: { id: big } });
      if (!r) return null;
      const missing = await prisma.$queryRaw`
        SELECT ci.label FROM public.rpa_candidate_documents x
        LEFT JOIN public.rpa_document_checklist_items ci ON ci.id = x.checklist_item_id
        WHERE x.request_id = ${big} AND x.uploaded_at IS NULL AND x.file_url IS NULL`.catch(() => []);
      return { url: `${base}/documents/${r.token}`, pipelineId: r.pipeline_id, stageKey: 'documents', missingDocs: missing.map((m) => m.label).filter(Boolean) };
    },
    profile: async () => {
      const r = await prisma.rpa_cv.findUnique({ where: { id: big }, select: { cvMissingToken: true } });
      return r?.cvMissingToken && { url: `${base}/missing-jd-upload?token=${encodeURIComponent(r.cvMissingToken)}`, pipelineId: null, cvId: big };
    },
    zeko: async () => {
      const [r] = await prisma.$queryRaw`
        SELECT j.slug, (SELECT p2.id FROM public.rpa_candidate_pipeline p2 WHERE p2.shortlist_id = z.candidate_id ORDER BY p2.id DESC LIMIT 1) AS pipeline_id
        FROM public.rpa_zeko_candidate_pipeline z
        LEFT JOIN public.rpa_zeko_jobs j ON j.zeko_id = z.zeko_job_id WHERE z.id = ${Number(id)}`;
      return r?.slug && { url: `${config.zeko.interviewLinkBase}/${r.slug}`, pipelineId: r.pipeline_id, stageKey: 'zeko_hr' };
    },
    evalground: async () => {
      const r = await prisma.rpa_assessment_invites.findUnique({ where: { id: big } });
      const url = firstUrlIn(r?.body);
      if (r && !url) throw new AppError('This test invite carries no link: it was sent as text only.', 409);
      return r && { url, pipelineId: r.pipeline_id, stageKey: 'assessment' };
    },
    mrf_form: async () => {
      const r = await prisma.rpa_mrf_jd_send.findUnique({ where: { id: big } });
      return r && { url: `${base}/mrf-submit?role=${encodeURIComponent(r.role)}&emailid=${encodeURIComponent(r.email)}`, pipelineId: null };
    },
  }[type];
  if (type === 'mrf_approval') {
    throw new AppError('MRF approval links are personal: whoever opens one decides in the approver’s name. Use "Re-send approval links" instead.', 403);
  }
  if (!finder) throw new AppError('Unknown link type.', 400);
  const found = await finder();
  if (!found || !found.url) throw new AppError('That link could not be found.', 404);
  return found;
}

/** Record who copied which link (D4). Never throws. */
async function recordCopy({ type, id, user, found, label, verb = 'copied' }) {
  const who = user?.username || user?.email || 'a recruiter';
  try {
    if (found.pipelineId) {
      await prisma.rpa_pipeline_stage_events.create({
        data: {
          pipeline_id: BigInt(found.pipelineId),
          stage_key: found.stageKey || 'shortlist',
          event_type: 'note',
          notes: `${label} link ${verb} by ${who} (Forms & Links).`,
          acted_by: user?.id || null,
        },
      });
    } else {
      await prisma.rpa_processing_log.create({
        data: {
          fileName: label, source: 'FORMS_LINKS_COPY', status: verb,
          logMessage: `${label} link (${type} ${id}) ${verb} by ${who}`,
          actor_email: user?.email || null, actor_context: `${user?.role || 'unknown'} via Forms & Links`,
          createdAt: new Date(),
        },
      });
    }
  } catch (err) {
    logger.error(`AUDIT GAP: ${type} ${id} link copied by ${who} was not recorded: ${err.message}`);
  }
}

/**
 * Copy (D4, D9): the URL and a ready-to-paste message; the copy is recorded.
 * @returns {Promise<{ url: string, message: string }>}
 */
export async function copyLink(type, id, user, { purpose = 'copy' } = {}) {
  const found = await resolveLink(type, id, user);
  const list = await listLinks(user, { states: 'all', pageSize: 100000, onlyType: type });
  const row = list.rows.find((r) => r.type === type && String(r.id) === String(id)) || {};
  if (row.state && row.state !== STATES.OPEN) {
    throw new AppError(`This link is ${String(row.status || row.state).toLowerCase()}, so it is not copied. ${row.type === 'scorecard' ? 'Renew it instead.' : ''}`.trim(), 409);
  }
  const label = `${row.typeLabel || LINK_TYPES[type]?.label || type}${row.roundLabel ? ` (${row.roundLabel})` : ''}`;
  await recordCopy({ type, id, user, found, label, verb: purpose === 'open' ? 'opened' : 'copied' });
  const message = linkMessage(type, {
    ...row, candidateName: row.candidate?.name || null,
    meetingId: found.meetingId, passcode: found.passcode, missingDocs: found.missingDocs,
  }, found.url, (d) => fmtDate(d));
  return { url: found.url, message };
}

/** Re-send: the same link by email again (scorecards, documents) or new approval links. */
export async function resendLink(type, id, user) {
  if (type === 'scorecard') {
    const { resendScorecard } = await import('./interviewScorecard.service.js');
    return resendScorecard(id, { user });
  }
  if (type === 'documents') {
    const r = await prisma.rpa_document_requests.findUnique({ where: { id: BigInt(id) }, select: { pipeline_id: true } });
    if (!r) throw new AppError('That document request could not be found.', 404);
    const { sendReminder } = await import('./documentCollection.service.js');
    return sendReminder(Number(r.pipeline_id), { actedBy: user?.id });
  }
  if (type === 'mrf_approval') {
    const t = await prisma.rpa_mrf_approval_tokens.findUnique({ where: { id: BigInt(id) }, select: { mrf_id: true } });
    if (!t) throw new AppError('That approval link could not be found.', 404);
    const { reissueApprovalLinks } = await import('./mrfApproval.service.js');
    return reissueApprovalLinks(Number(t.mrf_id), { user, frontendUrl: config.cors.frontendUrl });
  }
  throw new AppError('This kind of link cannot be re-sent from here.', 400);
}

/** Renew an expired scorecard for 7 days and send it again (D5). */
export async function renewLink(type, id, user) {
  if (type !== 'scorecard') throw new AppError('Only scorecard links can be renewed.', 400);
  const { renewScorecard } = await import('./interviewScorecard.service.js');
  return renewScorecard(id, { user });
}

/** Revoke a recording share link (the drawer's existing revoke). */
export async function revokeLink(type, id, user) {
  if (type !== 'recording') throw new AppError('Only recording links can be revoked.', 400);
  const l = await prisma.rpa_recording_share_link.findUnique({ where: { id: BigInt(id) }, select: { pipeline_id: true } });
  if (!l) throw new AppError('That recording link could not be found.', 404);
  const { revokeShareLink } = await import('./recordingShare.service.js');
  return revokeShareLink(l.pipeline_id, id, user);
}

export default { listLinks, linksSummary, standingForms, copyLink, resendLink, renewLink, revokeLink, canSeePipelineLinks };
