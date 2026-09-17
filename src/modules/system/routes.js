const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const systemService = require("./service");

const systemRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res, code = "NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

systemRouter.use(authenticate, requireRole("superadmin"));

systemRouter.get("/overview", handle((_req, res) => send(res, "System management overview loaded.", systemService.getOverview())));
systemRouter.get("/health", handle((_req, res) => send(res, "System health loaded.", systemService.getHealth())));
systemRouter.get("/status", handle((_req, res) => send(res, "System status loaded.", systemService.getMaintenanceStatus())));

systemRouter.get("/settings", handle((req, res) => {
  const result = systemService.listSystemSettings(req.query);
  return send(res, "System settings loaded.", result.data, result.meta);
}));

systemRouter.patch("/settings", handle((req, res) => {
  const settings = systemService.updateSettings(req.body || {}, req);
  return send(res, "System settings updated.", settings);
}));

systemRouter.post("/maintenance/enable", handle((req, res) => {
  const setting = systemService.setMaintenance(true, req.body || {}, req);
  return send(res, "Maintenance mode enabled.", setting);
}));

systemRouter.post("/maintenance/disable", handle((req, res) => {
  const setting = systemService.setMaintenance(false, req.body || {}, req);
  return send(res, "Maintenance mode disabled.", setting);
}));

systemRouter.get("/security/settings", handle((_req, res) => send(res, "Security settings loaded.", systemService.getSecuritySettings())));
systemRouter.patch("/security/settings", handle((req, res) => send(res, "Security settings updated.", systemService.updateSecuritySettings(req.body || {}, req))));

systemRouter.get("/users", handle((req, res) => {
  const result = systemService.listPlatformUsers(req.query);
  return send(res, "Platform users loaded.", result.data, result.meta);
}));
systemRouter.post("/users", handle(async (req, res) => res.status(201).json({ success: true, message: "Platform user created.", data: await systemService.createPlatformUser(req.body || {}, req), meta: {} })));
systemRouter.patch("/users/:id", handle(async (req, res) => {
  const user = await systemService.updatePlatformUser(req.params.id, req.body || {}, req);
  return user ? send(res, "Platform user updated.", user) : notFound(res, "USER_NOT_FOUND");
}));
systemRouter.post("/users/:id/activate", handle(async (req, res) => {
  const user = await systemService.setUserStatus(req.params.id, "active", req);
  return user ? send(res, "User activated.", user) : notFound(res, "USER_NOT_FOUND");
}));
systemRouter.post("/users/:id/deactivate", handle(async (req, res) => {
  const user = await systemService.setUserStatus(req.params.id, "inactive", req);
  return user ? send(res, "User deactivated.", user) : notFound(res, "USER_NOT_FOUND");
}));
systemRouter.post("/users/:id/suspend", handle(async (req, res) => {
  const user = await systemService.setUserStatus(req.params.id, "suspended", req);
  return user ? send(res, "User suspended.", user) : notFound(res, "USER_NOT_FOUND");
}));
systemRouter.post("/users/:id/lock", handle(async (req, res) => {
  const user = await systemService.setUserStatus(req.params.id, "locked", req);
  return user ? send(res, "User locked.", user) : notFound(res, "USER_NOT_FOUND");
}));
systemRouter.post("/users/:id/unlock", handle(async (req, res) => {
  const user = await systemService.setUserStatus(req.params.id, "active", req);
  return user ? send(res, "User unlocked.", user) : notFound(res, "USER_NOT_FOUND");
}));
systemRouter.post("/users/:id/reset-password", handle(async (req, res) => {
  const user = await systemService.resetPassword(req.params.id, req.body?.password, req);
  return user ? send(res, "User password reset.", user) : notFound(res, "USER_NOT_FOUND");
}));
systemRouter.post("/users/:id/revoke-sessions", handle((req, res) => send(res, "User sessions revoked.", systemService.revokeSessionsForUser(req.params.id, req))));
systemRouter.get("/users/:id/login-history", handle((req, res) => {
  const history = require("../../database/jsonStore").readCollection("login_history").filter((entry) => entry.userId === req.params.id);
  return send(res, "User login history loaded.", history);
}));

systemRouter.get("/sessions", handle((req, res) => {
  const result = require("../../utils/query").paginate(systemService.listSessions(req.query), req.query);
  return send(res, "Sessions loaded.", result.data, result.meta);
}));
systemRouter.post("/sessions/:id/revoke", handle((req, res) => {
  const session = systemService.revokeSingleSession(req.params.id, req);
  return session ? send(res, "Session revoked.", session) : notFound(res, "SESSION_NOT_FOUND");
}));

systemRouter.get("/roles", handle((req, res) => {
  const result = systemService.listRoles(req.query);
  return send(res, "Roles loaded.", result.data, result.meta);
}));
systemRouter.post("/roles", handle((req, res) => res.status(201).json({ success: true, message: "Role created.", data: systemService.createRole(req.body || {}, req), meta: {} })));
systemRouter.patch("/roles/:id", handle((req, res) => {
  const role = systemService.updateRole(req.params.id, req.body || {}, req);
  return role ? send(res, "Role updated.", role) : notFound(res, "ROLE_NOT_FOUND");
}));
systemRouter.delete("/roles/:id", handle((req, res) => {
  const role = systemService.deleteRole(req.params.id, req);
  return role ? send(res, "Role deleted.", role) : notFound(res, "ROLE_NOT_FOUND");
}));
systemRouter.get("/permissions", handle((_req, res) => send(res, "Permissions loaded.", systemService.listPermissions())));
systemRouter.post("/roles/:id/permissions", handle((req, res) => {
  const role = systemService.assignRolePermissions(req.params.id, req.body?.permissions || [], req);
  return role ? send(res, "Role permissions updated.", role) : notFound(res, "ROLE_NOT_FOUND");
}));

systemRouter.get("/integrations", handle((req, res) => {
  const result = systemService.listIntegrations(req.query);
  return send(res, "Integrations loaded.", result.data, result.meta);
}));
systemRouter.post("/integrations", handle((req, res) => res.status(201).json({ success: true, message: "Integration created.", data: systemService.upsertIntegration(req.body || {}, req), meta: {} })));
systemRouter.patch("/integrations/:id", handle((req, res) => {
  const integration = systemService.upsertIntegration(req.body || {}, req, req.params.id);
  return integration ? send(res, "Integration updated.", integration) : notFound(res, "INTEGRATION_NOT_FOUND");
}));
systemRouter.delete("/integrations/:id", handle((req, res) => {
  const integration = systemService.deleteIntegration(req.params.id, req);
  return integration ? send(res, "Integration deleted.", integration) : notFound(res, "INTEGRATION_NOT_FOUND");
}));
systemRouter.post("/integrations/:id/test", handle((req, res) => {
  const result = systemService.testIntegration(req.params.id, req);
  return result ? send(res, "Integration tested.", result) : notFound(res, "INTEGRATION_NOT_FOUND");
}));

systemRouter.get("/email/configuration", handle((_req, res) => send(res, "Email configuration loaded.", systemService.getEmailConfiguration())));
systemRouter.patch("/email/configuration", handle((req, res) => send(res, "Email configuration updated.", systemService.updateEmailConfiguration(req.body || {}, req))));
systemRouter.post("/email/test", handle(async (req, res) => send(res, "Email test completed.", await systemService.testEmail(req.body || {}, req))));

systemRouter.get("/notifications/configuration", handle((_req, res) => send(res, "Notification configuration loaded.", systemService.getNotificationConfiguration())));
systemRouter.patch("/notifications/configuration", handle((req, res) => send(res, "Notification configuration updated.", systemService.updateNotificationConfiguration(req.body || {}, req))));

systemRouter.get("/document-templates", handle((req, res) => {
  const result = systemService.listDocumentTemplates(req.query);
  return send(res, "Document templates loaded.", result.data, result.meta);
}));
systemRouter.post("/document-templates", handle((req, res) => res.status(201).json({ success: true, message: "Document template created.", data: systemService.createDocumentTemplate(req.body || {}, req), meta: {} })));
systemRouter.patch("/document-templates/:id", handle((req, res) => {
  const template = systemService.updateDocumentTemplate(req.params.id, req.body || {}, req);
  return template ? send(res, "Document template updated.", template) : notFound(res, "DOCUMENT_TEMPLATE_NOT_FOUND");
}));
systemRouter.delete("/document-templates/:id", handle((req, res) => {
  const template = systemService.deleteDocumentTemplate(req.params.id, req);
  return template ? send(res, "Document template deleted.", template) : notFound(res, "DOCUMENT_TEMPLATE_NOT_FOUND");
}));

systemRouter.get("/backups", handle((req, res) => {
  const result = systemService.listBackups(req.query);
  return send(res, "Backups loaded.", result.data, result.meta);
}));
systemRouter.post("/backups", handle((req, res) => res.status(202).json({ success: true, message: "Backup queued.", data: systemService.createBackup(req.body || {}, req), meta: {} })));
systemRouter.post("/backups/:id/restore", handle((req, res) => {
  const backup = systemService.restoreBackup(req.params.id, req.body || {}, req);
  return backup ? res.status(202).json({ success: true, message: "Backup restore queued.", data: backup, meta: { elevatedAuthorizationRequired: true } }) : notFound(res, "BACKUP_NOT_FOUND");
}));

systemRouter.get("/technical-audit-logs", handle((req, res) => {
  const result = systemService.listTechnicalAuditLogs(req.query);
  return send(res, "Technical audit logs loaded.", result.data, result.meta);
}));
systemRouter.get("/technical-audit-logs/export", handle((req, res) => {
  const csv = systemService.exportTechnicalAuditLogs(req.query);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"technical-audit-logs.csv\"");
  return res.status(200).send(csv);
}));
systemRouter.get("/technical-audit-logs/:id", handle((req, res) => {
  const log = systemService.getTechnicalAuditLog(req.params.id);
  return log ? send(res, "Technical audit log loaded.", log) : notFound(res, "TECHNICAL_AUDIT_LOG_NOT_FOUND");
}));

module.exports = { systemRouter };
