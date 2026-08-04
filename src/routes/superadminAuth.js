const express = require("express");
const { authenticate, requireRole } = require("../auth/middleware");
const { hashPassword, verifyPassword } = require("../auth/passwords");
const { issueAccessToken } = require("../auth/tokens");
const {
  createSuperadmin,
  getUserByEmail,
  hasSuperadmin,
  sanitizeUser,
  updateUserPassword,
} = require("../auth/userStore");

const superadminRouter = express.Router();

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

superadminRouter.get("/bootstrap/status", (req, res) => {
  res.json({ bootstrapped: hasSuperadmin() });
});

superadminRouter.post("/bootstrap", (req, res, next) => {
  try {
    if (hasSuperadmin()) {
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

    const user = createSuperadmin({
      name: name.trim(),
      email: email.trim(),
      passwordHash: hashPassword(password),
    });
    const token = issueAccessToken(user);

    return res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    return next(error);
  }
});

superadminRouter.post("/login", (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = getUserByEmail(email.trim());
  if (!user || user.role !== "superadmin" || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid superadmin credentials." });
  }

  return res.json({ token: issueAccessToken(user), user: sanitizeUser(user) });
});

superadminRouter.post("/logout", authenticate, requireRole("superadmin"), (req, res) => {
  res.status(204).send();
});

superadminRouter.get("/me", authenticate, requireRole("superadmin"), (req, res) => {
  res.json({ user: req.user });
});

superadminRouter.patch("/password", authenticate, requireRole("superadmin"), (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return res.status(400).json({ error: "Current password and new password are required." });
    }

    const user = getUserByEmail(req.user.email);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const updatedUser = updateUserPassword(user.id, hashPassword(newPassword));
    return res.json({ user: sanitizeUser(updatedUser) });
  } catch (error) {
    return next(error);
  }
});

module.exports = { superadminRouter };
