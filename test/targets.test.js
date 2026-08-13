const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-targets";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-targets-"));
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

test("creates assigned targets, calculates progress, auto-completes, and reports performance", async (t) => {
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
    body: JSON.stringify({
      name: "Sales",
      code: "SALES-001",
      status: "active",
    }),
  });
  assert.equal(departmentResponse.status, 201);
  const department = await departmentResponse.json();

  const employeeResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Nina",
        lastName: "Patel",
        email: "nina.patel@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-TARGET-001",
        jobTitle: "Sales Lead",
        departmentId: department.data.id,
        department: "Sales",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email: "nina.patel@example.com",
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

  const createTargetResponse = await fetch(`${baseUrl}/api/v1/targets`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Increase monthly sales",
      description: "Reach the August sales target",
      targetType: "DEPARTMENT",
      measurementType: "CURRENCY",
      metricName: "Monthly sales",
      targetValue: 10000000,
      currentValue: 6500000,
      progress: 100,
      unit: "NGN",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      priority: "HIGH",
      departmentId: department.data.id,
      employeeIds: [employee.data.id],
    }),
  });
  assert.equal(createTargetResponse.status, 201);
  const target = await createTargetResponse.json();
  assert.equal(target.data.progress, 0);
  assert.equal(target.data.assignments.length, 1);
  assert.equal(target.data.assignments[0].employeeId, employee.data.id);

  const employeeListResponse = await fetch(`${baseUrl}/api/v1/targets`, { headers: employeeHeaders });
  assert.equal(employeeListResponse.status, 200);
  const employeeList = await employeeListResponse.json();
  assert.equal(employeeList.data.length, 1);

  const progressResponse = await fetch(`${baseUrl}/api/v1/targets/${target.data.id}/progress`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      value: 7500000,
      progress: 100,
      percentage: 100,
      note: "Completed this week's work",
    }),
  });
  assert.equal(progressResponse.status, 201);
  const progress = await progressResponse.json();
  assert.equal(progress.data.currentValue, 7500000);
  assert.equal(progress.data.progress, 75);
  assert.equal(progress.meta.progress.percentage, 75);
  assert.equal(progress.data.status, "ACTIVE");

  const milestoneResponse = await fetch(`${baseUrl}/api/v1/targets/${target.data.id}/milestones`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Reach NGN 7.5m",
      targetValue: 7500000,
      dueDate: "2026-08-20",
    }),
  });
  assert.equal(milestoneResponse.status, 201);
  const milestone = await milestoneResponse.json();

  const completeMilestoneResponse = await fetch(`${baseUrl}/api/v1/targets/${target.data.id}/milestones/${milestone.data.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "COMPLETED" }),
  });
  assert.equal(completeMilestoneResponse.status, 200);

  const commentResponse = await fetch(`${baseUrl}/api/v1/targets/${target.data.id}/comments`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ comment: "Pipeline is on track." }),
  });
  assert.equal(commentResponse.status, 201);

  const completedResponse = await fetch(`${baseUrl}/api/v1/targets/${target.data.id}/progress`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ value: 10000000, progress: 40 }),
  });
  assert.equal(completedResponse.status, 201);
  const completed = await completedResponse.json();
  assert.equal(completed.data.progress, 100);
  assert.equal(completed.data.status, "COMPLETED");
  assert.ok(completed.data.completedAt);

  const detailsResponse = await fetch(`${baseUrl}/api/v1/targets/${target.data.id}`, { headers: adminHeaders });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.progressHistory.length, 3);
  assert.equal(details.data.comments.length, 1);
  assert.ok(details.data.history.some((entry) => entry.action === "COMPLETED"));

  const reportResponse = await fetch(`${baseUrl}/api/v1/targets/reports`, { headers: adminHeaders });
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.data.total, 1);
  assert.equal(report.data.completed, 1);
  assert.equal(report.data.averageProgress, 100);

  const departmentReportResponse = await fetch(`${baseUrl}/api/v1/targets/reports/departments`, { headers: adminHeaders });
  assert.equal(departmentReportResponse.status, 200);
  const departmentReport = await departmentReportResponse.json();
  assert.equal(departmentReport.data[0].departmentName, "Sales");
  assert.equal(departmentReport.data[0].completed, 1);

  const employeeReportResponse = await fetch(`${baseUrl}/api/v1/targets/reports/employees/${employee.data.id}`, {
    headers: adminHeaders,
  });
  assert.equal(employeeReportResponse.status, 200);
  const employeeReport = await employeeReportResponse.json();
  assert.equal(employeeReport.data.assignedTargets, 1);
  assert.equal(employeeReport.data.completedTargets, 1);
});
