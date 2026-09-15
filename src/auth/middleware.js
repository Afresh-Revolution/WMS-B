const { verifyAccessToken } = require("./tokens");
const { getUserById, sanitizeUser } = require("./userStore");
const postgresUserStore = require("./postgresUserStore");
const { getActiveSession, touchSession } = require("./sessionStore");
const { hasPermission } = require("../constants/rbac");
const { readCollection } = require("../database/jsonStore");
const { getActiveSecuritySettings } = require("../modules/security/securityService");

async function findAuthenticatedUser(id) {
  return postgresUserStore.isEnabled() ? postgresUserStore.getUserById(id) : getUserById(id);
}

async function authenticate(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  const user = await findAuthenticatedUser(payload.sub);
  if (!user) {
    return res.status(401).json({ error: "User no longer exists." });
  }

  if (String(user.status || "active").toLowerCase() !== "active" || user.lockedAt) {
    return res.status(403).json({ error: "Account is not active." });
  }

  const canUsePasswordResetRoutes =
    req.originalUrl.includes("/auth/change-password") ||
    req.originalUrl.includes("/profile/password") ||
    req.originalUrl.includes("/auth/me") ||
    req.originalUrl.includes("/auth/logout") ||
    req.originalUrl.includes("/auth/sessions");
  if ((user.mustChangePassword || user.forcePasswordReset) && !canUsePasswordResetRoutes) {
    return res.status(403).json({
      error: "Password change required.",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }

  const securitySettings = getActiveSecuritySettings();
  if (
    securitySettings.passwordExpiryEnabled &&
    user.passwordChangedAt &&
    Date.now() - new Date(user.passwordChangedAt).getTime() >
      securitySettings.passwordExpiryDays * 24 * 60 * 60 * 1000 &&
    !canUsePasswordResetRoutes
  ) {
    return res.status(403).json({
      error: "Password expired.",
      code: "PASSWORD_EXPIRED",
    });
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
  const maintenance = readCollection("system_settings").find(
    (setting) => !setting.deletedAt && (setting.key === "maintenanceMode" || setting.key === "maintenance_mode")
  );
  const maintenanceEnabled =
    securitySettings.maintenanceMode ||
    (maintenance && (maintenance.value === true || maintenance.value?.enabled === true || maintenance.value?.maintenanceMode === true));
  if (maintenanceEnabled && req.user.role !== "superadmin") {
    return res.status(503).json({
      success: false,
      message: "System is currently under maintenance.",
      error: {
        code: "MAINTENANCE_MODE",
        details: {
          message:
            securitySettings.maintenanceMessage ||
            maintenance?.value?.message ||
            "System is currently under maintenance.",
        },
      },
    });
  }
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
