const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-expenses";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-expenses-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

async function bootstrapSuperadmin(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main Admin",
      email: "admin@example.com",
      password: "password123",
      setupToken: "setup-token",
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function createStaff(baseUrl, headers, payload) {
  const response = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("runs expense claim lifecycle with ownership, policy checks, approvals, reimbursement, and audit trace", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const departmentResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Sales", code: "SALES-001", status: "active" }),
  });
  assert.equal(departmentResponse.status, 201);
  const department = await departmentResponse.json();

  const employee = await createStaff(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Nina",
      lastName: "Patel",
      email: "nina.expenses@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-EXP-001",
      jobTitle: "Account Executive",
      departmentId: department.data.id,
      department: "Sales",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "nina.expenses@example.com",
      initialPassword: "password123",
      role: "employee",
    },
  });
  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  const manager = await createStaff(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Maya",
      lastName: "Cole",
      email: "maya.expenses@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-EXP-002",
      jobTitle: "Sales Manager",
      departmentId: department.data.id,
      department: "Sales",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "maya.expenses@example.com",
      initialPassword: "password123",
      role: "department_manager",
    },
  });
  const managerUser = getUserById(manager.data.userId);
  const managerHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(managerUser)}`,
  };

  const spoofResponse = await fetch(`${baseUrl}/api/v1/expenses`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      employeeId: manager.data.id,
      description: "Spoofed employee claim",
      amount: 10000,
      expenseDate: "2026-07-25",
      category: "Meals",
    }),
  });
  assert.equal(spoofResponse.status, 403);

  const createResponse = await fetch(`${baseUrl}/api/v1/expenses`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      description: "Client dinner - Blue Table",
      amount: 1,
      expenseDate: "2026-07-25",
      category: "Meals",
      notes: "Client meeting and dinner.",
      status: "APPROVED",
      reimbursementStatus: "PAID",
      draft: true,
      items: [{ description: "Client dinner", quantity: 1, unitPrice: 48500 }],
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.data.reference, /^EXP-\d{4}$/);
  assert.equal(created.data.employeeId, employee.data.id);
  assert.equal(created.data.amount, 48500);
  assert.equal(created.data.originalAmount, 48500);
  assert.equal(created.data.status, "DRAFT");
  assert.equal(created.data.reimbursementStatus, "NOT_REQUIRED");
  assert.equal(created.data.items[0].total, 48500);

  const submitWithoutReceipt = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/submit`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ comment: "Please review." }),
  });
  assert.equal(submitWithoutReceipt.status, 409);

  const receiptResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/receipts`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      fileName: "client-dinner.png",
      fileUrl: "https://example.com/client-dinner.png",
      fileType: "image/png",
      fileSize: 2048,
      receiptNumber: "4458",
      receiptDate: "2026-07-25",
    }),
  });
  assert.equal(receiptResponse.status, 201);

  const submitResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/submit`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ comment: "Receipt uploaded." }),
  });
  assert.equal(submitResponse.status, 200);
  const submitted = await submitResponse.json();
  assert.equal(submitted.data.status, "SUBMITTED");
  assert.equal(submitted.data.currentApprovalLevel, 1);
  assert.equal(submitted.data.requiredApprovalLevels, 2);
  assert.equal(submitted.data.reimbursementStatus, "PENDING");

  const teamResponse = await fetch(`${baseUrl}/api/v1/expenses/team`, { headers: managerHeaders });
  assert.equal(teamResponse.status, 200);
  const team = await teamResponse.json();
  assert.equal(team.data.length, 1);
  assert.equal(team.data[0].id, created.data.id);

  const managerApprovalResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/approve`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({ comment: "Client meeting expense verified." }),
  });
  assert.equal(managerApprovalResponse.status, 200);
  const managerApproval = await managerApprovalResponse.json();
  assert.equal(managerApproval.data.status, "UNDER_REVIEW");
  assert.equal(managerApproval.data.currentApprovalLevel, 2);

  const adminApprovalResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/approve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      comment: "Finance approved adjusted reimbursement.",
      approvedAmount: 40000,
      adjustmentReason: "Alcohol line item is not reimbursable.",
    }),
  });
  assert.equal(adminApprovalResponse.status, 200);
  const adminApproval = await adminApprovalResponse.json();
  assert.equal(adminApproval.data.status, "APPROVED");
  assert.equal(adminApproval.data.approvalStatus, "APPROVED");
  assert.equal(adminApproval.data.originalAmount, 48500);
  assert.equal(adminApproval.data.approvedAmount, 40000);
  assert.equal(adminApproval.data.adjustmentReason, "Alcohol line item is not reimbursable.");

  const employeeReimburseResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/reimburse`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ amount: 40000, transactionReference: "SELF-PAY" }),
  });
  assert.equal(employeeReimburseResponse.status, 403);

  const overReimburseResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/reimburse`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ amount: 45000, transactionReference: "TXN-OVER" }),
  });
  assert.equal(overReimburseResponse.status, 409);

  const reimbursementResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/reimburse`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      amount: 40000,
      paymentMethod: "BANK_TRANSFER",
      transactionReference: "TXN-EXP-40000",
      paymentDate: "2026-08-13",
    }),
  });
  assert.equal(reimbursementResponse.status, 201);
  const reimbursement = await reimbursementResponse.json();
  assert.equal(reimbursement.data.status, "PAID");
  assert.equal(reimbursement.meta.expense.status, "COMPLETED");
  assert.equal(reimbursement.meta.expense.reimbursementStatus, "PAID");
  assert.equal(reimbursement.meta.expense.reimbursementAmount, 40000);

  const commentResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}/comments`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ comment: "Reimbursement received, thank you." }),
  });
  assert.equal(commentResponse.status, 201);

  const detailsResponse = await fetch(`${baseUrl}/api/v1/expenses/${created.data.id}`, { headers: employeeHeaders });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.receipts.length, 1);
  assert.equal(details.data.approvals.length, 2);
  assert.equal(details.data.reimbursements.length, 1);
  assert.ok(details.data.history.some((entry) => entry.action === "REIMBURSEMENT_PAID"));

  const myExpensesResponse = await fetch(`${baseUrl}/api/v1/expenses/me`, { headers: employeeHeaders });
  assert.equal(myExpensesResponse.status, 200);
  const myExpenses = await myExpensesResponse.json();
  assert.equal(myExpenses.data.length, 1);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/expenses/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.paid, 1);
  assert.equal(dashboard.data.totalClaims, 1);

  const reportsResponse = await fetch(`${baseUrl}/api/v1/expenses/reports`, { headers: adminHeaders });
  assert.equal(reportsResponse.status, 200);
  const reports = await reportsResponse.json();
  assert.equal(reports.data.totalExpenses, 1);
  assert.equal(reports.data.totalAmount, 48500);
  assert.equal(reports.data.reimbursements, 40000);
  assert.equal(reports.data.departmentSpending[0].amount, 48500);

  const exportResponse = await fetch(`${baseUrl}/api/v1/expenses/export`, { headers: adminHeaders });
  assert.equal(exportResponse.status, 200);
  const csv = await exportResponse.text();
  assert.match(csv, /EXP-\d{4}/);
  assert.match(csv, /Client dinner/);

  const policiesResponse = await fetch(`${baseUrl}/api/v1/expense-policies`, { headers: adminHeaders });
  assert.equal(policiesResponse.status, 200);
  const policies = await policiesResponse.json();
  assert.ok(policies.data.length > 0);

  const auditLogs = readCollection("audit_logs");
  assert.ok(auditLogs.some((entry) => entry.action === "EXPENSE_CREATED" && entry.module === "expenses"));
  assert.ok(auditLogs.some((entry) => entry.action === "REIMBURSEMENT_PAID" && entry.module === "expenses"));
});
