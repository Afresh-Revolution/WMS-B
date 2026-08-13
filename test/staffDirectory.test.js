const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-staff-directory";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-staff-directory-"));
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

test("creates, searches, profiles, documents, and suspends staff directory members", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const createResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        phone: "123",
      },
      employmentInformation: {
        employeeId: "EMP-001",
        jobTitle: "Backend Engineer",
        department: "Software Engineering",
        location: "Lagos",
        employmentType: "Full-time",
        status: "Active",
      },
      systemAccess: {
        createAccount: true,
        email: "john.doe@example.com",
        initialPassword: "password123",
        role: "employee",
      },
    }),
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.data.fullName, "John Doe");
  assert.equal(created.data.staffType, "employee");

  const searchResponse = await fetch(`${baseUrl}/api/v1/employers?search=john&view=list`, {
    headers,
  });
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  assert.equal(search.data.length, 1);
  assert.equal(search.data[0].fullName, "John Doe");
  assert.equal(search.meta.view, "list");
  assert.ok(search.meta.filters.departments.includes("Software Engineering"));

  const profileResponse = await fetch(`${baseUrl}/api/v1/employers/${created.data.id}`, {
    headers,
  });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.data.overview.fullName, "John Doe");
  assert.equal(profile.data.loginSecurity.accountStatus, "active");

  const documentResponse = await fetch(`${baseUrl}/api/v1/employers/${created.data.id}/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Contract",
      type: "Contract",
      fileUrl: "https://example.com/contract.pdf",
    }),
  });
  assert.equal(documentResponse.status, 201);

  const suspendResponse = await fetch(`${baseUrl}/api/v1/employers/${created.data.id}/suspend`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason: "test" }),
  });
  assert.equal(suspendResponse.status, 200);
  const suspended = await suspendResponse.json();
  assert.equal(suspended.data.status, "suspended");
});
