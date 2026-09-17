const crypto = require("crypto");
const { hashPassword } = require("../../auth/passwords");
const { revokeSession, revokeUserSessions, listSessions } = require("../../auth/sessionStore");
const accountStore = require("../../auth/accountStore");
const {
  getUserByEmail,
  getUserById,
  listUsers,
  sanitizeUser,
  updateUser,
  updateUserPassword,
} = require("../../auth/userStore");
const { ROLE_DEFINITIONS, PERMISSIONS } = require("../../constants/rbac");
const { appendRecord, readCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate, sortRecords } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const securityService = require("../security/securityService");

const ACCOUNT_STATUSES = new Set(["active", "inactive", "locked", "pending", "suspended"]);
const ACCOUNT_TYPES = new Set(["SUPER_ADMIN", "ADMIN", "STAFF"]);
const USER_SEARCH_FIELDS = ["name", "fullName", "email", "phone", "employeeId", "role", "status", "accountType"];

function now() {
  return new Date().toISOString();
}

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function createAuthUser(payload) {
  return accountStore.createUser(payload);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeRoleKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeStatus(value, fallback = "active") {
  const status = String(value || fallback).trim().toLowerCase();
  return ACCOUNT_STATUSES.has(status) ? status : fallback;
}

function normalizeAccountType(value, role) {
  const type = String(value || "").trim().toUpperCase();
  if (ACCOUNT_TYPES.has(type)) {
    return type;
  }

  if (role === "superadmin") {
    return "SUPER_ADMIN";
  }
  if (role === "admin") {
    return "ADMIN";
  }
  return "STAFF";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getRoleCatalog() {
  const storedRoles = readCollection("roles").filter((role) => !role.deletedAt);
  const systemRoles = Object.values(ROLE_DEFINITIONS).map((role) => ({
    id: role.key,
    key: role.key,
    name: role.name,
    description: role.description || null,
    isSystemRole: true,
    permissions: role.permissions,
  }));

  const byKey = new Map(systemRoles.map((role) => [role.key, role]));
  for (const role of storedRoles) {
    const key = role.key || normalizeRoleKey(role.name || role.id);
    byKey.set(key, {
      id: role.id,
      key,
      name: role.name,
      description: role.description || null,
      isSystemRole: Boolean(role.isSystemRole || role.is_system_role),
      permissions: Array.isArray(role.permissions) ? role.permissions : getRolePermissionsById(role.id, key),
    });
  }

  return [...byKey.values()];
}

function getRolePermissionsById(roleId, roleKey) {
  if (ROLE_DEFINITIONS[roleKey]) {
    return ROLE_DEFINITIONS[roleKey].permissions;
  }

  const rolePermissions = readCollection("role_permissions").filter((record) => record.roleId === roleId || record.role_id === roleId);
  const permissions = readCollection("permissions");
  return rolePermissions
    .map((record) => permissions.find((permission) => permission.id === (record.permissionId || record.permission_id)))
    .filter(Boolean)
    .map((permission) => permission.key || permission.name || `${permission.module}.${permission.action}`);
}

function resolveRole(roleIdOrKey) {
  const requested = normalizeRoleKey(roleIdOrKey);
  return (
    getRoleCatalog().find(
      (role) =>
        role.id === roleIdOrKey ||
        role.key === requested ||
        normalizeRoleKey(role.name) === requested
    ) || null
  );
}

function resolveDepartment(departmentIdOrName) {
  if (!departmentIdOrName) {
    return null;
  }

  const requested = String(departmentIdOrName).trim().toLowerCase();
  return (
    readCollection("departments").find(
      (department) =>
        !department.deletedAt &&
        (department.id === departmentIdOrName ||
          String(department.name || "").toLowerCase() === requested ||
          String(department.code || "").toLowerCase() === requested)
    ) || null
  );
}

function resolveEmployee(employeeId) {
  if (!employeeId) {
    return null;
  }

  return (
    readCollection("employees").find(
      (employee) =>
        !employee.deletedAt &&
        (employee.id === employeeId || employee.employeeId === employeeId || employee.employee_id === employeeId)
    ) || null
  );
}

function ensureCanManageUser(actor, targetUser, action) {
  if (!actor) {
    throw createHttpError(401, "Authentication required.", "UNAUTHORIZED");
  }

  if (actor.role !== "superadmin" && !Array.isArray(actor.permissions)) {
    throw createHttpError(403, "You do not have permission to perform this action.", "FORBIDDEN");
  }

  if (targetUser?.role === "superadmin" && actor.role !== "superadmin") {
    throw createHttpError(403, "Only Super Admin can manage Super Admin accounts.", "FORBIDDEN");
  }

  if (targetUser?.id === actor.id && ["lock", "deactivate", "delete"].includes(action)) {
    throw createHttpError(400, "You cannot lock, deactivate, or delete your own account.", "SELF_PROTECTION");
  }
}

function ensureCanCreateRole(actor, role) {
  if (role.key === "superadmin" && actor.role !== "superadmin") {
    throw createHttpError(403, "Only Super Admin can create another Super Admin.", "FORBIDDEN");
  }
}

function generateTemporaryPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function generateActivationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function writeUserAccessActivity({ actor, action, targetUser, oldValue, newValue, req, outcome = "SUCCESS", description }) {
  const activity = appendRecord("user_activity_logs", {
    id: crypto.randomUUID(),
    actorUserId: actor?.id || null,
    actor_user_id: actor?.id || null,
    action,
    module: "User Access",
    targetType: "user",
    target_type: "user",
    targetId: targetUser?.id || null,
    target_id: targetUser?.id || null,
    targetName: targetUser?.fullName || targetUser?.name || targetUser?.email || null,
    target_name: targetUser?.fullName || targetUser?.name || targetUser?.email || null,
    description: description || action,
    oldValues: oldValue || null,
    old_values: oldValue || null,
    newValues: newValue || null,
    new_values: newValue || null,
    ipAddress: req?.ip || null,
    ip_address: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
    user_agent: req?.get ? req.get("user-agent") : null,
    outcome,
    createdAt: now(),
    created_at: now(),
    updatedAt: now(),
    updated_at: now(),
  });

  recordOperationalAudit({
    user: actor,
    action,
    module: "User Access",
    targetType: "user",
    targetName: activity.targetName,
    recordId: targetUser?.id || null,
    oldValue,
    newValue,
    ipAddress: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
    status: outcome,
    description: description || action,
  });

  return activity;
}

function getAssignedPermissions(user) {
  const role = resolveRole(user.roleId || user.role);
  const rolePermissions = role?.permissions || [];
  const directPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  return [...new Set([...rolePermissions, ...directPermissions])].sort();
}

function decorateUser(user) {
  if (!user) {
    return null;
  }

  const sanitized = sanitizeUser(user);
  const role = resolveRole(sanitized.roleId || sanitized.role);
  const department = resolveDepartment(sanitized.departmentId);
  const employee = resolveEmployee(sanitized.employeeId);

  return {
    ...sanitized,
    role: role ? { id: role.id, key: role.key, name: role.name } : { id: sanitized.role, key: sanitized.role, name: sanitized.role },
    roleKey: role?.key || sanitized.role,
    department: department ? { id: department.id, name: department.name, code: department.code || null } : null,
    employee: employee
      ? {
          id: employee.id,
          employeeId: employee.employeeId || employee.employee_id || null,
          fullName: employee.fullName || employee.name || sanitized.fullName,
        }
      : null,
    permissions: getAssignedPermissions(user),
  };
}

async function listUserAccounts(query = {}) {
  const normalizedQuery = {
    ...query,
    q: query.q || query.search,
  };
  let users = (await accountStore.listUsers()).filter((user) => user.status !== "deleted" && !user.deletedAt);
  users = applyBasicFilters(users, normalizedQuery, USER_SEARCH_FIELDS);

  if (query.role) {
    users = users.filter((user) => String(user.roleId || user.role).toLowerCase() === String(query.role).toLowerCase());
  }
  if (query.department) {
    users = users.filter((user) => String(user.departmentId || "").toLowerCase() === String(query.department).toLowerCase());
  }

  const sorted = sortRecords(users, query.sort || query.sortBy || "createdAt", query.order || query.sortDirection || "desc");
  const result = paginate(sorted.map((user) => decorateUser(getUserById(user.id) || user)), query);
  return {
    data: result.data,
    meta: result.meta,
  };
}

function validateCreateUserPayload(payload) {
  const fullName = String(payload.fullName || payload.name || "").trim();
  const email = normalizeEmail(payload.email);

  if (fullName.length < 2) {
    throw createHttpError(400, "Full name is required.", "VALIDATION_ERROR", { field: "fullName" });
  }
  if (!isValidEmail(email)) {
    throw createHttpError(400, "A valid email is required.", "VALIDATION_ERROR", { field: "email" });
  }
  if (getUserByEmail(email)) {
    throw createHttpError(409, "A user with this email already exists.", "EMAIL_ALREADY_EXISTS");
  }

  const employee = resolveEmployee(payload.employeeId);
  if (payload.employeeId && !employee) {
    throw createHttpError(400, "Selected employee does not exist.", "INVALID_EMPLOYEE");
  }
  if (employee && listUsers().some((user) => user.employeeId === employee.id || user.employeeId === payload.employeeId)) {
    throw createHttpError(409, "This employee already has a user account.", "EMPLOYEE_ACCOUNT_EXISTS");
  }

  const role = resolveRole(payload.roleId || payload.role || payload.accountType);
  if (!role) {
    throw createHttpError(400, "Selected role does not exist.", "INVALID_ROLE");
  }

  const department = payload.departmentId ? resolveDepartment(payload.departmentId) : null;
  if (payload.departmentId && !department) {
    throw createHttpError(400, "Selected department does not exist.", "INVALID_DEPARTMENT");
  }

  return { fullName, email, employee, role, department };
}

async function createUserAccount(payload, actor, req) {
  const { fullName, email, employee, role, department } = validateCreateUserPayload(payload || {});
  ensureCanCreateRole(actor, role);

  const temporaryPassword = payload.temporaryPassword || generateTemporaryPassword();
  if (typeof temporaryPassword !== "string" || temporaryPassword.length < 8) {
    throw createHttpError(400, "Temporary password must be at least 8 characters.", "INVALID_TEMPORARY_PASSWORD");
  }
  securityService.validatePasswordAgainstPolicy(temporaryPassword);

  const activationToken = generateActivationToken();
  const user = await createAuthUser({
    name: fullName,
    fullName,
    email,
    phone: payload.phone,
    passwordHash: hashPassword(temporaryPassword),
    role: role.key,
    roleId: role.id,
    permissions: Array.isArray(payload.permissions) && payload.permissions.length > 0 ? payload.permissions : role.permissions,
    status: payload.status ? normalizeStatus(payload.status) : "active",
    accountType: normalizeAccountType(payload.accountType, role.key),
    departmentId: department?.id || null,
    employeeId: employee?.id || null,
    organizationId: payload.organizationId || payload.organization_id || employee?.organizationId || employee?.organization_id || employee?.employerId || employee?.employer_id || null,
    employerId: payload.employerId || payload.employer_id || employee?.employerId || employee?.employer_id || null,
    createdBy: actor?.id || null,
    mustChangePassword: true,
    activationTokenHash: hashToken(activationToken),
    activationTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
  });

  const { ensureEmployeeProfile } = require("../employees/employeeProfile");
  const profile = ensureEmployeeProfile(user, {
    employeeId: employee?.employeeId || employee?.employee_id || employee?.id || payload.employeeId,
    departmentId: department?.id || null,
    department: department?.name || null,
    jobTitle: payload.jobTitle || payload.job_title || null,
  });
  if (profile && !user.employeeId) {
    await accountStore.updateUser(user.id, { employeeId: profile.id });
  }

  appendRecord("user_roles", {
    id: crypto.randomUUID(),
    userId: user.id,
    user_id: user.id,
    roleId: role.id,
    role_id: role.id,
    assignedBy: actor?.id || null,
    assigned_by: actor?.id || null,
    createdAt: now(),
    created_at: now(),
    updatedAt: now(),
    updated_at: now(),
  });

  if (department) {
    appendRecord("user_departments", {
      id: crypto.randomUUID(),
      userId: user.id,
      user_id: user.id,
      departmentId: department.id,
      department_id: department.id,
      assignedBy: actor?.id || null,
      assigned_by: actor?.id || null,
      createdAt: now(),
      created_at: now(),
      updatedAt: now(),
      updated_at: now(),
    });
  }

  appendRecord("notifications", {
    id: crypto.randomUUID(),
    userId: user.id,
    user_id: user.id,
    type: "account_created",
    title: "Your company account has been created.",
    channel: "email",
    status: "pending",
    metadata: { email },
    createdAt: now(),
    created_at: now(),
  });

  const decorated = decorateUser(user);
  writeUserAccessActivity({
    actor,
    action: "USER_CREATED",
    targetUser: decorated,
    newValue: decorated,
    req,
    description: `Created user account for ${fullName}`,
  });

  return {
    user: decorated,
    provisioning: {
      activationTokenCreated: true,
      temporaryPasswordGenerated: !payload.temporaryPassword,
      mustChangePassword: true,
      credentialsDelivery: "email_or_notification_configuration",
    },
  };
}

async function getUserAccountDetail(id) {
  const user = await accountStore.getUserById(id);
  if (!user || user.deletedAt || user.status === "deleted") {
    return null;
  }

  const decorated = decorateUser(user);
  const sessions = listSessions({ userId: id }).filter((session) => session.status === "active");
  const loginHistory = readCollection("login_history").filter((event) => event.userId === id).slice(-20);
  const failedLogins = readCollection("failed_logins").filter((event) => event.userId === id).slice(-20);
  const activity = readCollection("user_activity_logs")
    .filter((event) => event.targetId === id || event.target_id === id || event.actorUserId === id)
    .slice(-30);
  const securityEvents = readCollection("technical_audit_logs")
    .filter((event) => event.userId === id || event.actorId === id || event.service === "security")
    .slice(-20);

  return {
    ...decorated,
    accountStatus: decorated.status,
    lastLogin: loginHistory.filter((event) => event.status === "success").slice(-1)[0] || null,
    sessions,
    loginHistory,
    failedLoginAttempts: failedLogins,
    activity,
    recentSecurityEvents: securityEvents,
    createdBy: user.createdBy ? decorateUser((await accountStore.getUserById(user.createdBy)) || getUserById(user.createdBy)) : null,
  };
}

async function updateUserAccount(id, payload, actor, req) {
  const current = (await accountStore.getUserById(id)) || getUserById(id);
  if (!current || current.deletedAt || current.status === "deleted") {
    return null;
  }
  ensureCanManageUser(actor, current, "update");

  const updates = {};
  if (payload.fullName || payload.name) {
    updates.fullName = String(payload.fullName || payload.name).trim();
    updates.name = updates.fullName;
  }
  if (payload.email) {
    const email = normalizeEmail(payload.email);
    if (!isValidEmail(email)) {
      throw createHttpError(400, "A valid email is required.", "VALIDATION_ERROR", { field: "email" });
    }
    const existing = (await accountStore.getUserByEmail(email)) || getUserByEmail(email);
    if (existing && existing.id !== id) {
      throw createHttpError(409, "A user with this email already exists.", "EMAIL_ALREADY_EXISTS");
    }
    updates.email = email;
  }
  if (payload.phone !== undefined) {
    updates.phone = payload.phone;
  }
  if (payload.status) {
    updates.status = normalizeStatus(payload.status);
  }
  if (payload.departmentId) {
    const department = resolveDepartment(payload.departmentId);
    if (!department) {
      throw createHttpError(400, "Selected department does not exist.", "INVALID_DEPARTMENT");
    }
    updates.departmentId = department.id;
  }
  if (payload.roleId || payload.role) {
    const role = resolveRole(payload.roleId || payload.role);
    if (!role) {
      throw createHttpError(400, "Selected role does not exist.", "INVALID_ROLE");
    }
    ensureCanCreateRole(actor, role);
    updates.role = role.key;
    updates.roleId = role.id;
    updates.accountType = normalizeAccountType(payload.accountType, role.key);
  }
  if (Array.isArray(payload.permissions)) {
    updates.permissions = payload.permissions;
  }

  updates.updatedBy = actor?.id || null;
  const oldValue = decorateUser(current);
  const updated = await accountStore.updateUser(id, updates);
  const newValue = decorateUser(updated);

  if (updates.role || updates.roleId) {
    appendRecord("user_roles", {
      id: crypto.randomUUID(),
      userId: id,
      user_id: id,
      roleId: updates.roleId,
      role_id: updates.roleId,
      assignedBy: actor?.id || null,
      assigned_by: actor?.id || null,
      createdAt: now(),
      created_at: now(),
    });
  }

  writeUserAccessActivity({
    actor,
    action: updates.role || updates.roleId ? "ROLE_CHANGED" : "USER_UPDATED",
    targetUser: newValue,
    oldValue,
    newValue,
    req,
  });

  return { oldValue, user: newValue };
}

async function setAccountStatus(id, status, actor, req, options = {}) {
  const current = (await accountStore.getUserById(id)) || getUserById(id);
  if (!current || current.deletedAt || current.status === "deleted") {
    return null;
  }
  ensureCanManageUser(actor, current, options.action || status);

  const updates = {
    status,
    updatedBy: actor?.id || null,
  };
  if (status === "locked") {
    updates.lockedAt = now();
    updates.lockedUntil = options.lockedUntil || null;
  }
  if (status === "active") {
    updates.lockedAt = null;
    updates.lockedUntil = null;
    updates.failedLoginAttempts = 0;
    updates.failedLoginCount = 0;
  }
  if (status === "inactive") {
    updates.deactivatedAt = now();
    updates.deactivatedBy = actor?.id || null;
  }

  const oldValue = decorateUser(current);
  const updated = await accountStore.updateUser(id, updates);
  if (["locked", "inactive", "suspended"].includes(status)) {
    revokeUserSessions(id, actor?.id);
  }
  const newValue = decorateUser(updated);

  writeUserAccessActivity({
    actor,
    action: options.auditAction || `USER_${status.toUpperCase()}`,
    targetUser: newValue,
    oldValue,
    newValue,
    req,
    description: options.reason || `User status changed to ${status}`,
  });

  return { oldValue, user: newValue };
}

async function resetUserPassword(id, payload, actor, req) {
  const current = (await accountStore.getUserById(id)) || getUserById(id);
  if (!current || current.deletedAt || current.status === "deleted") {
    return null;
  }
  ensureCanManageUser(actor, current, "reset-password");
  const temporaryPassword = payload?.temporaryPassword || generateTemporaryPassword();
  if (temporaryPassword.length < 8) {
    throw createHttpError(400, "Temporary password must be at least 8 characters.", "INVALID_PASSWORD");
  }
  securityService.validatePasswordAgainstPolicy(temporaryPassword, id);

  const oldValue = decorateUser(current);
  securityService.recordPasswordHistory(current);
  await accountStore.updateUserPassword(id, hashPassword(temporaryPassword));
  const updated = await accountStore.updateUser(id, {
    mustChangePassword: true,
    forcePasswordReset: true,
    updatedBy: actor?.id || null,
  });
  revokeUserSessions(id, actor?.id);
  const newValue = decorateUser(updated);
  appendRecord("notifications", {
    id: crypto.randomUUID(),
    userId: id,
    user_id: id,
    type: "password_reset",
    title: "Your password has been reset.",
    channel: "email",
    status: "pending",
    createdAt: now(),
    created_at: now(),
  });
  writeUserAccessActivity({
    actor,
    action: "PASSWORD_RESET",
    targetUser: newValue,
    oldValue,
    newValue,
    req,
  });
  return {
    user: newValue,
    provisioning: {
      temporaryPasswordGenerated: !payload?.temporaryPassword,
      mustChangePassword: true,
      credentialsDelivery: "email_or_notification_configuration",
    },
  };
}

async function forcePasswordChange(id, actor, req) {
  const current = (await accountStore.getUserById(id)) || getUserById(id);
  if (!current) {
    return null;
  }
  ensureCanManageUser(actor, current, "force-password-change");
  const oldValue = decorateUser(current);
  const updated = await accountStore.updateUser(id, { mustChangePassword: true, forcePasswordReset: true, updatedBy: actor?.id || null });
  const newValue = decorateUser(updated);
  writeUserAccessActivity({ actor, action: "FORCE_PASSWORD_CHANGE", targetUser: newValue, oldValue, newValue, req });
  return { oldValue, user: newValue };
}

function revokeUserSession(id, sessionId, actor, req) {
  const current = getUserById(id);
  if (!current) {
    return null;
  }
  ensureCanManageUser(actor, current, "revoke-session");
  const session = revokeSession(sessionId, actor?.id);
  if (!session || session.userId !== id) {
    return null;
  }
  writeUserAccessActivity({
    actor,
    action: "SESSION_REVOKED",
    targetUser: decorateUser(current),
    newValue: { sessionId },
    req,
  });
  return session;
}

function revokeAllUserSessions(id, actor, req) {
  const current = getUserById(id);
  if (!current) {
    return null;
  }
  ensureCanManageUser(actor, current, "revoke-sessions");
  const revoked = revokeUserSessions(id, actor?.id);
  writeUserAccessActivity({
    actor,
    action: "SESSION_REVOKED",
    targetUser: decorateUser(current),
    newValue: { revokedSessionCount: revoked.length },
    req,
  });
  return revoked;
}

async function getUserStatistics() {
  const users = (await accountStore.listUsers()).filter((user) => user.status !== "deleted" && !user.deletedAt);
  const loginHistory = readCollection("login_history");
  const failedLogins = readCollection("failed_logins");
  return {
    totalUsers: users.length,
    activeUsers: users.filter((user) => user.status === "active").length,
    inactiveUsers: users.filter((user) => user.status === "inactive").length,
    lockedAccounts: users.filter((user) => user.status === "locked" || user.lockedAt).length,
    pendingAccounts: users.filter((user) => user.status === "pending").length,
    adminAccounts: users.filter((user) => user.role === "admin" || user.accountType === "ADMIN").length,
    superAdminAccounts: users.filter((user) => user.role === "superadmin" || user.accountType === "SUPER_ADMIN").length,
    recentLogins: loginHistory.filter((event) => event.status === "success").slice(-10),
    failedLogins: failedLogins.slice(-10),
    recentlyCreatedAccounts: users
      .slice()
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, 10),
  };
}

function getUserActivity(id, query = {}) {
  const events = readCollection("user_activity_logs").filter(
    (event) => event.targetId === id || event.target_id === id || event.actorUserId === id || event.actor_user_id === id
  );
  return paginate(applyBasicFilters(events, { ...query, q: query.q || query.search }, ["action", "description", "outcome"]), query);
}

function getUserLoginHistory(id, query = {}) {
  const events = readCollection("login_history").filter((event) => event.userId === id);
  return paginate(applyBasicFilters(events, { ...query, q: query.q || query.search }, ["status", "reason"]), query);
}

function getUserSessions(id, query = {}) {
  return paginate(listSessions({ userId: id }), query);
}

module.exports = {
  createUserAccount,
  decorateUser,
  forcePasswordChange,
  getAssignedPermissions,
  getRoleCatalog,
  getUserAccountDetail,
  getUserActivity,
  getUserLoginHistory,
  getUserSessions,
  getUserStatistics,
  listUserAccounts,
  resetUserPassword,
  revokeAllUserSessions,
  revokeUserSession,
  setAccountStatus,
  updateUserAccount,
};
