const express = require("express");
const { authenticate } = require("../../auth/middleware");
const profileService = require("./service");

const profileRouter = express.Router();

function handle(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res, code = "SESSION_NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

profileRouter.use(authenticate);

profileRouter.get("/", handle(async (req, res) => {
  return send(res, "Profile loaded.", await profileService.getProfile(req.user.id, req.user));
}));

profileRouter.put("/", handle(async (req, res) => {
  return send(res, "Profile updated.", await profileService.updateProfile(req.user.id, req.body || {}, req));
}));

profileRouter.put("/password", handle(async (req, res) => {
  return send(res, "Password changed.", await profileService.changePassword(req.user.id, req.body || {}, req));
}));

profileRouter.post("/avatar", handle(async (req, res) => {
  return send(res, "Profile photo uploaded.", await profileService.uploadAvatar(req.user.id, req.body || {}, req));
}));

profileRouter.get("/sessions", handle((req, res) => {
  return send(res, "Profile sessions loaded.", profileService.listUserSessions(req.user.id));
}));

profileRouter.delete("/sessions/:id", handle(async (req, res) => {
  const session = await profileService.revokeOneUserSession(req.user.id, req.params.id, req);
  return session ? send(res, "Session terminated.", session) : notFound(res);
}));

profileRouter.delete("/sessions", handle(async (req, res) => {
  return send(res, "Sessions terminated.", await profileService.revokeAllUserSessions(req.user.id, req));
}));

profileRouter.get("/login-history", handle((req, res) => {
  const result = profileService.listLoginHistory(req.user.id, req.query);
  return send(res, "Login history loaded.", result.data, result.meta);
}));

profileRouter.post("/mfa/enable", handle(async (req, res) => {
  return send(res, "MFA enable challenge created.", await profileService.enableMfa(req.user.id, req));
}));

profileRouter.post("/mfa/disable", handle(async (req, res) => {
  return send(res, "MFA disabled.", await profileService.disableMfa(req.user.id, req.body || {}, req));
}));

profileRouter.post("/mfa/verify", handle(async (req, res) => {
  return send(res, "MFA verified.", await profileService.verifyMfa(req.user.id, req.body || {}, req));
}));

profileRouter.post("/mfa/backup-codes", handle(async (req, res) => {
  return send(res, "MFA backup codes regenerated.", await profileService.regenerateBackupCodes(req.user.id, req));
}));

module.exports = { profileRouter };
