const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const systemHealthService = require("./service");

const systemHealthRouter = express.Router();

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

systemHealthRouter.use(authenticate, requireRole("superadmin"));

systemHealthRouter.get("/", handle(async (req, res) => {
  return send(res, "System health loaded.", await systemHealthService.getDashboard(req.query.range));
}));

systemHealthRouter.get("/services", handle(async (_req, res) => {
  return send(res, "Service health loaded.", await systemHealthService.listServices());
}));

systemHealthRouter.get("/infrastructure", handle(async (req, res) => {
  return send(res, "Infrastructure metrics loaded.", await systemHealthService.listInfrastructure(req.query.range));
}));

systemHealthRouter.get("/metrics", handle(async (req, res) => {
  return send(res, "API metrics loaded.", await systemHealthService.listApiMetrics(req.query.range));
}));

module.exports = { systemHealthRouter };
