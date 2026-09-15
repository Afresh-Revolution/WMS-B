const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-unified-login";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
delete process.env.DATABASE_URL;

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { writeCollection } = require("../src/database/jsonStore");

const SHARED_LOGIN = "/api/v1/auth/login";
const PASSWORD = "password123";

const ROLE_ACCOUNTS = [
  { role: "hr", email: "hr.login@example.com", name: "Unified HR", dashboardPath: "/api/v1/hr/dashboard" },
  { role: "hod", email: "hod.login@example.com", name: "Unified HOD", dashboardPath: "/api/v1/hod/dashboard", employeeId: "emp-hod" },
  { role: "manager", email: "manager.login@example.com", name: "Unified Manager", dashboardPath: "/api/v1/manager/dashboard" },
  { role: "secretary", email: "secretary.login@example.com", name: "Unified Secretary", dashboardPath: "/api/v1/secretary/dashboard" },
  { role: "accountant", email: "accountant.login@example.com", name: "Unified Accountant", dashboardPath: "/api/v1/accountant/dashboard" },
  { role: "employee", email: "employee.login@example.com", name: "Unified Employee", dashboardPath: "/api/v1/employee/dashboard", employeeId: "emp-login" },
  { role: "nysc_intern", email: "intern.login@example.com", name: "Unified Intern", dashboardPath: "/api/v1/nysc-intern/dashboard" },
];

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-unified-login-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

async function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("one login page authenticates every workspace role through POST /api/v1/auth/login", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const optionsResponse = await fetch(`${baseUrl}/api/v1/auth/login-options`);
  assert.equal(optionsResponse.status, 200);
  const options = await optionsResponse.json();
  assert.equal(options.data.loginEndpoint, SHARED_LOGIN);
  assert.equal(options.data.passwordLogin, true);
  assert.equal(options.data.forgotPasswordEndpoint, "/api/v1/auth/forgot-password");
  assert.equal(options.data.keepMeSignedInEnabled, true);

  const bootstrapResponse = await postJson(`${baseUrl}/api/v1/auth/bootstrap`, {
    name: "Main Admin",
    email: "superadmin.login@example.com",
    password: PASSWORD,
    setupToken: "setup-token",
  });
  assert.equal(bootstrapResponse.status, 201);
  await bootstrapResponse.json();

  const passwordHash = hashPassword(PASSWORD);
  const createdUsers = ROLE_ACCOUNTS.map((account) =>
    createUser({
      name: account.name,
      email: account.email,
      passwordHash,
      role: account.role,
      roleId: account.role,
      status: "active",
      employeeId: account.employeeId || null,
      departmentId: account.role === "hod" ? "dept-login" : null,
      organizationId: "org-login",
    })
  );

  writeCollection("departments", [
    {
      id: "dept-login",
      name: "Login Department",
      code: "LOGIN",
      status: "active",
      hodId: createdUsers.find((user) => user.role === "hod")?.employeeId,
      organizationId: "org-login",
    },
  ]);
  writeCollection("employees", [
    {
      id: "emp-login",
      fullName: "Unified Employee",
      email: "employee.login@example.com",
      userId: createdUsers.find((user) => user.role === "employee")?.id,
      status: "active",
      employmentStatus: "active",
      departmentId: "dept-login",
      organizationId: "org-login",
    },
    {
      id: "emp-hod",
      fullName: "Unified HOD",
      email: "hod.login@example.com",
      userId: createdUsers.find((user) => user.role === "hod")?.id,
      status: "active",
      employmentStatus: "active",
      departmentId: "dept-login",
      organizationId: "org-login",
    },
  ]);
  writeCollection("nysc_intern_profiles", [
    {
      id: "profile-login-intern",
      fullName: "Unified Intern",
      email: "intern.login@example.com",
      userId: createdUsers.find((user) => user.role === "nysc_intern")?.id,
      type: "NYSC",
      status: "ACTIVE",
      departmentId: "dept-login",
      organizationId: "org-login",
    },
  ]);
  writeCollection("placements", [
    {
      id: "placement-login-intern",
      profileId: "profile-login-intern",
      departmentId: "dept-login",
      organizationId: "org-login",
      placementStatus: "ACTIVE",
      startDate: "2026-01-01",
      expectedEndDate: "2026-12-31",
    },
  ]);

  const superadminLogin = await postJson(`${baseUrl}${SHARED_LOGIN}`, {
    email: "superadmin.login@example.com",
    password: PASSWORD,
    keepMeSignedIn: true,
  });
  assert.equal(superadminLogin.status, 200);
  const superadminBody = await superadminLogin.json();
  assert.equal(superadminBody.success, true);
  assert.ok(superadminBody.token);
  assert.equal(superadminBody.user.roleKey, "superadmin");
  assert.equal(superadminBody.workspace.dashboardPath, "/api/v1/super-admin/dashboard");
  assert.equal(superadminBody.keepMeSignedIn, true);
  assert.equal(superadminBody.session.rememberMe, true);

  const superadminDashboard = await fetch(`${baseUrl}${superadminBody.workspace.dashboardPath}`, {
    headers: { authorization: `Bearer ${superadminBody.token}` },
  });
  assert.equal(superadminDashboard.status, 200);

  for (const account of ROLE_ACCOUNTS) {
    const loginResponse = await postJson(`${baseUrl}${SHARED_LOGIN}`, {
      email: account.email,
      password: PASSWORD,
    });
    assert.equal(loginResponse.status, 200, `${account.role} should sign in through the shared login page`);
    const loginBody = await loginResponse.json();
    assert.equal(loginBody.user.roleKey, account.role);
    assert.equal(loginBody.workspace.dashboardPath, account.dashboardPath);
    assert.equal(loginBody.keepMeSignedIn, false);

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    assert.equal(meResponse.status, 200);
    const meBody = await meResponse.json();
    assert.equal(meBody.data.workspace.dashboardPath, account.dashboardPath);

    const dashboardResponse = await fetch(`${baseUrl}${account.dashboardPath}`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    assert.equal(dashboardResponse.status, 200, `${account.role} should open their workspace after shared login`);
  }
});
