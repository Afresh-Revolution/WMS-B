const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-payroll";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-payroll-"));
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

test("calculates payroll runs, generates payslips, approves, pays, and locks without trusting frontend totals", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const employeeResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Nina",
        lastName: "Patel",
        email: "nina.payroll@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-PAY-001",
        jobTitle: "Software Engineer",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email: "nina.payroll@example.com",
        initialPassword: "password123",
        role: "employee",
      },
    }),
  });
  assert.equal(employeeResponse.status, 201);
  const employee = await employeeResponse.json();
  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  const structureResponse = await fetch(`${baseUrl}/api/v1/salaries/structures`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Junior Software Engineer",
      currency: "NGN",
      components: [
        { name: "Housing Allowance", code: "HOUSING", componentType: "EARNING", calculationType: "FIXED", defaultValue: 100000 },
        { name: "Transport Allowance", code: "TRANSPORT", componentType: "EARNING", calculationType: "FIXED", defaultValue: 50000 },
        { name: "Bonus", code: "BONUS", componentType: "EARNING", calculationType: "FIXED", defaultValue: 25000 },
      ],
    }),
  });
  assert.equal(structureResponse.status, 201);
  const structure = await structureResponse.json();

  const salaryResponse = await fetch(`${baseUrl}/api/v1/employees/${employee.data.id}/salary`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      salaryStructureId: structure.data.id,
      baseSalary: 500000,
      effectiveFrom: "2026-07-01",
      currency: "NGN",
      reason: "Promotion",
    }),
  });
  assert.equal(salaryResponse.status, 201);

  const deductionResponse = await fetch(`${baseUrl}/api/v1/employees/${employee.data.id}/deductions`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "PAYE and Pension",
      amount: 110000,
      category: "TAX",
      effectiveFrom: "2026-07-01",
    }),
  });
  assert.equal(deductionResponse.status, 201);

  const periodResponse = await fetch(`${baseUrl}/api/v1/payroll/periods`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "July 2026",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      payDate: "2026-07-28",
    }),
  });
  assert.equal(periodResponse.status, 201);
  const period = await periodResponse.json();

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/payroll/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.readiness, 100);
  assert.equal(dashboard.data.staffOnPayroll, 1);

  const runResponse = await fetch(`${baseUrl}/api/v1/payroll/runs`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      payrollPeriodId: period.data.id,
      grossAmount: 1,
      totalDeductions: 1,
      netAmount: 1,
      netSalary: 1,
    }),
  });
  assert.equal(runResponse.status, 201);
  const run = await runResponse.json();
  assert.equal(run.data.status, "PENDING_APPROVAL");
  assert.equal(run.data.employeeCount, 1);
  assert.equal(run.data.grossAmount, 675000);
  assert.equal(run.data.totalDeductions, 110000);
  assert.equal(run.data.netAmount, 565000);
  assert.equal(run.data.items[0].netSalary, 565000);

  const itemsResponse = await fetch(`${baseUrl}/api/v1/payroll/runs/${run.data.id}/items`, { headers: adminHeaders });
  assert.equal(itemsResponse.status, 200);
  const items = await itemsResponse.json();
  assert.equal(items.data.length, 1);

  const payslipsResponse = await fetch(`${baseUrl}/api/v1/payroll/payslips`, { headers: adminHeaders });
  assert.equal(payslipsResponse.status, 200);
  const payslips = await payslipsResponse.json();
  assert.equal(payslips.data.length, 1);
  assert.equal(payslips.data[0].netSalary, 565000);

  const ownPayslipsResponse = await fetch(`${baseUrl}/api/v1/employees/${employee.data.id}/payslips`, { headers: employeeHeaders });
  assert.equal(ownPayslipsResponse.status, 200);
  const ownPayslips = await ownPayslipsResponse.json();
  assert.equal(ownPayslips.data.length, 1);

  const approveResponse = await fetch(`${baseUrl}/api/v1/payroll/runs/${run.data.id}/approve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ comment: "Approved" }),
  });
  assert.equal(approveResponse.status, 200);
  const approved = await approveResponse.json();
  assert.equal(approved.data.status, "APPROVED");

  const paymentResponse = await fetch(`${baseUrl}/api/v1/payroll/runs/${run.data.id}/process-payment`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ paymentMethod: "MANUAL" }),
  });
  assert.equal(paymentResponse.status, 200);
  const paid = await paymentResponse.json();
  assert.equal(paid.data.status, "PAID");
  assert.equal(paid.meta.payments[0].amount, 565000);
  assert.equal(paid.meta.payments[0].status, "SUCCESS");

  const lockResponse = await fetch(`${baseUrl}/api/v1/payroll/runs/${run.data.id}/lock`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ reason: "Finalized July payroll" }),
  });
  assert.equal(lockResponse.status, 200);
  const locked = await lockResponse.json();
  assert.equal(locked.data.status, "LOCKED");

  const reportResponse = await fetch(`${baseUrl}/api/v1/payroll/reports`, { headers: adminHeaders });
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.data.netAmount, 565000);
  assert.equal(report.data.employeeCount, 1);
});
