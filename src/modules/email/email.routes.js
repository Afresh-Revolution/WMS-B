const express = require("express");
const { authenticate, requirePermission } = require("../../auth/middleware");
const emailService = require("./email.service");

const emailConfigRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

emailConfigRouter.use(authenticate);

emailConfigRouter.get(
  "/",
  requirePermission(emailService.EMAIL_PERMISSIONS.VIEW),
  handle((req, res) => send(res, "Email configuration loaded.", emailService.getCurrentConfiguration(req.user)))
);

emailConfigRouter.put(
  "/",
  requirePermission(emailService.EMAIL_PERMISSIONS.UPDATE),
  handle((req, res) => send(res, "Email configuration updated.", emailService.updateConfiguration(req.body || {}, req)))
);

emailConfigRouter.patch(
  "/",
  requirePermission(emailService.EMAIL_PERMISSIONS.UPDATE),
  handle((req, res) => send(res, "Email configuration updated.", emailService.updateConfiguration(req.body || {}, req)))
);

emailConfigRouter.post(
  "/test",
  requirePermission(emailService.EMAIL_PERMISSIONS.TEST),
  handle(async (req, res) => {
    const result = await emailService.sendTestEmail(req.body || {}, req);
    return res.status(result.status === "SUCCESS" ? 200 : 503).json({
      success: result.status === "SUCCESS",
      message: result.message,
      data: result,
      meta: {},
    });
  })
);

emailConfigRouter.post(
  "/check",
  requirePermission(emailService.EMAIL_PERMISSIONS.TEST),
  handle(async (req, res) => send(res, "Email service status checked.", await emailService.checkConfiguration(req)))
);

emailConfigRouter.patch(
  "/status",
  requirePermission(emailService.EMAIL_PERMISSIONS.UPDATE),
  handle((req, res) => send(res, "Email service status updated.", emailService.setStatus(req.body || {}, req)))
);

emailConfigRouter.get(
  "/templates",
  requirePermission(emailService.EMAIL_PERMISSIONS.TEMPLATES),
  handle((req, res) => {
    const result = emailService.listTemplates(req.query, req.user);
    return send(res, "Email templates loaded.", result.data, result.meta);
  })
);

emailConfigRouter.post(
  "/templates",
  requirePermission(emailService.EMAIL_PERMISSIONS.TEMPLATES),
  handle((req, res) => res.status(201).json({ success: true, message: "Email template created.", data: emailService.upsertTemplate(req.body || {}, req), meta: {} }))
);

emailConfigRouter.put(
  "/templates/:id",
  requirePermission(emailService.EMAIL_PERMISSIONS.TEMPLATES),
  handle((req, res) => send(res, "Email template updated.", emailService.upsertTemplate(req.body || {}, req, req.params.id)))
);

emailConfigRouter.get(
  "/logs",
  requirePermission(emailService.EMAIL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = emailService.listLogs(req.query, req.user);
    return send(res, "Email logs loaded.", result.data, result.meta);
  })
);

emailConfigRouter.get(
  "/queue",
  requirePermission(emailService.EMAIL_PERMISSIONS.VIEW),
  handle((_req, res) => send(res, "Email queue status loaded.", emailService.getQueueStats()))
);

emailConfigRouter.post(
  "/queue/process",
  requirePermission(emailService.EMAIL_PERMISSIONS.MANAGE),
  handle(async (req, res) => send(res, "Email queue processed.", await emailService.processQueue(Number(req.body?.limit || 25), req)))
);

module.exports = { emailConfigRouter };
