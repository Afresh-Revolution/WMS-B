const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { MEETING_PERMISSIONS, MEETING_STATUS } = require("./constants");
const meetingService = require("./meeting.service");

const meetingsRouter = express.Router();
const meetingTypesRouter = express.Router();
const meetingRoomsRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireMeetingPermission(permission) {
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

function auditMeeting(req, action, result) {
  if (!result) {
    return;
  }

  recordOperationalAudit({
    user: req.user,
    action,
    module: "meetings",
    recordId: result.record?.id || result.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

function notFound(res, code) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

meetingsRouter.use(authenticate);
meetingTypesRouter.use(authenticate);
meetingRoomsRouter.use(authenticate);

meetingsRouter.get(
  "/calendar",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const calendar = meetingService.getCalendar(req.user, req.query);
    return res.json({ success: true, message: "Meeting calendar loaded.", data: calendar, meta: {} });
  })
);

meetingsRouter.get(
  "/history",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = meetingService.getHistory(req.user, req.query);
    return res.json({ success: true, message: "Meeting history loaded.", data: result.data, meta: result.meta });
  })
);

meetingsRouter.get(
  "/reports",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => {
    const report = meetingService.getReports(req.user, req.query);
    return res.json({ success: true, message: "Meeting reports loaded.", data: report, meta: {} });
  })
);

meetingsRouter.post(
  "/",
  requireMeetingPermission(MEETING_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = meetingService.createMeeting(req.body || {}, req.user);
    auditMeeting(req, "MEETING_CREATED", result);
    return res.status(201).json({ success: true, message: "Meeting created.", data: result.record, meta: { warnings: result.warnings } });
  })
);

meetingsRouter.get(
  "/",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = meetingService.listMeetings(req.user, req.query);
    return res.json({ success: true, message: "Meetings loaded.", data: result.data, meta: result.meta });
  })
);

meetingsRouter.get(
  "/:id",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const meeting = meetingService.getMeetingDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Meeting loaded.", data: meeting, meta: {} });
  })
);

meetingsRouter.patch(
  "/:id",
  requireMeetingPermission(MEETING_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = meetingService.updateMeeting(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "MEETING_UPDATED", result);
    return res.json({ success: true, message: "Meeting updated.", data: result.record, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/cancel",
  requireMeetingPermission(MEETING_PERMISSIONS.CANCEL),
  handle((req, res) => {
    const result = meetingService.cancelMeeting(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "MEETING_CANCELLED", result);
    return res.json({ success: true, message: "Meeting cancelled.", data: result.record, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/postpone",
  requireMeetingPermission(MEETING_PERMISSIONS.POSTPONE),
  handle((req, res) => {
    const result = meetingService.postponeMeeting(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "MEETING_POSTPONED", result);
    return res.json({ success: true, message: "Meeting postponed.", data: result.record, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/start",
  requireMeetingPermission(MEETING_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = meetingService.setMeetingStatus(req.params.id, MEETING_STATUS.ONGOING, req.user);
    auditMeeting(req, "MEETING_STARTED", result);
    return res.json({ success: true, message: "Meeting started.", data: result.record, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/complete",
  requireMeetingPermission(MEETING_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = meetingService.setMeetingStatus(req.params.id, MEETING_STATUS.COMPLETED, req.user);
    auditMeeting(req, "MEETING_COMPLETED", result);
    return res.json({ success: true, message: "Meeting completed.", data: result.record, meta: {} });
  })
);

meetingsRouter.get(
  "/:id/participants",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const meeting = meetingService.getMeetingDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Meeting participants loaded.", data: meeting.participants, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/participants",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_PARTICIPANTS),
  handle((req, res) => {
    const result = meetingService.addParticipants(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "PARTICIPANT_ADDED", result);
    return res.status(201).json({ success: true, message: "Meeting participants added.", data: result.record, meta: {} });
  })
);

meetingsRouter.delete(
  "/:id/participants/:userId",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_PARTICIPANTS),
  handle((req, res) => {
    const result = meetingService.removeParticipant(req.params.id, req.params.userId, req.user);
    if (!result) {
      return notFound(res, "PARTICIPANT_NOT_FOUND");
    }
    auditMeeting(req, "PARTICIPANT_REMOVED", result);
    return res.json({ success: true, message: "Meeting participant removed.", data: result.record, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/respond",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = meetingService.respondToInvitation(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "PARTICIPANT_RESPONSE_UPDATED", result);
    return res.json({ success: true, message: "Meeting invitation response saved.", data: result.record, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/agenda",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_AGENDA),
  handle((req, res) => {
    const agenda = meetingService.addAgenda(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "AGENDA_CREATED", { record: { id: req.params.id, agenda } });
    return res.status(201).json({ success: true, message: "Meeting agenda created.", data: agenda, meta: {} });
  })
);

meetingsRouter.patch(
  "/:id/agenda/:agendaId",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_AGENDA),
  handle((req, res) => {
    const result = meetingService.updateAgenda(req.params.id, req.params.agendaId, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "AGENDA_NOT_FOUND");
    }
    auditMeeting(req, "AGENDA_UPDATED", result);
    return res.json({ success: true, message: "Meeting agenda updated.", data: result.record, meta: {} });
  })
);

meetingsRouter.delete(
  "/:id/agenda/:agendaId",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_AGENDA),
  handle((req, res) => {
    const result = meetingService.removeAgenda(req.params.id, req.params.agendaId, req.user);
    if (!result) {
      return notFound(res, "AGENDA_NOT_FOUND");
    }
    auditMeeting(req, "AGENDA_REMOVED", result);
    return res.json({ success: true, message: "Meeting agenda removed.", data: result.record, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/minutes",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_MINUTES),
  handle((req, res) => {
    const result = meetingService.upsertMinutes(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "MINUTES_CREATED", result);
    return res.status(result.oldValues ? 200 : 201).json({ success: true, message: "Meeting minutes saved.", data: result.record, meta: {} });
  })
);

meetingsRouter.patch(
  "/:id/minutes",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_MINUTES),
  handle((req, res) => {
    const result = meetingService.upsertMinutes(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "MINUTES_UPDATED", result);
    return res.json({ success: true, message: "Meeting minutes updated.", data: result.record, meta: {} });
  })
);

meetingsRouter.get(
  "/:id/action-items",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const meeting = meetingService.getMeetingDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Meeting action items loaded.", data: meeting.actionItems, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/action-items",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_ACTION_ITEMS),
  handle((req, res) => {
    const actionItem = meetingService.createActionItem(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "ACTION_ITEM_CREATED", { record: actionItem });
    return res.status(201).json({ success: true, message: "Meeting action item created.", data: actionItem, meta: {} });
  })
);

meetingsRouter.get(
  "/:id/attendance",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const meeting = meetingService.getMeetingDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Meeting attendance loaded.", data: meeting.attendance, meta: {} });
  })
);

meetingsRouter.post(
  "/:id/attendance",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_ATTENDANCE),
  handle((req, res) => {
    const attendance = meetingService.upsertAttendance(req.params.id, req.body || {}, req.user);
    auditMeeting(req, "ATTENDANCE_UPDATED", { record: { id: req.params.id, attendance } });
    return res.json({ success: true, message: "Meeting attendance saved.", data: attendance, meta: {} });
  })
);

meetingTypesRouter.get(
  "/",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = meetingService.listMeetingTypes(req.query);
    return res.json({ success: true, message: "Meeting types loaded.", data: result.data, meta: result.meta });
  })
);

meetingTypesRouter.post(
  "/",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_TYPES),
  handle((req, res) => {
    const type = meetingService.createMeetingType(req.body || {}, req.user);
    auditMeeting(req, "MEETING_TYPE_CREATED", { record: type });
    return res.status(201).json({ success: true, message: "Meeting type created.", data: type, meta: {} });
  })
);

meetingTypesRouter.patch(
  "/:id",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_TYPES),
  handle((req, res) => {
    const type = meetingService.updateMeetingType(req.params.id, req.body || {}, req.user);
    if (!type) {
      return notFound(res, "MEETING_TYPE_NOT_FOUND");
    }
    auditMeeting(req, "MEETING_TYPE_UPDATED", { record: type });
    return res.json({ success: true, message: "Meeting type updated.", data: type, meta: {} });
  })
);

meetingTypesRouter.delete(
  "/:id",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_TYPES),
  handle((req, res) => {
    const type = meetingService.removeMeetingType(req.params.id, req.user);
    if (!type) {
      return notFound(res, "MEETING_TYPE_NOT_FOUND");
    }
    auditMeeting(req, "MEETING_TYPE_DELETED", { record: type });
    return res.json({ success: true, message: "Meeting type deleted.", data: type, meta: {} });
  })
);

meetingRoomsRouter.get(
  "/",
  requireMeetingPermission(MEETING_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = meetingService.listMeetingRooms(req.query);
    return res.json({ success: true, message: "Meeting rooms loaded.", data: result.data, meta: result.meta });
  })
);

meetingRoomsRouter.post(
  "/",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_ROOMS),
  handle((req, res) => {
    const room = meetingService.createMeetingRoom(req.body || {}, req.user);
    auditMeeting(req, "MEETING_ROOM_CREATED", { record: room });
    return res.status(201).json({ success: true, message: "Meeting room created.", data: room, meta: {} });
  })
);

meetingRoomsRouter.patch(
  "/:id",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_ROOMS),
  handle((req, res) => {
    const room = meetingService.updateMeetingRoom(req.params.id, req.body || {}, req.user);
    if (!room) {
      return notFound(res, "MEETING_ROOM_NOT_FOUND");
    }
    auditMeeting(req, "MEETING_ROOM_UPDATED", { record: room });
    return res.json({ success: true, message: "Meeting room updated.", data: room, meta: {} });
  })
);

meetingRoomsRouter.post(
  "/:id/deactivate",
  requireMeetingPermission(MEETING_PERMISSIONS.MANAGE_ROOMS),
  handle((req, res) => {
    const room = meetingService.deactivateMeetingRoom(req.params.id, req.user);
    if (!room) {
      return notFound(res, "MEETING_ROOM_NOT_FOUND");
    }
    auditMeeting(req, "MEETING_ROOM_DEACTIVATED", { record: room });
    return res.json({ success: true, message: "Meeting room deactivated.", data: room, meta: {} });
  })
);

module.exports = { meetingRoomsRouter, meetingTypesRouter, meetingsRouter };
