const crypto = require("crypto");
const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { recordOperationalAudit } = require("../_shared/auditService");
const {
  createStaff,
  getStaffProfile,
  listHodOptions,
  listStaffDirectory,
  performStaffAction,
  resetStaffPassword,
  updateStaff,
} = require("../employers/staffDirectoryService");
const { getLookups, resolveEmploymentType } = require("../lookups/catalog");

const employeesRouter = express.Router();
const EMPLOYEE_ACTIONS = ["deactivate", "activate", "suspend", "terminate", "transfer", "promote", "reset-password"];

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function fail(res, statusCode, code, message, details = {}) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: { code, details },
  });
}

function notFound(res, id) {
  return fail(res, 404, "EMPLOYEE_NOT_FOUND", "Employee not found.", { id });
}

function valueOf(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return typeof value === "string" ? value.trim() : value;
    }
  }
  return "";
}

function generateLoginEmail(fullName) {
  const slug = String(fullName || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40) || "user";
  return `${slug}.${crypto.randomBytes(2).toString("hex")}@afresh.local`;
}

function generateTemporaryPassword() {
  return `Temp${crypto.randomBytes(4).toString("hex")}A1!`;
}

function normalizeEmployeeCreateBody(body = {}) {
  const fullName = valueOf(body, ["fullName", "full_name", "name"])
    || [valueOf(body, ["firstName", "first_name"]), valueOf(body, ["lastName", "last_name"])].filter(Boolean).join(" ");
  const email = valueOf(body, ["email", "workEmail", "work_email"]) || generateLoginEmail(fullName);
  const generatedEmail = !valueOf(body, ["email", "workEmail", "work_email"]);
  const password = generateTemporaryPassword();
  const employmentType = resolveEmploymentType(body.employmentType || body.employment_type || body.staffType);

  return {
    body: {
      ...body,
      staffType: body.staffType || body.staff_type || employmentType.staffType,
      employmentType: employmentType.label,
      employment_type: employmentType.key,
      fullName,
      name: fullName,
      email,
      phone: valueOf(body, ["phone", "phoneNumber", "phone_number"]),
      jobTitle: valueOf(body, ["jobTitle", "job_title", "position", "title", "roleTitle"]),
      department: valueOf(body, ["department", "departmentName", "department_name"]),
      departmentId: valueOf(body, ["departmentId", "department_id"]),
      location: valueOf(body, ["location", "workLocation", "work_location"]),
      locationType: valueOf(body, ["locationType", "location_type", "workMode", "work_mode"]),
      startDate: valueOf(body, ["startDate", "start_date", "employmentStartDate", "hireDate"]),
      reportsTo: valueOf(body, ["reportsTo", "reports_to", "manager"]),
      role: valueOf(body, ["role", "roleKey", "role_key"]) || "employee",
      systemAccess: {
        ...(body.systemAccess || {}),
        createAccount: true,
        email,
        initialPassword: password,
        role: body.systemAccess?.role || valueOf(body, ["role", "roleKey", "role_key"]) || "employee",
        mustChangePassword: true,
      },
    },
    generatedPassword: password,
    generatedEmail: generatedEmail ? email : null,
  };
}

employeesRouter.get("/", authenticate, requireRole("superadmin"), (req, res) => {
  const result = listStaffDirectory({
    ...req.query,
    staffType: req.query.staffType || req.query.staff_type || "employee",
  });
  return send(res, "Employees loaded.", result.data, result.meta);
});

employeesRouter.get("/options", authenticate, requireRole("superadmin"), async (_req, res) => {
  const employees = await listHodOptions();
  return send(res, "Employee form options loaded.", {
    ...getLookups(),
    employees,
    hods: employees,
  });
});

employeesRouter.post("/", authenticate, requireRole(["superadmin", "manager", "hr"]), async (req, res) => {
  const { body, generatedPassword, generatedEmail } = normalizeEmployeeCreateBody(req.body || {});
  if (!body.fullName) {
    return fail(res, 400, "EMPLOYEE_NAME_REQUIRED", "A name is required to add a person.");
  }

  try {
    const staff = await createStaff(body, req.user, req);
    recordOperationalAudit({
      user: req.user,
      action: "Created Employee",
      module: "employees",
      targetType: "employee",
      recordId: staff.id,
      newValue: staff,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: "Person created.",
      data: staff,
      meta: {
        temporaryPassword: generatedPassword,
        mustChangePassword: true,
        generatedEmail,
        loginEmail: body.email,
      },
    });
  } catch (error) {
    return fail(
      res,
      error.statusCode || 500,
      error.code || "EMPLOYEE_CREATE_FAILED",
      error.publicMessage || error.message || "Unable to add person."
    );
  }
});

employeesRouter.get("/:id", authenticate, requireRole("superadmin"), (req, res) => {
  const profile = getStaffProfile(req.params.id);
  return profile ? send(res, "Employee loaded.", profile) : notFound(res, req.params.id);
});

employeesRouter.patch("/:id", authenticate, requireRole("superadmin"), (req, res) => {
  const result = updateStaff(req.params.id, req.body || {}, req.user, req);
  if (!result) {
    return notFound(res, req.params.id);
  }
  recordOperationalAudit({
    user: req.user,
    action: "Updated Employee",
    module: "employees",
    recordId: req.params.id,
    oldValue: result.oldValue,
    newValue: result.record,
    ipAddress: req.ip,
  });
  return send(res, "Employee updated.", result.record);
});

employeesRouter.put("/:id", authenticate, requireRole("superadmin"), (req, res) => {
  const result = updateStaff(req.params.id, req.body || {}, req.user, req);
  if (!result) {
    return notFound(res, req.params.id);
  }
  recordOperationalAudit({
    user: req.user,
    action: "Updated Employee",
    module: "employees",
    recordId: req.params.id,
    oldValue: result.oldValue,
    newValue: result.record,
    ipAddress: req.ip,
  });
  return send(res, "Employee updated.", result.record);
});

employeesRouter.delete("/:id", authenticate, requireRole("superadmin"), async (req, res) => {
  const result = await performStaffAction(req.params.id, "deactivate", req.body || {}, req.user, req);
  if (!result) {
    return notFound(res, req.params.id);
  }
  recordOperationalAudit({
    user: req.user,
    action: "Deactivated Employee",
    module: "employees",
    recordId: req.params.id,
    oldValue: result.oldValue,
    newValue: result.record,
    ipAddress: req.ip,
  });
  return send(res, "Employee deactivated.", result.record);
});

for (const action of EMPLOYEE_ACTIONS.filter((item) => item !== "reset-password")) {
  employeesRouter.post(`/:id/${action}`, authenticate, requireRole("superadmin"), async (req, res) => {
    const result = await performStaffAction(req.params.id, action, req.body || {}, req.user, req);
    if (!result) {
      return notFound(res, req.params.id);
    }
    recordOperationalAudit({
      user: req.user,
      action: `Employee ${action}`,
      module: "employees",
      recordId: req.params.id,
      oldValue: result.oldValue,
      newValue: result.record,
      ipAddress: req.ip,
    });
    return send(res, `Employee ${action} completed.`, result.record);
  });
}

employeesRouter.post("/:id/reset-password", authenticate, requireRole("superadmin"), async (req, res) => {
  const password = req.body?.password || generateTemporaryPassword();
  if (typeof password !== "string" || password.length < 8) {
    return fail(res, 400, "INVALID_PASSWORD", "Password must be at least 8 characters.", { minLength: 8 });
  }
  const user = await resetStaffPassword(req.params.id, password, req.user, req);
  if (!user) {
    return notFound(res, req.params.id);
  }
  recordOperationalAudit({
    user: req.user,
    action: "Reset Employee Password",
    module: "employees",
    recordId: req.params.id,
    newValue: { userId: user.id },
    ipAddress: req.ip,
  });
  return send(res, "Employee password reset.", user, req.body?.password ? {} : { temporaryPassword: password });
});

module.exports = { employeesRouter };
