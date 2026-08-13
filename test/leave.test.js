const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-leave-module";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-leave-"));
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

test("calculates leave duration, blocks overlaps, approves, and moves balance days", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const leaveTypesResponse = await fetch(`${baseUrl}/api/v1/leave/types`, { headers: adminHeaders });
  assert.equal(leaveTypesResponse.status, 200);
  const leaveTypes = await leaveTypesResponse.json();
  const annualLeave = leaveTypes.data.find((leaveType) => leaveType.code === "ANNUAL");
  assert.ok(annualLeave);

  const createEmployeeResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Jane",
        lastName: "Adebayo",
        email: "jane.adebayo@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-LEAVE-001",
        jobTitle: "Operations Lead",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email: "jane.adebayo@example.com",
        initialPassword: "password123",
        role: "employee",
      },
    }),
  });
  assert.equal(createEmployeeResponse.status, 201);
  const employee = await createEmployeeResponse.json();
  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  const requestResponse = await fetch(`${baseUrl}/api/v1/leave/requests`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      leaveTypeId: annualLeave.id,
      startDate: "2026-08-20",
      endDate: "2026-08-25",
      duration: 99,
      note: "Annual vacation",
    }),
  });
  assert.equal(requestResponse.status, 201);
  const request = await requestResponse.json();
  assert.equal(request.data.duration, 4);
  assert.equal(request.data.calendarDays, 6);
  assert.equal(request.data.status, "PENDING");

  const overlapResponse = await fetch(`${baseUrl}/api/v1/leave/requests`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      leaveTypeId: annualLeave.id,
      startDate: "2026-08-23",
      endDate: "2026-08-28",
    }),
  });
  assert.equal(overlapResponse.status, 409);

  const balanceAfterSubmitResponse = await fetch(`${baseUrl}/api/v1/leave/balances/${employee.data.id}`, {
    headers: adminHeaders,
  });
  assert.equal(balanceAfterSubmitResponse.status, 200);
  const balanceAfterSubmit = await balanceAfterSubmitResponse.json();
  assert.equal(balanceAfterSubmit.data[0].pendingDays, 4);
  assert.equal(balanceAfterSubmit.data[0].remainingDays, 21);

  const approveResponse = await fetch(`${baseUrl}/api/v1/leave/requests/${request.data.id}/approve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ comment: "Enjoy" }),
  });
  assert.equal(approveResponse.status, 200);
  const approved = await approveResponse.json();
  assert.equal(approved.data.status, "APPROVED");
  assert.equal(approved.meta.balance.pendingDays, 0);
  assert.equal(approved.meta.balance.usedDays, 4);
  assert.equal(approved.meta.balance.remainingDays, 21);
});
