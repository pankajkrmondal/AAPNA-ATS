/**
 * notification.controller.js — the signed-in user's own inbox.
 *
 * Every handler is scoped to req.user.id: there is no way to read or mark
 * another user's notifications, so no ownership check is needed beyond that.
 */
import * as notificationService from '../services/notification.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';

/**
 * GET /api/notifications?limit=30&unread_only=1
 * The bell's list, newest first.
 */
export const list = catchAsync(async (req, res) => {
  const { limit, unread_only } = req.query;
  const [items, unread] = await Promise.all([
    notificationService.listNotifications(req.user.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      unreadOnly: unread_only === '1' || unread_only === 'true',
    }),
    notificationService.unreadCount(req.user.id),
  ]);
  return success(res, { items, unread }, 'Notifications retrieved successfully');
});

/**
 * GET /api/notifications/unread-count
 * Badge only — cheaper than fetching the list.
 */
export const getUnreadCount = catchAsync(async (req, res) => {
  const unread = await notificationService.unreadCount(req.user.id);
  return success(res, { unread }, 'Unread count retrieved successfully');
});

/** POST /api/notifications/:id/read */
export const markRead = catchAsync(async (req, res) => {
  const result = await notificationService.markRead(req.user.id, req.params.id);
  return success(res, result, 'Notification marked read');
});

/** POST /api/notifications/read-all */
export const markAllRead = catchAsync(async (req, res) => {
  const result = await notificationService.markAllRead(req.user.id);
  return success(res, result, 'All notifications marked read');
});
