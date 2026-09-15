const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const {
  createUserAccount,
  forcePasswordChange,
  getUserAccountDetail,
  getUserActivity,
  getUserLoginHistory,
  getUserSessions,
  getUserStatistics,
  listUserAccounts,
  resetUserPassword,
  revokeAllUserSessions,
  revokeUserSession,
  setAccountStatus,
  updateUserAccount,
} = require("./userAccessService");

const usersRouter = express.Router();

function authorize(permission) {
  return (req, res, next) => {
    if (req.user?.role === "superadmin" || hasPermission(req.user, permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "You do not have permission to perform this action",
      error: { code: "FORBIDDEN" },
    });
  };
}

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code: "USER_NOT_FOUND" },
  });
}

function sendResult(res, result, message) {
  if (!result) {
    return notFound(res);
  }

  return res.json({ success: true, message, data: result.user || result, meta: {} });
}

usersRouter.use(authenticate);

usersRouter.get("/statistics", authorize("users.view"), (req, res) => {
  return res.json({
    success: true,
    message: "User access statistics loaded.",
    data: getUserStatistics(),
    meta: {},
  });
});

usersRouter.get("/", authorize("users.view"), (req, res) => {
  const result = listUserAccounts(req.query);
  return res.json({
    success: true,
    message: "Users loaded.",
    data: result.data,
    meta: {
      ...result.meta,
      pagination: {
        page: result.meta.page,
        limit: result.meta.limit,
        total: result.meta.total,
        pages: result.meta.totalPages,
      },
    },
  });
});

usersRouter.post("/", authorize("users.create"), async (req, res, next) => {
  try {
    const result = await createUserAccount(req.body || {}, req.user, req);
    return res.status(201).json({
      success: true,
      message: "User created successfully.",
      data: result.user,
      meta: { provisioning: result.provisioning },
    });
  } catch (error) {
    return next(error);
  }
});

usersRouter.get("/:id", authorize("users.view"), (req, res) => {
  const detail = getUserAccountDetail(req.params.id);
  if (!detail) {
    return notFound(res);
  }

  return res.json({ success: true, message: "User detail loaded.", data: detail, meta: {} });
});

usersRouter.patch("/:id", authorize("users.update"), (req, res) => {
  return sendResult(res, updateUserAccount(req.params.id, req.body || {}, req.user, req), "User updated.");
});

usersRouter.put("/:id", authorize("users.update"), (req, res) => {
  return sendResult(res, updateUserAccount(req.params.id, req.body || {}, req.user, req), "User updated.");
});

usersRouter.delete("/:id", authorize("users.delete"), (req, res) => {
  return sendResult(
    res,
    setAccountStatus(req.params.id, "inactive", req.user, req, {
      action: "delete",
      auditAction: "USER_DEACTIVATED",
      reason: "Soft deleted through User Access.",
    }),
    "User deactivated."
  );
});

usersRouter.post("/:id/lock", authorize("users.lock"), (req, res) => {
  return sendResult(
    res,
    setAccountStatus(req.params.id, "locked", req.user, req, {
      action: "lock",
      auditAction: "USER_LOCKED",
      reason: req.body?.reason || "Account locked by administrator.",
      lockedUntil: req.body?.lockedUntil,
    }),
    "User locked."
  );
});

usersRouter.post("/:id/unlock", authorize("users.unlock"), (req, res) => {
  return sendResult(
    res,
    setAccountStatus(req.params.id, "active", req.user, req, {
      action: "unlock",
      auditAction: "USER_UNLOCKED",
      reason: req.body?.reason || "Account unlocked by administrator.",
    }),
    "User unlocked."
  );
});

usersRouter.post("/:id/deactivate", authorize("users.update"), (req, res) => {
  return sendResult(
    res,
    setAccountStatus(req.params.id, "inactive", req.user, req, {
      action: "deactivate",
      auditAction: "USER_DEACTIVATED",
      reason: req.body?.reason || "Account deactivated by administrator.",
    }),
    "User deactivated."
  );
});

usersRouter.post("/:id/reactivate", authorize("users.update"), (req, res) => {
  return sendResult(
    res,
    setAccountStatus(req.params.id, "active", req.user, req, {
      action: "reactivate",
      auditAction: "USER_REACTIVATED",
      reason: req.body?.reason || "Account reactivated by administrator.",
    }),
    "User reactivated."
  );
});

usersRouter.post("/:id/suspend", authorize("users.update"), (req, res) => {
  return sendResult(
    res,
    setAccountStatus(req.params.id, "suspended", req.user, req, {
      action: "suspend",
      auditAction: "USER_SUSPENDED",
      reason: req.body?.reason || "Account suspended by administrator.",
    }),
    "User suspended."
  );
});

usersRouter.post("/:id/reset-password", authorize("users.update"), (req, res) => {
  const result = resetUserPassword(req.params.id, req.body || {}, req.user, req);
  if (!result) {
    return notFound(res);
  }

  return res.json({
    success: true,
    message: "Password reset.",
    data: result.user,
    meta: { provisioning: result.provisioning },
  });
});

usersRouter.post("/:id/force-password-change", authorize("users.update"), (req, res) => {
  return sendResult(res, forcePasswordChange(req.params.id, req.user, req), "Password change required.");
});

usersRouter.post("/:id/revoke-sessions", authorize("users.update"), (req, res) => {
  const result = revokeAllUserSessions(req.params.id, req.user, req);
  if (!result) {
    return notFound(res);
  }

  return res.json({ success: true, message: "User sessions revoked.", data: result, meta: {} });
});

usersRouter.get("/:id/sessions", authorize("users.view"), (req, res) => {
  const result = getUserSessions(req.params.id, req.query);
  return res.json({ success: true, message: "User sessions loaded.", data: result.data, meta: result.meta });
});

usersRouter.delete("/:id/sessions/:sessionId", authorize("users.update"), (req, res) => {
  const result = revokeUserSession(req.params.id, req.params.sessionId, req.user, req);
  if (!result) {
    return notFound(res);
  }

  return res.json({ success: true, message: "Session revoked.", data: result, meta: {} });
});

usersRouter.get("/:id/login-history", authorize("users.view"), (req, res) => {
  const result = getUserLoginHistory(req.params.id, req.query);
  return res.json({ success: true, message: "User login history loaded.", data: result.data, meta: result.meta });
});

usersRouter.get("/:id/activity", authorize("users.view"), (req, res) => {
  const result = getUserActivity(req.params.id, req.query);
  return res.json({ success: true, message: "User activity loaded.", data: result.data, meta: result.meta });
});

module.exports = { usersRouter };
