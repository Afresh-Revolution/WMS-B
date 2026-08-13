const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { buildDashboardOverview } = require("./dashboardService");

const dashboardRouter = express.Router();

dashboardRouter.use(authenticate, requireRole("superadmin"));

dashboardRouter.get("/overview", (req, res) => {
  return res.json({
    success: true,
    message: "Super Admin dashboard overview loaded.",
    data: buildDashboardOverview(req.query),
    meta: {},
  });
});

module.exports = { dashboardRouter };
