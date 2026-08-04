const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-local-tests";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-auth-test-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

test("bootstraps, logs in, and reads the superadmin profile", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const bootstrapResponse = await fetch(`${baseUrl}/api/superadmin/bootstrap`, {
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
  const bootstrapBody = await bootstrapResponse.json();
  assert.equal(bootstrapBody.user.role, "superadmin");
  assert.ok(bootstrapBody.token);

  const secondBootstrapResponse = await fetch(`${baseUrl}/api/superadmin/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Other Admin",
      email: "other@example.com",
      password: "password123",
      setupToken: "setup-token",
    }),
  });
  assert.equal(secondBootstrapResponse.status, 409);

  const loginResponse = await fetch(`${baseUrl}/api/superadmin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = await loginResponse.json();

  const meResponse = await fetch(`${baseUrl}/api/superadmin/me`, {
    headers: { authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(meResponse.status, 200);
  const meBody = await meResponse.json();
  assert.equal(meBody.user.email, "admin@example.com");
});

test("rejects bootstrap requests with an invalid setup token", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/superadmin/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main Admin",
      email: "admin@example.com",
      password: "password123",
      setupToken: "bad-token",
    }),
  });

  assert.equal(response.status, 403);
});
