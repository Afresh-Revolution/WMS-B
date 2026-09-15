const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-bills-module";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-bills-"));
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

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

test("runs bill lifecycle with calculated totals, duplicate protection, approval, payment, and accounting trace", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dueDate = isoDate(30);
  const scheduledPaymentDate = isoDate();
  const partialPaymentDate = isoDate();
  const finalPaymentDate = isoDate();
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const departmentResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Finance", code: "FIN-001", status: "active" }),
  });
  assert.equal(departmentResponse.status, 201);
  const department = await departmentResponse.json();

  const managerResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Amara",
        lastName: "Okafor",
        email: "amara.bills@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-BILL-001",
        jobTitle: "Finance Manager",
        departmentId: department.data.id,
        department: "Finance",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email: "amara.bills@example.com",
        initialPassword: "password123",
        role: "department_manager",
      },
    }),
  });
  assert.equal(managerResponse.status, 201);
  const manager = await managerResponse.json();
  const managerUser = getUserById(manager.data.userId);
  const managerHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(managerUser)}`,
  };

  const vendorResponse = await fetch(`${baseUrl}/api/v1/vendors`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "AWS Cloud Services",
      businessName: "AWS Cloud Services",
      email: "aws@example.com",
      status: "active",
    }),
  });
  assert.equal(vendorResponse.status, 201);
  const vendor = await vendorResponse.json();

  const createResponse = await fetch(`${baseUrl}/api/v1/bills`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      vendorId: vendor.data.id,
      invoiceNumber: "INV-2026-080",
      amount: 1,
      dueDate,
      category: "Utilities",
      departmentId: department.data.id,
      status: "PAID",
      paymentStatus: "PAID",
      approvalStatus: "APPROVED",
      items: [
        { description: "AWS Hosting", quantity: 1, unitPrice: 500000 },
        { description: "Database Service", quantity: 1, unitPrice: 200000 },
        { description: "Support", quantity: 1, unitPrice: 150000 },
      ],
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.data.reference, /^BILL-\d{4}$/);
  assert.equal(created.data.status, "SUBMITTED");
  assert.equal(created.data.paymentStatus, "UNPAID");
  assert.equal(created.data.approvalStatus, "PENDING");
  assert.equal(created.data.totalAmount, 850000);
  assert.equal(created.data.amountPaid, 0);
  assert.equal(created.data.amountDue, 850000);
  assert.equal(created.data.items.length, 3);
  assert.equal(created.data.items[0].total, 500000);

  const duplicateResponse = await fetch(`${baseUrl}/api/v1/bills`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      vendorId: vendor.data.id,
      invoiceNumber: "INV-2026-080",
      amount: 850000,
      dueDate,
      category: "Utilities",
    }),
  });
  assert.equal(duplicateResponse.status, 409);

  const selfApproveResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/approve`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({ comment: "Approving my own bill" }),
  });
  assert.equal(selfApproveResponse.status, 403);

  const firstApprovalResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/approve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ comment: "Department amount verified." }),
  });
  assert.equal(firstApprovalResponse.status, 200);
  const firstApproval = await firstApprovalResponse.json();
  assert.equal(firstApproval.data.status, "PENDING_APPROVAL");
  assert.equal(firstApproval.data.currentApprovalLevel, 2);

  const finalApprovalResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/approve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ comment: "Finance approved for payment." }),
  });
  assert.equal(finalApprovalResponse.status, 200);
  const finalApproval = await finalApprovalResponse.json();
  assert.equal(finalApproval.data.status, "APPROVED");
  assert.equal(finalApproval.data.approvalStatus, "APPROVED");

  const scheduleResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/schedule`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ scheduledPaymentDate }),
  });
  assert.equal(scheduleResponse.status, 200);
  const scheduled = await scheduleResponse.json();
  assert.equal(scheduled.data.status, "SCHEDULED");
  assert.equal(scheduled.data.scheduledPaymentDate, scheduledPaymentDate);

  const commentResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/comments`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({ comment: "Vendor invoice uploaded and checked." }),
  });
  assert.equal(commentResponse.status, 201);

  const attachmentResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/attachments`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      fileName: "aws-invoice.pdf",
      fileUrl: "https://example.com/aws-invoice.pdf",
      fileType: "application/pdf",
      fileSize: 2048,
    }),
  });
  assert.equal(attachmentResponse.status, 201);

  const partialPaymentResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/payments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      amount: 400000,
      transactionReference: "TXN-400",
      paymentDate: partialPaymentDate,
    }),
  });
  assert.equal(partialPaymentResponse.status, 201);
  const partialPayment = await partialPaymentResponse.json();
  assert.equal(partialPayment.data.status, "SUCCESSFUL");
  assert.equal(partialPayment.meta.bill.status, "PARTIALLY_PAID");
  assert.equal(partialPayment.meta.bill.paymentStatus, "PARTIALLY_PAID");
  assert.equal(partialPayment.meta.bill.amountDue, 450000);

  const overpayResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/payments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ amount: 500000, transactionReference: "TXN-OVERPAY" }),
  });
  assert.equal(overpayResponse.status, 409);

  const finalPaymentResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/payments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      amount: 450000,
      transactionReference: "TXN-450",
      paymentDate: finalPaymentDate,
    }),
  });
  assert.equal(finalPaymentResponse.status, 201);
  const finalPayment = await finalPaymentResponse.json();
  assert.equal(finalPayment.meta.bill.status, "PAID");
  assert.equal(finalPayment.meta.bill.paymentStatus, "PAID");
  assert.equal(finalPayment.meta.bill.amountDue, 0);

  const detailsResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}`, { headers: adminHeaders });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.payments.length, 2);
  assert.equal(details.data.comments.length, 1);
  assert.equal(details.data.attachments.length, 1);
  assert.ok(details.data.history.some((entry) => entry.action === "PAYMENT_COMPLETED"));

  const paymentsResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/payments`, { headers: adminHeaders });
  assert.equal(paymentsResponse.status, 200);
  const payments = await paymentsResponse.json();
  assert.equal(payments.data.length, 2);

  const historyResponse = await fetch(`${baseUrl}/api/v1/bills/${created.data.id}/history`, { headers: adminHeaders });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.ok(history.data.some((entry) => entry.action === "SCHEDULED"));

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/bills/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.outstandingAmount, 0);
  assert.equal(dashboard.data.paidThisMonth, 1);

  const reportsResponse = await fetch(`${baseUrl}/api/v1/bills/reports`, { headers: adminHeaders });
  assert.equal(reportsResponse.status, 200);
  const reports = await reportsResponse.json();
  assert.equal(reports.data.totalBills, 1);
  assert.equal(reports.data.totalPaid, 1);
  assert.equal(reports.data.totalPaidAmount, 850000);
  assert.equal(reports.data.vendorSpending[0].amount, 850000);

  const expenses = readCollection("expenses");
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].billId, created.data.id);
  assert.equal(expenses[0].amount, 850000);

  const auditLogs = readCollection("audit_logs");
  assert.ok(auditLogs.some((entry) => entry.action === "BILL_CREATED" && entry.module === "bills"));
  assert.ok(auditLogs.some((entry) => entry.action === "PAYMENT_COMPLETED" && entry.module === "bills"));
});
