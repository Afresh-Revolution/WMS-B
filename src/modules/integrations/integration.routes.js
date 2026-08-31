const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const service = require("./integration.service");

const integrationsRouter = express.Router();
const paystackPaymentsRouter = express.Router();
const paystackWebhookRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission) || hasPermission(user, "integrations.manage");
}

function requireIntegrationPermission(permission) {
  return (req, res, next) => {
    if (can(req.user, permission)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: "Access denied.",
      error: { code: "ACCESS_DENIED", details: {} },
    });
  };
}

integrationsRouter.get(
  "/:provider/callback",
  handle(async (req, res) => {
    const data = await service.handleOAuthCallback(req.params.provider, req.query, req);
    return send(res, "Integration connected successfully.", data);
  })
);

integrationsRouter.use(authenticate);

integrationsRouter.get(
  "/",
  requireIntegrationPermission(service.INTEGRATION_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = service.listIntegrations(req.query);
    return send(res, "Integrations loaded.", result.data, result.meta);
  })
);

integrationsRouter.get(
  "/logs",
  requireIntegrationPermission(service.INTEGRATION_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = service.listIntegrationLogs(req.query);
    return send(res, "Integration logs loaded.", result.data, result.meta);
  })
);

integrationsRouter.get(
  "/:provider",
  requireIntegrationPermission(service.INTEGRATION_PERMISSIONS.VIEW),
  handle((req, res) => send(res, "Integration loaded.", service.getIntegration(req.params.provider)))
);

integrationsRouter.post(
  "/:provider/connect",
  handle(async (req, res) => {
    const data = await service.connectIntegration(req.params.provider, req.body || {}, req);
    return send(res, data.authUrl ? "Integration authorization URL created." : "Integration connected successfully.", data);
  })
);

integrationsRouter.post(
  "/:provider/disconnect",
  handle(async (req, res) => send(res, "Integration disconnected successfully.", await service.disconnectIntegration(req.params.provider, req)))
);

integrationsRouter.post(
  "/:provider/test",
  handle(async (req, res) => {
    const data = await service.testIntegration(req.params.provider, req);
    return res.status(data.status === "active" ? 200 : 502).json({
      success: data.status === "active",
      provider: data.provider,
      status: data.status,
      message: data.message,
      data,
      meta: {},
    });
  })
);

integrationsRouter.put(
  "/:provider/config",
  handle((req, res) => send(res, "Integration configuration updated.", service.updateIntegrationConfig(req.params.provider, req.body || {}, req)))
);

integrationsRouter.post(
  "/slack/message",
  handle(async (req, res) => send(res, "Slack message sent.", await service.sendSlackMessage(req.body || {}, req)))
);

integrationsRouter.post(
  "/slack/announcement",
  handle(async (req, res) => send(res, "Slack announcement sent.", await service.sendSlackAnnouncement(req.body || {}, req)))
);

integrationsRouter.post(
  "/google_workspace/calendar/events",
  handle(async (req, res) => {
    const data = await service.createGoogleCalendarEvent(req.body || {}, req);
    return res.status(201).json({ success: true, message: "Google Calendar event created.", data, meta: {} });
  })
);

integrationsRouter.put(
  "/google_workspace/calendar/events/:id",
  handle(async (req, res) => send(res, "Google Calendar event updated.", await service.updateGoogleCalendarEvent(req.params.id, req.body || {}, req)))
);

integrationsRouter.delete(
  "/google_workspace/calendar/events/:id",
  handle(async (req, res) => send(res, "Google Calendar event deleted.", await service.deleteGoogleCalendarEvent(req.params.id, req.body || {}, req)))
);

integrationsRouter.post(
  "/zoom/meetings",
  handle(async (req, res) => {
    const data = await service.createZoomMeeting(req.body || {}, req);
    return res.status(201).json({ success: true, message: "Zoom meeting created.", data, meta: {} });
  })
);

integrationsRouter.put(
  "/zoom/meetings/:id",
  handle(async (req, res) => send(res, "Zoom meeting updated.", await service.updateZoomMeeting(req.params.id, req.body || {}, req)))
);

integrationsRouter.delete(
  "/zoom/meetings/:id",
  handle(async (req, res) => send(res, "Zoom meeting deleted.", await service.deleteZoomMeeting(req.params.id, req)))
);

paystackPaymentsRouter.use(authenticate);

paystackPaymentsRouter.post(
  "/initialize",
  handle(async (req, res) => {
    const data = await service.initializePaystackPayment(req.body || {}, req);
    return res.status(201).json({ success: true, message: "Paystack payment initialized.", data, meta: {} });
  })
);

paystackPaymentsRouter.get(
  "/verify/:reference",
  handle(async (req, res) => send(res, "Paystack payment verified.", await service.verifyPaystackPayment(req.params.reference, req)))
);

paystackPaymentsRouter.post(
  "/transfer",
  handle(async (req, res) => {
    const data = await service.createPaystackTransfer(req.body || {}, req);
    return res.status(201).json({ success: true, message: "Paystack transfer created.", data, meta: {} });
  })
);

paystackWebhookRouter.post(
  "/paystack",
  handle(async (req, res) => send(res, "Paystack webhook processed.", await service.handlePaystackWebhook(req)))
);

module.exports = { integrationsRouter, paystackPaymentsRouter, paystackWebhookRouter };
