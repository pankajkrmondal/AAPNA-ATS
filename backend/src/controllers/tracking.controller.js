import prisma from '../config/database.js';
import logger from '../config/logger.js';

// 1×1 transparent GIF served for every request — a tracking pixel must never
// surface an error or challenge, or mail clients would render a broken image.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/track/open/:token — public (unauthenticated) email open-tracking
 * pixel. Marks the matching rpa_email_tracking row opened and always responds
 * with the GIF, even for unknown/garbage tokens or DB failures.
 */
export async function trackOpen(req, res) {
  const { token } = req.params;
  // Guard the uuid cast (column is @db.Uuid) and skip lookups for junk tokens.
  if (token && UUID_RE.test(token)) {
    try {
      const updated = await prisma.$executeRaw`
        UPDATE rpa_email_tracking
        SET opened = true,
            open_count = COALESCE(open_count, 0) + 1,
            first_opened_at = COALESCE(first_opened_at, NOW()),
            last_opened_at = NOW()
        WHERE tracking_token = ${token}::uuid
      `;
      if (updated > 0) {
        logger.info(`[Open Tracking] Pixel hit for token ${token}.`);
      }
    } catch (err) {
      logger.error(`[Open Tracking] Update failed for token ${token}: ${err.message}`);
    }
  }

  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': TRANSPARENT_GIF.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });
  return res.status(200).end(TRANSPARENT_GIF);
}
