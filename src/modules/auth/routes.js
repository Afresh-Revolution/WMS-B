const crypto = require("crypto");
const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { hashPassword, verifyPassword } = require("../../auth/passwords");
const {
  createSession,
  findSessionByRefreshToken,
  listSessions,
  recordFailedLogin,
  recordLoginHistory,
  revokeSession,
  revokeUserSessions,
} = require("../../auth/sessionStore");
const { hashToken, issueAccessToken, issueRefreshToken } = require("../../auth/tokens");
const {
  createSuperadmin,
  getUserByEmail,
  getUserById,
  hasSuperadmin,
  sanitizeUser,
  updateUser,
  updateUserPassword,
} = require("../../auth/userStore");
const postgresUserStore = require("../../auth/postgresUserStore");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const securityService = require("../security/securityService");
const emailService = require("../email/email.service");
const { decorateUser } = require("../users/userAccessService");
const technicalAuditRepository = require("../technicalAudit/repository");

const authRouter = express.Router();
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;

function now() {
  return new Date().toISOString();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function validateBootstrapToken(setupToken) {
  const configuredToken = process.env.SUPERADMIN_SETUP_TOKEN;
  if (!configuredToken && process.env.NODE_ENV !== "production") {
    return true;
  }

  return typeof setupToken === "string" && setupToken === configuredToken;
}

function usingPostgresUsers() {
  return postgresUserStore.isEnabled();
}

async function authHasSuperadmin() {
  return usingPostgresUsers() ? postgresUserStore.hasSuperadmin() : hasSuperadmin();
}

async function authGetUserByEmail(email) {
  return usingPostgresUsers() ? postgresUserStore.getUserByEmail(email) : getUserByEmail(email);
}

async function authGetUserById(id) {
  return usingPostgresUsers() ? postgresUserStore.getUserById(id) : getUserById(id);
}

async function authCreateSuperadmin(payload) {
  return usingPostgresUsers() ? postgresUserStore.createSuperadmin(payload) : createSuperadmin(payload);
}

async function authUpdateUser(id, payload) {
  return usingPostgresUsers() ? postgresUserStore.updateUser(id, payload) : updateUser(id, payload);
}

async function authUpdateUserPassword(id, passwordHash) {
  return usingPostgresUsers() ? postgresUserStore.updateUserPassword(id, passwordHash) : updateUserPassword(id, passwordHash);
}

function getSecuritySetting(key, fallback) {
  const settings = securityService.getActiveSecuritySettings();
  return settings[key] ?? settings[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] ?? fallback;
}

function getMaxFailedAttempts() {
  const configured = Number(getSecuritySetting("maxLoginAttempts", DEFAULT_MAX_FAILED_ATTEMPTS));
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_FAILED_ATTEMPTS;
}

function safeSession(session) {
  if (!session) {
    return null;
  }

  const { refreshTokenHash, ...safe } = session;
  return safe;
}

function issueAuthResponse(user, req) {
  const refreshToken = issueRefreshToken();
  const session = createSession({ user, refreshToken, req });
  securityService.enforceSessionPolicy(user.id, session.id, req);
  return {
    token: issueAccessToken(user, session.id),
    accessToken: issueAccessToken(user, session.id),
    refreshToken,
    user: decorateUser(user),
    session: safeSession(session),
    mustChangePassword: Boolean(user.mustChangePassword || user.forcePasswordReset),
  };
}

function recordAuthAudit({ user, req, action, status = "SUCCESS", description, metadata }) {
  appendRecord("user_activity_logs", {
    id: crypto.randomUUID(),
    actorUserId: user?.id || null,
    actor_user_id: user?.id || null,
    action,
    module: "Authentication",
    targetType: "user",
    target_type: "user",
    targetId: user?.id || null,
    target_id: user?.id || null,
    targetName: user?.fullName || user?.name || user?.email || null,
    target_name: user?.fullName || user?.name || user?.email || null,
    description,
    oldValues: null,
    old_values: null,
    newValues: metadata || null,
    new_values: metadata || null,
    ipAddress: req?.ip || null,
    ip_address: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
    user_agent: req?.get ? req.get("user-agent") : null,
    outcome: status,
    metadata,
    createdAt: now(),
    created_at: now(),
    updatedAt: now(),
    updated_at: now(),
  });
  technicalAuditRepository.recordLog({
    req,
    user,
    action,
    module: "Authentication",
    target: user?.id || user?.email || metadata?.email || null,
    status: status === "FAILED" ? "failed" : "success",
    metadata: {
      description,
      ...(metadata || {}),
    },
  }).catch(() => null);
}

authRouter.get("/bootstrap/status", async (req, res) => {
  return res.json({ success: true, message: "Bootstrap status loaded.", data: { bootstrapped: await authHasSuperadmin() }, meta: {} });
});

authRouter.post("/bootstrap", async (req, res) => {
  if (await authHasSuperadmin()) {
    throw createHttpError(409, "Superadmin has already been bootstrapped.", "SUPERADMIN_EXISTS");
  }

  const { name, fullName, email, password, setupToken } = req.body || {};
  if (!validateBootstrapToken(setupToken)) {
    throw createHttpError(403, "Invalid setup token.", "INVALID_SETUP_TOKEN");
  }
  if (typeof (name || fullName) !== "string" || String(name || fullName).trim().length < 2) {
    throw createHttpError(400, "Name must be at least 2 characters.", "VALIDATION_ERROR");
  }
  if (!isValidEmail(email)) {
    throw createHttpError(400, "A valid email is required.", "VALIDATION_ERROR");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw createHttpError(400, "Password must be at least 8 characters.", "VALIDATION_ERROR");
  }

  const user = await authCreateSuperadmin({
    name: String(name || fullName).trim(),
    email: normalizeEmail(email),
    passwordHash: hashPassword(password),
  });
  const auth = issueAuthResponse(user, req);
  recordLoginHistory({ userId: user.id, status: "success", req, reason: "bootstrap" });
  recordAuthAudit({ user, req, action: "LOGIN_SUCCESS", description: "Super Admin bootstrapped." });
  return res.status(201).json(auth);
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    throw createHttpError(400, "Email and password are required.", "VALIDATION_ERROR");
  }

  const normalizedEmail = normalizeEmail(email);
  let user = await authGetUserByEmail(normalizedEmail);
  if (!user) {
    securityService.recordLoginAttempt({ email: normalizedEmail, req, successful: false, failureReason: "unknown_account" });
    recordFailedLogin({ email: normalizedEmail, req, reason: "unknown_account" });
    recordLoginHistory({ userId: null, status: "failed", req, reason: "unknown_account" });
    recordAuthAudit({ user: null, req, action: "LOGIN_FAILED", status: "FAILED", metadata: { email: normalizedEmail } });
    throw createHttpError(401, "Invalid credentials.", "INVALID_CREDENTIALS");
  }

  const status = String(user.status || "active").toLowerCase();
  if (status === "locked" && user.lockedUntil && new Date(user.lockedUntil).getTime() <= Date.now()) {
    await authUpdateUser(user.id, { status: "active", lockedAt: null, lockedUntil: null, failedLoginAttempts: 0, failedLoginCount: 0 });
    user = await authGetUserById(user.id);
  } else if (!["active"].includes(status)) {
    securityService.recordLoginAttempt({ userId: user.id, email: normalizedEmail, req, successful: false, failureReason: `account_${status}` });
    recordFailedLogin({ email: normalizedEmail, userId: user.id, req, reason: `account_${status}` });
    recordLoginHistory({ userId: user.id, status: "failed", req, reason: `account_${status}` });
    throw createHttpError(403, "Account is not active.", "ACCOUNT_NOT_ACTIVE", { status });
  }

  if (user.lockedAt || (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now())) {
    securityService.recordLoginAttempt({ userId: user.id, email: normalizedEmail, req, successful: false, failureReason: "account_locked" });
    recordFailedLogin({ email: normalizedEmail, userId: user.id, req, reason: "account_locked" });
    recordLoginHistory({ userId: user.id, status: "failed", req, reason: "account_locked" });
    throw createHttpError(423, "Account is locked.", "ACCOUNT_LOCKED");
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const failedLoginAttempts = Number(user.failedLoginAttempts || user.failedLoginCount || 0) + 1;
    const updates = { failedLoginAttempts, failedLoginCount: failedLoginAttempts };
    if (failedLoginAttempts >= getMaxFailedAttempts()) {
      const securitySettings = securityService.getActiveSecuritySettings();
      updates.status = "locked";
      updates.lockedAt = now();
      updates.lockedUntil = new Date(Date.now() + securitySettings.lockoutDurationMinutes * 60 * 1000).toISOString();
      securityService.appendSecurityEvent("ACCOUNT_LOCKED", user, user.id, { failedLoginAttempts }, req, "failed");
    }

    await authUpdateUser(user.id, updates);
    securityService.recordLoginAttempt({ userId: user.id, email: normalizedEmail, req, successful: false, failureReason: "invalid_password" });
    recordFailedLogin({ email: normalizedEmail, userId: user.id, req, reason: "invalid_password" });
    recordLoginHistory({ userId: user.id, status: "failed", req, reason: "invalid_password" });
    recordAuthAudit({ user, req, action: "LOGIN_FAILED", status: "FAILED", description: "Invalid password." });
    throw createHttpError(401, "Invalid credentials.", "INVALID_CREDENTIALS");
  }

  const updatedUser = await authUpdateUser(user.id, {
    failedLoginAttempts: 0,
    failedLoginCount: 0,
    lastLoginAt: now(),
    lastLoginIp: req.ip || null,
    lastActivityAt: now(),
  });
  securityService.recordLoginAttempt({ userId: user.id, email: normalizedEmail, req, successful: true });
  recordLoginHistory({ userId: user.id, status: "success", req, reason: "password" });
  recordAuthAudit({ user: updatedUser, req, action: "LOGIN_SUCCESS", description: "User logged in." });
  if (securityService.isMfaRequiredForUser(updatedUser)) {
    const challenge = securityService.createMfaChallenge(updatedUser, req, req.body?.mfaMethod || "email");
    return res.status(202).json({
      success: true,
      message: "MFA verification required.",
      data: { mfaRequired: true, challenge },
      meta: {},
    });
  }
  return res.json(issueAuthResponse(updatedUser, req));
});

authRouter.post("/mfa/verify", async (req, res) => {
  const user = securityService.verifyMfaChallenge(req.body?.challengeId, req.body?.code, req);
  const updatedUser = await authUpdateUser(user.id, {
    failedLoginAttempts: 0,
    failedLoginCount: 0,
    lastLoginAt: now(),
    lastLoginIp: req.ip || null,
    lastActivityAt: now(),
  });
  recordLoginHistory({ userId: user.id, status: "success", req, reason: "mfa" });
  return res.json(issueAuthResponse(updatedUser, req));
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== "string") {
    throw createHttpError(400, "Refresh token is required.", "VALIDATION_ERROR");
  }

  const session = findSessionByRefreshToken(refreshToken);
  if (!session) {
    throw createHttpError(401, "Invalid refresh token.", "INVALID_REFRESH_TOKEN");
  }

  const user = await authGetUserById(session.userId);
  if (!user || String(user.status || "").toLowerCase() !== "active") {
    throw createHttpError(401, "User no longer has access.", "USER_ACCESS_REVOKED");
  }

  revokeSession(session.id, user.id);
  return res.json(issueAuthResponse(user, req));
});

authRouter.post("/logout", authenticate, (req, res) => {
  if (req.authSessionId) {
    revokeSession(req.authSessionId, req.user.id);
  }
  recordLoginHistory({ userId: req.user.id, status: "logout", req, reason: "user_logout" });
  recordAuthAudit({ user: req.user, req, action: "LOGOUT", description: "User logged out." });
  return res.status(204).send();
});

authRouter.get("/me", authenticate, async (req, res) => {
  return res.json({ success: true, message: "Current user loaded.", data: decorateUser(await authGetUserById(req.user.id)), meta: {} });
});

authRouter.post("/change-password", authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await authGetUserById(req.user.id);
  if (!user || typeof currentPassword !== "string" || !verifyPassword(currentPassword, user.passwordHash)) {
    throw createHttpError(401, "Current password is incorrect.", "INVALID_CURRENT_PASSWORD");
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw createHttpError(400, "New password must be at least 8 characters.", "VALIDATION_ERROR");
  }
  securityService.validatePasswordAgainstPolicy(newPassword, user.id);

  securityService.recordPasswordHistory(user);
  const updated = await authUpdateUserPassword(user.id, hashPassword(newPassword));
  await authUpdateUser(user.id, { mustChangePassword: false, forcePasswordReset: false, lastActivityAt: now() });
  recordAuthAudit({ user: updated, req, action: "PASSWORD_CHANGED", description: "User changed password." });
  securityService.appendSecurityEvent("PASSWORD_CHANGED", updated, updated.id, {}, req);
  return res.json({ success: true, message: "Password changed.", data: decorateUser(await authGetUserById(user.id)), meta: {} });
});

authRouter.post("/forgot-password", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const user = email ? getUserByEmail(email) : null;
  if (user) {
    const token = crypto.randomBytes(32).toString("base64url");
    appendRecord("password_reset_tokens", {
      id: crypto.randomUUID(),
      userId: user.id,
      user_id: user.id,
      tokenHash: hashToken(token),
      token_hash: hashToken(token),
      expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
      expires_at: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
      usedAt: null,
      used_at: null,
      createdAt: now(),
      created_at: now(),
    });
    appendRecord("notifications", {
      id: crypto.randomUUID(),
      userId: user.id,
      user_id: user.id,
      type: "forgot_password",
      title: "Password reset requested.",
      channel: "email",
      status: "pending",
      createdAt: now(),
      created_at: now(),
    });
    emailService
      .sendEmail({
        to: user.email,
        template: "password-reset",
        data: {
          resetLink: `${process.env.FRONTEND_URL || process.env.APP_BASE_URL || "http://127.0.0.1:3000"}/reset-password?token=${token}`,
          name: user.name || user.fullName || user.email,
        },
      })
      .catch((error) => {
        console.error("Password reset email queueing failed:", error.publicMessage || error.message);
      });
    recordAuthAudit({ user, req, action: "PASSWORD_RESET_REQUESTED" });
  }

  return res.json({
    success: true,
    message: "If the account exists, password reset instructions will be sent.",
    data: { resetTokenIssued: Boolean(user) },
    meta: {},
  });
});

authRouter.post("/reset-password", (req, res) => {
  const { token, newPassword } = req.body || {};
  if (typeof token !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
    throw createHttpError(400, "A valid token and new password are required.", "VALIDATION_ERROR");
  }

  const tokens = readCollection("password_reset_tokens");
  const tokenHash = hashToken(token);
  const index = tokens.findIndex(
    (record) =>
      (record.tokenHash === tokenHash || record.token_hash === tokenHash) &&
      !record.usedAt &&
      !record.used_at &&
      new Date(record.expiresAt || record.expires_at).getTime() > Date.now()
  );
  if (index === -1) {
    throw createHttpError(400, "Password reset token is invalid or expired.", "INVALID_RESET_TOKEN");
  }

  const userId = tokens[index].userId || tokens[index].user_id;
  const existingUser = getUserById(userId);
  securityService.validatePasswordAgainstPolicy(newPassword, userId);
  securityService.recordPasswordHistory(existingUser);
  const updated = updateUserPassword(userId, hashPassword(newPassword));
  updateUser(userId, { status: "active", mustChangePassword: false, forcePasswordReset: false });
  tokens[index] = { ...tokens[index], usedAt: now(), used_at: now(), updatedAt: now(), updated_at: now() };
  writeCollection("password_reset_tokens", tokens);
  revokeUserSessions(userId, userId);
  recordAuthAudit({ user: updated, req, action: "PASSWORD_RESET", description: "User reset password." });
  return res.json({ success: true, message: "Password reset.", data: decorateUser(getUserById(userId)), meta: {} });
});

authRouter.get("/sessions", authenticate, (req, res) => {
  const sessions = listSessions({ userId: req.user.id }).map(safeSession);
  return res.json({ success: true, message: "Sessions loaded.", data: sessions, meta: {} });
});

authRouter.delete("/sessions/:id", authenticate, (req, res) => {
  const session = revokeSession(req.params.id, req.user.id);
  if (!session || session.userId !== req.user.id) {
    throw createHttpError(404, "Session not found.", "SESSION_NOT_FOUND");
  }
  recordAuthAudit({ user: req.user, req, action: "SESSION_REVOKED", metadata: { sessionId: req.params.id } });
  return res.json({ success: true, message: "Session revoked.", data: safeSession(session), meta: {} });
});

authRouter.get("/superadmin/me", authenticate, requireRole("superadmin"), async (req, res) => {
  return res.json({ success: true, message: "Super Admin loaded.", data: decorateUser(await authGetUserById(req.user.id)), meta: {} });
});

module.exports = { authRouter };
