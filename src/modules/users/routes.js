const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { hashPassword } = require("../../auth/passwords");
const { revokeUserSessions } = require("../../auth/sessionStore");
const { createUser, listUsers, sanitizeUser, updateUser, updateUserPassword } = require("../../auth/userStore");
const { paginate, applyBasicFilters } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");

const usersRouter = express.Router();

usersRouter.use(authenticate, requireRole("superadmin"));

usersRouter.get("/", (req, res) => {
  const users = applyBasicFilters(listUsers(), req.query, ["name", "email", "role", "status"]);
  const result = paginate(users, req.query);
  return res.json({
    success: true,
    message: "Users loaded.",
    data: result.data,
    meta: result.meta,
  });
});

usersRouter.post("/", (req, res) => {
  const { name, email, password, role, permissions, status } = req.body || {};

  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({
      success: false,
      message: "Operation failed",
      error: { code: "INVALID_USER_PAYLOAD", details: {} },
    });
  }

  const user = createUser({
    name: name.trim(),
    email: email.trim(),
    passwordHash: hashPassword(password),
    role: role || "employee",
    permissions: Array.isArray(permissions) ? permissions : [],
    status: status || "active",
  });

  recordOperationalAudit({
    user: req.user,
    action: "User Created",
    module: "users",
    recordId: user.id,
    newValue: sanitizeUser(user),
    ipAddress: req.ip,
  });

  return res.status(201).json({
    success: true,
    message: "User created.",
    data: sanitizeUser(user),
    meta: {},
  });
});

usersRouter.patch("/:id", (req, res) => {
  const { password, ...payload } = req.body || {};
  const oldValue = listUsers().find((user) => user.id === req.params.id);
  const user = updateUser(req.params.id, payload);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Operation failed",
      error: { code: "NOT_FOUND", details: { id: req.params.id } },
    });
  }

  if (typeof password === "string" && password.length >= 8) {
    updateUserPassword(user.id, hashPassword(password));
  }

  const sanitized = sanitizeUser(updateUser(req.params.id, {}));
  recordOperationalAudit({
    user: req.user,
    action: "User Updated",
    module: "users",
    recordId: req.params.id,
    oldValue,
    newValue: sanitized,
    ipAddress: req.ip,
  });

  return res.json({
    success: true,
    message: "User updated.",
    data: sanitized,
    meta: {},
  });
});

usersRouter.delete("/:id", (req, res) => {
  const oldValue = listUsers().find((user) => user.id === req.params.id);
  const user = updateUser(req.params.id, {
    status: "deleted",
    deletedAt: new Date().toISOString(),
    deletedBy: req.user.id,
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Operation failed",
      error: { code: "NOT_FOUND", details: { id: req.params.id } },
    });
  }

  revokeUserSessions(req.params.id, req.user.id);
  recordOperationalAudit({
    user: req.user,
    action: "User Deleted",
    module: "users",
    recordId: req.params.id,
    oldValue,
    newValue: sanitizeUser(user),
    ipAddress: req.ip,
  });

  return res.json({
    success: true,
    message: "User deleted.",
    data: sanitizeUser(user),
    meta: {},
  });
});

usersRouter.post("/:id/reset-password", (req, res) => {
  const { password } = req.body || {};

  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Operation failed",
      error: { code: "INVALID_PASSWORD", details: { minLength: 8 } },
    });
  }

  const user = updateUserPassword(req.params.id, hashPassword(password));
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Operation failed",
      error: { code: "NOT_FOUND", details: { id: req.params.id } },
    });
  }

  revokeUserSessions(req.params.id, req.user.id);
  recordOperationalAudit({
    user: req.user,
    action: "User Password Reset",
    module: "users",
    recordId: req.params.id,
    ipAddress: req.ip,
  });

  return res.json({ success: true, message: "Password reset.", data: sanitizeUser(user), meta: {} });
});

module.exports = { usersRouter };
