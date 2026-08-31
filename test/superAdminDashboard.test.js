const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-super-admin-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-super-admin-dashboard-"));
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

test("super admin dashboard namespace exposes figma modules and aliases existing admin services", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/super-admin/dashboard`, { headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.metrics.totalUsers, 1);
  assert.ok(dashboard.data.navigation.includes("users"));
  assert.ok(dashboard.data.navigation.includes("technical-audit"));

  const statsResponse = await fetch(`${baseUrl}/api/v1/super-admin/dashboard/stats`, { headers });
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.equal(stats.data.totalUsers, 1);

  const navigationResponse = await fetch(`${baseUrl}/api/v1/super-admin/navigation`, { headers });
  assert.equal(navigationResponse.status, 200);
  const navigation = await navigationResponse.json();
  assert.ok(navigation.data.includes("system-management"));

  const modulesResponse = await fetch(`${baseUrl}/api/v1/super-admin/modules`, { headers });
  assert.equal(modulesResponse.status, 200);
  const modules = await modulesResponse.json();
  assert.ok(modules.data.some((item) => item.key === "users" && item.url.endsWith("/super-admin/users")));
  assert.ok(modules.data.some((item) => item.key === "settings" && item.url.endsWith("/super-admin/settings")));

  const usersModuleResponse = await fetch(`${baseUrl}/api/v1/super-admin/modules/users`, { headers });
  assert.equal(usersModuleResponse.status, 200);
  const usersModule = await usersModuleResponse.json();
  assert.equal(usersModule.data.label, "User");

  const settingsResponse = await fetch(`${baseUrl}/api/v1/super-admin/settings`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ theme: "light", currency: "NGN" }),
  });
  assert.equal(settingsResponse.status, 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.data.length, 2);

  const userStatsResponse = await fetch(`${baseUrl}/api/v1/super-admin/users/statistics`, { headers });
  assert.equal(userStatsResponse.status, 200);
  const userStats = await userStatsResponse.json();
  assert.equal(userStats.data.totalUsers, 1);

  const roleCatalogResponse = await fetch(`${baseUrl}/api/v1/super-admin/roles/catalog`, { headers });
  assert.equal(roleCatalogResponse.status, 200);

  const profileResponse = await fetch(`${baseUrl}/api/v1/super-admin/profile`, { headers });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.data.role, "superadmin");

  const legacyDashboardResponse = await fetch(`${baseUrl}/api/super-admin/dashboard`, { headers });
  assert.equal(legacyDashboardResponse.status, 200);

  const employee = createUser({
    name: "Employee User",
    email: "employee@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    status: "active",
  });
  const deniedResponse = await fetch(`${baseUrl}/api/v1/super-admin/dashboard`, {
    headers: { authorization: `Bearer ${issueAccessToken(employee)}` },
  });
  assert.equal(deniedResponse.status, 403);
});
