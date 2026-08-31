const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-architecture";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-architecture-"));
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

test("serves architecture foundation routes for RBAC, dashboard, health, and permission-aware search", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrap(baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const permissionsResponse = await fetch(`${baseUrl}/api/v1/permissions`, { headers });
  assert.equal(permissionsResponse.status, 200);
  const permissions = await permissionsResponse.json();
  assert.ok(permissions.data.some((permission) => permission.key === "roles.assign_permissions"));

  const createRoleResponse = await fetch(`${baseUrl}/api/v1/roles`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Operations Lead",
      permissions: ["employees.view", "tasks.view"],
    }),
  });
  assert.equal(createRoleResponse.status, 201);
  const role = await createRoleResponse.json();

  const updatePermissionsResponse = await fetch(`${baseUrl}/api/v1/roles/${role.data.id}/permissions`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ permissions: ["employees.view", "departments.view", "reports.view"] }),
  });
  assert.equal(updatePermissionsResponse.status, 200);
  const updatedRole = await updatePermissionsResponse.json();
  assert.deepEqual(updatedRole.data.permissions, ["departments.view", "employees.view", "reports.view"]);

  const protectedSuperAdminResponse = await fetch(`${baseUrl}/api/v1/roles/superadmin/permissions`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ permissions: ["profile.view"] }),
  });
  assert.equal(protectedSuperAdminResponse.status, 403);

  const departmentResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Product Engineering", code: "PROD-ENG", status: "active" }),
  });
  assert.equal(departmentResponse.status, 201);

  const searchResponse = await fetch(`${baseUrl}/api/v1/search?q=Product`, { headers });
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  assert.ok(search.data.some((result) => result.type === "departments" && result.label === "Product Engineering"));

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/dashboard/super-admin`, { headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.total_users, 1);
  assert.equal(dashboard.data.departments, 1);

  const healthResponse = await fetch(`${baseUrl}/api/v1/health`, { headers });
  assert.equal(healthResponse.status, 200);
});
