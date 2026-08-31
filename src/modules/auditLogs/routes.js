const express = require("express");
const { authenticate } = require("../../auth/middleware");
const auditLogService = require("./service");

const auditLogsRouter = express.Router();

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function immutable(_req, res) {
  return res.status(405).json({
    success: false,
    message: "Operation failed",
    error: { code: "AUDIT_LOG_IMMUTABLE", details: { reason: "Operational audit logs are append-only." } },
  });
}

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code: "AUDIT_LOG_NOT_FOUND", details: {} },
  });
}

auditLogsRouter.use(authenticate);

auditLogsRouter.get(
  "/stats",
  handle((req, res) =>
    res.json({
      success: true,
      message: "Operational audit statistics loaded.",
      data: auditLogService.getAuditStats(req.user, req.query),
      meta: {},
    })
  )
);

auditLogsRouter.get(
  "/export",
  handle((req, res) => {
    const result = auditLogService.exportAuditLogs(req.user, req.query, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      requestId: req.id,
      sessionId: req.authSessionId,
    });
    if (result.format === "json") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("x-audit-export-event-id", result.auditEventId);
      return res.status(200).send(result.content);
    }
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="operational-audit-logs.${result.format}"`);
    res.setHeader("x-audit-export-event-id", result.auditEventId);
    return res.status(200).send(result.content);
  })
);

auditLogsRouter.get(
  "/",
  handle((req, res) => {
    const result = auditLogService.listAuditLogs(req.user, req.query);
    return res.json({
      success: true,
      message: "Operational audit logs loaded.",
      data: result.data,
      meta: { pagination: result.pagination, ...result.pagination },
    });
  })
);

auditLogsRouter.get(
  "/:id",
  handle((req, res) => {
    const log = auditLogService.getAuditLog(req.params.id, req.user);
    if (!log) {
      return notFound(res);
    }
    return res.json({ success: true, message: "Operational audit log loaded.", data: log, meta: {} });
  })
);

auditLogsRouter.put("/:id", immutable);
auditLogsRouter.patch("/:id", immutable);
auditLogsRouter.delete("/:id", immutable);
auditLogsRouter.post("/", immutable);

module.exports = { auditLogsRouter };
