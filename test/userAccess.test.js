const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-user-access";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-user-access-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

async function bootstrap(baseUrl) {
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

test("creates and secures user access accounts with roles, departments, sessions, and audit-safe responses", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrap(baseUrl);
  const superHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const departmentResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: superHeaders,
    body: JSON.stringify({
      name: "Management",
      code: "MGT-001",
      status: "active",
    }),
  });
  assert.equal(departmentResponse.status, 201);
  const department = await departmentResponse.json();

  const createUserResponse = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: superHeaders,
    body: JSON.stringify({
      fullName: "David Okoye",
      email: "david.okoye@company.com",
      phone: "+234000000000",
      roleId: "admin",
      departmentId: department.data.id,
      accountType: "ADMIN",
      temporaryPassword: "TempPass123!",
      status: "active",
    }),
  });
  assert.equal(createUserResponse.status, 201);
  const createdUser = await createUserResponse.json();
  assert.equal(createdUser.data.email, "david.okoye@company.com");
  assert.equal(createdUser.data.role.key, "admin");
  assert.equal(createdUser.data.department.name, "Management");
  assert.equal(createdUser.data.mustChangePassword, true);
  assert.equal(createdUser.data.passwordHash, undefined);
  assert.equal(createdUser.meta.provisioning.mustChangePassword, true);

  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "DAVID.OKOYE@COMPANY.COM",
      password: "TempPass123!",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.mustChangePassword, true);

  const blockedStatsResponse = await fetch(`${baseUrl}/api/v1/users/statistics`, {
    headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal(blockedStatsResponse.status, 403);

  const changePasswordResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({
      currentPassword: "TempPass123!",
      newPassword: "Permanent123!",
    }),
  });
  assert.equal(changePasswordResponse.status, 200);

  const secondLoginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "david.okoye@company.com",
      password: "Permanent123!",
    }),
  });
  assert.equal(secondLoginResponse.status, 200);
  const secondLogin = await secondLoginResponse.json();

  const statsResponse = await fetch(`${baseUrl}/api/v1/users/statistics`, {
    headers: { authorization: `Bearer ${secondLogin.token}` },
  });
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.equal(stats.data.totalUsers, 2);
  assert.equal(stats.data.adminAccounts, 1);
  assert.equal(stats.data.superAdminAccounts, 1);

  const sessionsResponse = await fetch(`${baseUrl}/api/v1/auth/sessions`, {
    headers: { authorization: `Bearer ${secondLogin.token}` },
  });
  assert.equal(sessionsResponse.status, 200);
  const sessions = await sessionsResponse.json();
  assert.ok(sessions.data.length >= 1);
  assert.equal(sessions.data[0].refreshTokenHash, undefined);

  const selfLockResponse = await fetch(`${baseUrl}/api/v1/users/${createdUser.data.id}/lock`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secondLogin.token}`,
    },
    body: JSON.stringify({ reason: "self test" }),
  });
  assert.equal(selfLockResponse.status, 400);

  const superLockResponse = await fetch(`${baseUrl}/api/v1/users/${createdUser.data.id}/lock`, {
    method: "POST",
    headers: superHeaders,
    body: JSON.stringify({ reason: "security review" }),
  });
  assert.equal(superLockResponse.status, 200);
  const locked = await superLockResponse.json();
  assert.equal(locked.data.status, "locked");
});
