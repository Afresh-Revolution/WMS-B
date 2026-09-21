const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-frontend-routes";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
delete process.env.DATABASE_URL;

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById, updateUser } = require("../src/auth/userStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-frontend-routes-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

test("frontend workspace routes exist for HR, accountant, employee, and lookups", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const bootstrap = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main Admin",
      email: "admin@example.com",
      password: "password123",
      setupToken: "setup-token",
    }),
  });
  assert.equal(bootstrap.status, 201);
  const auth = await bootstrap.json();
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const deptResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "People Ops", code: "HR-FE", status: "active" }),
  });
  assert.equal(deptResponse.status, 201);
  const department = await deptResponse.json();

  async function createUser(fullName, email, role) {
    const response = await fetch(`${baseUrl}/api/v1/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        fullName,
        email,
        role,
        status: "active",
        departmentId: department.data.id,
        temporaryPassword: "TempPass123!",
      }),
    });
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const created = await response.json();
    updateUser(created.data.id, {
      mustChangePassword: false,
      forcePasswordReset: false,
      departmentId: department.data.id,
    });
    return {
      "content-type": "application/json",
      authorization: `Bearer ${issueAccessToken(getUserById(created.data.id))}`,
    };
  }

  const hrHeaders = await createUser("Frontend HR", "frontend.hr@example.com", "hr");
  const accountantHeaders = await createUser("Frontend Accountant", "frontend.accountant@example.com", "accountant");
  const employeeHeaders = await createUser("Frontend Employee", "frontend.employee@example.com", "employee");

  const hrPaths = [
    "/hr/attendance",
    "/hr/performance",
    "/hr/meetings",
    "/hr/tasks",
    "/hr/targets",
    "/hr/leave/types",
    "/hr/employees",
    "/hr/departments",
    "/hr/approval-queue",
  ];
  for (const route of hrPaths) {
    const response = await fetch(`${baseUrl}/api/v1${route}`, { headers: hrHeaders });
    assert.equal(response.status, 200, `${route} ${JSON.stringify(await response.clone().json())}`);
  }

  const lookups = await fetch(`${baseUrl}/api/v1/lookups/leave-types`, { headers: employeeHeaders });
  assert.equal(lookups.status, 200, JSON.stringify(await lookups.clone().json()));

  const accountantStatus = await fetch(`${baseUrl}/api/v1/accountant/attendance/status`, {
    headers: accountantHeaders,
  });
  assert.equal(accountantStatus.status, 200, JSON.stringify(await accountantStatus.clone().json()));

  const employeeDashboard = await fetch(`${baseUrl}/api/v1/employee/dashboard`, {
    headers: employeeHeaders,
  });
  assert.equal(employeeDashboard.status, 200, JSON.stringify(await employeeDashboard.clone().json()));

  const employeeReimbursements = await fetch(`${baseUrl}/api/v1/employee/reimbursements`, {
    headers: employeeHeaders,
  });
  assert.equal(employeeReimbursements.status, 200, JSON.stringify(await employeeReimbursements.clone().json()));
});
