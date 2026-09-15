const crypto = require("crypto");
const { PERMISSIONS, ROLE_DEFINITIONS } = require("../../constants/rbac");
const { readCollection, writeCollection, appendRecord } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordTechnicalAuditEvent } = require("../_shared/auditService");

const DEFAULT_ROLE_KEYS = [
  "superadmin",
  "admin",
  "hr",
  "accountant",
  "secretary",
  "hod",
  "employee",
  "intern",
  "nysc_intern",
];

const DEFAULT_ROLE_NAMES = {
  superadmin: "Super Admin",
  admin: "Admin",
  hr: "HR",
  accountant: "Accountant",
  secretary: "Secretary",
  hod: "HOD",
  employee: "Employee",
  intern: "Intern",
  nysc_intern: "NYSC/Intern",
};

const ROLE_PERMISSION_PRESETS = {
  superadmin: Object.values(PERMISSIONS),
  admin: [
    "overview.view",
    "users.view",
    "employees.view",
    "departments.view",
    "leave.view",
    "meetings.view",
    "tasks.view",
    "targets.view",
    "reports.view",
  ],
  hr: [
    "employees.view",
    "employees.create",
    "employees.update",
    "departments.view",
    "leave.view",
    "leave.approve",
    "leave.reject",
    "attendance.view",
    "report.viewAttendance",
    "promotions.view",
    "promotions.create",
    "salary_increments.view",
    "discipline.view",
    "discipline.create",
    "nysc_interns.view",
    "nysc_interns.create",
    "reports.view",
  ],
  accountant: [
    "payroll.view",
    "payroll.create",
    "bills.view",
    "bills.create",
    "expenses.view",
    "expenses.approve",
    "purchases.view",
    "vendors.view",
    "reports.view",
    "attendance.check_in",
  ],
  secretary: [
    "meetings.view",
    "meetings.create",
    "events.view",
    "events.create",
    "announcements.view",
    "announcements.create",
    "announcements.publish",
  ],
  hod: [
    "dashboard:view",
    "overview.view",
    "departments.view",
    "employees.view",
    "leave.view",
    "leave.create",
    "leave.approve",
    "leave.reject",
    "leave.view_team",
    "performance.view",
    "performance.create",
    "performance.review",
    "meetings.view",
    "meetings.create",
    "meetings.update",
    "tasks.view",
    "tasks.create",
    "tasks.assign",
    "tasks.update",
    "targets.view",
    "targets.create",
    "targets.assign",
    "targets.update",
    "reports.view",
    "notifications.view",
    "audit_logs.view",
    "settings.view",
    "settings.update",
    "help_center.view",
    "profile.view",
    "profile.update",
  ],
  employee: ["profile.view", "profile.update", "attendance.check_in", "leave.request", "tasks.view", "targets.view", "meetings.view", "announcements.view"],
  intern: [
    "dashboard:view",
    "profile.view",
    "profile.update",
    "tasks.view",
    "tasks.update",
    "attendance.check_in",
    "meeting.view",
    "target.view",
    "target.update_progress",
    "nysc_intern.view",
    "nysc_intern.view_documents",
    "nysc_intern.view_reviews",
    "announcement.view",
  ],
  nysc_intern: [
    "dashboard:view",
    "profile.view",
    "profile.update",
    "tasks.view",
    "tasks.update",
    "attendance.check_in",
    "meeting.view",
    "target.view",
    "target.update_progress",
    "nysc_intern.view",
    "nysc_intern.view_documents",
    "nysc_intern.view_reviews",
    "announcement.view",
  ],
};

function now() {
  return new Date().toISOString();
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function normalizePermission(permission) {
  const key = String(permission || "").trim();
  const [module, action = "manage"] = key.split(".");
  return {
    id: key,
    key,
    name: key,
    module,
    action,
    description: key,
  };
}

function listPermissionCatalog() {
  const stored = readCollection("permissions")
    .filter((permission) => !permission.deletedAt)
    .map((permission) => ({
      id: permission.id || permission.key || permission.name,
      key: permission.key || permission.name || `${permission.module}.${permission.action}`,
      name: permission.name || permission.key || `${permission.module}.${permission.action}`,
      module: permission.module,
      action: permission.action,
      description: permission.description || null,
    }));
  const fromConstants = Object.values(PERMISSIONS).map(normalizePermission);
  const byKey = new Map();

  for (const permission of [...fromConstants, ...stored]) {
    byKey.set(permission.key, permission);
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function validatePermissions(permissions = []) {
  const catalog = listPermissionCatalog();
  const byKeyOrId = new Map();
  for (const permission of catalog) {
    byKeyOrId.set(permission.key, permission);
    byKeyOrId.set(permission.id, permission);
  }

  const resolved = [];
  const invalid = [];
  for (const permission of permissions) {
    const match = byKeyOrId.get(permission);
    if (!match) {
      invalid.push(permission);
      continue;
    }
    resolved.push(match.key);
  }

  if (invalid.length > 0) {
    throw createHttpError(400, "One or more permissions are invalid.", "INVALID_PERMISSIONS", { invalid });
  }

  return [...new Set(resolved)].sort();
}

function defaultRole(key) {
  const existing = ROLE_DEFINITIONS[key];
  return {
    id: key,
    key,
    name: DEFAULT_ROLE_NAMES[key] || existing?.name || key,
    description: existing?.description || null,
    permissions: ROLE_PERMISSION_PRESETS[key] || existing?.permissions || [],
    isSystemRole: true,
    is_system_role: true,
    createdAt: null,
    updatedAt: null,
  };
}

function listAllRoles() {
  const roles = new Map(DEFAULT_ROLE_KEYS.map((key) => [key, defaultRole(key)]));
  for (const role of readCollection("roles").filter((record) => !record.deletedAt)) {
    const key = role.key || normalizeKey(role.name || role.id);
    roles.set(key, {
      id: role.id,
      key,
      name: role.name,
      description: role.description || null,
      permissions: Array.isArray(role.permissions) ? role.permissions : [],
      isSystemRole: Boolean(role.isSystemRole || role.is_system_role),
      is_system_role: Boolean(role.isSystemRole || role.is_system_role),
      createdAt: role.createdAt || role.created_at || null,
      updatedAt: role.updatedAt || role.updated_at || null,
    });
  }

  return [...roles.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function findRole(id) {
  return listAllRoles().find((role) => role.id === id || role.key === normalizeKey(id)) || null;
}

function writeRoleRecord(payload) {
  const roles = readCollection("roles");
  const timestamp = now();
  const role = {
    id: crypto.randomUUID(),
    ...payload,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  roles.push(role);
  writeCollection("roles", roles);
  return role;
}

function updateRoleRecord(id, payload) {
  const roles = readCollection("roles");
  const index = roles.findIndex((role) => !role.deletedAt && (role.id === id || role.key === normalizeKey(id)));
  if (index === -1) {
    return null;
  }

  roles[index] = {
    ...roles[index],
    ...payload,
    id: roles[index].id,
    updatedAt: now(),
    updated_at: now(),
  };
  writeCollection("roles", roles);
  return roles[index];
}

function audit(req, action, role, beforeData, afterData) {
  appendRecord("role_permission_cache_invalidations", {
    id: crypto.randomUUID(),
    roleId: role?.id || null,
    role_id: role?.id || null,
    reason: action,
    createdAt: now(),
    created_at: now(),
  });

  return recordTechnicalAuditEvent({
    user: req.user,
    action,
    module: "Roles & Permissions",
    targetType: "Role",
    targetId: role?.id || null,
    description: action,
    beforeData,
    afterData,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    service: "rbac",
  });
}

function listRoles(query = {}) {
  const result = paginate(applyBasicFilters(listAllRoles(), { ...query, q: query.q || query.search }, ["key", "name", "description"]), query);
  return result;
}

function getRole(id) {
  return findRole(id);
}

function createRole(payload = {}, req) {
  if (!payload.name) {
    throw createHttpError(400, "Role name is required.", "ROLE_NAME_REQUIRED");
  }

  const key = normalizeKey(payload.key || payload.name);
  if (findRole(key)) {
    throw createHttpError(409, "Role already exists.", "ROLE_EXISTS");
  }

  const role = writeRoleRecord({
    key,
    name: payload.name,
    description: payload.description || null,
    permissions: validatePermissions(payload.permissions || []),
    isSystemRole: false,
    is_system_role: false,
    createdBy: req.user.id,
    created_by: req.user.id,
  });
  audit(req, "ROLE_CREATED", role, null, role);
  return role;
}

function updateRole(id, payload = {}, req) {
  const role = findRole(id);
  if (!role) {
    return null;
  }
  if (role.key === "superadmin") {
    throw createHttpError(403, "Super Admin permissions cannot be modified.", "SUPER_ADMIN_ROLE_PROTECTED");
  }

  const update = {};
  if (payload.name) update.name = payload.name;
  if (payload.description !== undefined) update.description = payload.description;
  if (payload.key) update.key = normalizeKey(payload.key);
  const stored = updateRoleRecord(id, update) || writeRoleRecord({ ...role, ...update, isSystemRole: false, is_system_role: false });
  audit(req, "ROLE_UPDATED", stored, role, stored);
  return stored;
}

function deleteRole(id, req) {
  const role = findRole(id);
  if (!role) {
    return null;
  }
  if (role.isSystemRole || role.key === "superadmin") {
    throw createHttpError(403, "System roles cannot be deleted.", "SYSTEM_ROLE_PROTECTED");
  }

  const deleted = updateRoleRecord(id, { deletedAt: now(), deleted_at: now(), deletedBy: req.user.id, deleted_by: req.user.id });
  audit(req, "ROLE_DELETED", role, role, deleted);
  return deleted;
}

function getRolePermissions(id) {
  const role = findRole(id);
  if (!role) {
    return null;
  }
  const permissionKeys = validatePermissions(role.permissions || []);
  return permissionKeys.map((permission) => listPermissionCatalog().find((item) => item.key === permission)).filter(Boolean);
}

function putRolePermissions(id, permissions = [], req) {
  const role = findRole(id);
  if (!role) {
    return null;
  }
  if (role.key === "superadmin") {
    throw createHttpError(403, "Super Admin permissions cannot be modified.", "SUPER_ADMIN_ROLE_PROTECTED");
  }

  const nextPermissions = validatePermissions(permissions);
  const stored =
    updateRoleRecord(id, { permissions: nextPermissions, updatedBy: req.user.id, updated_by: req.user.id }) ||
    writeRoleRecord({
      ...role,
      id: crypto.randomUUID(),
      permissions: nextPermissions,
      isSystemRole: false,
      is_system_role: false,
      updatedBy: req.user.id,
      updated_by: req.user.id,
    });
  audit(req, "ROLE_PERMISSIONS_CHANGED", stored, role, stored);
  return stored;
}

module.exports = {
  createRole,
  deleteRole,
  getRole,
  getRolePermissions,
  listPermissionCatalog,
  listRoles,
  putRolePermissions,
  updateRole,
};
