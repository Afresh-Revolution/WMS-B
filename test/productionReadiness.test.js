const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-production";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { assertRuntimeConfig } = require("../src/config");

function withEnv(t, values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function createTestServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-production-"));
  process.env.DATA_DIR = dataDir;
  const app = createApp();
  const server = app.listen(0);
  t.after(() => {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("serves API metadata with production headers and readiness checks", async (t) => {
  withEnv(t, {
    CORS_ORIGIN: "https://app.example.com",
    DATABASE_URL: "",
    REQUIRE_DATABASE_ON_READY: "false",
    RATE_LIMIT_MAX: "100",
  });
  const baseUrl = createTestServer(t);

  const rootResponse = await fetch(`${baseUrl}/`, {
    headers: { origin: "https://app.example.com", "x-request-id": "request-123" },
  });
  assert.equal(rootResponse.status, 200);
  assert.equal(rootResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(rootResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(rootResponse.headers.get("x-request-id"), "request-123");
  assert.equal(rootResponse.headers.get("access-control-allow-origin"), "https://app.example.com");
  assert.equal(rootResponse.headers.has("x-powered-by"), false);
  const root = await rootResponse.json();
  assert.equal(root.name, "wms-api");
  assert.equal(root.docs.superAdmin, "/api/v1/super-admin/modules");

  const readyResponse = await fetch(`${baseUrl}/ready`);
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.equal(ready.status, "ready");
  assert.equal(ready.database, "not_configured");

  const optionsResponse = await fetch(`${baseUrl}/api/v1/auth/bootstrap/status`, {
    method: "OPTIONS",
    headers: {
      origin: "https://app.example.com",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  assert.equal(optionsResponse.status, 204);
  assert.equal(optionsResponse.headers.get("access-control-allow-methods"), "GET,POST,PUT,PATCH,DELETE,OPTIONS");
});

test("blocks disallowed API origins before route handling", async (t) => {
  withEnv(t, {
    CORS_ORIGIN: "https://app.example.com",
    RATE_LIMIT_MAX: "100",
  });
  const baseUrl = createTestServer(t);

  const response = await fetch(`${baseUrl}/api/v1/auth/bootstrap/status`, {
    headers: { origin: "https://evil.example.com" },
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "CORS_ORIGIN_NOT_ALLOWED");
});

test("rate limits API traffic with retry metadata", async (t) => {
  withEnv(t, {
    CORS_ORIGIN: "",
    RATE_LIMIT_MAX: "2",
    RATE_LIMIT_WINDOW_MS: "60000",
  });
  const baseUrl = createTestServer(t);

  assert.equal((await fetch(`${baseUrl}/`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/`)).status, 200);

  const limited = await fetch(`${baseUrl}/`);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("ratelimit-limit"), "2");
  const body = await limited.json();
  assert.equal(body.error.code, "RATE_LIMIT_EXCEEDED");
});

test("requires deployment secrets and database URL in production", (t) => {
  withEnv(t, {
    NODE_ENV: "production",
    AUTH_TOKEN_SECRET: "short",
    SUPERADMIN_SETUP_TOKEN: "setup-token",
    ENCRYPTION_KEY: "short",
    DATABASE_URL: "",
  });

  assert.throws(() => assertRuntimeConfig(), /AUTH_TOKEN_SECRET/);
});
