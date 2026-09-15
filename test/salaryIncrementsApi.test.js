const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-salary-increments";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
delete process.env.DATABASE_URL;

const { createApp } = require("../src/app");
const { writeCollection } = require("../src/database/jsonStore");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-salary-increments-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

test("super admin can create salary recommendations that appear on both list paths", async (t) => {
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

  writeCollection("employees", [
    {
      id: "emp-plangnan",
      fullName: "Plangnan Nungse",
      department: "Software Engineering",
      salary: 50000,
    },
  ]);

  const createResponse = await fetch(`${baseUrl}/api/v1/hr/salary-adjustments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      employeeName: "Plangnan Nungse",
      department: "Software Engineering",
      currentSalary: "50000",
      proposedSalary: "150000",
      effectiveDate: "12/17/2026",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.data.employeeName, "Plangnan Nungse");
  assert.equal(created.data.currentSalary, 50000);
  assert.equal(created.data.proposedSalary, 150000);
  assert.equal(created.data.effectiveDate, "2026-12-17");
  assert.equal(created.data.status, "PENDING");

  const listResponse = await fetch(`${baseUrl}/api/v1/salary-increments`, { headers });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.ok(list.data.some((item) => item.id === created.data.id));

  const aliasCreateResponse = await fetch(`${baseUrl}/api/v1/salary-increments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      employeeName: "Plangnan Nungse",
      department: "Software Engineering",
      currentSalary: 50000,
      proposedSalary: 175000,
      effectiveDate: "2026-12-18",
    }),
  });
  assert.equal(aliasCreateResponse.status, 201);
  const aliasCreated = await aliasCreateResponse.json();

  const hrListResponse = await fetch(`${baseUrl}/api/v1/hr/salary-adjustments`, { headers });
  assert.equal(hrListResponse.status, 200);
  const hrList = await hrListResponse.json();
  assert.ok(hrList.data.some((item) => item.id === created.data.id));
  assert.ok(hrList.data.some((item) => item.id === aliasCreated.data.id));

  const superAdminListResponse = await fetch(`${baseUrl}/api/v1/super-admin/salary-increments`, { headers });
  assert.equal(superAdminListResponse.status, 200);
});
