const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-security";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-security-"));
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

test("enforces Super Admin security settings across passwords, lockouts, sessions, MFA, and maintenance", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrap(baseUrl);
  const superHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const policyResponse = await fetch(`${baseUrl}/api/v1/security/password-policy`, {
    method: "PATCH",
    headers: superHeaders,
    body: JSON.stringify({
      minimumPasswordLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSymbol: true,
      passwordHistoryEnabled: true,
      passwordHistoryCount: 2,
    }),
  });
  assert.equal(policyResponse.status, 200);

  const weakUserResponse = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: superHeaders,
    body: JSON.stringify({
      fullName: "Security User",
      email: "security.user@example.com",
      roleId: "employee",
      accountType: "STAFF",
      temporaryPassword: "weakpass",
      status: "active",
    }),
  });
  assert.equal(weakUserResponse.status, 400);

  const userResponse = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: superHeaders,
    body: JSON.stringify({
      fullName: "Security User",
      email: "security.user@example.com",
      roleId: "employee",
      accountType: "STAFF",
      temporaryPassword: "TempPass123!",
      status: "active",
    }),
  });
  assert.equal(userResponse.status, 201);
  const createdUser = await userResponse.json();

  const loginPolicyResponse = await fetch(`${baseUrl}/api/v1/security/login-policy`, {
    method: "PATCH",
    headers: superHeaders,
    body: JSON.stringify({ maxLoginAttempts: 2, lockoutDurationMinutes: 5 }),
  });
  assert.equal(loginPolicyResponse.status, 200);

  for (let index = 0; index < 2; index += 1) {
    const badLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "security.user@example.com", password: "WrongPass123!" }),
    });
    assert.equal(badLogin.status, 401);
  }

  const lockedLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security.user@example.com", password: "TempPass123!" }),
  });
  assert.equal(lockedLogin.status, 403);

  const attemptsResponse = await fetch(`${baseUrl}/api/v1/security/login-attempts`, { headers: superHeaders });
  assert.equal(attemptsResponse.status, 200);
  const attempts = await attemptsResponse.json();
  assert.ok(attempts.data.length >= 2);

  const unlockResponse = await fetch(`${baseUrl}/api/v1/security/users/${createdUser.data.id}/unlock`, {
    method: "POST",
    headers: superHeaders,
  });
  assert.equal(unlockResponse.status, 200);

  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security.user@example.com", password: "TempPass123!" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();

  const changePasswordResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({ currentPassword: "TempPass123!", newPassword: "Permanent123!" }),
  });
  assert.equal(changePasswordResponse.status, 200);

  const secondLoginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security.user@example.com", password: "Permanent123!" }),
  });
  assert.equal(secondLoginResponse.status, 200);
  const secondLogin = await secondLoginResponse.json();

  const reusePasswordResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secondLogin.token}`,
    },
    body: JSON.stringify({ currentPassword: "Permanent123!", newPassword: "TempPass123!" }),
  });
  assert.equal(reusePasswordResponse.status, 400);

  const sessionPolicyResponse = await fetch(`${baseUrl}/api/v1/security/session-policy`, {
    method: "PATCH",
    headers: superHeaders,
    body: JSON.stringify({ sessionTimeoutMinutes: 30, maxConcurrentSessions: 1, allowRememberDevice: true }),
  });
  assert.equal(sessionPolicyResponse.status, 200);

  const sessionsResponse = await fetch(`${baseUrl}/api/v1/security/sessions`, { headers: superHeaders });
  assert.equal(sessionsResponse.status, 200);
  const sessions = await sessionsResponse.json();
  assert.equal(sessions.data.some((session) => session.refreshTokenHash), false);

  const mfaPolicyResponse = await fetch(`${baseUrl}/api/v1/security/mfa`, {
    method: "PATCH",
    headers: superHeaders,
    body: JSON.stringify({ requireMfa: true, allowEmailMfa: true }),
  });
  assert.equal(mfaPolicyResponse.status, 200);

  const mfaLoginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "security.user@example.com", password: "Permanent123!" }),
  });
  assert.equal(mfaLoginResponse.status, 202);
  const mfaLogin = await mfaLoginResponse.json();
  assert.equal(mfaLogin.data.mfaRequired, true);

  const maintenanceResponse = await fetch(`${baseUrl}/api/v1/security/maintenance`, {
    method: "PATCH",
    headers: superHeaders,
    body: JSON.stringify({ maintenanceMode: true, maintenanceMessage: "Maintenance window" }),
  });
  assert.equal(maintenanceResponse.status, 200);

  const blockedUserResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${secondLogin.token}` },
  });
  assert.equal(blockedUserResponse.status, 503);

  const adminSecurityAliasResponse = await fetch(`${baseUrl}/api/admin/security`, { headers: superHeaders });
  assert.equal(adminSecurityAliasResponse.status, 200);
});
