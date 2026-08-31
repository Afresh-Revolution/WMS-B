const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { EVENT_PERMISSIONS } = require("./constants");
const eventService = require("./event.service");

const eventsRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireEventPermission(permission) {
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
    error: { code: "EVENT_NOT_FOUND", details: {} },
  });
}

function auditEvent(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "events",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

eventsRouter.use(authenticate);

eventsRouter.get(
  "/dashboard",
  requireEventPermission(EVENT_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => res.json({ success: true, message: "Events dashboard loaded.", data: eventService.getDashboard(req.user), meta: {} }))
);

eventsRouter.get(
  "/reports",
  requireEventPermission(EVENT_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => res.json({ success: true, message: "Events reports loaded.", data: eventService.getReports(req.user, req.query), meta: {} }))
);

eventsRouter.get(
  "/export",
  requireEventPermission(EVENT_PERMISSIONS.EXPORT),
  handle((req, res) => {
    const csv = eventService.exportEvents(req.user, req.query);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"events.csv\"");
    return res.status(200).send(csv);
  })
);

eventsRouter.post(
  "/",
  requireEventPermission(EVENT_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = eventService.createEvent(req.body || {}, req.user);
    auditEvent(req, "EVENT_CREATED", result);
    return res.status(201).json({ success: true, message: "Event created.", data: result.record, meta: {} });
  })
);

eventsRouter.get(
  "/",
  requireEventPermission(EVENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = eventService.listEvents(req.user, req.query);
    return res.json({ success: true, message: "Events loaded.", data: result.data, meta: result.meta });
  })
);

eventsRouter.get(
  "/:id",
  requireEventPermission(EVENT_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Event loaded.", data: eventService.getEventDetails(req.params.id, req.user), meta: {} }))
);

eventsRouter.patch(
  "/:id",
  requireEventPermission(EVENT_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = eventService.updateEvent(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_UPDATED", result);
    return res.json({ success: true, message: "Event updated.", data: result.record, meta: {} });
  })
);

eventsRouter.delete(
  "/:id",
  requireEventPermission(EVENT_PERMISSIONS.DELETE),
  handle((req, res) => {
    const result = eventService.archiveEvent(req.params.id, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_ARCHIVED", result);
    return res.json({ success: true, message: "Event archived.", data: result.record, meta: {} });
  })
);

eventsRouter.post(
  "/:id/publish",
  requireEventPermission(EVENT_PERMISSIONS.PUBLISH),
  handle((req, res) => {
    const result = eventService.publishEvent(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_PUBLISHED", result);
    return res.json({ success: true, message: "Event published.", data: result.record, meta: result.meta || {} });
  })
);

eventsRouter.post(
  "/:id/cancel",
  requireEventPermission(EVENT_PERMISSIONS.CANCEL),
  handle((req, res) => {
    const result = eventService.cancelEvent(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_CANCELLED", result);
    return res.json({ success: true, message: "Event cancelled.", data: result.record, meta: {} });
  })
);

eventsRouter.post(
  "/:id/reschedule",
  requireEventPermission(EVENT_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = eventService.rescheduleEvent(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_RESCHEDULED", result);
    return res.json({ success: true, message: "Event rescheduled.", data: result.record, meta: {} });
  })
);

eventsRouter.post(
  "/:id/rsvp",
  requireEventPermission(EVENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const attendee = eventService.rsvpEvent(req.params.id, req.body || {}, req.user);
    if (!attendee) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_RSVP", attendee);
    return res.json({ success: true, message: "Event RSVP saved.", data: attendee, meta: {} });
  })
);

eventsRouter.post(
  "/:id/check-in",
  requireEventPermission(EVENT_PERMISSIONS.CHECKIN),
  handle((req, res) => {
    const attendee = eventService.checkInEvent(req.params.id, req.user);
    if (!attendee) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_CHECKIN", attendee);
    return res.json({ success: true, message: "Event check-in recorded.", data: attendee, meta: {} });
  })
);

eventsRouter.post(
  "/:id/check-out",
  requireEventPermission(EVENT_PERMISSIONS.CHECKIN),
  handle((req, res) => {
    const attendee = eventService.checkOutEvent(req.params.id, req.user);
    if (!attendee) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_CHECKOUT", attendee);
    return res.json({ success: true, message: "Event check-out recorded.", data: attendee, meta: {} });
  })
);

eventsRouter.get(
  "/:id/audience",
  requireEventPermission(EVENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const audience = eventService.getAudience(req.params.id, req.user);
    if (!audience) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Event audience loaded.", data: audience, meta: {} });
  })
);

eventsRouter.post(
  "/:id/audience",
  requireEventPermission(EVENT_PERMISSIONS.MANAGE_AUDIENCE),
  handle((req, res) => {
    const result = eventService.updateAudience(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_AUDIENCE_CHANGED", result);
    return res.json({ success: true, message: "Event audience updated.", data: result.record, meta: {} });
  })
);

eventsRouter.get(
  "/:id/attendees",
  requireEventPermission(EVENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const attendees = eventService.listAttendees(req.params.id, req.user);
    if (!attendees) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Event attendees loaded.", data: attendees, meta: {} });
  })
);

eventsRouter.get(
  "/:id/sponsors",
  requireEventPermission(EVENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const sponsors = eventService.listSponsors(req.params.id, req.user);
    if (!sponsors) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Event sponsors loaded.", data: sponsors, meta: {} });
  })
);

eventsRouter.post(
  "/:id/sponsors",
  requireEventPermission(EVENT_PERMISSIONS.MANAGE_SPONSORS),
  handle((req, res) => {
    const result = eventService.addSponsor(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_SPONSOR_ADDED", result);
    return res.status(201).json({ success: true, message: "Event sponsor added.", data: result.record, meta: {} });
  })
);

eventsRouter.get(
  "/:id/documents",
  requireEventPermission(EVENT_PERMISSIONS.VIEW),
  handle((req, res) => {
    const documents = eventService.listDocuments(req.params.id, req.user);
    if (!documents) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Event documents loaded.", data: documents, meta: {} });
  })
);

eventsRouter.post(
  "/:id/documents",
  requireEventPermission(EVENT_PERMISSIONS.MANAGE_DOCUMENTS),
  handle((req, res) => {
    const document = eventService.addDocument(req.params.id, req.body || {}, req.user);
    if (!document) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_DOCUMENT_UPLOADED", document);
    return res.status(201).json({ success: true, message: "Event document uploaded.", data: document, meta: {} });
  })
);

eventsRouter.post(
  "/:id/budget",
  requireEventPermission(EVENT_PERMISSIONS.MANAGE_BUDGET),
  handle((req, res) => {
    const result = eventService.upsertBudget(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditEvent(req, "EVENT_BUDGET_UPDATED", result);
    return res.json({ success: true, message: "Event budget updated.", data: result.record, meta: {} });
  })
);

eventsRouter.get(
  "/:id/report",
  requireEventPermission(EVENT_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => res.json({ success: true, message: "Event report loaded.", data: eventService.getEventReport(req.params.id, req.user), meta: {} }))
);

module.exports = { eventsRouter };
