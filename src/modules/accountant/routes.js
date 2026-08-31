const express = require("express");
const { authenticate } = require("../../auth/middleware");
const accountantService = require("./service");

const accountantRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function created(res, message, data, meta = {}) {
  return res.status(201).json({ success: true, message, data, meta });
}

function notFound(res, code = "RESOURCE_NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

function paged(res, message, result) {
  return send(res, message, result.data, result.meta);
}

function list(collection, message, permission) {
  return handle((req, res) => paged(res, message, accountantService.filterScoped(collection, req.user, req.query, permission)));
}

function get(collection, message, notFoundCode, permission) {
  return handle((req, res) => {
    const record = accountantService.findScopedRecord(collection, req.params.id, req.user, permission);
    return record ? send(res, message, record) : notFound(res, notFoundCode);
  });
}

accountantRouter.use(authenticate);

accountantRouter.get("/scope", handle((req, res) => send(res, "Accountant scope loaded.", accountantService.getScopeSummary(req.user))));
accountantRouter.get("/dashboard", handle((req, res) => send(res, "Accountant dashboard loaded.", accountantService.getDashboard(req.user, req.query))));
accountantRouter.get("/dashboard/stats", handle((req, res) => send(res, "Accountant dashboard stats loaded.", accountantService.getStats(req.user, req.query))));
accountantRouter.get("/profile", handle((req, res) => send(res, "Accountant profile loaded.", accountantService.getProfile(req.user))));
accountantRouter.patch("/profile", handle((req, res) => send(res, "Accountant profile updated.", accountantService.updateSelfEmploymentRecord(req.body || {}, req))));
accountantRouter.put("/profile", handle((req, res) => send(res, "Accountant profile updated.", accountantService.updateSelfEmploymentRecord(req.body || {}, req))));
accountantRouter.get("/employment-record", handle((req, res) => send(res, "Accountant employment record loaded.", accountantService.getSelfEmploymentRecord(req.user))));
accountantRouter.get("/employment-record/documents", handle((req, res) => send(res, "Accountant employment documents loaded.", accountantService.getSelfEmploymentRecord(req.user).documents || [])));
accountantRouter.patch("/employment-record", handle((req, res) => send(res, "Accountant employment record updated.", accountantService.updateSelfEmploymentRecord(req.body || {}, req))));
accountantRouter.put("/employment-record", handle((req, res) => send(res, "Accountant employment record updated.", accountantService.updateSelfEmploymentRecord(req.body || {}, req))));
accountantRouter.get("/settings", handle((req, res) => send(res, "Accountant settings loaded.", accountantService.getSettings(req.user))));
accountantRouter.patch("/settings", handle((req, res) => send(res, "Accountant settings updated.", accountantService.updateSettings(req.body || {}, req))));
accountantRouter.get("/help-center", handle((req, res) => send(res, "Accountant help center loaded.", accountantService.getHelpCenter(req.user))));

accountantRouter.get("/payroll", list("payroll", "Accountant payroll records loaded.", "payroll.view"));
accountantRouter.get("/payroll/dashboard", handle((req, res) => send(res, "Accountant payroll dashboard loaded.", accountantService.getDashboard(req.user, req.query).metrics)));
accountantRouter.get("/payroll/periods", list("payroll_periods", "Accountant payroll periods loaded.", "payroll.view"));
accountantRouter.get("/payroll/runs", list("payroll_runs", "Accountant payroll runs loaded.", "payroll.view"));
accountantRouter.get("/payroll/runs/:id", get("payroll_runs", "Accountant payroll run loaded.", "PAYROLL_RUN_NOT_FOUND", "payroll.view"));
accountantRouter.get("/payroll/runs/:id/items", handle((req, res) => {
  const run = accountantService.findScopedRecord("payroll_runs", req.params.id, req.user, "payroll.view");
  if (!run) return notFound(res, "PAYROLL_RUN_NOT_FOUND");
  const result = accountantService.filterScoped("payroll_run_items", req.user, { ...req.query, payrollRunId: req.params.id }, "payroll.view");
  return paged(res, "Accountant payroll run items loaded.", result);
}));
accountantRouter.get("/payroll/payments", handle((req, res) => paged(res, "Accountant payroll payments loaded.", accountantService.filterScoped("payroll_payments", req.user, req.query, "accountant.payments.view"))));
accountantRouter.get("/payroll/payslips", list("payslips", "Accountant payslips loaded.", "payroll.view_payslips"));
accountantRouter.get("/payroll/deductions", list("employee_deductions", "Accountant deductions loaded.", "payroll.manage_deductions"));
accountantRouter.post("/payroll/deductions", handle((req, res) => created(res, "Accountant deduction created.", accountantService.createScopedRecord("employee_deductions", req.body || {}, req, { permission: "payroll.manage_deductions", defaults: { status: "ACTIVE" }, auditAction: "ACCOUNTANT_DEDUCTION_CREATED" }))));
accountantRouter.patch("/payroll/deductions/:id", handle((req, res) => {
  const result = accountantService.writeScopedRecord("employee_deductions", req.params.id, req.body || {}, req, { permission: "payroll.manage_deductions", auditAction: "ACCOUNTANT_DEDUCTION_UPDATED" });
  return result ? send(res, "Accountant deduction updated.", result.record) : notFound(res, "DEDUCTION_NOT_FOUND");
}));

accountantRouter.get("/salary-implementations", list("salary_adjustments", "Accountant salary implementations loaded.", "salary_increments.view"));
accountantRouter.post("/salary-implementations", handle((req, res) => created(res, "Accountant salary implementation created.", accountantService.createScopedRecord("salary_adjustments", req.body || {}, req, { permission: "salary.update", defaults: { status: "PENDING_IMPLEMENTATION" }, auditAction: "ACCOUNTANT_SALARY_IMPLEMENTATION_CREATED" }))));
accountantRouter.patch("/salary-implementations/:id/implement", handle((req, res) => {
  const result = accountantService.writeScopedRecord("salary_adjustments", req.params.id, { ...(req.body || {}), status: "IMPLEMENTED", implementedAt: new Date().toISOString(), implementedBy: req.user.id }, req, { permission: "salary.update", auditAction: "ACCOUNTANT_SALARY_IMPLEMENTED" });
  return result ? send(res, "Accountant salary implementation completed.", result.record) : notFound(res, "SALARY_IMPLEMENTATION_NOT_FOUND");
}));

accountantRouter.get("/purchase-requests", list("purchase_requests", "Accountant purchase requests loaded.", "purchase_request.view"));
accountantRouter.get("/purchase-orders", list("purchase_orders", "Accountant purchase orders loaded.", "purchase_request.view"));
accountantRouter.post("/purchase-orders/:id/payments", handle((req, res) => {
  const payment = accountantService.recordSourcePayment("purchase_orders", req.params.id, req.body || {}, req, "PURCHASE_ORDER");
  return payment ? created(res, "Purchase order payment recorded.", payment) : notFound(res, "PURCHASE_ORDER_NOT_FOUND");
}));

accountantRouter.get("/bills", list("bills", "Accountant bills loaded.", "bill.view"));
accountantRouter.post("/bills", handle((req, res) => created(res, "Accountant bill created.", accountantService.createScopedRecord("bills", req.body || {}, req, { permission: "bill.create", defaults: { status: "DRAFT", paymentStatus: "UNPAID" }, auditAction: "ACCOUNTANT_BILL_CREATED" }))));
accountantRouter.get("/bills/:id", get("bills", "Accountant bill loaded.", "BILL_NOT_FOUND", "bill.view"));
accountantRouter.patch("/bills/:id", handle((req, res) => {
  const result = accountantService.writeScopedRecord("bills", req.params.id, req.body || {}, req, { permission: "bill.update", auditAction: "ACCOUNTANT_BILL_UPDATED" });
  return result ? send(res, "Accountant bill updated.", result.record) : notFound(res, "BILL_NOT_FOUND");
}));
accountantRouter.post("/bills/:id/payments", handle((req, res) => {
  const payment = accountantService.recordSourcePayment("bills", req.params.id, req.body || {}, req, "BILL");
  return payment ? created(res, "Bill payment recorded.", payment) : notFound(res, "BILL_NOT_FOUND");
}));

accountantRouter.get("/invoices", list("invoices", "Accountant invoices loaded.", "accountant.finance.view"));
accountantRouter.post("/invoices", handle((req, res) => created(res, "Accountant invoice created.", accountantService.createScopedRecord("invoices", req.body || {}, req, { permission: "accountant.finance.manage", defaults: { status: "OPEN", paymentStatus: "UNPAID" }, auditAction: "ACCOUNTANT_INVOICE_CREATED" }))));
accountantRouter.patch("/invoices/:id", handle((req, res) => {
  const result = accountantService.writeScopedRecord("invoices", req.params.id, req.body || {}, req, { permission: "accountant.finance.manage", auditAction: "ACCOUNTANT_INVOICE_UPDATED" });
  return result ? send(res, "Accountant invoice updated.", result.record) : notFound(res, "INVOICE_NOT_FOUND");
}));

accountantRouter.get("/expenses", list("expenses", "Accountant expenses loaded.", "expense.view"));
accountantRouter.post("/expenses/:id/reimburse", handle((req, res) => {
  const payment = accountantService.recordSourcePayment("expenses", req.params.id, req.body || {}, req, "EXPENSE_REIMBURSEMENT");
  return payment ? created(res, "Expense reimbursement recorded.", payment) : notFound(res, "EXPENSE_NOT_FOUND");
}));

accountantRouter.get("/vendors", list("vendors", "Accountant vendor directory loaded.", "accountant.vendors.view"));
accountantRouter.get("/vendors/:id", get("vendors", "Accountant vendor loaded.", "VENDOR_NOT_FOUND", "accountant.vendors.view"));

accountantRouter.get("/payments", handle((req, res) => paged(res, "Accountant payment register loaded.", accountantService.collectPayments(req.user, req.query))));
accountantRouter.post("/payments", handle((req, res) => created(res, "Accountant payment recorded.", accountantService.recordPayment(req.body || {}, req))));
accountantRouter.patch("/payments/:id/reconcile", handle((req, res) => {
  const result = accountantService.reconcilePayment(req.params.id, req.body || {}, req);
  return result ? send(res, "Accountant payment reconciled.", result.record) : notFound(res, "PAYMENT_NOT_FOUND");
}));
accountantRouter.get("/payments/export", handle((req, res) => {
  const csv = accountantService.exportPayments(req.user, req.query);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"accountant-payments.csv\"");
  return res.status(200).send(csv);
}));

accountantRouter.get("/reports", handle((req, res) => send(res, "Accountant reports loaded.", accountantService.getReports(req.user, req.query))));
accountantRouter.get("/reports/summary", handle((req, res) => send(res, "Accountant report summary loaded.", accountantService.getReports(req.user, req.query).summary)));
accountantRouter.get("/reports/export", handle((req, res) => {
  const csv = accountantService.exportPayments(req.user, req.query);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"accountant-report.csv\"");
  return res.status(200).send(csv);
}));

accountantRouter.get("/notifications", handle((req, res) => paged(res, "Accountant notifications loaded.", accountantService.listNotifications(req.user, req.query))));
accountantRouter.patch("/notifications/:id/read", handle((req, res) => {
  const notification = accountantService.markNotificationRead(req.params.id, req);
  return notification ? send(res, "Accountant notification marked as read.", notification) : notFound(res, "NOTIFICATION_NOT_FOUND");
}));
accountantRouter.get("/audit-logs", handle((req, res) => paged(res, "Accountant audit logs loaded.", accountantService.listAuditLogs(req.user, req.query))));

module.exports = { accountantRouter };
