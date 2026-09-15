const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { getLookups } = require("./catalog");

const lookupsRouter = express.Router();

lookupsRouter.use(authenticate);

lookupsRouter.get("/", (_req, res) => {
  return res.json({
    success: true,
    message: "Lookups loaded.",
    data: getLookups(),
    meta: {},
  });
});

lookupsRouter.get("/departments", (_req, res) => {
  return res.json({
    success: true,
    message: "Departments loaded.",
    data: getLookups().departments,
    meta: {},
  });
});

lookupsRouter.get("/employment-types", (_req, res) => {
  return res.json({
    success: true,
    message: "Employment types loaded.",
    data: getLookups().employmentTypes,
    meta: {},
  });
});

module.exports = { lookupsRouter };
