const crypto = require("crypto");
const { getUserById, updateUser } = require("../../auth/userStore");
const { hasPermission } = require("../../constants/rbac");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");

const ACCOUNTANT_NAVIGATION = Object.freeze([
  "Overview",
  "Payroll",
  "Salary Implementation",
  "Purchase Orders",
  "Bills & Invoices",
  "Expenses",
  "Vendor Directory",
  "Payment Register",
  "Financial Reports",
  "Notifications",
  "Employment Record",
  "Settings",
  "Sign Out",
]);

const SEARCH_FIELDS = Object.freeze({
  payroll_runs: ["reference", "periodName", "status"],
  payroll_periods: ["name", "status"],
  payroll_payments: ["paymentReference", "paymentMethod", "status", "employeeName"],
  payroll: ["reference", "period", "status"],
  employee_salary_assignments: ["employeeName", "status", "currency"],
  salary_adjustments: ["employeeName", "adjustmentType", "status", "reason"],
  purchase_requests: ["title", "requestNumber", "vendorName", "status"],
  purchase_orders: ["orderNumber", "vendorName", "status"],
  bills: ["billNumber", "vendorName", "description", "status", "paymentStatus"],
  bill_payments: ["reference", "paymentMethod", "status"],
  invoices: ["invoiceNumber", "customerName", "status"],
  expenses: ["title", "employeeName", "category", "status", "reimbursementStatus"],
  expense_reimbursements: ["reference", "paymentMethod", "status"],
  vendors: ["name", "email", "phone", "category", "status"],
  payments: ["reference", "sourceType", "paymentMethod", "status", "payeeName"],
  notifications: ["title", "body", "type", "status"],
  operational_audit_logs: ["action", "module", "actorName", "targetType"],
});

const MONEY_FIELDS = ["amount", "totalAmount", "total_amount", "netAmount", "netSalary", "paidAmount", "balanceDue"];
const PAYMENT_COLLECTIONS = Object.freeze([
  ["payments", "GENERAL"],
  ["payroll_payments", "PAYROLL"],
  ["bill_payments", "BILL"],
  ["expense_reimbursements", "EXPENSE_REIMBURSEMENT"],
]);

function now() {
  return new Date().toISOString();
}

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function normalizeStatus(value, fallback = "PENDING") {
  return String(value || fallback).trim().toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt && !record.deleted_at && String(record.status || "").toLowerCase() !== "deleted");
}

function valueOf(record, keys) {
  for (const key of keys) {
    if (record && record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return null;
}

function getActorEmployee(user) {
  const { resolveEmployeeForUser } = require("../employees/employeeProfile");
  return resolveEmployeeForUser(user);
}

function getOrganizationId(user, employee = null) {
  return (
    user?.organizationId ||
    user?.organization_id ||
    user?.employerId ||
    user?.employer_id ||
    employee?.organizationId ||
    employee?.organization_id ||
    employee?.employerId ||
    employee?.employer_id ||
    null
  );
}

function getRecordOrganizationId(record) {
  return valueOf(record, ["organizationId", "organization_id", "employerId", "employer_id", "companyId", "company_id"]);
}

function organizationMatches(record, scope) {
  const recordOrgId = getRecordOrganizationId(record);
  return !scope.organizationId || !recordOrgId || String(recordOrgId) === String(scope.organizationId);
}

function assertAccountantAccess(user) {
  const role = normalizeRole(user?.role);
  if (role !== "accountant" && role !== "superadmin") {
    throw createHttpError(403, "Accountant access is required.", "ACCOUNTANT_ROLE_REQUIRED");
  }
}

function assertAccountantPermission(user, permission) {
  if (!permission || user?.role === "superadmin" || hasPermission(user, permission)) {
    return;
  }
  throw createHttpError(403, "You do not have permission to perform this Accountant action.", "FORBIDDEN", { permission });
}

function buildScope(user) {
  assertAccountantAccess(user);
  const accountantEmployee = getActorEmployee(user);
  return {
    user,
    organizationId: getOrganizationId(user, accountantEmployee),
    employee: accountantEmployee,
    employeeId: accountantEmployee?.id || user.employeeId || user.employee_id || null,
    identifiers: new Set([user?.id, user?.employeeId, user?.employee_id, accountantEmployee?.id, accountantEmployee?.employeeId, accountantEmployee?.employee_id].filter(Boolean)),
  };
}

function serializeScope(scope) {
  return {
    organizationId: scope.organizationId,
    employeeId: scope.employeeId,
    navigation: ACCOUNTANT_NAVIGATION,
  };
}

function filterScoped(collection, user, query = {}, permission = "accountant.finance.view") {
  const scope = buildScope(user);
  assertAccountantPermission(user, permission);
  const records = activeRecords(collection).filter((record) => organizationMatches(record, scope));
  const q = query.q || query.search;
  return paginate(applyBasicFilters(records, { ...query, q }, SEARCH_FIELDS[collection] || []), query);
}

function findScopedRecord(collection, id, user, permission = "accountant.finance.view") {
  const scope = buildScope(user);
  assertAccountantPermission(user, permission);
  return activeRecords(collection).find((record) => record.id === id && organizationMatches(record, scope)) || null;
}

function writeScopedRecord(collection, id, payload, req, options = {}) {
  const scope = buildScope(req.user);
  assertAccountantPermission(req.user, options.permission || "accountant.finance.manage");
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && organizationMatches(record, scope));
  if (index === -1) return null;

  const oldValues = records[index];
  const timestamp = now();
  records[index] = {
    ...records[index],
    ...payload,
    id: records[index].id,
    organizationId: records[index].organizationId || records[index].organization_id || scope.organizationId || null,
    organization_id: records[index].organization_id || records[index].organizationId || scope.organizationId || null,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  writeCollection(collection, records);
  audit(req, options.auditAction || "ACCOUNTANT_RECORD_UPDATED", collection, records[index], oldValues);
  return { oldValues, record: records[index] };
}

function createScopedRecord(collection, payload, req, options = {}) {
  const scope = buildScope(req.user);
  assertAccountantPermission(req.user, options.permission || "accountant.finance.manage");
  const timestamp = now();
  const record = appendRecord(collection, {
    id: crypto.randomUUID(),
    ...options.defaults,
    ...payload,
    organizationId: payload.organizationId || payload.organization_id || scope.organizationId || null,
    organization_id: payload.organization_id || payload.organizationId || scope.organizationId || null,
    createdBy: req.user.id,
    created_by: req.user.id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  });
  audit(req, options.auditAction || "ACCOUNTANT_RECORD_CREATED", collection, record);
  return record;
}

function audit(req, action, module, record, oldValue = null) {
  recordOperationalAudit({
    user: req.user,
    action,
    module,
    recordId: record?.id || req.params?.id || null,
    oldValue,
    newValue: record,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

function sum(records, fields = MONEY_FIELDS) {
  return records.reduce((total, record) => total + toNumber(valueOf(record, fields)), 0);
}

function countByStatus(records, statuses) {
  const allowed = new Set(statuses.map((status) => status.toUpperCase()));
  return records.filter((record) => allowed.has(normalizeStatus(record.status))).length;
}

function collectPayments(user, query = {}) {
  const scope = buildScope(user);
  assertAccountantPermission(user, "accountant.payments.view");
  const rows = PAYMENT_COLLECTIONS.flatMap(([collection, sourceType]) =>
    activeRecords(collection)
      .filter((record) => organizationMatches(record, scope))
      .map((record) => normalizePaymentRecord(record, sourceType, collection))
  );
  return paginate(applyBasicFilters(rows, { ...query, q: query.q || query.search }, SEARCH_FIELDS.payments), query);
}

function normalizePaymentRecord(record, sourceType, collection) {
  return {
    ...record,
    sourceType: record.sourceType || record.source_type || sourceType,
    source_type: record.source_type || record.sourceType || sourceType,
    sourceCollection: collection,
    source_collection: collection,
    amount: toNumber(valueOf(record, MONEY_FIELDS)),
    reference: record.reference || record.paymentReference || record.payment_reference || record.transactionReference || record.transaction_reference || null,
    paymentMethod: record.paymentMethod || record.payment_method || null,
    payment_method: record.payment_method || record.paymentMethod || null,
    payeeName: record.payeeName || record.payee_name || record.vendorName || record.vendor_name || record.employeeName || record.employee_name || null,
  };
}

function getDashboard(user, query = {}) {
  const scope = buildScope(user);
  assertAccountantPermission(user, "accountant.dashboard.view");
  const payrollRuns = activeRecords("payroll_runs").filter((record) => organizationMatches(record, scope));
  const payrollMirror = activeRecords("payroll").filter((record) => organizationMatches(record, scope));
  const purchases = activeRecords("purchase_requests").filter((record) => organizationMatches(record, scope));
  const purchaseOrders = activeRecords("purchase_orders").filter((record) => organizationMatches(record, scope));
  const bills = activeRecords("bills").filter((record) => organizationMatches(record, scope));
  const invoices = activeRecords("invoices").filter((record) => organizationMatches(record, scope));
  const expenses = activeRecords("expenses").filter((record) => organizationMatches(record, scope));
  const vendors = activeRecords("vendors").filter((record) => organizationMatches(record, scope));
  const payments = collectPayments(user, { limit: 100 }).data;

  return {
    scope: serializeScope(scope),
    period: query.period || "current",
    metrics: {
      pendingPayroll: countByStatus([...payrollRuns, ...payrollMirror], ["PENDING", "PENDING_APPROVAL", "PROCESSING"]),
      payrollTotal: sum([...payrollRuns, ...payrollMirror], ["netAmount", "netSalary", "net_salary"]),
      purchaseRequests: purchases.length,
      openPurchaseOrders: countByStatus(purchaseOrders, ["DRAFT", "ISSUED", "PENDING", "APPROVED"]),
      billsDue: bills.filter((bill) => ["UNPAID", "PARTIALLY_PAID", "OVERDUE"].includes(normalizeStatus(bill.paymentStatus || bill.payment_status || bill.status, "UNPAID"))).length,
      billsDueAmount: sum(bills, ["balanceDue", "balance_due", "totalAmount", "total_amount", "amount"]),
      invoicesOpen: invoices.filter((invoice) => !["PAID", "CANCELLED", "VOID"].includes(normalizeStatus(invoice.status, "OPEN"))).length,
      expenseClaims: expenses.length,
      reimbursableExpenses: expenses.filter((expense) => ["APPROVED", "REIMBURSEMENT_PENDING", "PENDING_REIMBURSEMENT"].includes(normalizeStatus(expense.status))).length,
      vendors: vendors.length,
      payments: payments.length,
      paymentVolume: sum(payments, ["amount"]),
      failedPayments: countByStatus(payments, ["FAILED"]),
    },
    queues: {
      payroll: payrollRuns.filter((run) => ["PENDING_APPROVAL", "APPROVED", "PAYMENT_PROCESSING", "FAILED"].includes(normalizeStatus(run.status))).slice(0, 10),
      bills: bills.filter((bill) => ["APPROVED", "SCHEDULED", "PARTIALLY_PAID", "OVERDUE"].includes(normalizeStatus(bill.status))).slice(0, 10),
      expenses: expenses.filter((expense) => ["APPROVED", "REIMBURSEMENT_PENDING", "PENDING_REIMBURSEMENT", "FAILED"].includes(normalizeStatus(expense.status))).slice(0, 10),
      purchases: purchases.filter((purchase) => ["APPROVED", "ORDERED", "RECEIVED", "PAYMENT_PENDING"].includes(normalizeStatus(purchase.status))).slice(0, 10),
    },
    reports: buildReportSummary(scope),
    navigation: ACCOUNTANT_NAVIGATION,
  };
}

function getStats(user, query = {}) {
  return getDashboard(user, query).metrics;
}

function getScopeSummary(user) {
  return serializeScope(buildScope(user));
}

function getSelfEmploymentRecord(user) {
  const scope = buildScope(user);
  const employee = scope.employee;
  return {
    user: getUserById(user.id),
    employee,
    documents: employee ? activeRecords("documents").filter((document) => (document.employeeId || document.employee_id) === employee.id) : [],
    salary: employee ? activeRecords("employee_salary_assignments").filter((assignment) => (assignment.employeeId || assignment.employee_id) === employee.id) : [],
    payments: employee ? collectPayments(user, { employeeId: employee.id, limit: 20 }).data : [],
  };
}

function updateSelfEmploymentRecord(payload, req) {
  const allowed = ["phone", "address", "profilePhoto", "profile_photo", "preferences", "emergencyContact", "emergency_contact"];
  const updates = Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.includes(key)));
  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, "No allowed employment record fields were provided.", "VALIDATION_ERROR");
  }
  const updated = updateUser(req.user.id, updates);
  audit(req, "ACCOUNTANT_SELF_PROFILE_UPDATED", "profile", updated);
  return updated;
}

function getProfile(user) {
  const scope = buildScope(user);
  return {
    ...user,
    employee: scope.employee,
    navigation: ACCOUNTANT_NAVIGATION,
  };
}

function getSettings(user) {
  buildScope(user);
  return {
    preferences: user.preferences || {},
    notificationPreferences: activeRecords("notification_preferences").find((record) => (record.userId || record.user_id) === user.id) || null,
  };
}

function updateSettings(payload, req) {
  assertAccountantAccess(req.user);
  return updateUser(req.user.id, { preferences: payload.preferences || payload });
}

function getHelpCenter(user) {
  buildScope(user);
  return {
    sections: [
      { title: "Payroll", routes: ["/api/v1/accountant/payroll/runs", "/api/v1/accountant/payroll/payments"] },
      { title: "Payments", routes: ["/api/v1/accountant/payments", "/api/v1/accountant/payments/export"] },
      { title: "Bills and expenses", routes: ["/api/v1/accountant/bills", "/api/v1/accountant/expenses"] },
      { title: "Reports", routes: ["/api/v1/accountant/reports", "/api/v1/accountant/reports/export"] },
    ],
  };
}

function recordPayment(payload, req) {
  const amount = toNumber(payload.amount);
  if (amount <= 0) {
    throw createHttpError(400, "Payment amount must be greater than zero.", "VALIDATION_ERROR");
  }
  return createScopedRecord("payments", {
    ...payload,
    amount,
    reference: payload.reference || `PAY-${Date.now()}`,
    status: normalizeStatus(payload.status, "SUCCESSFUL"),
    paymentDate: payload.paymentDate || payload.payment_date || now(),
    payment_date: payload.payment_date || payload.paymentDate || now(),
    reconciled: Boolean(payload.reconciled),
  }, req, { permission: "accountant.payments.create", auditAction: "ACCOUNTANT_PAYMENT_RECORDED" });
}

function reconcilePayment(id, payload, req) {
  const result = writeScopedRecord("payments", id, {
    ...payload,
    status: normalizeStatus(payload.status, "RECONCILED"),
    reconciled: true,
    reconciledAt: now(),
    reconciled_at: now(),
    reconciledBy: req.user.id,
    reconciled_by: req.user.id,
  }, req, { permission: "accountant.payments.reconcile", auditAction: "ACCOUNTANT_PAYMENT_RECONCILED" });
  return result;
}

function recordSourcePayment(collection, sourceId, payload, req, sourceType) {
  const source = findScopedRecord(collection, sourceId, req.user, "accountant.finance.manage");
  if (!source) return null;
  const payment = recordPayment({
    ...payload,
    sourceId,
    source_id: sourceId,
    sourceType,
    source_type: sourceType,
    vendorId: source.vendorId || source.vendor_id || payload.vendorId || payload.vendor_id || null,
    vendorName: source.vendorName || source.vendor_name || payload.vendorName || payload.vendor_name || null,
    amount: payload.amount || source.balanceDue || source.balance_due || source.amount || source.totalAmount || source.total_amount,
  }, req);
  const paidAmount = toNumber(source.paidAmount || source.paid_amount) + toNumber(payment.amount);
  const totalAmount = toNumber(source.totalAmount || source.total_amount || source.amount || source.balanceDue || source.balance_due);
  writeScopedRecord(collection, sourceId, {
    paidAmount,
    paid_amount: paidAmount,
    paymentStatus: totalAmount && paidAmount >= totalAmount ? "PAID" : "PARTIALLY_PAID",
    payment_status: totalAmount && paidAmount >= totalAmount ? "PAID" : "PARTIALLY_PAID",
  }, req, { permission: "accountant.finance.manage", auditAction: "ACCOUNTANT_SOURCE_PAYMENT_APPLIED" });
  return payment;
}

function buildReportSummary(scope) {
  const bills = activeRecords("bills").filter((record) => organizationMatches(record, scope));
  const expenses = activeRecords("expenses").filter((record) => organizationMatches(record, scope));
  const purchases = activeRecords("purchase_requests").filter((record) => organizationMatches(record, scope));
  const payroll = activeRecords("payroll").filter((record) => organizationMatches(record, scope));
  const payments = PAYMENT_COLLECTIONS.flatMap(([collection, sourceType]) =>
    activeRecords(collection).filter((record) => organizationMatches(record, scope)).map((record) => normalizePaymentRecord(record, sourceType, collection))
  );
  return {
    totals: {
      payroll: sum(payroll, ["netSalary", "net_salary", "netAmount"]),
      purchases: sum(purchases),
      bills: sum(bills),
      expenses: sum(expenses),
      payments: sum(payments, ["amount"]),
    },
    counts: {
      payroll: payroll.length,
      purchases: purchases.length,
      bills: bills.length,
      expenses: expenses.length,
      payments: payments.length,
    },
  };
}

function getReports(user, query = {}) {
  const scope = buildScope(user);
  assertAccountantPermission(user, "accountant.reports.view");
  return {
    scope: serializeScope(scope),
    period: query.period || "current",
    summary: buildReportSummary(scope),
    aging: {
      billsDue: activeRecords("bills").filter((bill) => organizationMatches(bill, scope) && normalizeStatus(bill.paymentStatus || bill.status, "UNPAID") !== "PAID").length,
      expensesPending: activeRecords("expenses").filter((expense) => organizationMatches(expense, scope) && !["PAID", "REIMBURSED", "CANCELLED"].includes(normalizeStatus(expense.reimbursementStatus || expense.status))).length,
    },
  };
}

function exportPayments(user, query = {}) {
  assertAccountantPermission(user, "accountant.payments.export");
  const rows = collectPayments(user, { ...query, limit: 100 }).data;
  const header = ["id", "sourceType", "reference", "payeeName", "amount", "paymentMethod", "status", "paymentDate"];
  return [
    header.join(","),
    ...rows.map((row) =>
      header.map((key) => JSON.stringify(row[key] ?? row[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ?? "")).join(",")
    ),
  ].join("\n");
}

function listNotifications(user, query = {}) {
  buildScope(user);
  const records = activeRecords("notifications").filter((record) => (record.userId || record.user_id || record.recipientUserId || record.recipient_user_id) === user.id);
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, SEARCH_FIELDS.notifications), query);
}

function markNotificationRead(id, req) {
  buildScope(req.user);
  const records = readCollection("notifications");
  const index = records.findIndex((record) => record.id === id && (record.userId || record.user_id || record.recipientUserId || record.recipient_user_id) === req.user.id);
  if (index === -1) return null;
  records[index] = { ...records[index], readAt: now(), read_at: now(), status: "read", updatedAt: now(), updated_at: now() };
  writeCollection("notifications", records);
  return records[index];
}

function listAuditLogs(user, query = {}) {
  const scope = buildScope(user);
  assertAccountantPermission(user, "audit_logs.view");
  const records = activeRecords("operational_audit_logs").filter((record) => {
    if (!organizationMatches(record, scope)) return false;
    const module = String(record.module || "").toLowerCase();
    return ["payroll", "bills", "expenses", "purchase", "procurement", "vendors", "payments", "finance"].some((key) => module.includes(key));
  });
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, SEARCH_FIELDS.operational_audit_logs), query);
}

module.exports = {
  ACCOUNTANT_NAVIGATION,
  buildScope,
  collectPayments,
  createScopedRecord,
  exportPayments,
  filterScoped,
  findScopedRecord,
  getDashboard,
  getHelpCenter,
  getProfile,
  getReports,
  getScopeSummary,
  getSelfEmploymentRecord,
  getSettings,
  getStats,
  listAuditLogs,
  listNotifications,
  markNotificationRead,
  reconcilePayment,
  recordPayment,
  recordSourcePayment,
  updateSelfEmploymentRecord,
  updateSettings,
  writeScopedRecord,
};
