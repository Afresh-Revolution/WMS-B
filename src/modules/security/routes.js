const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { listSessions, revokeUserSessions } = require("../../auth/sessionStore");
const { listUsers, sanitizeUser, updateUser } = require("../../auth/userStore");
const { readCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");

const securityRouter = express.Router();

securityRouter.use(authenticate, requireRole("superadmin"));

securityRouter.get("/events", (req, res) => {
  const events = applyBasicFilters(readCollection("technical_audit_logs"), req.query, [
    "endpoint",
    "method",
    "service",
    "error",
  ]);
  const result = paginate(events, req.query);
  return res.json({ success: true, message: "Security events loaded.", data: result.data, meta: result.meta });
});

securityRouter.get("/sessions", (req, res) => {
  const result = paginate(listSessions(req.query), req.query);
  return res.json({ success: true, message: "Sessions loaded.", data: result.data, meta: result.meta });
});

securityRouter.get("/login-history", (req, res) => {
  const history = applyBasicFilters(readCollection("login_history"), req.query, ["status", "reason", "userId"]);
  const result = paginate(history, req.query);
  return res.json({ success: true, message: "Login history loaded.", data: result.data, meta: result.meta });
});

securityRouter.get("/failed-logins", (req, res) => {
  const attempts = applyBasicFilters(readCollection("failed_logins"), req.query, ["email", "reason", "userId"]);
  const result = paginate(attempts, req.query);
  return res.json({ success: true, message: "Failed logins loaded.", data: result.data, meta: result.meta });
});

securityRouter.post("/users/:id/lock", (req, res) => {
  const user = updateUser(req.params.id, { status: "locked", lockedAt: new Date().toISOString() });
  if (!user) {
    return res.status(404).json({ success: false, message: "Operation failed", error: { code: "NOT_FOUND" } });
  }

  revokeUserSessions(req.params.id, req.user.id);
  recordOperationalAudit({
    user: req.user,
    action: "User Locked",
    module: "security",
    recordId: req.params.id,
    newValue: sanitizeUser(user),
    ipAddress: req.ip,
  });

  return res.json({ success: true, message: "User locked.", data: sanitizeUser(user), meta: {} });
});

securityRouter.post("/users/:id/unlock", (req, res) => {
  const user = updateUser(req.params.id, { status: "active", lockedAt: null, failedLoginCount: 0 });
  if (!user) {
    return res.status(404).json({ success: false, message: "Operation failed", error: { code: "NOT_FOUND" } });
  }

  recordOperationalAudit({
    user: req.user,
    action: "User Unlocked",
    module: "security",
    recordId: req.params.id,
    newValue: sanitizeUser(user),
    ipAddress: req.ip,
  });

  return res.json({ success: true, message: "User unlocked.", data: sanitizeUser(user), meta: {} });
});

securityRouter.post("/users/:id/force-logout", (req, res) => {
  const user = listUsers().find((candidate) => candidate.id === req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: "Operation failed", error: { code: "NOT_FOUND" } });
  }

  const revokedSessions = revokeUserSessions(req.params.id, req.user.id);
  recordOperationalAudit({
    user: req.user,
    action: "User Force Logout",
    module: "security",
    recordId: req.params.id,
    newValue: { revokedSessionCount: revokedSessions.length },
    ipAddress: req.ip,
  });

  return res.json({
    success: true,
    message: "User sessions revoked.",
    data: { user, revokedSessions },
    meta: {},
  });
});

module.exports = { securityRouter };
