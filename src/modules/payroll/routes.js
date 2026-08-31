const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { PAYROLL_PERMISSIONS } = require("./constants");
const payrollService = require("./payroll.service");

const payrollRouter = express.Router();
const salariesRouter = express.Router();
const employeePayrollRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requirePayrollPermission(permission) {
  return (req, res, next) => {
    if (can(req.user, permission)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: "Operation failed",
      error: { code: "FORBIDDEN", details: {} },
    });
  };
}

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function notFound(res, code) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

function auditPayroll(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "payroll",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

payrollRouter.use(authenticate);
salariesRouter.use(authenticate);
employeePayrollRouter.use(authenticate);

payrollRouter.get(
  "/dashboard",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Payroll dashboard loaded.", data: payrollService.getDashboard(), meta: {} }))
);

payrollRouter.get(
  "/periods",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = payrollService.listPayrollPeriods(req.query);
    return res.json({ success: true, message: "Payroll periods loaded.", data: result.data, meta: result.meta });
  })
);

payrollRouter.post(
  "/periods",
  requirePayrollPermission(PAYROLL_PERMISSIONS.CREATE),
  handle((req, res) => {
    const period = payrollService.createPayrollPeriod(req.body || {}, req.user);
    auditPayroll(req, "PAYROLL_PERIOD_CREATED", { record: period });
    return res.status(201).json({ success: true, message: "Payroll period created.", data: period, meta: {} });
  })
);

payrollRouter.patch(
  "/periods/:id",
  requirePayrollPermission(PAYROLL_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const period = payrollService.updatePayrollPeriod(req.params.id, req.body || {}, req.user);
    if (!period) {
      return notFound(res, "PAYROLL_PERIOD_NOT_FOUND");
    }
    auditPayroll(req, "PAYROLL_PERIOD_UPDATED", { record: period });
    return res.json({ success: true, message: "Payroll period updated.", data: period, meta: {} });
  })
);

payrollRouter.get(
  "/runs",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = payrollService.listRuns(req.query);
    return res.json({ success: true, message: "Payroll runs loaded.", data: result.data, meta: result.meta });
  })
);

payrollRouter.post(
  "/runs",
  requirePayrollPermission(PAYROLL_PERMISSIONS.CALCULATE),
  handle((req, res) => {
    const result = payrollService.createPayrollRun(req.body || {}, req.user);
    auditPayroll(req, "PAYROLL_CALCULATED", result);
    return res.status(201).json({ success: true, message: "Payroll run calculated.", data: result.record, meta: { readiness: result.readiness } });
  })
);

payrollRouter.get(
  "/runs/:id",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Payroll run loaded.", data: payrollService.getRunDetails(req.params.id, req.user), meta: {} }))
);

payrollRouter.post(
  "/runs/:id/calculate",
  requirePayrollPermission(PAYROLL_PERMISSIONS.CALCULATE),
  handle((req, res) => {
    const result = payrollService.calculateRun(req.params.id, req.user);
    if (!result) {
      return notFound(res, "PAYROLL_RUN_NOT_FOUND");
    }
    return res.json({ success: true, message: "Payroll run calculation loaded.", data: result.record, meta: {} });
  })
);

payrollRouter.post(
  "/runs/:id/approve",
  requirePayrollPermission(PAYROLL_PERMISSIONS.APPROVE),
  handle((req, res) => {
    const result = payrollService.approveRun(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PAYROLL_RUN_NOT_FOUND");
    }
    auditPayroll(req, "PAYROLL_APPROVED", result);
    return res.json({ success: true, message: "Payroll run approved.", data: result.record, meta: {} });
  })
);

payrollRouter.post(
  "/runs/:id/reject",
  requirePayrollPermission(PAYROLL_PERMISSIONS.REJECT),
  handle((req, res) => {
    const result = payrollService.rejectRun(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PAYROLL_RUN_NOT_FOUND");
    }
    auditPayroll(req, "PAYROLL_REJECTED", result);
    return res.json({ success: true, message: "Payroll run rejected.", data: result.record, meta: {} });
  })
);

payrollRouter.post(
  "/runs/:id/process-payment",
  requirePayrollPermission(PAYROLL_PERMISSIONS.PROCESS_PAYMENT),
  handle(async (req, res) => {
    const result = await payrollService.processPayment(req.params.id, req.body || {}, req.user, req);
    if (!result) {
      return notFound(res, "PAYROLL_RUN_NOT_FOUND");
    }
    auditPayroll(req, "PAYMENT_COMPLETED", result);
    return res.json({ success: true, message: "Payroll payment processed.", data: result.record, meta: { payments: result.payments } });
  })
);

payrollRouter.post(
  "/runs/:id/lock",
  requirePayrollPermission(PAYROLL_PERMISSIONS.LOCK),
  handle((req, res) => {
    const result = payrollService.lockRun(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PAYROLL_RUN_NOT_FOUND");
    }
    auditPayroll(req, "PAYROLL_LOCKED", result);
    return res.json({ success: true, message: "Payroll run locked.", data: result.record, meta: {} });
  })
);

payrollRouter.post(
  "/runs/:id/cancel",
  requirePayrollPermission(PAYROLL_PERMISSIONS.CANCEL),
  handle((req, res) => {
    const result = payrollService.cancelRun(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PAYROLL_RUN_NOT_FOUND");
    }
    auditPayroll(req, "PAYROLL_CANCELLED", result);
    return res.json({ success: true, message: "Payroll run cancelled.", data: result.record, meta: {} });
  })
);

payrollRouter.get(
  "/runs/:id/items",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Payroll run items loaded.", data: payrollService.listRunItems(req.params.id, req.user), meta: {} }))
);

payrollRouter.get(
  "/payslips",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW_PAYSLIPS),
  handle((req, res) => {
    const result = payrollService.listPayslips(req.query, req.user);
    return res.json({ success: true, message: "Payslips loaded.", data: result.data, meta: result.meta });
  })
);

payrollRouter.get(
  "/payslips/:id",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW_PAYSLIPS),
  handle((req, res) => {
    const payslip = payrollService.getPayslip(req.params.id, req.user);
    if (!payslip) {
      return notFound(res, "PAYSLIP_NOT_FOUND");
    }
    return res.json({ success: true, message: "Payslip loaded.", data: payslip, meta: {} });
  })
);

payrollRouter.post(
  "/payslips/:id/generate",
  requirePayrollPermission(PAYROLL_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const payslip = payrollService.generatePayslip(req.params.id, req.user);
    if (!payslip) {
      return notFound(res, "PAYSLIP_NOT_FOUND");
    }
    auditPayroll(req, "PAYSLIP_GENERATED", { record: payslip });
    return res.json({ success: true, message: "Payslip generated.", data: payslip, meta: {} });
  })
);

payrollRouter.get(
  "/reports",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => res.json({ success: true, message: "Payroll reports loaded.", data: payrollService.getReports(req.user, req.query), meta: {} }))
);

payrollRouter.get(
  "/export",
  requirePayrollPermission(PAYROLL_PERMISSIONS.EXPORT),
  handle((req, res) => {
    const csv = payrollService.exportPayroll(req.user, req.query);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"payroll-export.csv\"");
    return res.send(csv);
  })
);

payrollRouter.get(
  "/deductions",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS),
  handle((req, res) => {
    const result = payrollService.listDeductions(req.query);
    return res.json({ success: true, message: "Payroll deductions loaded.", data: result.data, meta: result.meta });
  })
);

payrollRouter.post(
  "/deductions",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS),
  handle((req, res) => {
    const deduction = payrollService.createDeduction(req.body || {}, req.user);
    auditPayroll(req, "DEDUCTION_ADDED", { record: deduction });
    return res.status(201).json({ success: true, message: "Payroll deduction created.", data: deduction, meta: {} });
  })
);

payrollRouter.patch(
  "/deductions/:id",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS),
  handle((req, res) => {
    const deduction = payrollService.updateDeduction(req.params.id, req.body || {}, req.user);
    if (!deduction) {
      return notFound(res, "DEDUCTION_NOT_FOUND");
    }
    auditPayroll(req, "DEDUCTION_UPDATED", { record: deduction });
    return res.json({ success: true, message: "Payroll deduction updated.", data: deduction, meta: {} });
  })
);

salariesRouter.get(
  "/structures",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = payrollService.listSalaryStructures(req.query);
    return res.json({ success: true, message: "Salary structures loaded.", data: result.data, meta: result.meta });
  })
);

salariesRouter.post(
  "/structures",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_SALARY),
  handle((req, res) => {
    const structure = payrollService.createSalaryStructure(req.body || {}, req.user);
    auditPayroll(req, "SALARY_STRUCTURE_CREATED", { record: structure });
    return res.status(201).json({ success: true, message: "Salary structure created.", data: structure, meta: {} });
  })
);

salariesRouter.patch(
  "/structures/:id",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_SALARY),
  handle((req, res) => {
    const structure = payrollService.updateSalaryStructure(req.params.id, req.body || {}, req.user);
    if (!structure) {
      return notFound(res, "SALARY_STRUCTURE_NOT_FOUND");
    }
    auditPayroll(req, "SALARY_STRUCTURE_UPDATED", { record: structure });
    return res.json({ success: true, message: "Salary structure updated.", data: structure, meta: {} });
  })
);

employeePayrollRouter.get(
  "/:id/salary",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW_PAYSLIPS),
  handle((req, res) => res.json({ success: true, message: "Employee salary loaded.", data: payrollService.getEmployeeSalary(req.params.id, req.user), meta: {} }))
);

employeePayrollRouter.post(
  "/:id/salary",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_SALARY),
  handle((req, res) => {
    const assignment = payrollService.assignEmployeeSalary(req.params.id, req.body || {}, req.user);
    auditPayroll(req, "SALARY_CHANGED", { record: assignment });
    return res.status(201).json({ success: true, message: "Employee salary assigned.", data: assignment, meta: {} });
  })
);

employeePayrollRouter.get(
  "/:id/salary-history",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW_PAYSLIPS),
  handle((req, res) => res.json({ success: true, message: "Employee salary history loaded.", data: payrollService.getEmployeeSalary(req.params.id, req.user).history, meta: {} }))
);

employeePayrollRouter.get(
  "/:id/payslips",
  requirePayrollPermission(PAYROLL_PERMISSIONS.VIEW_PAYSLIPS),
  handle((req, res) => {
    const result = payrollService.listPayslips({ ...req.query, employeeId: req.params.id }, req.user);
    return res.json({ success: true, message: "Employee payslips loaded.", data: result.data, meta: result.meta });
  })
);

employeePayrollRouter.post(
  "/:id/deductions",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS),
  handle((req, res) => {
    const deduction = payrollService.addEmployeeDeduction(req.params.id, req.body || {}, req.user);
    auditPayroll(req, "DEDUCTION_ADDED", { record: deduction });
    return res.status(201).json({ success: true, message: "Employee deduction added.", data: deduction, meta: {} });
  })
);

employeePayrollRouter.delete(
  "/:id/deductions/:deductionId",
  requirePayrollPermission(PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS),
  handle((req, res) => {
    const deduction = payrollService.removeEmployeeDeduction(req.params.id, req.params.deductionId, req.user);
    if (!deduction) {
      return notFound(res, "EMPLOYEE_DEDUCTION_NOT_FOUND");
    }
    auditPayroll(req, "DEDUCTION_REMOVED", { record: deduction });
    return res.json({ success: true, message: "Employee deduction removed.", data: deduction, meta: {} });
  })
);

module.exports = { employeePayrollRouter, payrollRouter, salariesRouter };
