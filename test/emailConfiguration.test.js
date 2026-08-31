const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-email";
process.env.ENCRYPTION_KEY = "test-email-encryption-key-that-is-long-enough";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
process.env.EMAIL_MOCK_DELIVERY = "true";
process.env.EMAIL_PROVIDER = "postmark";
process.env.EMAIL_FROM_NAME = "Afresh";
process.env.EMAIL_FROM_ADDRESS = "no-reply@afresh.co";
process.env.SMTP_HOST = "smtp.postmark.io";
process.env.SMTP_PORT = "587";

const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-email-"));
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

test("manages production email configuration with encrypted secrets, queueing, templates, status checks, and audit", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrap(baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const unauthenticated = await fetch(`${baseUrl}/api/admin/email-config`);
  assert.equal(unauthenticated.status, 401);

  const defaultResponse = await fetch(`${baseUrl}/api/admin/email-config`, { headers });
  assert.equal(defaultResponse.status, 200);
  const defaults = await defaultResponse.json();
  assert.equal(defaults.data.provider, "postmark");
  assert.equal(defaults.data.fromAddress, "no-reply@afresh.co");
  assert.equal("smtpPasswordEncrypted" in defaults.data, false);

  const updateResponse = await fetch(`${baseUrl}/api/admin/email-config`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      provider: "postmark",
      fromName: "Afresh",
      fromAddress: "no-reply@afresh.co",
      smtpHost: "smtp.postmark.io",
      smtpPort: 587,
      smtpUsername: "postmark-user",
      smtpPassword: "smtp-secret",
      apiKey: "postmark-token",
      encryptionType: "starttls",
      enabled: true,
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.data.enabled, true);
  assert.equal(updated.data.status, "operational");
  assert.equal(updated.data.hasPassword, true);
  assert.equal(updated.data.hasApiKey, true);
  assert.equal(updated.data.smtpPasswordEncrypted, undefined);
  assert.equal(updated.data.apiKeyEncrypted, undefined);

  const storedConfig = readCollection("email_configurations")[0];
  assert.match(storedConfig.smtpPasswordEncrypted, /^enc:v1:/);
  assert.match(storedConfig.apiKeyEncrypted, /^enc:v1:/);
  assert.equal(storedConfig.smtpPasswordEncrypted.includes("smtp-secret"), false);
  assert.equal(storedConfig.apiKeyEncrypted.includes("postmark-token"), false);

  const checkResponse = await fetch(`${baseUrl}/api/admin/email-config/check`, { method: "POST", headers });
  assert.equal(checkResponse.status, 200);
  const checked = await checkResponse.json();
  assert.equal(checked.data.status, "operational");
  assert.ok(checked.data.checkedAt);

  const testResponse = await fetch(`${baseUrl}/api/admin/email-config/test`, {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient: "admin@example.com" }),
  });
  assert.equal(testResponse.status, 200);
  const testEmail = await testResponse.json();
  assert.equal(testEmail.data.status, "SUCCESS");

  const templatesResponse = await fetch(`${baseUrl}/api/admin/email-config/templates`, { headers });
  assert.equal(templatesResponse.status, 200);
  const templates = await templatesResponse.json();
  assert.ok(templates.data.some((template) => template.type === "password-reset"));

  const templateCreateResponse = await fetch(`${baseUrl}/api/admin/email-config/templates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Custom Ops Alert",
      subject: "Alert: {{title}}",
      body: "<p>{{body}}</p>",
      type: "custom-ops-alert",
      isActive: true,
    }),
  });
  assert.equal(templateCreateResponse.status, 201);
  const createdTemplate = await templateCreateResponse.json();
  assert.equal(createdTemplate.data.type, "custom-ops-alert");

  const forgotResponse = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com" }),
  });
  assert.equal(forgotResponse.status, 200);
  assert.equal(readCollection("email_jobs").length, 1);
  assert.equal(readCollection("email_logs").filter((log) => log.status === "queued").length, 1);

  const processResponse = await fetch(`${baseUrl}/api/admin/email-config/queue/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({ limit: 5 }),
  });
  assert.equal(processResponse.status, 200);
  const processed = await processResponse.json();
  assert.equal(processed.data.processed, 1);
  assert.equal(readCollection("email_jobs")[0].status, "sent");
  assert.equal(readCollection("email_logs").filter((log) => log.status === "sent").length, 2);

  const disableResponse = await fetch(`${baseUrl}/api/admin/email-config/status`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disableResponse.status, 200);
  const disabled = await disableResponse.json();
  assert.equal(disabled.data.status, "disabled");

  const disabledTestResponse = await fetch(`${baseUrl}/api/admin/email-config/test`, {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient: "admin@example.com" }),
  });
  assert.equal(disabledTestResponse.status, 503);
  const disabledTest = await disabledTestResponse.json();
  assert.equal(disabledTest.success, false);

  const legacySystemResponse = await fetch(`${baseUrl}/api/v1/system-management/email/configuration`, { headers });
  assert.equal(legacySystemResponse.status, 200);
  const legacySystem = await legacySystemResponse.json();
  assert.equal(legacySystem.data.hasPassword, true);
  assert.equal(legacySystem.data.encryptedPassword, undefined);

  const logsResponse = await fetch(`${baseUrl}/api/admin/email-config/logs`, { headers });
  assert.equal(logsResponse.status, 200);
  const logs = await logsResponse.json();
  assert.ok(logs.data.some((log) => log.status === "cancelled"));
  assert.equal(JSON.stringify(logs.data).includes("postmark-token"), false);
  assert.equal(JSON.stringify(readCollection("operational_audit_logs")).includes("postmark-token"), false);

  const audits = readCollection("operational_audit_logs");
  assert.ok(audits.some((audit) => audit.module === "Email Configuration" && audit.action === "EMAIL_CONFIG_UPDATED"));
  assert.ok(audits.some((audit) => audit.action === "EMAIL_SERVICE_DISABLED"));
});
