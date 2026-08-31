const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-reports";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { appendRecord, readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-reports-"));
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

async function createDepartment(baseUrl, headers, name, code) {
  const response = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, code, status: "active" }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function createEmployee(baseUrl, headers, body) {
  const response = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  return response.json();
}

function id() {
  return crypto.randomUUID();
}

function seedOperationalData({ finance, operations, employee, secondEmployee }) {
  appendRecord("attendance", {
    id: id(),
    employeeId: employee.id,
    departmentId: finance.id,
    date: "2026-08-10",
    status: "present",
    createdAt: "2026-08-10T08:00:00.000Z",
  });
  appendRecord("attendance", {
    id: id(),
    employeeId: secondEmployee.id,
    departmentId: operations.id,
    date: "2026-08-10",
    status: "absent",
    createdAt: "2026-08-10T08:00:00.000Z",
  });
  appendRecord("leave_requests", {
    id: id(),
    employeeId: employee.id,
    departmentId: finance.id,
    leaveType: "Annual",
    status: "approved",
    durationDays: 5,
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  appendRecord("leave_requests", {
    id: id(),
    employeeId: secondEmployee.id,
    departmentId: operations.id,
    leaveType: "Sick",
    status: "pending",
    durationDays: 2,
    createdAt: "2026-08-02T00:00:00.000Z",
  });
  appendRecord("payslips", {
    id: id(),
    employeeId: employee.id,
    departmentId: finance.id,
    grossSalary: 700000,
    totalDeductions: 100000,
    netSalary: 600000,
    status: "paid",
    payDate: "2026-08-31",
    createdAt: "2026-08-31T00:00:00.000Z",
  });
  appendRecord("tasks", {
    id: id(),
    employeeId: employee.id,
    departmentId: finance.id,
    title: "Close monthly books",
    status: "completed",
    dueDate: "2026-08-20",
    createdAt: "2026-08-05T00:00:00.000Z",
  });
  appendRecord("tasks", {
    id: id(),
    employeeId: secondEmployee.id,
    departmentId: operations.id,
    title: "Review SOP",
    status: "open",
    dueDate: "2020-01-01",
    createdAt: "2026-08-05T00:00:00.000Z",
  });
  appendRecord("targets", {
    id: id(),
    employeeId: employee.id,
    departmentId: finance.id,
    title: "Revenue collections",
    status: "completed",
    progress: 100,
    dueDate: "2026-08-25",
    createdAt: "2026-08-05T00:00:00.000Z",
  });
  appendRecord("targets", {
    id: id(),
    employeeId: secondEmployee.id,
    departmentId: operations.id,
    title: "Process efficiency",
    status: "active",
    progress: 60,
    dueDate: "2026-09-01",
    createdAt: "2026-08-05T00:00:00.000Z",
  });
  appendRecord("expenses", {
    id: id(),
    employeeId: employee.id,
    departmentId: finance.id,
    categoryName: "Travel",
    amount: 50000,
    totalAmount: 50000,
    status: "approved",
    expenseDate: "2026-08-12",
    createdAt: "2026-08-12T00:00:00.000Z",
  });
  appendRecord("purchase_requests", {
    id: id(),
    departmentId: operations.id,
    departmentName: "Operations",
    estimatedAmount: 120000,
    status: "approved",
    createdAt: "2026-08-13T00:00:00.000Z",
  });
  const vendorId = id();
  appendRecord("vendors", {
    id: vendorId,
    name: "Stationery Hub",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  appendRecord("purchase_orders", {
    id: id(),
    vendorId,
    vendorName: "Stationery Hub",
    total: 120000,
    status: "delivered",
    createdAt: "2026-08-14T00:00:00.000Z",
  });
  appendRecord("bills", {
    id: id(),
    vendorId,
    vendorName: "Stationery Hub",
    categoryName: "Office Supplies",
    totalAmount: 120000,
    amountPaid: 80000,
    amountDue: 40000,
    status: "approved",
    paymentStatus: "partial",
    dueDate: "2020-01-01",
    createdAt: "2026-08-15T00:00:00.000Z",
  });
  appendRecord("nysc_intern_profiles", {
    id: id(),
    profileNumber: "NYSC-2026-0001",
    fullName: "Ife Okoro",
    type: "NYSC",
    institution: "Covenant University",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  appendRecord("placements", {
    id: id(),
    profileId: "NYSC-2026-0001",
    departmentId: operations.id,
    placementStatus: "ENDING_SOON",
    placementProgress: 80,
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  const caseId = id();
  appendRecord("disciplinary_cases", {
    id: caseId,
    employeeId: secondEmployee.id,
    departmentId: operations.id,
    status: "open",
    incidentDate: "2026-08-03",
    createdAt: "2026-08-03T00:00:00.000Z",
  });
  appendRecord("disciplinary_actions", {
    id: id(),
    caseId,
    employeeId: secondEmployee.id,
    departmentId: operations.id,
    actionType: "warning",
    status: "active",
    createdAt: "2026-08-04T00:00:00.000Z",
  });
  appendRecord("meetings", {
    id: id(),
    departmentId: finance.id,
    title: "Finance weekly sync",
    status: "completed",
    startDate: "2026-08-11T09:00:00.000Z",
    createdAt: "2026-08-11T00:00:00.000Z",
  });
  appendRecord("meeting_attendance", {
    id: id(),
    meetingId: "meeting-1",
    userId: employee.userId,
    status: "PRESENT",
    createdAt: "2026-08-11T00:00:00.000Z",
  });
  const eventId = id();
  appendRecord("events", {
    id: eventId,
    title: "Town Hall",
    status: "completed",
    startDate: "2026-08-18T10:00:00.000Z",
    createdAt: "2026-08-18T00:00:00.000Z",
  });
  appendRecord("event_attendees", {
    id: id(),
    eventId,
    userId: employee.userId,
    status: "ATTENDED",
    invitedAt: "2026-08-17T00:00:00.000Z",
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  const announcementId = id();
  appendRecord("announcements", {
    id: announcementId,
    title: "Payroll Processing",
    message: "Payroll is processing.",
    category: "Finance",
    status: "published",
    priority: "important",
    createdAt: "2026-08-13T00:00:00.000Z",
  });
  appendRecord("announcement_recipients", {
    id: id(),
    announcementId,
    employeeId: employee.id,
    userId: employee.userId,
    deliveredAt: "2026-08-13T00:00:00.000Z",
    isRead: true,
    readAt: "2026-08-13T01:00:00.000Z",
    createdAt: "2026-08-13T00:00:00.000Z",
  });
  appendRecord("announcement_recipients", {
    id: id(),
    announcementId,
    employeeId: secondEmployee.id,
    userId: secondEmployee.userId,
    deliveredAt: "2026-08-13T00:00:00.000Z",
    isRead: false,
    readAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
  });
}

test("aggregates reports from operational modules, protects sensitive views, saves reports, and records exports", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const finance = await createDepartment(baseUrl, adminHeaders, "Finance", "FIN-REP-001");
  const operations = await createDepartment(baseUrl, adminHeaders, "Operations", "OPS-REP-001");
  const employee = await createEmployee(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Ada",
      lastName: "Report",
      email: "ada.reports@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-REP-001",
      jobTitle: "Accountant",
      departmentId: finance.data.id,
      department: "Finance",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "ada.reports@example.com",
      initialPassword: "password123",
      role: "employee",
    },
  });
  const secondEmployee = await createEmployee(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Bola",
      lastName: "Report",
      email: "bola.reports@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-REP-002",
      jobTitle: "Operations Analyst",
      departmentId: operations.data.id,
      department: "Operations",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "bola.reports@example.com",
      initialPassword: "password123",
      role: "employee",
    },
  });
  seedOperationalData({
    finance: finance.data,
    operations: operations.data,
    employee: employee.data,
    secondEmployee: secondEmployee.data,
  });

  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  const unauthorizedPayrollResponse = await fetch(`${baseUrl}/api/v1/reports/payroll`, { headers: employeeHeaders });
  assert.equal(unauthorizedPayrollResponse.status, 403);

  const overviewResponse = await fetch(`${baseUrl}/api/v1/reports/overview`, { headers: adminHeaders });
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.data.totalHeadcount, 2);
  assert.equal(overview.data.averageAttendance, 50);
  assert.equal(overview.data.reportAccuracy, 100);

  const headcountResponse = await fetch(`${baseUrl}/api/v1/reports/headcount`, { headers: adminHeaders });
  assert.equal(headcountResponse.status, 200);
  const headcount = await headcountResponse.json();
  assert.equal(headcount.data.total, 2);
  assert.equal(headcount.data.active, 2);
  assert.equal(headcount.data.byDepartment.length, 2);

  const attendanceResponse = await fetch(`${baseUrl}/api/v1/reports/attendance?startDate=2026-08-01&endDate=2026-08-31`, {
    headers: adminHeaders,
  });
  assert.equal(attendanceResponse.status, 200);
  const attendance = await attendanceResponse.json();
  assert.equal(attendance.data.averageAttendance, 50);
  assert.equal(attendance.data.data[0].attendanceRate, 50);

  const payrollResponse = await fetch(`${baseUrl}/api/v1/reports/payroll`, { headers: adminHeaders });
  assert.equal(payrollResponse.status, 200);
  const payroll = await payrollResponse.json();
  assert.equal(payroll.data.grossPay, 700000);
  assert.equal(payroll.data.deductions, 100000);
  assert.equal(payroll.data.netPay, 600000);
  assert.equal(payroll.data.staffPaid, 1);

  const targetsResponse = await fetch(`${baseUrl}/api/v1/reports/targets`, { headers: adminHeaders });
  assert.equal(targetsResponse.status, 200);
  const targets = await targetsResponse.json();
  assert.equal(targets.data.totalTargets, 2);
  assert.equal(targets.data.achievementRate, 80);

  const expensesResponse = await fetch(`${baseUrl}/api/v1/reports/expenses`, { headers: adminHeaders });
  assert.equal(expensesResponse.status, 200);
  const expenses = await expensesResponse.json();
  assert.equal(expenses.data.total, 50000);
  assert.equal(expenses.data.approved, 50000);

  const purchasesResponse = await fetch(`${baseUrl}/api/v1/reports/purchases`, { headers: adminHeaders });
  assert.equal(purchasesResponse.status, 200);
  const purchases = await purchasesResponse.json();
  assert.equal(purchases.data.totalRequests, 1);
  assert.equal(purchases.data.totalPurchaseValue, 240000);

  const billsResponse = await fetch(`${baseUrl}/api/v1/reports/bills`, { headers: adminHeaders });
  assert.equal(billsResponse.status, 200);
  const bills = await billsResponse.json();
  assert.equal(bills.data.totalBills, 1);
  assert.equal(bills.data.totalOutstanding, 40000);

  const nyscResponse = await fetch(`${baseUrl}/api/v1/reports/nysc-interns`, { headers: adminHeaders });
  assert.equal(nyscResponse.status, 200);
  const nysc = await nyscResponse.json();
  assert.equal(nysc.data.totalNyscMembers, 1);
  assert.equal(nysc.data.exitingSoon, 1);

  const disciplineResponse = await fetch(`${baseUrl}/api/v1/reports/discipline`, { headers: adminHeaders });
  assert.equal(disciplineResponse.status, 200);
  const discipline = await disciplineResponse.json();
  assert.equal(discipline.data.activeCases, 1);
  assert.equal(discipline.data.warnings, 1);

  const announcementsResponse = await fetch(`${baseUrl}/api/v1/reports/announcements`, { headers: adminHeaders });
  assert.equal(announcementsResponse.status, 200);
  const announcements = await announcementsResponse.json();
  assert.equal(announcements.data.published, 1);
  assert.equal(announcements.data.recipients, 2);
  assert.equal(announcements.data.read, 1);
  assert.equal(announcements.data.readRate, 50);

  const customResponse = await fetch(`${baseUrl}/api/v1/reports/custom`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ module: "employees", fields: ["id", "departmentId", "status"], filters: { departmentId: finance.data.id } }),
  });
  assert.equal(customResponse.status, 200);
  const custom = await customResponse.json();
  assert.equal(custom.data.count, 1);
  assert.deepEqual(Object.keys(custom.data.rows[0]).sort(), ["departmentId", "id", "status"]);

  const savedResponse = await fetch(`${baseUrl}/api/v1/reports/saved`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Monthly HR Report",
      reportType: "headcount",
      filters: { departmentId: finance.data.id },
      columns: ["total", "active"],
      isShared: true,
    }),
  });
  assert.equal(savedResponse.status, 201);
  const saved = await savedResponse.json();
  assert.equal(saved.data.createdBy, auth.user.id);

  const runSavedResponse = await fetch(`${baseUrl}/api/v1/reports/saved/${saved.data.id}/run`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(runSavedResponse.status, 200);
  const runSaved = await runSavedResponse.json();
  assert.equal(runSaved.data.result.total, 1);

  const exportResponse = await fetch(`${baseUrl}/api/v1/reports/export?reportType=headcount&format=csv`, { headers: adminHeaders });
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.ok(exportResponse.headers.get("x-report-export-id"));
  const csv = await exportResponse.text();
  assert.match(csv, /total/);
  assert.match(csv, /active/);

  const exportJobs = readCollection("report_exports");
  assert.equal(exportJobs.length, 1);
  assert.equal(exportJobs[0].status, "completed");
  assert.equal(exportJobs[0].requestedBy, auth.user.id);

  const dataQualityResponse = await fetch(`${baseUrl}/api/v1/reports/data-quality`, { headers: adminHeaders });
  assert.equal(dataQualityResponse.status, 200);
  const dataQuality = await dataQualityResponse.json();
  assert.equal(dataQuality.data.score, 100);

  const auditLogs = readCollection("audit_logs").filter((entry) => entry.module === "reports");
  assert.ok(auditLogs.some((entry) => entry.action === "REPORT_EXPORTED"));
  assert.ok(auditLogs.some((entry) => entry.action === "REPORT_SAVED"));
});
