const express = require("express");
const { authenticate, requirePermission } = require("../../auth/middleware");
const notificationService = require("./notification.service");

const notificationConfigRouter = express.Router();
const notificationsRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

notificationConfigRouter.use(authenticate);

notificationConfigRouter.get(
  "/",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.VIEW_CONFIG),
  handle((req, res) => send(res, "Notification configuration loaded.", notificationService.getConfiguration(req.user)))
);

notificationConfigRouter.patch(
  "/channels",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.UPDATE_CONFIG),
  handle((req, res) => send(res, "Notification channel updated.", notificationService.updateChannel(req.body || {}, req)))
);

notificationConfigRouter.patch(
  "/delivery-preferences",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.UPDATE_CONFIG),
  handle((req, res) => send(res, "Notification delivery preferences updated.", notificationService.updateGlobalConfiguration(req.body || {}, req)))
);

notificationConfigRouter.get(
  "/rules",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.RULES),
  handle((req, res) => {
    const result = notificationService.listRules(req.query, req.user);
    return send(res, "Notification rules loaded.", result.data, result.meta);
  })
);

notificationConfigRouter.put(
  "/rules/:type",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.RULES),
  handle((req, res) => send(res, "Notification rule updated.", notificationService.updateRule(req.params.type, req.body || {}, req)))
);

notificationConfigRouter.get(
  "/logs",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.LOGS),
  handle((req, res) => {
    const result = notificationService.listDeliveryLogs(req.query, req.user);
    return send(res, "Notification delivery logs loaded.", result.data, result.meta);
  })
);

notificationConfigRouter.get(
  "/queue",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.LOGS),
  handle((_req, res) => send(res, "Notification queue status loaded.", notificationService.getQueueStats()))
);

notificationConfigRouter.post(
  "/queue/process",
  requirePermission(notificationService.NOTIFICATION_PERMISSIONS.MANAGE_CONFIG),
  handle(async (req, res) => send(res, "Notification queue processed.", await notificationService.processQueue(Number(req.body?.limit || 25), req)))
);

notificationsRouter.use(authenticate);

notificationsRouter.get(
  "/",
  handle((req, res) => {
    const result = notificationService.listUserNotifications(req.user, req.query);
    return res.json({ success: true, message: "Notifications loaded.", data: result.notifications, unreadCount: result.unreadCount, meta: result });
  })
);

notificationsRouter.get(
  "/unread-count",
  handle((req, res) => send(res, "Unread notification count loaded.", notificationService.getUnreadCount(req.user)))
);

notificationsRouter.get(
  "/push/public-key",
  handle((_req, res) => send(res, "Web Push public key loaded.", {
    publicKey: notificationService.getVapidPublicKey(),
    configured: Boolean(notificationService.getVapidPublicKey()),
  }))
);

notificationsRouter.get(
  "/push/subscriptions",
  handle((req, res) => {
    const result = notificationService.listPushSubscriptions(req.user, req.query);
    return send(res, "Push subscriptions loaded.", result.data, result.meta);
  })
);

notificationsRouter.post(
  "/push/subscribe",
  handle((req, res) => res.status(201).json({
    success: true,
    message: "Push subscription saved.",
    data: notificationService.subscribePush(req.user, req.body || {}, req),
    meta: {},
  }))
);

notificationsRouter.post(
  "/push/unsubscribe",
  handle((req, res) => send(res, "Push subscription removed.", notificationService.unsubscribePush(req.user, req.body || {}, req)))
);

notificationsRouter.delete(
  "/push/subscriptions/:id",
  handle((req, res) => send(res, "Push subscription removed.", notificationService.unsubscribePush(req.user, { id: req.params.id }, req)))
);

notificationsRouter.get(
  "/preferences",
  handle((req, res) => send(res, "Notification preferences loaded.", notificationService.getUserPreferences(req.user.id)))
);

notificationsRouter.patch(
  "/preferences",
  handle((req, res) => send(res, "Notification preferences updated.", notificationService.updatePreferences(req.user, req.body || {}, req)))
);

notificationsRouter.patch(
  "/read-all",
  handle((req, res) => send(res, "Notifications marked as read.", notificationService.markAllAsRead(req.user)))
);

notificationsRouter.patch(
  "/:id/read",
  handle((req, res) => send(res, "Notification marked as read.", notificationService.markAsRead(req.params.id, req.user)))
);

notificationsRouter.delete(
  "/:id",
  handle((req, res) => send(res, "Notification deleted.", notificationService.deleteNotification(req.params.id, req.user)))
);

module.exports = { notificationConfigRouter, notificationsRouter };
