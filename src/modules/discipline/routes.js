const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { DISCIPLINE_PERMISSIONS } = require("./constants");
const disciplineService = require("./discipline.service");

const disciplineRouter = express.Router();
const employeeDisciplineRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireDisciplinePermission(permission) {
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

function notFound(res, code = "DISCIPLINE_CASE_NOT_FOUND") {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

function auditDiscipline(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "discipline",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

disciplineRouter.use(authenticate);
employeeDisciplineRouter.use(authenticate);

disciplineRouter.get(
  "/dashboard",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => res.json({ success: true, message: "Disciplinary dashboard loaded.", data: disciplineService.getDashboard(req.user), meta: {} }))
);

disciplineRouter.get(
  "/export",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.EXPORT),
  handle((req, res) => {
    const csv = disciplineService.exportCases(req.user, req.query);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"disciplinary-cases.csv\"");
    return res.status(200).send(csv);
  })
);

disciplineRouter.get(
  "/evidence/:id/download",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW_EVIDENCE),
  handle((req, res) => {
    const evidence = disciplineService.downloadEvidence(req.params.id, req.user);
    if (!evidence) {
      return notFound(res, "DISCIPLINARY_EVIDENCE_NOT_FOUND");
    }
    auditDiscipline(req, "DISCIPLINARY_EVIDENCE_VIEWED", evidence);
    return res.json({ success: true, message: "Evidence download authorized.", data: evidence, meta: {} });
  })
);

disciplineRouter.post(
  "/cases",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = disciplineService.createCase(req.body || {}, req.user);
    auditDiscipline(req, "DISCIPLINARY_CASE_CREATED", result);
    return res.status(201).json({ success: true, message: "Disciplinary case created.", data: result.record, meta: result.meta || {} });
  })
);

disciplineRouter.get(
  "/cases",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = disciplineService.listCases(req.user, req.query);
    return res.json({ success: true, message: "Disciplinary cases loaded.", data: result.data, meta: result.meta });
  })
);

disciplineRouter.get(
  "/cases/:id",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Disciplinary case loaded.", data: disciplineService.getCaseDetails(req.params.id, req.user), meta: {} }))
);

disciplineRouter.patch(
  "/cases/:id",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = disciplineService.updateCase(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_CASE_UPDATED", result);
    return res.json({ success: true, message: "Disciplinary case updated.", data: result.record, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/assign",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.ASSIGN),
  handle((req, res) => {
    const result = disciplineService.assignCase(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_CASE_ASSIGNED", result);
    return res.json({ success: true, message: "Disciplinary case assigned.", data: result.record, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/investigate",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.INVESTIGATE),
  handle((req, res) => {
    const result = disciplineService.startInvestigation(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_INVESTIGATION_STARTED", result);
    return res.json({ success: true, message: "Disciplinary investigation started.", data: result.record, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/actions",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.ISSUE_ACTION),
  handle((req, res) => {
    const result = disciplineService.issueAction(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_ACTION_ISSUED", result);
    return res.status(201).json({ success: true, message: "Disciplinary action issued.", data: result.record, meta: result.meta || {} });
  })
);

disciplineRouter.get(
  "/cases/:id/actions",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const actions = disciplineService.listActions(req.params.id, req.user);
    if (!actions) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Disciplinary actions loaded.", data: actions, meta: {} });
  })
);

disciplineRouter.post(
  "/actions/:id/revoke",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.ISSUE_ACTION),
  handle((req, res) => {
    const result = disciplineService.revokeAction(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "DISCIPLINARY_ACTION_NOT_FOUND");
    }
    auditDiscipline(req, "DISCIPLINARY_ACTION_REVOKED", result);
    return res.json({ success: true, message: "Disciplinary action revoked.", data: result.record, meta: {} });
  })
);

disciplineRouter.post(
  "/actions/:id/acknowledge",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const acknowledgement = disciplineService.acknowledgeAction(req.params.id, req.body || {}, req.user);
    if (!acknowledgement) {
      return notFound(res, "DISCIPLINARY_ACTION_NOT_FOUND");
    }
    auditDiscipline(req, "DISCIPLINARY_ACKNOWLEDGED", acknowledgement);
    return res.json({ success: true, message: "Disciplinary action acknowledgement recorded.", data: acknowledgement, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/resolve",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.RESOLVE),
  handle((req, res) => {
    const result = disciplineService.resolveCase(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_CASE_RESOLVED", result);
    return res.json({ success: true, message: "Disciplinary case resolved.", data: result.record, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/close",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.CLOSE),
  handle((req, res) => {
    const result = disciplineService.closeCase(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_CASE_CLOSED", result);
    return res.json({ success: true, message: "Disciplinary case closed.", data: result.record, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/reopen",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.REOPEN),
  handle((req, res) => {
    const result = disciplineService.reopenCase(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_CASE_REOPENED", result);
    return res.json({ success: true, message: "Disciplinary case reopened.", data: result.record, meta: {} });
  })
);

disciplineRouter.get(
  "/cases/:id/evidence",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW_EVIDENCE),
  handle((req, res) => {
    const evidence = disciplineService.listEvidence(req.params.id, req.user);
    if (!evidence) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Disciplinary evidence loaded.", data: evidence, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/evidence",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.UPLOAD_EVIDENCE),
  handle((req, res) => {
    const evidence = disciplineService.addEvidence(req.params.id, req.body || {}, req.user);
    if (!evidence) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_EVIDENCE_ADDED", evidence);
    return res.status(201).json({ success: true, message: "Disciplinary evidence added.", data: evidence, meta: {} });
  })
);

disciplineRouter.get(
  "/cases/:id/notes",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.INVESTIGATE),
  handle((req, res) => {
    const notes = disciplineService.listNotes(req.params.id, req.user);
    if (!notes) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Disciplinary notes loaded.", data: notes, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/notes",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.INVESTIGATE),
  handle((req, res) => {
    const note = disciplineService.addNote(req.params.id, req.body || {}, req.user);
    if (!note) {
      return notFound(res);
    }
    return res.status(201).json({ success: true, message: "Disciplinary note added.", data: note, meta: {} });
  })
);

disciplineRouter.get(
  "/cases/:id/hearings",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.MANAGE_HEARINGS),
  handle((req, res) => {
    const hearings = disciplineService.listHearings(req.params.id, req.user);
    if (!hearings) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Disciplinary hearings loaded.", data: hearings, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/hearings",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.MANAGE_HEARINGS),
  handle((req, res) => {
    const hearing = disciplineService.createHearing(req.params.id, req.body || {}, req.user);
    if (!hearing) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_HEARING_CREATED", hearing);
    return res.status(201).json({ success: true, message: "Disciplinary hearing created.", data: hearing, meta: {} });
  })
);

disciplineRouter.get(
  "/cases/:id/appeals",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const appeals = disciplineService.listAppeals(req.params.id, req.user);
    if (!appeals) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Disciplinary appeals loaded.", data: appeals, meta: {} });
  })
);

disciplineRouter.post(
  "/cases/:id/appeals",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = disciplineService.submitAppeal(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditDiscipline(req, "DISCIPLINARY_APPEAL_SUBMITTED", result);
    return res.status(201).json({ success: true, message: "Disciplinary appeal submitted.", data: result.record, meta: result.meta || {} });
  })
);

disciplineRouter.post(
  "/appeals/:id/review",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.MANAGE_APPEALS),
  handle((req, res) => {
    const result = disciplineService.reviewAppeal(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "DISCIPLINARY_APPEAL_NOT_FOUND");
    }
    auditDiscipline(req, "DISCIPLINARY_APPEAL_REVIEWED", result);
    return res.json({ success: true, message: "Disciplinary appeal reviewed.", data: result.record, meta: {} });
  })
);

employeeDisciplineRouter.get(
  "/:id/disciplinary-history",
  requireDisciplinePermission(DISCIPLINE_PERMISSIONS.VIEW_EMPLOYEE_HISTORY),
  handle((req, res) => res.json({ success: true, message: "Employee disciplinary history loaded.", data: disciplineService.getEmployeeHistory(req.params.id, req.user), meta: {} }))
);

module.exports = { disciplineRouter, employeeDisciplineRouter };
