const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { TARGET_PERMISSIONS, TARGET_STATUS } = require("./constants");
const targetService = require("./target.service");

const targetsRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireTargetPermission(permission) {
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

function notFound(res, code) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

function auditTarget(req, action, result) {
  if (!result) {
    return;
  }

  recordOperationalAudit({
    user: req.user,
    action,
    module: "targets",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

targetsRouter.use(authenticate);

targetsRouter.get(
  "/reports/departments",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => {
    const report = targetService.getDepartmentReports(req.user, req.query);
    return res.json({ success: true, message: "Department target reports loaded.", data: report, meta: {} });
  })
);

targetsRouter.get(
  "/reports/employees/:employeeId",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => {
    const report = targetService.getEmployeeReport(req.params.employeeId, req.user);
    return res.json({ success: true, message: "Employee target report loaded.", data: report, meta: {} });
  })
);

targetsRouter.get(
  "/reports",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => {
    const report = targetService.getReports(req.user, req.query);
    return res.json({ success: true, message: "Target reports loaded.", data: report, meta: {} });
  })
);

targetsRouter.post(
  "/",
  requireTargetPermission(TARGET_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = targetService.createTarget(req.body || {}, req.user);
    auditTarget(req, "TARGET_CREATED", result);
    return res.status(201).json({ success: true, message: "Target created.", data: result.record, meta: {} });
  })
);

targetsRouter.get(
  "/",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = targetService.listTargets(req.user, req.query);
    return res.json({ success: true, message: "Targets loaded.", data: result.data, meta: result.meta });
  })
);

targetsRouter.get(
  "/:id",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW),
  handle((req, res) => {
    const target = targetService.getTargetDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Target loaded.", data: target, meta: {} });
  })
);

targetsRouter.patch(
  "/:id",
  requireTargetPermission(TARGET_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = targetService.updateTarget(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_UPDATED", result);
    return res.json({ success: true, message: "Target updated.", data: result.record, meta: {} });
  })
);

targetsRouter.post(
  "/:id/progress",
  requireTargetPermission(TARGET_PERMISSIONS.UPDATE_PROGRESS),
  handle((req, res) => {
    const result = targetService.updateProgress(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_PROGRESS_UPDATED", result);
    return res.status(201).json({ success: true, message: "Target progress updated.", data: result.record, meta: { progress: result.progress } });
  })
);

targetsRouter.get(
  "/:id/progress",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW),
  handle((req, res) => {
    const target = targetService.getTargetDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Target progress loaded.", data: target.progressHistory, meta: {} });
  })
);

targetsRouter.post(
  "/:id/milestones",
  requireTargetPermission(TARGET_PERMISSIONS.MANAGE_MILESTONES),
  handle((req, res) => {
    const milestone = targetService.addMilestone(req.params.id, req.body || {}, req.user);
    if (!milestone) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_MILESTONE_CREATED", { record: milestone });
    return res.status(201).json({ success: true, message: "Target milestone created.", data: milestone, meta: {} });
  })
);

targetsRouter.patch(
  "/:id/milestones/:milestoneId",
  requireTargetPermission(TARGET_PERMISSIONS.MANAGE_MILESTONES),
  handle((req, res) => {
    const result = targetService.updateMilestone(req.params.id, req.params.milestoneId, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "MILESTONE_NOT_FOUND");
    }
    auditTarget(req, "TARGET_MILESTONE_UPDATED", result);
    return res.json({ success: true, message: "Target milestone updated.", data: result.record, meta: {} });
  })
);

targetsRouter.post(
  "/:id/comments",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW),
  handle((req, res) => {
    const comment = targetService.addComment(req.params.id, req.body || {}, req.user);
    if (!comment) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_COMMENT_CREATED", { record: comment });
    return res.status(201).json({ success: true, message: "Target comment created.", data: comment, meta: {} });
  })
);

targetsRouter.get(
  "/:id/comments",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW),
  handle((req, res) => {
    const target = targetService.getTargetDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Target comments loaded.", data: target.comments, meta: {} });
  })
);

targetsRouter.post(
  "/:id/assign",
  requireTargetPermission(TARGET_PERMISSIONS.ASSIGN),
  handle((req, res) => {
    const assignments = targetService.assignTarget(req.params.id, req.body || {}, req.user);
    if (!assignments) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_ASSIGNED", { record: { id: req.params.id, assignments } });
    return res.status(201).json({ success: true, message: "Target assigned.", data: assignments, meta: {} });
  })
);

targetsRouter.delete(
  "/:id/assign/:employeeId",
  requireTargetPermission(TARGET_PERMISSIONS.ASSIGN),
  handle((req, res) => {
    const assignment = targetService.unassignTarget(req.params.id, req.params.employeeId, req.user);
    if (!assignment) {
      return notFound(res, "TARGET_ASSIGNMENT_NOT_FOUND");
    }
    auditTarget(req, "TARGET_UNASSIGNED", { record: assignment });
    return res.json({ success: true, message: "Target assignment removed.", data: assignment, meta: {} });
  })
);

targetsRouter.post(
  "/:id/pause",
  requireTargetPermission(TARGET_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = targetService.setTargetStatus(req.params.id, TARGET_STATUS.PAUSED, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_PAUSED", result);
    return res.json({ success: true, message: "Target paused.", data: result.record, meta: {} });
  })
);

targetsRouter.post(
  "/:id/resume",
  requireTargetPermission(TARGET_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = targetService.setTargetStatus(req.params.id, TARGET_STATUS.ACTIVE, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_RESUMED", result);
    return res.json({ success: true, message: "Target resumed.", data: result.record, meta: {} });
  })
);

targetsRouter.post(
  "/:id/cancel",
  requireTargetPermission(TARGET_PERMISSIONS.DELETE),
  handle((req, res) => {
    const result = targetService.setTargetStatus(req.params.id, TARGET_STATUS.CANCELLED, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "TARGET_NOT_FOUND");
    }
    auditTarget(req, "TARGET_CANCELLED", result);
    return res.json({ success: true, message: "Target cancelled.", data: result.record, meta: {} });
  })
);

targetsRouter.get(
  "/:id/history",
  requireTargetPermission(TARGET_PERMISSIONS.VIEW),
  handle((req, res) => {
    const target = targetService.getTargetDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Target history loaded.", data: target.history, meta: {} });
  })
);

module.exports = { targetsRouter };
