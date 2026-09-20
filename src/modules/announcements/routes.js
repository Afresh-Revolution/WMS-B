const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { ANNOUNCEMENT_PERMISSIONS } = require("./constants");
const announcementService = require("./service");

const announcementsRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireAnnouncementPermission(permission) {
  return (req, res, next) => {
    if (can(req.user, permission)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: "Operation failed",
      error: { code: "FORBIDDEN", details: {} },
    });
  };
}

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code: "ANNOUNCEMENT_NOT_FOUND", details: {} },
  });
}

function auditAnnouncement(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "announcements",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

announcementsRouter.use(authenticate);

announcementsRouter.get(
  "/admin/dashboard",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS),
  handle((req, res) => res.json({ success: true, message: "Announcements dashboard loaded.", data: announcementService.getDashboard(req.user), meta: {} }))
);

announcementsRouter.get(
  "/admin/reports",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS),
  handle((req, res) => res.json({ success: true, message: "Announcements reports loaded.", data: announcementService.getReports(req.user, req.query), meta: {} }))
);

announcementsRouter.get(
  "/admin/export",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS),
  handle((req, res) => {
    const csv = announcementService.exportAnnouncements(req.user, req.query);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"announcements.csv\"");
    return res.status(200).send(csv);
  })
);

announcementsRouter.post(
  "/admin/drafts",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = announcementService.createDraft(req.body || {}, req.user);
    auditAnnouncement(req, "ANNOUNCEMENT_CREATED", result);
    return res.status(201).json({ success: true, message: "Announcement draft created.", data: result.record, meta: result.meta || {} });
  })
);

announcementsRouter.post(
  "/admin",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = announcementService.createAnnouncement(req.body || {}, req.user);
    auditAnnouncement(req, result.record.status === "published" ? "ANNOUNCEMENT_PUBLISHED" : "ANNOUNCEMENT_CREATED", result);
    return res.status(201).json({ success: true, message: "Announcement created.", data: result.record, meta: result.meta || {} });
  })
);

announcementsRouter.get(
  "/admin",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = announcementService.listAdminAnnouncements(req.user, req.query);
    return res.json({ success: true, message: "Announcements loaded.", data: result.data, meta: result.meta });
  })
);

announcementsRouter.get(
  "/admin/:id/recipients",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW_RECIPIENTS),
  handle((req, res) => {
    const recipients = announcementService.listRecipients(req.params.id, req.user, req.query);
    if (!recipients) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Announcement recipients loaded.", data: recipients, meta: {} });
  })
);

announcementsRouter.get(
  "/admin/:id/analytics",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS),
  handle((req, res) => {
    const analytics = announcementService.getAnalytics(req.params.id, req.user);
    if (!analytics) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Announcement analytics loaded.", data: analytics, meta: {} });
  })
);

announcementsRouter.get(
  "/admin/:id/audit-logs",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const logs = announcementService.getAuditLogs(req.params.id, req.user);
    if (!logs) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Announcement audit logs loaded.", data: logs, meta: {} });
  })
);

announcementsRouter.get(
  "/admin/:id",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const announcement = announcementService.getAdminDetails(req.params.id, req.user);
    if (!announcement) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Announcement loaded.", data: announcement, meta: {} });
  })
);

announcementsRouter.patch(
  "/admin/:id",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.EDIT),
  handle((req, res) => {
    const result = announcementService.updateAnnouncement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_UPDATED", result);
    return res.json({ success: true, message: "Announcement updated.", data: result.record, meta: {} });
  })
);

announcementsRouter.delete(
  "/admin/:id",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.DELETE),
  handle((req, res) => {
    const result = announcementService.deleteAnnouncement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_DELETED", result);
    return res.json({ success: true, message: "Announcement deleted.", data: result.record, meta: {} });
  })
);

announcementsRouter.post(
  "/admin/:id/publish",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.PUBLISH),
  handle((req, res) => {
    const result = announcementService.publishAnnouncement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_PUBLISHED", result);
    return res.json({ success: true, message: "Announcement published.", data: result.record, meta: result.meta || {} });
  })
);

announcementsRouter.post(
  "/admin/:id/schedule",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.SCHEDULE),
  handle((req, res) => {
    const result = announcementService.scheduleAnnouncement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_SCHEDULED", result);
    return res.json({ success: true, message: "Announcement scheduled.", data: result.record, meta: {} });
  })
);

announcementsRouter.patch(
  "/admin/:id/archive",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.ARCHIVE),
  handle((req, res) => {
    const result = announcementService.archiveAnnouncement(req.params.id, req.user);
    if (!result) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_ARCHIVED", result);
    return res.json({ success: true, message: "Announcement archived.", data: result.record, meta: {} });
  })
);

announcementsRouter.patch(
  "/admin/:id/pin",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.PIN),
  handle((req, res) => {
    const result = announcementService.setPin(req.params.id, true, req.user);
    if (!result) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_PINNED", result);
    return res.json({ success: true, message: "Announcement pinned.", data: result.record, meta: {} });
  })
);

announcementsRouter.patch(
  "/admin/:id/unpin",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.PIN),
  handle((req, res) => {
    const result = announcementService.setPin(req.params.id, false, req.user);
    if (!result) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_UNPINNED", result);
    return res.json({ success: true, message: "Announcement unpinned.", data: result.record, meta: {} });
  })
);

announcementsRouter.get(
  "/unread-count",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Unread announcements counted.", data: { count: announcementService.getUnreadCount(req.user) }, meta: {} }))
);

announcementsRouter.get(
  "/",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = announcementService.listEmployeeAnnouncements(req.user, req.query);
    return res.json({ success: true, message: "Announcements loaded.", data: result.data, meta: result.meta });
  })
);

function createPublishedAnnouncement(req, res) {
  const result = announcementService.createAnnouncement({ ...(req.body || {}), status: req.body?.status || "published" }, req.user);
  auditAnnouncement(req, result.record.status === "published" ? "ANNOUNCEMENT_PUBLISHED" : "ANNOUNCEMENT_CREATED", result);
  return res.status(201).json({ success: true, message: "Announcement created.", data: result.record, meta: result.meta || {} });
}

announcementsRouter.post(
  "/",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.CREATE),
  handle(createPublishedAnnouncement)
);

announcementsRouter.post(
  "/create",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.CREATE),
  handle(createPublishedAnnouncement)
);

announcementsRouter.post(
  "/publish",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.CREATE),
  handle(createPublishedAnnouncement)
);

announcementsRouter.get(
  "/:id",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const announcement = announcementService.getEmployeeAnnouncement(req.params.id, req.user);
    if (!announcement) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Announcement loaded.", data: announcement, meta: {} });
  })
);

announcementsRouter.patch(
  "/:id/read",
  requireAnnouncementPermission(ANNOUNCEMENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const recipient = announcementService.markRead(req.params.id, req.user);
    if (!recipient) {
      return notFound(res);
    }
    auditAnnouncement(req, "ANNOUNCEMENT_READ", recipient);
    return res.json({ success: true, message: "Announcement marked as read.", data: recipient, meta: {} });
  })
);

module.exports = { announcementsRouter };
