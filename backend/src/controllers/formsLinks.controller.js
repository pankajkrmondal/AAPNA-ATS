/**
 * Forms & Links (L08) — HTTP layer. The service holds every rule; this file
 * only reads the request and shapes the response. Staff only: the router
 * applies authenticate + requireStaff.
 */
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import { success } from '../utils/apiResponse.js';
import * as formsLinks from '../services/formsLinks.service.js';

const TYPES = new Set(['scorecard', 'meeting', 'recording', 'documents', 'profile', 'zeko', 'evalground', 'mrf_form', 'mrf_approval']);

function typeAndId(req) {
  const { type } = req.params;
  const id = String(req.params.id || '');
  if (!TYPES.has(type)) throw new AppError('Unknown link type.', 400);
  if (!/^\d+$/.test(id)) throw new AppError('Invalid link id.', 400);
  return { type, id };
}

/** GET /api/forms-links — the list, tiles and tab / type counts. */
export const list = catchAsync(async (req, res) => {
  const result = await formsLinks.listLinks(req.user, {
    tab: req.query.tab,
    types: req.query.types,
    states: req.query.states,
    tile: req.query.tile,
    sentDays: req.query.sentDays ? Number(req.query.sentDays) : null,
    mine: req.query.mine,
    search: req.query.search,
    candidate: req.query.candidate,
    mrf: req.query.mrf,
    mrfRequest: req.query.mrfRequest,
    includeProfiles: req.query.includeProfiles,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  return success(res, result, 'Links retrieved');
});

/** GET /api/forms-links/summary — the Dashboard row's counts. */
export const summary = catchAsync(async (req, res) => success(res, await formsLinks.linksSummary(req.user), 'Link summary retrieved'));

/** GET /api/forms-links/standing — the Standing forms tab. */
export const standing = catchAsync(async (_req, res) => success(res, await formsLinks.standingForms(), 'Standing forms retrieved'));

/** POST /api/forms-links/:type/:id/copy — the URL and message; the copy is recorded. */
export const copy = catchAsync(async (req, res) => {
  const { type, id } = typeAndId(req);
  const purpose = req.body?.purpose === 'open' ? 'open' : 'copy';
  return success(res, await formsLinks.copyLink(type, id, req.user, { purpose }), purpose === 'open' ? 'Link opened' : 'Link copied');
});

/** POST /api/forms-links/:type/:id/resend */
export const resend = catchAsync(async (req, res) => {
  const { type, id } = typeAndId(req);
  return success(res, await formsLinks.resendLink(type, id, req.user), 'Sent again');
});

/** POST /api/forms-links/:type/:id/renew — scorecards: 7 more days, sent again. */
export const renew = catchAsync(async (req, res) => {
  const { type, id } = typeAndId(req);
  return success(res, await formsLinks.renewLink(type, id, req.user), 'Renewed and sent again');
});

/** POST /api/forms-links/:type/:id/revoke — recording links. */
export const revoke = catchAsync(async (req, res) => {
  const { type, id } = typeAndId(req);
  return success(res, await formsLinks.revokeLink(type, id, req.user), 'Link revoked');
});

export default { list, summary, standing, copy, resend, renew, revoke };
