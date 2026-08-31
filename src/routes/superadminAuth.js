const express = require("express");
const { authenticate, requireRole } = require("../auth/middleware");
const { hashPassword, verifyPassword } = require("../auth/passwords");
const { issueAccessToken, issueRefreshToken } = require("../auth/tokens");
const {
  createSession,
  findSessionByRefreshToken,
  recordFailedLogin,
  recordLoginHistory,
  revokeSession,
} = require("../auth/sessionStore");
const {
  createSuperadmin,
  getUserByEmail,
  getUserById,
  hasSuperadmin,
  sanitizeUser,
  updateUser,
  updateUserPassword,
} = require("../auth/userStore");
const postgresUserStore = require("../auth/postgresUserStore");

const superadminRouter = express.Router();
const MAX_FAILED_LOGINS = 5;

function issueAuthResponse(user, req) {
  const refreshToken = issueRefreshToken();
  const session = createSession({ user, refreshToken, req });
  return {
    token: issueAccessToken(user, session.id),
    refreshToken,
    session: {
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
    },
    user: sanitizeUser(user),
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }

  return null;
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

superadminRouter.get("/bootstrap/status", async (req, res) => {
  res.json({ bootstrapped: await authHasSuperadmin() });
});

superadminRouter.post("/bootstrap", async (req, res, next) => {
  try {
    if (await authHasSuperadmin()) {
      return res.status(409).json({ error: "Superadmin has already been bootstrapped." });
    }

    const { name, email, password, setupToken } = req.body || {};

    if (!validateBootstrapToken(setupToken)) {
      return res.status(403).json({ error: "Invalid setup token." });
    }

    if (typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "Name must be at least 2 characters." });
    }

    if (typeof email !== "string" || !isValidEmail(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const user = await authCreateSuperadmin({
      name: name.trim(),
      email: email.trim(),
      passwordHash: hashPassword(password),
    });
    const auth = issueAuthResponse(user, req);
    recordLoginHistory({ userId: user.id, status: "success", req, reason: "bootstrap" });

    return res.status(201).json(auth);
  } catch (error) {
    return next(error);
  }
});

superadminRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = await authGetUserByEmail(email.trim());
  if (!user || user.role !== "superadmin") {
    recordFailedLogin({ email, req, reason: "unknown_superadmin" });
    recordLoginHistory({ userId: null, status: "failed", req, reason: "unknown_superadmin" });
    return res.status(401).json({ error: "Invalid superadmin credentials." });
  }

  if (user.status === "locked" || user.lockedAt) {
    recordFailedLogin({ email, userId: user.id, req, reason: "account_locked" });
    recordLoginHistory({ userId: user.id, status: "failed", req, reason: "account_locked" });
    return res.status(423).json({ error: "Account is locked." });
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
    const updates = { failedLoginCount };

    if (failedLoginCount >= MAX_FAILED_LOGINS) {
      updates.status = "locked";
      updates.lockedAt = new Date().toISOString();
    }

    await authUpdateUser(user.id, updates);
    recordFailedLogin({ email, userId: user.id, req, reason: "invalid_password" });
    recordLoginHistory({ userId: user.id, status: "failed", req, reason: "invalid_password" });
    return res.status(401).json({ error: "Invalid superadmin credentials." });
  }

  const updatedUser = await authUpdateUser(user.id, { failedLoginCount: 0, lastLoginAt: new Date().toISOString() });
  recordLoginHistory({ userId: user.id, status: "success", req, reason: "password" });

  return res.json(issueAuthResponse(updatedUser || user, req));
});

superadminRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body || {};

  if (typeof refreshToken !== "string") {
    return res.status(400).json({ error: "Refresh token is required." });
  }

  const session = findSessionByRefreshToken(refreshToken);
  if (!session) {
    return res.status(401).json({ error: "Invalid refresh token." });
  }

  const user = await authGetUserById(session.userId);
  if (!user || user.role !== "superadmin" || user.status !== "active") {
    return res.status(401).json({ error: "User no longer has access." });
  }

  return res.json({ token: issueAccessToken(user, session.id), user: sanitizeUser(user) });
});

superadminRouter.post("/logout", authenticate, requireRole("superadmin"), (req, res) => {
  if (req.authSessionId) {
    revokeSession(req.authSessionId, req.user.id);
  }

  recordLoginHistory({ userId: req.user.id, status: "logout", req, reason: "user_logout" });
  res.status(204).send();
});

superadminRouter.get("/me", authenticate, requireRole("superadmin"), (req, res) => {
  res.json({ user: req.user });
});

function changePasswordHandler(req, res, next) {
  Promise.resolve().then(async () => {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return res.status(400).json({ error: "Current password and new password are required." });
    }

    const user = await authGetUserByEmail(req.user.email);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const updatedUser = await authUpdateUserPassword(user.id, hashPassword(newPassword));
    return res.json({ user: sanitizeUser(updatedUser) });
  }).catch(next);
}

superadminRouter.patch("/password", authenticate, requireRole("superadmin"), changePasswordHandler);

superadminRouter.post(
  "/change-password",
  authenticate,
  requireRole("superadmin"),
  changePasswordHandler
);

module.exports = { superadminRouter };
