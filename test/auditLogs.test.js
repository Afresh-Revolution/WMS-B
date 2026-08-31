const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-audit-logs";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { recordOperationalAudit } = require("../src/modules/_shared/auditService");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-audit-logs-"));
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

async function createEmployee(baseUrl, headers) {
  const response = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Audit",
        lastName: "Viewer",
        email: "audit.viewer@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-AUD-001",
        jobTitle: "Analyst",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email: "audit.viewer@example.com",
        initialPassword: "password123",
        role: "employee",
      },
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("serves immutable operational audit logs with filters, stats, export, redaction, and hash metadata", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
    "x-request-id": "req-audit-test-001",
  };

  const employee = await createEmployee(baseUrl, adminHeaders);
  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  recordOperationalAudit({
    user: auth.user,
    action: "Password Reset",
    module: "security",
    recordId: employee.data.userId,
    targetType: "User",
    targetName: "Audit Viewer",
    description: "Reset staff account password.",
    severity: "WARNING",
    newValue: {
      userId: employee.data.userId,
      password: "plain-secret",
      nested: { refreshToken: "refresh-secret", safe: "visible" },
    },
    metadata: { apiKey: "secret-key", reason: "support request" },
    ipAddress: "127.0.0.1",
    userAgent: "node-test",
    requestId: "req-manual-audit-001",
  });

  const deniedResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, { headers: employeeHeaders });
  assert.equal(deniedResponse.status, 403);

  const listResponse = await fetch(`${baseUrl}/api/v1/audit-logs?module=security&status=SUCCESS&limit=10`, {
    headers: adminHeaders,
  });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.data.length, 1);
  assert.equal(list.meta.pagination.total, 1);
  assert.match(list.data[0].eventId, /^AUD-\d{8}-\d{6}$/);
  assert.equal(list.data[0].action, "PASSWORD_RESET");
  assert.equal(list.data[0].severity, "WARNING");
  assert.equal(list.data[0].actorName, "Main Admin");

  const searchResponse = await fetch(`${baseUrl}/api/v1/audit-logs?search=Audit%20Viewer`, { headers: adminHeaders });
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  assert.equal(search.data.some((log) => log.targetName === "Audit Viewer"), true);

  const detailResponse = await fetch(`${baseUrl}/api/v1/audit-logs/${list.data[0].eventId}`, { headers: adminHeaders });
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.data.afterData.password, "[REDACTED]");
  assert.equal(detail.data.afterData.nested.refreshToken, "[REDACTED]");
  assert.equal(detail.data.afterData.nested.safe, "visible");
  assert.equal(detail.data.metadata.apiKey, "[REDACTED]");
  assert.ok(detail.data.recordHash);
  assert.equal(detail.data.integrity.verified, true);

  const statsResponse = await fetch(`${baseUrl}/api/v1/audit-logs/stats`, { headers: adminHeaders });
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.equal(stats.data.totalEvents, 2);
  assert.equal(stats.data.successfulEvents, 2);
  assert.equal(stats.data.securityEvents, 1);
  assert.equal(stats.data.eventsByModule.security, 1);

  const patchResponse = await fetch(`${baseUrl}/api/v1/audit-logs/${list.data[0].id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ severity: "INFO" }),
  });
  assert.equal(patchResponse.status, 405);

  const exportResponse = await fetch(`${baseUrl}/api/v1/audit-logs/export?format=csv&module=security`, {
    headers: adminHeaders,
  });
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.ok(exportResponse.headers.get("x-audit-export-event-id"));
  const csv = await exportResponse.text();
  assert.match(csv, /PASSWORD_RESET/);
  assert.match(csv, /Audit Viewer/);

  const logs = readCollection("operational_audit_logs");
  assert.equal(logs.some((log) => log.action === "AUDIT_LOGS_EXPORTED"), true);
  assert.equal(logs.every((log) => log.recordHash || log.record_hash), true);
});
