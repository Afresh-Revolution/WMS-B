const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { recordOperationalAudit } = require("../_shared/auditService");
const {
  bulkAction,
  bulkImport,
  createStaff,
  exportStaff,
  forceStaffLogout,
  getStaffActivity,
  getStaffDocuments,
  getStaffLoginHistory,
  getStaffProfile,
  listStaffDirectory,
  performStaffAction,
  resetStaffPassword,
  updateStaff,
} = require("./staffDirectoryService");

const employersRouter = express.Router();

function actionResponse(res, result, message) {
  if (!result) {
    return res.status(404).json({
      success: false,
      message: "Operation failed",
      error: { code: "STAFF_NOT_FOUND", details: {} },
    });
  }

  return res.json({ success: true, message, data: result.record || result, meta: {} });
}

function requireConfirmation(req, phrase) {
  return req.body?.confirmation === phrase;
}

employersRouter.use(authenticate, requireRole("superadmin"));

employersRouter.get("/", (req, res) => {
  const result = listStaffDirectory(req.query);
  return res.json({
    success: true,
    message: "Staff directory loaded.",
    data: result.data,
    meta: result.meta,
  });
});

employersRouter.post("/", (req, res) => {
  const staff = createStaff(req.body, req.user, req);
  recordOperationalAudit({
    user: req.user,
    action: "Created Staff",
    module: "employers",
    targetType: staff.staffType,
    recordId: staff.id,
    newValue: staff,
    ipAddress: req.ip,
  });

  return res.status(201).json({ success: true, message: "Person created.", data: staff, meta: {} });
});

employersRouter.get("/export", (req, res) => {
  const result = exportStaff(req.query, req.user, req);
  recordOperationalAudit({
    user: req.user,
    action: "Exported Staff Directory",
    module: "employers",
    newValue: { filters: req.query, count: result.count, format: req.query.format || "csv" },
    ipAddress: req.ip,
  });

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"staff-directory.csv\"");
  return res.send(result.csv);
});

employersRouter.post("/import", (req, res) => {
  const result = bulkImport(req.body || {}, req.user, req);
  recordOperationalAudit({
    user: req.user,
    action: req.body?.confirm ? "Imported Staff Directory" : "Previewed Staff Import",
    module: "employers",
    newValue: { previewCount: result.preview.length, importedCount: result.imported.length },
    ipAddress: req.ip,
  });

  return res.status(req.body?.confirm ? 201 : 200).json({
    success: true,
    message: req.body?.confirm ? "Staff import completed." : "Staff import preview generated.",
    data: result,
    meta: {},
  });
});

employersRouter.post("/bulk", (req, res) => {
  const result = bulkAction(req.body || {}, req.user, req);
  recordOperationalAudit({
    user: req.user,
    action: `Bulk Staff ${req.body?.action || "Action"}`,
    module: "employers",
    newValue: { count: result.length, action: req.body?.action },
    ipAddress: req.ip,
  });

  return res.json({ success: true, message: "Bulk action completed.", data: result, meta: {} });
});

employersRouter.get("/:id", (req, res) => {
  const profile = getStaffProfile(req.params.id);
  if (!profile) {
    return res.status(404).json({
      success: false,
      message: "Operation failed",
      error: { code: "STAFF_NOT_FOUND", details: { id: req.params.id } },
    });
  }

  return res.json({ success: true, message: "Staff profile loaded.", data: profile, meta: {} });
});

employersRouter.patch("/:id", (req, res) => {
  const result = updateStaff(req.params.id, req.body || {}, req.user, req);
  if (result) {
    recordOperationalAudit({
      user: req.user,
      action: "Updated Staff",
      module: "employers",
      recordId: req.params.id,
      oldValue: result.oldValue,
      newValue: result.record,
      ipAddress: req.ip,
    });
  }

  return actionResponse(res, result, "Staff profile updated.");
});

for (const action of ["deactivate", "activate", "suspend"]) {
  employersRouter.post(`/:id/${action}`, (req, res) => {
    const result = performStaffAction(req.params.id, action, req.body || {}, req.user, req);
    if (result) {
      recordOperationalAudit({
        user: req.user,
        action: `Staff ${action}`,
        module: "employers",
        recordId: req.params.id,
        oldValue: result.oldValue,
        newValue: result.record,
        ipAddress: req.ip,
      });
    }

    return actionResponse(res, result, `Staff ${action} completed.`);
  });
}

employersRouter.post("/:id/terminate", (req, res) => {
  if (!requireConfirmation(req, "TERMINATE STAFF")) {
    return res.status(400).json({
      success: false,
      message: "Operation failed",
      error: { code: "CONFIRMATION_REQUIRED", details: { confirmation: "TERMINATE STAFF" } },
    });
  }

  const result = performStaffAction(req.params.id, "terminate", req.body || {}, req.user, req);
  if (result) {
    recordOperationalAudit({
      user: req.user,
      action: "Staff Terminated",
      module: "employers",
      recordId: req.params.id,
      oldValue: result.oldValue,
      newValue: result.record,
      ipAddress: req.ip,
    });
  }

  return actionResponse(res, result, "Staff terminated.");
});

for (const [path, action] of [
  ["transfer", "transfer"],
  ["promote", "promote"],
  ["department", "department"],
  ["manager", "manager"],
  ["role", "role"],
]) {
  employersRouter.post(`/:id/${path}`, (req, res) => {
    const result = performStaffAction(req.params.id, action, req.body || {}, req.user, req);
    if (result) {
      recordOperationalAudit({
        user: req.user,
        action: `Staff ${action}`,
        module: "employers",
        recordId: req.params.id,
        oldValue: result.oldValue,
        newValue: result.record,
        ipAddress: req.ip,
      });
    }

    return actionResponse(res, result, `Staff ${action} completed.`);
  });
}

employersRouter.post("/:id/reset-password", (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Operation failed",
      error: { code: "INVALID_PASSWORD", details: { minLength: 8 } },
    });
  }

  const user = resetStaffPassword(req.params.id, password, req.user, req);
  recordOperationalAudit({
    user: req.user,
    action: "Reset Staff Password",
    module: "employers",
    recordId: req.params.id,
    newValue: user ? { userId: user.id } : null,
    ipAddress: req.ip,
  });

  return actionResponse(res, user, "Staff password reset.");
});

employersRouter.post("/:id/force-logout", (req, res) => {
  const revokedSessions = forceStaffLogout(req.params.id, req.user, req);
  recordOperationalAudit({
    user: req.user,
    action: "Force Staff Logout",
    module: "employers",
    recordId: req.params.id,
    newValue: revokedSessions ? { revokedSessionCount: revokedSessions.length } : null,
    ipAddress: req.ip,
  });

  return actionResponse(res, revokedSessions, "Staff sessions revoked.");
});

employersRouter.get("/:id/documents", (req, res) => {
  return res.json({
    success: true,
    message: "Staff documents loaded.",
    data: getStaffDocuments(req.params.id),
    meta: {},
  });
});

employersRouter.post("/:id/documents", (req, res) => {
  const { addStaffDocument } = require("./staffDirectoryService");
  const document = addStaffDocument(req.params.id, req.body || {}, req.user, req);
  recordOperationalAudit({
    user: req.user,
    action: "Uploaded Staff Document",
    module: "employers",
    recordId: req.params.id,
    newValue: document,
    ipAddress: req.ip,
  });

  return res.status(201).json({ success: true, message: "Staff document uploaded.", data: document, meta: {} });
});

employersRouter.get("/:id/activity", (req, res) => {
  const result = getStaffActivity(req.params.id, req.query);
  return res.json({ success: true, message: "Staff activity loaded.", data: result.data, meta: result.meta });
});

employersRouter.get("/:id/login-history", (req, res) => {
  const result = getStaffLoginHistory(req.params.id, req.query);
  return res.json({ success: true, message: "Staff login history loaded.", data: result.data, meta: result.meta });
});

module.exports = { employersRouter };
