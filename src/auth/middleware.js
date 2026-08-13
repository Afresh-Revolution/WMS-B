const { verifyAccessToken } = require("./tokens");
const { getUserById, sanitizeUser } = require("./userStore");
const { getActiveSession, touchSession } = require("./sessionStore");
const { hasPermission } = require("../constants/rbac");

function authenticate(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  const user = getUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: "User no longer exists." });
  }

  if (user.status === "locked" || user.status === "suspended" || user.lockedAt) {
    return res.status(403).json({ error: "Account is not active." });
  }

  if (payload.sid) {
    const session = getActiveSession(payload.sid);
    if (!session || session.userId !== user.id) {
      return res.status(401).json({ error: "Session is no longer active." });
    }

    req.authSessionId = payload.sid;
    touchSession(payload.sid);
  }

  req.user = sanitizeUser(user);
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden." });
    }

    return next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user?.role === "superadmin" || hasPermission(req.user, permission)) {
      return next();
    }

    return res.status(403).json({ error: "Forbidden." });
  };
}

module.exports = { authenticate, requirePermission, requireRole };
