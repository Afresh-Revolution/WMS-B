const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { NYSC_INTERN_PERMISSIONS } = require("./constants");
const nyscInternService = require("./nyscIntern.service");

const nyscInternRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireNyscInternPermission(permission) {
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

function notFound(res, code = "NYSC_INTERN_PROFILE_NOT_FOUND") {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

function auditPlacement(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "nysc_intern",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

nyscInternRouter.use(authenticate);

nyscInternRouter.get(
  "/dashboard",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "NYSC and intern dashboard loaded.", data: nyscInternService.getDashboard(req.user), meta: {} }))
);

nyscInternRouter.get(
  "/reports/summary",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "NYSC and intern summary loaded.", data: nyscInternService.getSummary(req.user), meta: {} }))
);

nyscInternRouter.get(
  "/export",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.EXPORT),
  handle((req, res) => {
    const csv = nyscInternService.exportProfiles(req.user, req.query);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"nysc-interns.csv\"");
    return res.status(200).send(csv);
  })
);

nyscInternRouter.get(
  "/documents/:id/download",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW_DOCUMENTS),
  handle((req, res) => {
    const document = nyscInternService.downloadDocument(req.params.id, req.user);
    if (!document) {
      return notFound(res, "PLACEMENT_DOCUMENT_NOT_FOUND");
    }
    auditPlacement(req, "DOCUMENT_VIEWED", document);
    return res.json({ success: true, message: "Placement document download authorized.", data: document, meta: {} });
  })
);

nyscInternRouter.patch(
  "/attendance/:id",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.MANAGE_ATTENDANCE),
  handle((req, res) => {
    const result = nyscInternService.updateAttendance(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PLACEMENT_ATTENDANCE_NOT_FOUND");
    }
    auditPlacement(req, "ATTENDANCE_UPDATED", result);
    return res.json({ success: true, message: "Placement attendance updated.", data: result.record, meta: {} });
  })
);

function createNyscIntern(req, res) {
  const result = nyscInternService.createProfile(req.body || {}, req.user);
  auditPlacement(req, result.record.profile.type === "NYSC" ? "NYSC_CREATED" : "INTERN_CREATED", result);
  return res.status(201).json({ success: true, message: "NYSC/intern profile created.", data: result.record, meta: {} });
}

nyscInternRouter.post(
  "/",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.CREATE),
  handle(createNyscIntern)
);

nyscInternRouter.post(
  "/members",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.CREATE),
  handle(createNyscIntern)
);

nyscInternRouter.get(
  "/",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = nyscInternService.listProfiles(req.user, req.query);
    return res.json({ success: true, message: "NYSC and intern profiles loaded.", data: result.data, meta: result.meta });
  })
);

nyscInternRouter.get(
  "/:id",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "NYSC/intern profile loaded.", data: nyscInternService.getDetails(req.params.id, req.user), meta: {} }))
);

nyscInternRouter.patch(
  "/:id",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = nyscInternService.updateProfile(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "PROFILE_UPDATED", result);
    return res.json({ success: true, message: "NYSC/intern profile updated.", data: result.record, meta: {} });
  })
);

nyscInternRouter.delete(
  "/:id",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.DELETE),
  handle((req, res) => {
    const result = nyscInternService.removeProfile(req.params.id, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "PLACEMENT_CANCELLED", result);
    return res.json({ success: true, message: "NYSC/intern placement cancelled.", data: result.record, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/supervisor",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.ASSIGN_SUPERVISOR),
  handle((req, res) => {
    const result = nyscInternService.assignSupervisor(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "SUPERVISOR_ASSIGNED", result);
    return res.json({ success: true, message: "Placement supervisor assigned.", data: result.record, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/department",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.MANAGE_PLACEMENT),
  handle((req, res) => {
    const result = nyscInternService.changeDepartment(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "DEPARTMENT_CHANGED", result);
    return res.json({ success: true, message: "Placement department changed.", data: result.record, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/extend",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.EXTEND),
  handle((req, res) => {
    const result = nyscInternService.extendPlacement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "PLACEMENT_EXTENDED", result);
    return res.json({ success: true, message: "Placement extended.", data: result.record, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/complete",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.COMPLETE),
  handle((req, res) => {
    const result = nyscInternService.completePlacement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "PLACEMENT_COMPLETED", result);
    return res.json({ success: true, message: "Placement completed.", data: result.record, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/terminate",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.TERMINATE),
  handle((req, res) => {
    const result = nyscInternService.terminatePlacement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "PLACEMENT_TERMINATED", result);
    return res.json({ success: true, message: "Placement terminated.", data: result.record, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/exit",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.MANAGE_EXIT),
  handle((req, res) => {
    const result = nyscInternService.processExit(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "PLACEMENT_EXITED", result);
    return res.json({ success: true, message: "Placement exit processed.", data: result.record, meta: {} });
  })
);

nyscInternRouter.get(
  "/:id/attendance",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = nyscInternService.listAttendance(req.params.id, req.user, req.query);
    if (!result) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Placement attendance loaded.", data: result.data, meta: result.meta });
  })
);

nyscInternRouter.post(
  "/:id/attendance",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.MANAGE_ATTENDANCE),
  handle((req, res) => {
    const attendance = nyscInternService.addAttendance(req.params.id, req.body || {}, req.user);
    if (!attendance) {
      return notFound(res);
    }
    auditPlacement(req, "ATTENDANCE_UPDATED", attendance);
    return res.status(201).json({ success: true, message: "Placement attendance recorded.", data: attendance, meta: {} });
  })
);

nyscInternRouter.get(
  "/:id/documents",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW_DOCUMENTS),
  handle((req, res) => {
    const documents = nyscInternService.listDocuments(req.params.id, req.user);
    if (!documents) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Placement documents loaded.", data: documents, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/documents",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.MANAGE_DOCUMENTS),
  handle((req, res) => {
    const document = nyscInternService.addDocument(req.params.id, req.body || {}, req.user);
    if (!document) {
      return notFound(res);
    }
    auditPlacement(req, "DOCUMENT_UPLOADED", document);
    return res.status(201).json({ success: true, message: "Placement document uploaded.", data: document, meta: {} });
  })
);

nyscInternRouter.get(
  "/:id/reviews",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW_REVIEWS),
  handle((req, res) => {
    const reviews = nyscInternService.listReviews(req.params.id, req.user);
    if (!reviews) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Placement reviews loaded.", data: reviews, meta: {} });
  })
);

nyscInternRouter.post(
  "/:id/reviews",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.MANAGE_REVIEWS),
  handle((req, res) => {
    const review = nyscInternService.addReview(req.params.id, req.body || {}, req.user);
    if (!review) {
      return notFound(res);
    }
    auditPlacement(req, "REVIEW_CREATED", review);
    return res.status(201).json({ success: true, message: "Placement review recorded.", data: review, meta: {} });
  })
);

nyscInternRouter.get(
  "/:id/tasks",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Placement tasks loaded.", data: nyscInternService.listTasks(req.params.id, req.user), meta: {} }))
);

nyscInternRouter.get(
  "/:id/targets",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Placement targets loaded.", data: nyscInternService.listTargets(req.params.id, req.user), meta: {} }))
);

nyscInternRouter.get(
  "/:id/history",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Placement history loaded.", data: nyscInternService.listHistory(req.params.id, req.user), meta: {} }))
);

nyscInternRouter.post(
  "/:id/convert-to-employee",
  requireNyscInternPermission(NYSC_INTERN_PERMISSIONS.CONVERT_EMPLOYEE),
  handle((req, res) => {
    const result = nyscInternService.convertToEmployee(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditPlacement(req, "EMPLOYEE_CONVERSION", result);
    return res.status(201).json({ success: true, message: "Placement converted to employee.", data: result.record, meta: result.meta || {} });
  })
);

module.exports = { nyscInternRouter };
