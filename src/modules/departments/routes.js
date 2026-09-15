const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { recordOperationalAudit } = require("../_shared/auditService");
const {
  createDepartment,
  getDepartmentActivity,
  getDepartmentProfile,
  getDepartmentRelation,
  listDepartments,
  removeHod,
  setDepartmentStatus,
  setHod,
  softDeleteDepartment,
  updateDepartment,
} = require("./departmentService");

const departmentsRouter = express.Router();

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code: "DEPARTMENT_NOT_FOUND", details: {} },
  });
}

function sendResult(res, result, message) {
  if (!result) {
    return notFound(res);
  }

  return res.json({ success: true, message, data: result.record || result, meta: {} });
}

function auditDepartment(req, action, result) {
  recordOperationalAudit({
    user: req.user,
    action,
    module: "departments",
    recordId: req.params.id || result?.id || result?.record?.id,
    oldValue: result?.oldValue || null,
    newValue: result?.record || result || null,
    ipAddress: req.ip,
  });
}

departmentsRouter.use(authenticate, requireRole("superadmin"));

departmentsRouter.get("/", (req, res) => {
  const result = listDepartments(req.query);
  return res.json({ success: true, message: "Departments loaded.", data: result.data, meta: result.meta });
});

departmentsRouter.get("/hod-options", (_req, res) => {
  const { listHodOptions } = require("../employers/staffDirectoryService");
  return res.json({
    success: true,
    message: "HOD options loaded.",
    data: listHodOptions(),
    meta: {},
  });
});

departmentsRouter.post("/", (req, res) => {
  const department = createDepartment(req.body || {}, req.user, req);
  auditDepartment(req, "Department Created", department);
  return res.status(201).json({ success: true, message: "Department created.", data: department, meta: {} });
});

departmentsRouter.get("/:id", (req, res) => {
  const profile = getDepartmentProfile(req.params.id);
  if (!profile) {
    return notFound(res);
  }

  return res.json({ success: true, message: "Department profile loaded.", data: profile, meta: {} });
});

departmentsRouter.get("/:id/overview", (req, res) => {
  const profile = getDepartmentProfile(req.params.id);
  if (!profile) {
    return notFound(res);
  }

  return res.json({ success: true, message: "Department overview loaded.", data: profile.overview.summary, meta: {} });
});

departmentsRouter.patch("/:id", (req, res) => {
  const result = updateDepartment(req.params.id, req.body || {}, req.user, req);
  auditDepartment(req, "Department Updated", result);
  return sendResult(res, result, "Department updated.");
});

departmentsRouter.delete("/:id", (req, res) => {
  const result = softDeleteDepartment(req.params.id, req.user, req);
  auditDepartment(req, "Department Soft Deleted", result);
  return sendResult(res, result, "Department soft deleted.");
});

departmentsRouter.post("/:id/activate", (req, res) => {
  const result = setDepartmentStatus(req.params.id, "active", req.body || {}, req.user, req);
  auditDepartment(req, "Department Activated", result);
  return sendResult(res, result, "Department activated.");
});

departmentsRouter.post("/:id/deactivate", (req, res) => {
  const result = setDepartmentStatus(req.params.id, "inactive", req.body || {}, req.user, req);
  auditDepartment(req, "Department Deactivated", result);
  return sendResult(res, result, "Department deactivated.");
});

departmentsRouter.post("/:id/hod", (req, res) => {
  const result = setHod(req.params.id, req.body?.employeeId || req.body?.hodId, req.user, req);
  auditDepartment(req, "Department HOD Assigned", result);
  return sendResult(res, result, "Department HOD assigned.");
});

departmentsRouter.delete("/:id/hod", (req, res) => {
  const result = removeHod(req.params.id, req.user, req);
  auditDepartment(req, "Department HOD Removed", result);
  return sendResult(res, result, "Department HOD removed.");
});

departmentsRouter.post("/:id/assistant-hod", (req, res) => {
  const result = setHod(req.params.id, req.body?.employeeId || req.body?.assistantHodId, req.user, req, true);
  auditDepartment(req, "Department Assistant HOD Assigned", result);
  return sendResult(res, result, "Department assistant HOD assigned.");
});

for (const relation of [
  "employees",
  "interns",
  "nysc",
  "tasks",
  "targets",
  "leave",
  "payroll",
  "expenses",
  "purchases",
  "meetings",
  "events",
  "reports",
]) {
  departmentsRouter.get(`/:id/${relation}`, (req, res) => {
    const result = getDepartmentRelation(req.params.id, relation, req.query);
    if (!result) {
      return notFound(res);
    }

    return res.json({ success: true, message: `Department ${relation} loaded.`, data: result.data, meta: result.meta });
  });
}

departmentsRouter.get("/:id/activity", (req, res) => {
  const result = getDepartmentActivity(req.params.id, req.query);
  return res.json({ success: true, message: "Department activity loaded.", data: result.data, meta: result.meta });
});

module.exports = { departmentsRouter };
