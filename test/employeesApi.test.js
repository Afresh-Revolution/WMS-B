const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-employees-api";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
delete process.env.DATABASE_URL;

const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-employees-api-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

test("super admin can list and add people through POST /api/v1/employees", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const bootstrapResponse = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main Admin",
      email: "admin@example.com",
      password: "password123",
      setupToken: "setup-token",
    }),
  });
  assert.equal(bootstrapResponse.status, 201);
  const auth = await bootstrapResponse.json();
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const emptyListResponse = await fetch(`${baseUrl}/api/v1/employees`, { headers });
  assert.equal(emptyListResponse.status, 200);
  const emptyList = await emptyListResponse.json();
  assert.equal(emptyList.success, true);
  assert.ok(Array.isArray(emptyList.data));
  assert.equal(emptyList.data.length, 0);

  const createResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fullName: "Lena Fisher",
      email: "lena.f@afresh.com",
      phone: "08030000000",
      jobTitle: "Hardware Lead",
      department: "Hardware",
      location: "Remote",
      role: "employee",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.success, true);
  assert.equal(created.data.fullName, "Lena Fisher");
  assert.equal(created.data.email, "lena.f@afresh.com");
  assert.equal(created.data.jobPosition, "Hardware Lead");
  assert.equal(created.data.department, "Hardware");
  assert.ok(created.meta.temporaryPassword);

  const listResponse = await fetch(`${baseUrl}/api/v1/employees`, { headers });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].fullName, "Lena Fisher");

  const detailResponse = await fetch(`${baseUrl}/api/v1/employees/${created.data.id}`, { headers });
  assert.equal(detailResponse.status, 200);

  const aliasResponse = await fetch(`${baseUrl}/api/v1/super-admin/employees`, { headers });
  assert.equal(aliasResponse.status, 200);
  const aliasList = await aliasResponse.json();
  assert.equal(aliasList.data.length, 1);

  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "lena.f@afresh.com",
      password: created.meta.temporaryPassword,
    }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.user.roleKey, "employee");
  assert.equal(login.workspace.key, "employee");
  assert.equal(login.mustChangePassword, true);

  const blockedDashboard = await fetch(`${baseUrl}/api/v1/employee/dashboard`, {
    headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal(blockedDashboard.status, 403);

  const changePasswordResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({
      currentPassword: created.meta.temporaryPassword,
      newPassword: "Permanent123!",
    }),
  });
  assert.equal(changePasswordResponse.status, 200);

  const optionsResponse = await fetch(`${baseUrl}/api/v1/lookups`, { headers });
  assert.equal(optionsResponse.status, 200);
  const options = await optionsResponse.json();
  assert.ok(options.data.departments.some((item) => item.name === "Software Engineers"));
  assert.ok(options.data.departments.some((item) => item.name === "Finance"));
  assert.deepEqual(
    options.data.employmentTypes.map((item) => item.key),
    ["full_time", "nysc", "intern"]
  );

  const employeeOptionsResponse = await fetch(`${baseUrl}/api/v1/employees/options`, { headers });
  assert.equal(employeeOptionsResponse.status, 200);

  const profileResponse = await fetch(`${baseUrl}/api/v1/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      role: "software dev",
      department: "Software Engineers",
      startDate: "01/09/2025",
      employmentType: "Full-time",
      reportsTo: "manager",
    }),
  });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.data.employmentType, "Full-time");
  assert.equal(profile.data.department, "Software Engineers");

  const hrCreateResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fullName: "Ada HR",
      email: "ada.hr@afresh.com",
      role: "HR",
      department: "Human Resources",
      employmentType: "fulltime",
    }),
  });
  assert.equal(hrCreateResponse.status, 201);
  const hrCreated = await hrCreateResponse.json();
  assert.equal(hrCreated.data.role, "hr");
  assert.equal(hrCreated.data.department, "Human Resources");
  assert.equal(hrCreated.meta.mustChangePassword, true);
  assert.ok(hrCreated.meta.temporaryPassword);

  const hrLoginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "ada.hr@afresh.com",
      password: hrCreated.meta.temporaryPassword,
    }),
  });
  assert.equal(hrLoginResponse.status, 200);
  const hrLogin = await hrLoginResponse.json();
  assert.equal(hrLogin.user.roleKey, "hr");
  assert.equal(hrLogin.mustChangePassword, true);

  const hrChangePasswordResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${hrLogin.token}`,
    },
    body: JSON.stringify({
      currentPassword: hrCreated.meta.temporaryPassword,
      newPassword: "Permanent123!",
    }),
  });
  assert.equal(hrChangePasswordResponse.status, 200);

  const hrReloginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "ada.hr@afresh.com",
      password: "Permanent123!",
    }),
  });
  assert.equal(hrReloginResponse.status, 200);
  const hrRelogin = await hrReloginResponse.json();
  assert.equal(hrRelogin.mustChangePassword, false);

  const hrDashboardResponse = await fetch(`${baseUrl}/api/v1/hr/dashboard`, {
    headers: { authorization: `Bearer ${hrRelogin.token}` },
  });
  assert.equal(hrDashboardResponse.status, 200);
});
