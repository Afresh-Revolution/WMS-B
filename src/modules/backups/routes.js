const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const backupService = require("./service");

const backupsRouter = express.Router();

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

function notFound(res, code = "BACKUP_NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

backupsRouter.use(authenticate, requireRole("superadmin"));

backupsRouter.get("/", handle(async (req, res) => {
  const result = await backupService.listBackups(req.query);
  return send(res, "Backups loaded.", result.data, result.meta);
}));

backupsRouter.post("/", handle(async (req, res) => {
  const job = await backupService.queueManualBackup(req.body || {}, req);
  return res.status(202).json({ success: true, message: "Backup queued.", data: job, meta: {} });
}));

backupsRouter.get("/settings", handle(async (_req, res) => {
  return send(res, "Backup settings loaded.", await backupService.getSettings());
}));

backupsRouter.put("/settings", handle(async (req, res) => {
  return send(res, "Backup settings updated.", await backupService.updateSettings(req.body || {}, req));
}));

backupsRouter.get("/health", handle(async (_req, res) => {
  return send(res, "Backup health loaded.", await backupService.getBackupHealth());
}));

backupsRouter.get("/:id/status", handle(async (req, res) => {
  const status = await backupService.getStatus(req.params.id);
  return status ? send(res, "Backup status loaded.", status) : notFound(res);
}));

backupsRouter.get("/:id", handle(async (req, res) => {
  const backup = await backupService.getBackup(req.params.id);
  return backup ? send(res, "Backup loaded.", backup) : notFound(res);
}));

backupsRouter.post("/:id/restore", handle(async (req, res) => {
  const job = await backupService.queueRestore(req.params.id, req.body || {}, req);
  return job ? res.status(202).json({ success: true, message: "Backup restore queued.", data: job, meta: { confirmationRequired: true } }) : notFound(res);
}));

backupsRouter.delete("/:id", handle(async (req, res) => {
  const backup = await backupService.deleteBackup(req.params.id, req);
  return backup ? send(res, "Backup deleted.", backup) : notFound(res);
}));

module.exports = { backupsRouter };
