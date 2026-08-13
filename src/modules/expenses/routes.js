const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { EXPENSE_PERMISSIONS } = require("./constants");
const expenseService = require("./expense.service");

const expensesRouter = express.Router();
const expensePoliciesRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireExpensePermission(permission) {
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

function notFound(res, code = "EXPENSE_NOT_FOUND") {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

function auditExpense(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "expenses",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

expensesRouter.use(authenticate);
expensePoliciesRouter.use(authenticate);

expensesRouter.get(
  "/dashboard",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Expenses dashboard loaded.", data: expenseService.getDashboard(req.user), meta: {} }))
);

expensesRouter.get(
  "/reports",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Expense reports loaded.", data: expenseService.getReports(req.user, req.query), meta: {} }))
);

expensesRouter.get(
  "/export",
  requireExpensePermission(EXPENSE_PERMISSIONS.EXPORT),
  handle((req, res) => {
    const csv = expenseService.exportExpenses(req.user, req.query);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"expenses.csv\"");
    return res.status(200).send(csv);
  })
);

expensesRouter.get(
  "/categories",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = expenseService.listCategories(req.query);
    return res.json({ success: true, message: "Expense categories loaded.", data: result.data, meta: result.meta });
  })
);

expensesRouter.get(
  "/me",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = expenseService.listMyExpenses(req.user, req.query);
    return res.json({ success: true, message: "My expenses loaded.", data: result.data, meta: result.meta });
  })
);

expensesRouter.get(
  "/team",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW_TEAM),
  handle((req, res) => {
    const result = expenseService.listTeamExpenses(req.user, req.query);
    return res.json({ success: true, message: "Team expenses loaded.", data: result.data, meta: result.meta });
  })
);

expensesRouter.post(
  "/",
  requireExpensePermission(EXPENSE_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = expenseService.createExpense(req.body || {}, req.user);
    auditExpense(req, "EXPENSE_CREATED", result);
    return res.status(201).json({ success: true, message: "Expense created.", data: result.record, meta: {} });
  })
);

expensesRouter.get(
  "/",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = expenseService.listExpenses(req.user, req.query);
    return res.json({ success: true, message: "Expenses loaded.", data: result.data, meta: result.meta });
  })
);

expensesRouter.get(
  "/:id",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Expense loaded.", data: expenseService.getExpenseDetails(req.params.id, req.user), meta: {} }))
);

expensesRouter.patch(
  "/:id",
  requireExpensePermission(EXPENSE_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = expenseService.updateExpense(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditExpense(req, "EXPENSE_UPDATED", result);
    return res.json({ success: true, message: "Expense updated.", data: result.record, meta: {} });
  })
);

expensesRouter.post(
  "/:id/submit",
  requireExpensePermission(EXPENSE_PERMISSIONS.SUBMIT),
  handle((req, res) => {
    const result = expenseService.submitExpense(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditExpense(req, "EXPENSE_SUBMITTED", result);
    return res.json({ success: true, message: "Expense submitted.", data: result.record, meta: {} });
  })
);

expensesRouter.post(
  "/:id/approve",
  requireExpensePermission(EXPENSE_PERMISSIONS.APPROVE),
  handle((req, res) => {
    const result = expenseService.approveExpense(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditExpense(req, result.record.adjustedBy === req.user.id ? "EXPENSE_ADJUSTED" : "EXPENSE_APPROVED", result);
    return res.json({ success: true, message: "Expense approved.", data: result.record, meta: {} });
  })
);

expensesRouter.post(
  "/:id/reject",
  requireExpensePermission(EXPENSE_PERMISSIONS.REJECT),
  handle((req, res) => {
    const result = expenseService.rejectExpense(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditExpense(req, "EXPENSE_REJECTED", result);
    return res.json({ success: true, message: "Expense rejected.", data: result.record, meta: {} });
  })
);

expensesRouter.post(
  "/:id/cancel",
  requireExpensePermission(EXPENSE_PERMISSIONS.CANCEL),
  handle((req, res) => {
    const result = expenseService.cancelExpense(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditExpense(req, "EXPENSE_CANCELLED", result);
    return res.json({ success: true, message: "Expense cancelled.", data: result.record, meta: {} });
  })
);

expensesRouter.post(
  "/:id/comments",
  requireExpensePermission(EXPENSE_PERMISSIONS.COMMENT),
  handle((req, res) => {
    const comment = expenseService.addComment(req.params.id, req.body || {}, req.user);
    if (!comment) {
      return notFound(res);
    }
    auditExpense(req, "EXPENSE_COMMENT_ADDED", comment);
    return res.status(201).json({ success: true, message: "Expense comment added.", data: comment, meta: {} });
  })
);

expensesRouter.post(
  "/:id/receipts",
  requireExpensePermission(EXPENSE_PERMISSIONS.UPLOAD_RECEIPT),
  handle((req, res) => {
    const receipt = expenseService.addReceipt(req.params.id, req.body || {}, req.user);
    if (!receipt) {
      return notFound(res);
    }
    auditExpense(req, "EXPENSE_RECEIPT_UPLOADED", receipt);
    return res.status(201).json({ success: true, message: "Expense receipt uploaded.", data: receipt, meta: {} });
  })
);

expensesRouter.post(
  "/:id/reimburse",
  requireExpensePermission(EXPENSE_PERMISSIONS.REIMBURSE),
  handle((req, res) => {
    const result = expenseService.processReimbursement(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditExpense(req, result.reimbursement.status === "FAILED" ? "REIMBURSEMENT_FAILED" : result.record.reimbursementStatus === "PAID" ? "REIMBURSEMENT_PAID" : "REIMBURSEMENT_PROCESSING", result);
    return res.status(201).json({ success: true, message: "Expense reimbursement processed.", data: result.reimbursement, meta: { expense: result.record } });
  })
);

expensesRouter.get(
  "/:id/reimbursements",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const expense = expenseService.getExpenseDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Expense reimbursements loaded.", data: expense.reimbursements, meta: { expenseId: expense.id } });
  })
);

expensesRouter.get(
  "/:id/history",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const expense = expenseService.getExpenseDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Expense history loaded.", data: expense.history, meta: { expenseId: expense.id } });
  })
);

expensePoliciesRouter.get(
  "/",
  requireExpensePermission(EXPENSE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = expenseService.listPolicies(req.user, req.query);
    return res.json({ success: true, message: "Expense policies loaded.", data: result.data, meta: result.meta });
  })
);

expensePoliciesRouter.post(
  "/",
  requireExpensePermission(EXPENSE_PERMISSIONS.MANAGE_POLICIES),
  handle((req, res) => {
    const result = expenseService.createPolicy(req.body || {}, req.user);
    auditExpense(req, "EXPENSE_POLICY_CREATED", result);
    return res.status(201).json({ success: true, message: "Expense policy created.", data: result.record, meta: {} });
  })
);

expensePoliciesRouter.patch(
  "/:id",
  requireExpensePermission(EXPENSE_PERMISSIONS.MANAGE_POLICIES),
  handle((req, res) => {
    const result = expenseService.updatePolicy(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "EXPENSE_POLICY_NOT_FOUND");
    }
    auditExpense(req, "EXPENSE_POLICY_UPDATED", result);
    return res.json({ success: true, message: "Expense policy updated.", data: result.record, meta: {} });
  })
);

module.exports = { expensePoliciesRouter, expensesRouter };
