const express = require("express");
const { authenticate } = require("../../auth/middleware");
const hrService = require("../hr/hr.service");

const salaryIncrementsRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Salary increment not found.",
    error: { code: "SALARY_INCREMENT_NOT_FOUND", details: {} },
  });
}

salaryIncrementsRouter.use(authenticate);

salaryIncrementsRouter.get("/", handle((req, res) => {
  const result = hrService.listSalaryAdjustments(req.query, req.user);
  return send(res, "Salary increments loaded.", result.data, result.meta);
}));

salaryIncrementsRouter.post("/", handle((req, res) => {
  const record = hrService.createSalaryAdjustment(req.body || {}, req);
  return res.status(201).json({ success: true, message: "Salary increment recommendation created.", data: record, meta: {} });
}));

salaryIncrementsRouter.get("/:id", handle((req, res) => {
  const result = hrService.listSalaryAdjustments({ ...req.query, limit: 500 }, req.user);
  const record = result.data.find((item) => item.id === req.params.id);
  return record ? send(res, "Salary increment loaded.", record) : notFound(res);
}));

function approve(req, res) {
  const result = hrService.approveSalaryAdjustment(req.params.id, req.body || {}, req);
  return result ? send(res, "Salary increment approved.", result.record) : notFound(res);
}

function reject(req, res) {
  const result = hrService.rejectSalaryAdjustment(req.params.id, req.body || {}, req);
  return result ? send(res, "Salary increment rejected.", result.record) : notFound(res);
}

salaryIncrementsRouter.patch("/:id/approve", handle(approve));
salaryIncrementsRouter.post("/:id/approve", handle(approve));
salaryIncrementsRouter.patch("/:id/reject", handle(reject));
salaryIncrementsRouter.post("/:id/reject", handle(reject));

module.exports = { salaryIncrementsRouter };
