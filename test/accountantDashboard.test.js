const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-accountant-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { hashPassword } = require("../src/auth/passwords");
const { createUser } = require("../src/auth/userStore");
const { writeCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-accountant-"));
  process.env.DATA_DIR = dataDir;
  seedData();
  const app = createApp();
  const server = app.listen(0);
  t.after(() => {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function seedData() {
  createUser({
    name: "Ada Accountant",
    email: "accountant@example.com",
    passwordHash: hashPassword("password123"),
    role: "accountant",
    organizationId: "org-1",
    employeeId: "employee-accountant",
    permissions: [],
  });
  createUser({
    name: "Manny Manager",
    email: "manager@example.com",
    passwordHash: hashPassword("password123"),
    role: "manager",
    organizationId: "org-1",
    permissions: [],
  });

  writeCollection("employees", [
    { id: "employee-accountant", fullName: "Ada Accountant", email: "accountant@example.com", organizationId: "org-1", status: "active" },
  ]);
  writeCollection("payroll_runs", [
    { id: "run-1", reference: "PAY-2026-08", status: "PENDING_APPROVAL", netAmount: 1000000, organizationId: "org-1", createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "run-other", reference: "PAY-OTHER", status: "PENDING_APPROVAL", netAmount: 9999999, organizationId: "org-2", createdAt: "2026-08-01T00:00:00.000Z" },
  ]);
  writeCollection("payroll", [
    { id: "run-1", reference: "PAY-2026-08", status: "PENDING", netSalary: 1000000, organizationId: "org-1", createdAt: "2026-08-01T00:00:00.000Z" },
  ]);
  writeCollection("payroll_run_items", [
    { id: "item-1", payrollRunId: "run-1", employeeId: "employee-1", employeeName: "Employee One", netSalary: 250000, organizationId: "org-1", createdAt: "2026-08-01T00:00:00.000Z" },
  ]);
  writeCollection("payroll_payments", [
    { id: "payroll-payment-1", payrollRunId: "run-1", paymentReference: "PR-1", employeeName: "Employee One", amount: 250000, status: "SUCCESS", organizationId: "org-1", createdAt: "2026-08-02T00:00:00.000Z" },
  ]);
  writeCollection("purchase_requests", [
    { id: "purchase-1", title: "Laptop refresh", requestNumber: "REQ-1", amount: 400000, status: "APPROVED", organizationId: "org-1", createdAt: "2026-08-03T00:00:00.000Z" },
  ]);
  writeCollection("purchase_orders", [
    { id: "po-1", orderNumber: "PO-1", vendorName: "Tech Vendor", totalAmount: 400000, paidAmount: 0, status: "APPROVED", organizationId: "org-1", createdAt: "2026-08-04T00:00:00.000Z" },
  ]);
  writeCollection("bills", [
    { id: "bill-1", billNumber: "BILL-1", vendorName: "Power Co", totalAmount: 150000, paidAmount: 0, paymentStatus: "UNPAID", status: "APPROVED", organizationId: "org-1", createdAt: "2026-08-05T00:00:00.000Z" },
  ]);
  writeCollection("expenses", [
    { id: "expense-1", title: "Travel reimbursement", amount: 45000, status: "APPROVED", reimbursementStatus: "PENDING", organizationId: "org-1", createdAt: "2026-08-06T00:00:00.000Z" },
  ]);
  writeCollection("vendors", [
    { id: "vendor-1", name: "Power Co", status: "ACTIVE", organizationId: "org-1", createdAt: "2026-08-07T00:00:00.000Z" },
  ]);
  writeCollection("payments", [
    { id: "payment-1", reference: "PAY-1", sourceType: "BILL", payeeName: "Power Co", amount: 50000, status: "SUCCESSFUL", organizationId: "org-1", createdAt: "2026-08-08T00:00:00.000Z" },
    { id: "payment-other", reference: "PAY-OTHER", sourceType: "BILL", payeeName: "Other Org", amount: 999999, status: "SUCCESSFUL", organizationId: "org-2", createdAt: "2026-08-08T00:00:00.000Z" },
  ]);
  writeCollection("notifications", [
    { id: "notification-1", userId: "placeholder", title: "Payment failed", status: "unread", createdAt: "2026-08-09T00:00:00.000Z" },
  ]);
}

async function login(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  return {
    user: body.user,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${body.token}`,
    },
  };
}

test("accountant dashboard exposes scoped finance workflows and payment actions", async (t) => {
  const baseUrl = createTestApp(t);
  const accountant = await login(baseUrl, "accountant@example.com");

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/accountant/dashboard`, { headers: accountant.headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.scope.organizationId, "org-1");
  assert.equal(dashboard.data.metrics.pendingPayroll, 2);
  assert.equal(dashboard.data.metrics.purchaseRequests, 1);
  assert.equal(dashboard.data.metrics.vendors, 1);
  assert.equal(dashboard.data.metrics.paymentVolume, 300000);
  assert.ok(dashboard.data.navigation.includes("Payment Register"));

  const paymentsResponse = await fetch(`${baseUrl}/api/v1/accountant/payments`, { headers: accountant.headers });
  assert.equal(paymentsResponse.status, 200);
  const payments = await paymentsResponse.json();
  assert.equal(payments.data.length, 2);
  assert.ok(payments.data.every((payment) => payment.organizationId === "org-1"));

  const createPaymentResponse = await fetch(`${baseUrl}/api/v1/accountant/payments`, {
    method: "POST",
    headers: accountant.headers,
    body: JSON.stringify({ reference: "PAY-2", sourceType: "GENERAL", payeeName: "Tax Authority", amount: 75000, paymentMethod: "BANK_TRANSFER" }),
  });
  assert.equal(createPaymentResponse.status, 201);
  const createdPayment = await createPaymentResponse.json();
  assert.equal(createdPayment.data.organizationId, "org-1");

  const reconcileResponse = await fetch(`${baseUrl}/api/v1/accountant/payments/${createdPayment.data.id}/reconcile`, {
    method: "PATCH",
    headers: accountant.headers,
    body: JSON.stringify({ note: "Matched bank statement" }),
  });
  assert.equal(reconcileResponse.status, 200);
  const reconciled = await reconcileResponse.json();
  assert.equal(reconciled.data.reconciled, true);
  assert.equal(reconciled.data.status, "RECONCILED");

  const billPaymentResponse = await fetch(`${baseUrl}/api/v1/accountant/bills/bill-1/payments`, {
    method: "POST",
    headers: accountant.headers,
    body: JSON.stringify({ reference: "BILL-PAY-1", amount: 150000, paymentMethod: "BANK_TRANSFER" }),
  });
  assert.equal(billPaymentResponse.status, 201);
  const billResponse = await fetch(`${baseUrl}/api/v1/accountant/bills/bill-1`, { headers: accountant.headers });
  const bill = await billResponse.json();
  assert.equal(bill.data.paymentStatus, "PAID");

  const exportResponse = await fetch(`${baseUrl}/api/v1/accountant/payments/export`, { headers: accountant.headers });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type"), /text\/csv/);
  assert.match(await exportResponse.text(), /PAY-2/);

  const legacyResponse = await fetch(`${baseUrl}/api/accountant/dashboard`, { headers: accountant.headers });
  assert.equal(legacyResponse.status, 200);
});

test("accountant endpoints reject non-accountant users", async (t) => {
  const baseUrl = createTestApp(t);
  const manager = await login(baseUrl, "manager@example.com");

  const response = await fetch(`${baseUrl}/api/v1/accountant/dashboard`, { headers: manager.headers });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "ACCOUNTANT_ROLE_REQUIRED");
});
