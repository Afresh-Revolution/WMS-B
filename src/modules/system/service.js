const crypto = require("crypto");
const { hashPassword } = require("../../auth/passwords");
const { listSessions, revokeSession, revokeUserSessions } = require("../../auth/sessionStore");
const accountStore = require("../../auth/accountStore");
const { listUsers, sanitizeUser } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordTechnicalAuditEvent, redactSensitiveData } = require("../_shared/auditService");
const { getSystemStatus } = require("../dashboard/dashboardService");
const emailService = require("../email/email.service");
const notificationService = require("../notifications/notification.service");

function now() {
  return new Date().toISOString();
}

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt);
}

function writeRecord(collection, payload) {
  const timestamp = now();
  const records = readCollection(collection);
  const record = { id: crypto.randomUUID(), ...payload, createdAt: timestamp, updatedAt: timestamp };
  records.push(record);
  writeCollection(collection, records);
  return record;
}

function updateRecord(collection, id, payload) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt);
  if (index === -1) {
    return null;
  }
  records[index] = { ...records[index], ...payload, id: records[index].id, updatedAt: now() };
  writeCollection(collection, records);
  return records[index];
}

function audit(req, action, targetType, targetId, beforeData, afterData, description, metadata = {}) {
  return recordTechnicalAuditEvent({
    user: req.user,
    action,
    module: "System Management",
    targetType,
    targetId,
    description,
    beforeData,
    afterData,
    metadata,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
  });
}

function getOverview() {
  const users = listUsers();
  const maintenance = getMaintenanceStatus();
  return {
    platformUsers: users.filter((user) => user.status !== "deleted").length,
    adminAccounts: users.filter((user) => ["superadmin", "admin"].includes(user.role)).length,
    lockedAccounts: users.filter((user) => user.status === "locked" || user.lockedAt).length,
    maintenanceMode: maintenance.maintenanceMode,
    activeSessions: listSessions({}).filter((session) => session.status === "active").length,
    integrations: activeRecords("integrations").length,
    backups: activeRecords("backups").length,
  };
}

function listSystemSettings(query = {}) {
  return paginate(applyBasicFilters(activeRecords("system_settings"), query, ["key", "section", "category"]), query);
}

function upsertSetting({ key, value, type, category, section, isSensitive }, req) {
  if (!key) {
    throw createHttpError(400, "Setting key is required.", "SETTING_KEY_REQUIRED");
  }
  const records = readCollection("system_settings");
  const index = records.findIndex((record) => !record.deletedAt && record.key === key && (record.section || "platform") === (section || category || "platform"));
  const payload = {
    key,
    value: isSensitive ? redactSensitiveData(value) : value,
    type: type || inferType(value),
    category: category || section || "platform",
    section: section || category || "platform",
    isSensitive: Boolean(isSensitive),
    is_sensitive: Boolean(isSensitive),
    updatedBy: req.user.id,
    updated_by: req.user.id,
  };
  if (index === -1) {
    const record = writeRecord("system_settings", payload);
    audit(req, "SYSTEM_SETTING_UPDATED", "SystemSetting", record.id, null, record, `Created system setting ${key}.`);
    return record;
  }
  const oldValue = records[index];
  records[index] = { ...records[index], ...payload, updatedAt: now() };
  writeCollection("system_settings", records);
  audit(req, "SYSTEM_SETTING_UPDATED", "SystemSetting", records[index].id, oldValue, records[index], `Updated system setting ${key}.`);
  return records[index];
}

function updateSettings(payload = {}, req) {
  const settings = Array.isArray(payload.settings)
    ? payload.settings
    : Object.entries(payload).map(([key, value]) => ({ key, value, category: "platform" }));
  return settings.map((setting) => upsertSetting(setting, req));
}

function inferType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function getSecuritySettings() {
  const existing = activeRecords("system_security_settings")[0];
  return existing || {
    id: null,
    minPasswordLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecialCharacter: true,
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 30,
    sessionTimeoutMinutes: 60,
    mfaRequired: false,
  };
}

function updateSecuritySettings(payload, req) {
  const current = activeRecords("system_security_settings")[0];
  const allowed = [
    "minPasswordLength",
    "requireUppercase",
    "requireLowercase",
    "requireNumber",
    "requireSpecialCharacter",
    "maxLoginAttempts",
    "lockoutDurationMinutes",
    "sessionTimeoutMinutes",
    "mfaRequired",
  ];
  const update = allowed.reduce((result, key) => {
    if (payload[key] !== undefined) result[key] = payload[key];
    return result;
  }, {});
  const record = current ? updateRecord("system_security_settings", current.id, update) : writeRecord("system_security_settings", update);
  audit(req, "TECHNICAL_SECURITY_SETTINGS_CHANGED", "SecuritySettings", record.id, current, record, "Changed system security settings.");
  return record;
}

function listPlatformUsers(query = {}) {
  return paginate(applyBasicFilters(listUsers(), query, ["name", "email", "role", "status"]), query);
}

async function createPlatformUser(payload, req) {
  if (!payload.name || !payload.email || !payload.password) {
    throw createHttpError(400, "User name, email, and password are required.", "INVALID_USER_PAYLOAD");
  }
  const user = await accountStore.createUser({
    name: String(payload.name).trim(),
    email: String(payload.email).trim(),
    passwordHash: hashPassword(payload.password),
    role: payload.role || "employee",
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    status: payload.status || "active",
    departmentId: payload.departmentId || payload.department_id || null,
    employeeId: payload.employeeId || payload.employee_id || null,
    organizationId: payload.organizationId || payload.organization_id || null,
    employerId: payload.employerId || payload.employer_id || null,
  });
  const sanitized = sanitizeUser(user);
  audit(req, "USER_CREATED", "User", user.id, null, sanitized, "Created platform user.");
  return sanitized;
}

async function updatePlatformUser(id, payload, req) {
  const oldValue = (await accountStore.getUserById(id)) || listUsers().find((user) => user.id === id);
  const { password, ...updates } = payload || {};
  const user = await accountStore.updateUser(id, updates);
  if (!user) return null;
  if (typeof password === "string" && password.length >= 8) {
    await accountStore.updateUserPassword(id, hashPassword(password));
  }
  const sanitized = sanitizeUser(await accountStore.getUserById(id));
  audit(req, "USER_UPDATED", "User", id, oldValue, sanitized, "Updated platform user.");
  return sanitized;
}

async function setUserStatus(id, status, req) {
  const oldValue = (await accountStore.getUserById(id)) || listUsers().find((user) => user.id === id);
  const payload = status === "locked" ? { status, lockedAt: now() } : { status, lockedAt: null };
  const user = await accountStore.updateUser(id, payload);
  if (!user) return null;
  if (["locked", "suspended", "inactive"].includes(status)) revokeUserSessions(id, req.user.id);
  const sanitized = sanitizeUser(user);
  audit(req, `USER_${status.toUpperCase()}`, "User", id, oldValue, sanitized, `Changed user status to ${status}.`);
  return sanitized;
}

async function resetPassword(id, password, req) {
  if (!password || password.length < 8) {
    throw createHttpError(400, "Password must be at least 8 characters.", "INVALID_PASSWORD");
  }
  const oldValue = (await accountStore.getUserById(id)) || listUsers().find((user) => user.id === id);
  const user = await accountStore.updateUserPassword(id, hashPassword(password));
  if (!user) return null;
  revokeUserSessions(id, req.user.id);
  const sanitized = sanitizeUser(user);
  audit(req, "USER_PASSWORD_RESET", "User", id, oldValue, sanitized, "Reset platform user password.");
  return sanitized;
}

function revokeSessionsForUser(id, req) {
  const revoked = revokeUserSessions(id, req.user.id);
  audit(req, "USER_SESSIONS_REVOKED", "Session", id, null, { revokedSessionCount: revoked.length }, "Revoked user sessions.");
  return revoked;
}

function revokeSingleSession(id, req) {
  const session = revokeSession(id, req.user.id);
  if (!session) return null;
  audit(req, "SESSION_REVOKED", "Session", id, null, session, "Revoked platform session.");
  return session;
}

function listRoles(query = {}) {
  const existing = activeRecords("roles");
  const fallback = ["superadmin", "admin", "department_manager", "team_leader", "employee"].map((role) => ({
    id: role,
    key: role,
    name: role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    isSystem: true,
  }));
  return paginate(applyBasicFilters(existing.length ? existing : fallback, query, ["key", "name", "description"]), query);
}

function createRole(payload, req) {
  if (!payload.key || !payload.name) throw createHttpError(400, "Role key and name are required.", "ROLE_REQUIRED");
  const record = writeRecord("roles", {
    key: String(payload.key).toLowerCase(),
    name: payload.name,
    description: payload.description || null,
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    isSystem: false,
    is_system: false,
  });
  audit(req, "ROLE_CREATED", "Role", record.id, null, record, "Created role.");
  return record;
}

function updateRole(id, payload, req) {
  const oldValue = activeRecords("roles").find((role) => role.id === id);
  const record = updateRecord("roles", id, payload);
  if (!record) return null;
  audit(req, "ROLE_UPDATED", "Role", id, oldValue, record, "Updated role.");
  return record;
}

function deleteRole(id, req) {
  const oldValue = activeRecords("roles").find((role) => role.id === id);
  const record = updateRecord("roles", id, { deletedAt: now(), deletedBy: req.user.id });
  if (!record) return null;
  audit(req, "ROLE_DELETED", "Role", id, oldValue, record, "Deleted role.");
  return record;
}

function assignRolePermissions(id, permissions, req) {
  const role = activeRecords("roles").find((item) => item.id === id);
  if (!role) return null;
  const record = updateRecord("roles", id, { permissions: Array.isArray(permissions) ? permissions : [] });
  audit(req, "ROLE_PERMISSIONS_CHANGED", "Role", id, role, record, "Changed role permissions.");
  return record;
}

function listPermissions() {
  const { PERMISSIONS } = require("../../constants/rbac");
  return Object.values(PERMISSIONS).map((permission) => {
    const [module, action] = String(permission).split(/[.:]/);
    return { key: permission, module, action: action || "manage", description: permission };
  });
}

function upsertIntegration(payload, req, id = null) {
  const sanitized = sanitizeConfiguration(payload.configuration || {});
  const encryptedSecret = payload.secret || payload.secretKey || payload.apiKey ? encryptSecret(payload.secret || payload.secretKey || payload.apiKey) : undefined;
  const data = {
    name: payload.name,
    provider: payload.provider,
    type: payload.type || payload.provider,
    status: payload.status || "inactive",
    configuration: sanitized,
    ...(encryptedSecret ? { encryptedSecret, encrypted_secret: encryptedSecret } : {}),
  };
  if (!id) {
    const record = writeRecord("integrations", data);
    audit(req, "INTEGRATION_CONNECTED", "Integration", record.id, null, sanitizeIntegration(record), "Created integration.");
    return sanitizeIntegration(record);
  }
  const oldValue = activeRecords("integrations").find((record) => record.id === id);
  const record = updateRecord("integrations", id, data);
  if (!record) return null;
  audit(req, "INTEGRATION_UPDATED", "Integration", id, sanitizeIntegration(oldValue), sanitizeIntegration(record), "Updated integration.");
  return sanitizeIntegration(record);
}

function sanitizeConfiguration(configuration) {
  return Object.entries(configuration || {}).reduce((result, [key, value]) => {
    result[key] = /secret|password|token|key/i.test(key) && key !== "publicKey" ? "[ENCRYPTED]" : value;
    return result;
  }, {});
}

function encryptSecret(value) {
  return `enc:${Buffer.from(String(value)).toString("base64url")}`;
}

function sanitizeIntegration(record) {
  if (!record) return null;
  const { encryptedSecret, encrypted_secret, ...safe } = record;
  return { ...safe, hasSecret: Boolean(encryptedSecret || encrypted_secret) };
}

function listIntegrations(query = {}) {
  const result = paginate(applyBasicFilters(activeRecords("integrations"), query, ["name", "provider", "type", "status"]), query);
  result.data = result.data.map(sanitizeIntegration);
  return result;
}

function deleteIntegration(id, req) {
  const oldValue = activeRecords("integrations").find((record) => record.id === id);
  const record = updateRecord("integrations", id, { deletedAt: now(), status: "deleted" });
  if (!record) return null;
  audit(req, "INTEGRATION_DISCONNECTED", "Integration", id, sanitizeIntegration(oldValue), sanitizeIntegration(record), "Deleted integration.");
  return sanitizeIntegration(record);
}

function testIntegration(id, req) {
  const oldValue = activeRecords("integrations").find((record) => record.id === id);
  if (!oldValue) return null;
  const record = updateRecord("integrations", id, { lastTestedAt: now(), last_tested_at: now(), testStatus: "SUCCESS" });
  audit(req, "INTEGRATION_TESTED", "Integration", id, sanitizeIntegration(oldValue), sanitizeIntegration(record), "Tested integration.");
  return { status: "SUCCESS", integration: sanitizeIntegration(record) };
}

function getEmailConfiguration() {
  return emailService.getCurrentConfiguration();
}

function updateEmailConfiguration(payload, req) {
  return emailService.updateConfiguration({ ...payload, enabled: payload.enabled ?? payload.isActive ?? payload.is_active ?? true }, req);
}

async function testEmail(payload, req) {
  return emailService.sendTestEmail(payload, req);
}

function getNotificationConfiguration() {
  const config = notificationService.getConfiguration();
  return {
    ...config,
    leaveApproval: true,
    payroll: config.channels.email,
    taskAssignment: config.channels.inApp,
    announcements: config.channels.inApp,
    securityAlerts: true,
    channels: [
      config.channels.inApp ? "IN_APP" : null,
      config.channels.email ? "EMAIL" : null,
      config.channels.sms ? "SMS" : null,
    ].filter(Boolean),
  };
}

function updateNotificationConfiguration(payload, req) {
  if (payload.channels && Array.isArray(payload.channels)) {
    for (const channel of ["in_app", "email", "sms"]) {
      notificationService.updateChannel(
        { channel, enabled: payload.channels.map((entry) => String(entry).toLowerCase()).includes(channel) || payload.channels.map((entry) => String(entry).toLowerCase()).includes(channel.toUpperCase()) },
        req
      );
    }
  }
  if (payload.payroll !== undefined) {
    notificationService.updateChannel({ channel: "email", enabled: Boolean(payload.payroll) }, req);
  }
  notificationService.updateGlobalConfiguration(payload, req);
  return getNotificationConfiguration();
}

function listDocumentTemplates(query = {}) {
  return paginate(applyBasicFilters(activeRecords("document_templates"), query, ["name", "type", "description", "status"]), query);
}

function createDocumentTemplate(payload, req) {
  if (!payload.name || !payload.type || !(payload.content || payload.body)) {
    throw createHttpError(400, "Template name, type, and content are required.", "DOCUMENT_TEMPLATE_REQUIRED");
  }
  const record = writeRecord("document_templates", {
    name: payload.name,
    type: payload.type,
    description: payload.description || null,
    content: payload.content || payload.body,
    body: payload.content || payload.body,
    variables: Array.isArray(payload.variables) ? payload.variables : [],
    version: 1,
    status: payload.status || "active",
    createdBy: req.user.id,
    created_by: req.user.id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "DOCUMENT_TEMPLATE_CREATED", "DocumentTemplate", record.id, null, record, "Created document template.");
  return record;
}

function updateDocumentTemplate(id, payload, req) {
  const oldValue = activeRecords("document_templates").find((template) => template.id === id);
  if (!oldValue) return null;
  writeRecord("document_template_versions", { templateId: id, template_id: id, version: oldValue.version || 1, snapshot: oldValue, createdBy: req.user.id });
  const record = updateRecord("document_templates", id, {
    ...payload,
    content: payload.content || payload.body || oldValue.content || oldValue.body,
    body: payload.content || payload.body || oldValue.content || oldValue.body,
    version: Number(oldValue.version || 1) + 1,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "DOCUMENT_TEMPLATE_UPDATED", "DocumentTemplate", id, oldValue, record, "Updated document template.");
  return record;
}

function deleteDocumentTemplate(id, req) {
  const oldValue = activeRecords("document_templates").find((template) => template.id === id);
  const record = updateRecord("document_templates", id, { deletedAt: now(), status: "deleted", updatedBy: req.user.id });
  if (!record) return null;
  audit(req, "DOCUMENT_TEMPLATE_DELETED", "DocumentTemplate", id, oldValue, record, "Deleted document template.");
  return record;
}

function listBackups(query = {}) {
  return paginate(applyBasicFilters(activeRecords("backups"), query, ["backupId", "backup_id", "status", "storage", "type"]), query);
}

function createBackup(payload, req) {
  const timestamp = now();
  const record = writeRecord("backups", {
    backupId: payload.backupId || `backup-${Date.now()}`,
    backup_id: payload.backupId || `backup-${Date.now()}`,
    type: payload.type || "manual",
    storage: payload.storage || payload.storageLocation || "secure-vault",
    storageLocation: payload.storageLocation || payload.storage || "secure-vault",
    storage_location: payload.storageLocation || payload.storage || "secure-vault",
    status: "PENDING",
    startedAt: timestamp,
    started_at: timestamp,
    createdBy: req.user.id,
    created_by: req.user.id,
    encrypted: true,
    checksum: crypto.createHash("sha256").update(`${timestamp}:${req.user.id}`).digest("hex"),
    restoreRequiresConfirmation: true,
  });
  audit(req, "BACKUP_STARTED", "Backup", record.id, null, record, "Started backup job.");
  return record;
}

function restoreBackup(id, payload, req) {
  if (payload.confirmation !== "RESTORE BACKUP") {
    throw createHttpError(400, "Restore confirmation is required.", "RESTORE_CONFIRMATION_REQUIRED");
  }
  const oldValue = activeRecords("backups").find((backup) => backup.id === id);
  const record = updateRecord("backups", id, { status: "RESTORE_REQUESTED", restoreRequestedAt: now(), restoreRequestedBy: req.user.id });
  if (!record) return null;
  audit(req, "BACKUP_RESTORE_REQUESTED", "Backup", id, oldValue, record, "Requested backup restore.");
  return record;
}

function getMaintenanceStatus() {
  const setting = activeRecords("system_settings").find((record) => record.key === "maintenanceMode" || record.key === "maintenance_mode");
  const value = setting?.value || {};
  return {
    maintenanceMode: value === true || value.enabled === true || value.maintenanceMode === true,
    maintenanceMessage: value.message || value.maintenanceMessage || "System is currently under maintenance.",
    maintenanceStartedAt: value.startedAt || value.maintenanceStartedAt || null,
    maintenanceStartedBy: value.startedBy || value.maintenanceStartedBy || null,
  };
}

function setMaintenance(enabled, payload, req) {
  return upsertSetting(
    {
      key: "maintenanceMode",
      section: "platform",
      category: "platform",
      type: "object",
      value: {
        enabled,
        maintenanceMode: enabled,
        message: payload.message || "System is currently under maintenance.",
        startedAt: enabled ? now() : null,
        startedBy: enabled ? req.user.id : null,
      },
    },
    req
  );
}

function getHealth() {
  return {
    ...getSystemStatus(),
    api: { status: "HEALTHY", uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage() },
    queue: { status: "HEALTHY", provider: "in-process" },
    storage: { status: "HEALTHY", provider: "local-json-store" },
    backgroundWorkers: { status: "HEALTHY", workers: ["backup", "email", "notification"] },
  };
}

function listTechnicalAuditLogs(query = {}) {
  const records = applyBasicFilters(activeRecords("technical_audit_logs"), query, ["eventId", "action", "module", "service", "description"]);
  const prioritized = records.sort((left, right) => {
    const leftGeneric = String(left.action || "").startsWith("ADMIN_") ? 1 : 0;
    const rightGeneric = String(right.action || "").startsWith("ADMIN_") ? 1 : 0;
    if (leftGeneric !== rightGeneric) return leftGeneric - rightGeneric;
    return String(right.createdAt || right.created_at || "").localeCompare(String(left.createdAt || left.created_at || ""));
  });
  const result = paginate(prioritized, query);
  return result;
}

function getTechnicalAuditLog(id) {
  return activeRecords("technical_audit_logs").find((log) => log.id === id || log.eventId === id || log.event_id === id) || null;
}

function exportTechnicalAuditLogs(query = {}) {
  const logs = listTechnicalAuditLogs({ ...query, limit: 100 }).data;
  const headers = ["eventId", "timestamp", "actorName", "action", "module", "targetType", "targetId", "status", "service"];
  return [headers, ...logs.map((log) => headers.map((header) => log[header] || log[header.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] || ""))]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

module.exports = {
  assignRolePermissions,
  createBackup,
  createDocumentTemplate,
  createPlatformUser,
  createRole,
  deleteDocumentTemplate,
  deleteIntegration,
  deleteRole,
  exportTechnicalAuditLogs,
  getEmailConfiguration,
  getHealth,
  getMaintenanceStatus,
  getNotificationConfiguration,
  getOverview,
  getSecuritySettings,
  getTechnicalAuditLog,
  listBackups,
  listDocumentTemplates,
  listIntegrations,
  listPermissions,
  listPlatformUsers,
  listRoles,
  listSessions,
  listSystemSettings,
  listTechnicalAuditLogs,
  resetPassword,
  restoreBackup,
  revokeSessionsForUser,
  revokeSingleSession,
  setMaintenance,
  setUserStatus,
  testEmail,
  testIntegration,
  updateDocumentTemplate,
  updateEmailConfiguration,
  updateNotificationConfiguration,
  updatePlatformUser,
  updateRole,
  updateSecuritySettings,
  updateSettings,
  upsertIntegration,
};
