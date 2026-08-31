const express = require("express");
const { authenticate, requirePermission } = require("../../auth/middleware");
const securityService = require("./securityService");

const securityRouter = express.Router();

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res, code = "NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

securityRouter.use(authenticate);

securityRouter.get("/", requirePermission("security.view"), handle((req, res) => {
  return send(res, "Security configuration loaded.", securityService.getDashboardData(req.query));
}));

securityRouter.get("/dashboard", requirePermission("security.view"), handle((req, res) => {
  return send(res, "Security dashboard loaded.", securityService.getDashboardData(req.query));
}));

securityRouter.patch("/password-policy", requirePermission("security.update"), handle((req, res) => {
  const settings = securityService.upsertSecuritySettings(req.body || {}, req, "PASSWORD_POLICY_CHANGED", [
    "minimumPasswordLength",
    "requireUppercase",
    "requireLowercase",
    "requireNumber",
    "requireSymbol",
    "passwordExpiryEnabled",
    "passwordExpiryDays",
    "passwordHistoryEnabled",
    "passwordHistoryCount",
  ]);
  return send(res, "Password policy updated.", settings);
}));

securityRouter.patch("/mfa", requirePermission("security.manage_mfa"), handle((req, res) => {
  const settings = securityService.upsertSecuritySettings(req.body || {}, req, "MFA_POLICY_CHANGED", [
    "requireMfa",
    "allowEmailMfa",
    "allowAuthenticatorMfa",
  ]);
  return send(res, "MFA policy updated.", settings);
}));

securityRouter.patch("/login-policy", requirePermission("security.update"), handle((req, res) => {
  const settings = securityService.upsertSecuritySettings(req.body || {}, req, "LOGIN_POLICY_CHANGED", [
    "maxLoginAttempts",
    "lockoutDurationMinutes",
  ]);
  return send(res, "Login policy updated.", settings);
}));

securityRouter.patch("/session-policy", requirePermission("security.manage_sessions"), handle((req, res) => {
  const settings = securityService.upsertSecuritySettings(req.body || {}, req, "SESSION_POLICY_CHANGED", [
    "sessionTimeoutMinutes",
    "maxConcurrentSessions",
    "allowRememberDevice",
  ]);
  return send(res, "Session policy updated.", settings);
}));

securityRouter.patch("/maintenance", requirePermission("security.manage_maintenance"), handle((req, res) => {
  const settings = securityService.upsertSecuritySettings(req.body || {}, req, req.body?.maintenanceMode || req.body?.maintenance_mode ? "MAINTENANCE_MODE_ENABLED" : "MAINTENANCE_MODE_DISABLED", [
    "maintenanceMode",
    "maintenanceMessage",
  ]);
  return send(res, "Maintenance policy updated.", settings);
}));

securityRouter.get("/sessions", requirePermission("security.manage_sessions"), handle((req, res) => {
  const result = require("../../utils/query").paginate(
    require("../../auth/sessionStore").listSessions(req.query).map(securityService.sanitizeSession),
    req.query
  );
  return send(res, "Sessions loaded.", result.data, result.meta);
}));

securityRouter.delete("/sessions/:sessionId", requirePermission("security.manage_sessions"), handle((req, res) => {
  const session = securityService.revokeOneSession(req.params.sessionId, req);
  return session ? send(res, "Session revoked.", session) : notFound(res, "SESSION_NOT_FOUND");
}));

securityRouter.post("/users/:userId/unlock", requirePermission("security.unlock_accounts"), handle((req, res) => {
  const user = securityService.unlockAccount(req.params.userId, req);
  return user ? send(res, "Account unlocked.", user) : notFound(res, "USER_NOT_FOUND");
}));

securityRouter.post("/users/:userId/revoke-sessions", requirePermission("security.manage_sessions"), handle((req, res) => {
  return send(res, "User sessions revoked.", securityService.revokeAllSessionsForUser(req.params.userId, req));
}));

securityRouter.get("/login-attempts", requirePermission("security.view_security_logs"), handle((req, res) => {
  const result = securityService.listLoginAttempts(req.query);
  return send(res, "Login attempts loaded.", result.data, result.meta);
}));

securityRouter.get("/events", requirePermission("security.view_security_logs"), handle((req, res) => {
  const result = securityService.listSecurityEvents(req.query);
  return send(res, "Security events loaded.", result.data, result.meta);
}));

securityRouter.get("/trusted-devices", requirePermission("security.manage_sessions"), handle((req, res) => {
  const result = securityService.listTrustedDevices(req.query);
  return send(res, "Trusted devices loaded.", result.data, result.meta);
}));

securityRouter.delete("/trusted-devices/:id", requirePermission("security.manage_sessions"), handle((req, res) => {
  const device = securityService.revokeTrustedDevice(req.params.id, req);
  return device ? send(res, "Trusted device revoked.", device) : notFound(res, "TRUSTED_DEVICE_NOT_FOUND");
}));

securityRouter.post("/users/:userId/mfa", requirePermission("security.manage_mfa"), handle((req, res) => {
  const mfa = securityService.upsertMfa(req.params.userId, req.body || {}, req);
  return mfa ? send(res, "User MFA updated.", mfa) : notFound(res, "USER_NOT_FOUND");
}));

module.exports = { securityRouter };
