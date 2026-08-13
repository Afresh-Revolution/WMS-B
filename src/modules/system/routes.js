const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { checkDatabaseConnection } = require("../../db");
const { readCollection } = require("../../database/jsonStore");
const { createRepository } = require("../../repositories/resourceRepository");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const { getSystemStatus } = require("../dashboard/dashboardService");

const systemRouter = express.Router();
const backupRepository = createRepository("backups", {
  searchableFields: ["backupId", "status", "storage", "createdBy"],
});

systemRouter.use(authenticate, requireRole("superadmin"));

systemRouter.get("/health", async (req, res) => {
  let database = null;
  if (process.env.DATABASE_URL) {
    try {
      database = { status: "healthy", checkedAt: (await checkDatabaseConnection()).now };
    } catch (error) {
      database = { status: "critical", error: error.message };
    }
  }

  return res.json({
    success: true,
    message: "System health loaded.",
    data: {
      ...getSystemStatus(),
      database,
      cpu: process.cpuUsage(),
      memory: process.memoryUsage(),
    },
    meta: {},
  });
});

systemRouter.get("/settings", (req, res) => {
  const settings = applyBasicFilters(readCollection("system_settings"), req.query, ["key", "section", "value"]);
  const result = paginate(settings, req.query);
  return res.json({ success: true, message: "System settings loaded.", data: result.data, meta: result.meta });
});

systemRouter.get("/backups", (req, res) => {
  const backups = applyBasicFilters(readCollection("backups"), req.query, ["backupId", "status", "storage"]);
  const result = paginate(backups, req.query);
  return res.json({ success: true, message: "Backups loaded.", data: result.data, meta: result.meta });
});

systemRouter.post("/backups", (req, res) => {
  const record = backupRepository.create(
    {
      ...req.body,
      backupId: req.body?.backupId || `backup-${Date.now()}`,
      status: req.body?.status || "pending",
      restoreRequiresConfirmation: true,
    },
    req.user.id
  );

  recordOperationalAudit({
    user: req.user,
    action: "Backup Created",
    module: "backups",
    recordId: record.id,
    newValue: record,
    ipAddress: req.ip,
  });

  return res.status(202).json({ success: true, message: "Backup queued.", data: record, meta: {} });
});

systemRouter.post("/backups/:id/restore", (req, res) => {
  if (req.body?.confirmation !== "RESTORE BACKUP") {
    return res.status(400).json({
      success: false,
      message: "Operation failed",
      error: {
        code: "RESTORE_CONFIRMATION_REQUIRED",
        details: { confirmation: "RESTORE BACKUP" },
      },
    });
  }

  const oldValue = backupRepository.getById(req.params.id);
  const record = backupRepository.update(req.params.id, {
    restoreRequestedAt: new Date().toISOString(),
    restoreRequestedBy: req.user.id,
    status: "restore_requested",
  });

  if (!record) {
    return res.status(404).json({ success: false, message: "Operation failed", error: { code: "NOT_FOUND" } });
  }

  recordOperationalAudit({
    user: req.user,
    action: "Backup Restore Requested",
    module: "backups",
    recordId: record.id,
    oldValue,
    newValue: record,
    ipAddress: req.ip,
  });

  return res.status(202).json({
    success: true,
    message: "Backup restore requires elevated operational approval and has been queued.",
    data: record,
    meta: { elevatedAuthorizationRequired: true },
  });
});

module.exports = { systemRouter };
