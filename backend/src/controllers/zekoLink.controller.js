/**
 * PUBLIC handlers for U08's tracked Zeko link (no login: the uuid token in the
 * URL is the only credential). See services/zekoLink.service.js.
 */
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import {
  resolveZekoLinkRedirect,
  getZekoLinkInfo,
  saveZekoLinkPhone,
} from '../services/zekoLink.service.js';

/** The answer depends on the booking's state at this moment, and the URL carries a token. */
function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

/** GET /api/z/:token: 302 to Zeko, or to the /zeko-start page. */
export const redirectZekoLink = catchAsync(async (req, res) => {
  const location = await resolveZekoLinkRedirect(req.params.token);
  noStore(res);
  return res.redirect(302, location);
});

/** GET /api/z/:token/info: first name, role, state, and the Zeko link while open. */
export const zekoLinkInfo = catchAsync(async (req, res) => {
  const info = await getZekoLinkInfo(req.params.token);
  noStore(res);
  return success(res, info, 'Interview link details');
});

/** POST /api/z/:token/phone { phone }: saves the number, returns { zekoUrl }. */
export const zekoLinkPhone = catchAsync(async (req, res) => {
  const result = await saveZekoLinkPhone(req.params.token, req.body?.phone);
  noStore(res);
  return success(res, result, result.saved ? 'Phone number saved' : 'Continue to Zeko');
});

export default { redirectZekoLink, zekoLinkInfo, zekoLinkPhone };
