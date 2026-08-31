const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const technicalAuditService = require("./service");

const technicalAuditRouter = express.Router();

function handle(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function notFound(res) {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code: "TECHNICAL_AUDIT_LOG_NOT_FOUND", details: {} } });
}

technicalAuditRouter.use(authenticate, requireRole("superadmin"));

technicalAuditRouter.get("/", handle(async (req, res) => {
  const result = await technicalAuditService.listLogs(req.user, req.query);
  return res.json({ success: true, message: "Technical audit logs loaded.", data: result.data, meta: result.meta });
}));

technicalAuditRouter.get("/search", handle(async (req, res) => {
  const result = await technicalAuditService.searchLogs(req.user, req.query);
  return res.json({ success: true, message: "Technical audit search loaded.", data: result.data, meta: result.meta });
}));

technicalAuditRouter.get("/export", handle(async (req, res) => {
  const exportResult = await technicalAuditService.exportLogs(req.user, req.query, {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestMethod: req.method,
    requestPath: req.originalUrl,
  });
  res.setHeader("content-type", exportResult.contentType);
  res.setHeader("content-disposition", `attachment; filename="${exportResult.filename}"`);
  return res.status(200).send(exportResult.content);
}));

technicalAuditRouter.get("/:id", handle(async (req, res) => {
  const log = await technicalAuditService.getLog(req.params.id, req.user);
  return log ? res.json({ success: true, message: "Technical audit log loaded.", data: log, meta: {} }) : notFound(res);
}));

module.exports = { technicalAuditRouter };
