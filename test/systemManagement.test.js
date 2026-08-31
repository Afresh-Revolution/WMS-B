const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-system-management";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-system-management-"));
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

test("manages platform settings, access, integrations, maintenance, backups, and technical audit trace", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
    "x-request-id": "req-system-management-001",
  };

  const overviewResponse = await fetch(`${baseUrl}/api/v1/system-management/overview`, { headers: adminHeaders });
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.data.platformUsers, 1);
  assert.equal(overview.data.adminAccounts, 1);
  assert.equal(overview.data.maintenanceMode, false);

  const settingsResponse = await fetch(`${baseUrl}/api/v1/system-management/settings`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      settings: [
        { key: "currency", value: "NGN", type: "string", category: "regional" },
        { key: "file_upload_limit", value: 25, type: "number", category: "files" },
      ],
    }),
  });
  assert.equal(settingsResponse.status, 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.data.length, 2);
  assert.equal(settings.data[0].updatedBy, auth.user.id);

  const securityPatchResponse = await fetch(`${baseUrl}/api/v1/system-management/security/settings`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ minPasswordLength: 10, maxLoginAttempts: 4, mfaRequired: true }),
  });
  assert.equal(securityPatchResponse.status, 200);
  const security = await securityPatchResponse.json();
  assert.equal(security.data.minPasswordLength, 10);
  assert.equal(security.data.mfaRequired, true);

  const userResponse = await fetch(`${baseUrl}/api/v1/system-management/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "System Staff",
      email: "system.staff@example.com",
      password: "password123",
      role: "employee",
    }),
  });
  assert.equal(userResponse.status, 201);
  const createdUser = await userResponse.json();
  assert.equal(createdUser.data.email, "system.staff@example.com");
  assert.equal(createdUser.data.passwordHash, undefined);

  const lockResponse = await fetch(`${baseUrl}/api/v1/system-management/users/${createdUser.data.id}/lock`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(lockResponse.status, 200);
  const locked = await lockResponse.json();
  assert.equal(locked.data.status, "locked");

  const unlockResponse = await fetch(`${baseUrl}/api/v1/system-management/users/${createdUser.data.id}/unlock`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(unlockResponse.status, 200);
  const unlocked = await unlockResponse.json();
  assert.equal(unlocked.data.status, "active");

  const resetResponse = await fetch(`${baseUrl}/api/v1/system-management/users/${createdUser.data.id}/reset-password`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ password: "newpassword123" }),
  });
  assert.equal(resetResponse.status, 200);

  const employeeToken = issueAccessToken(getUserById(createdUser.data.id));
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${employeeToken}`,
  };

  const enableMaintenanceResponse = await fetch(`${baseUrl}/api/v1/system-management/maintenance/enable`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ message: "Maintenance window" }),
  });
  assert.equal(enableMaintenanceResponse.status, 200);

  const blockedResponse = await fetch(`${baseUrl}/api/v1/reports/overview`, { headers: employeeHeaders });
  assert.equal(blockedResponse.status, 503);

  const disableMaintenanceResponse = await fetch(`${baseUrl}/api/v1/system-management/maintenance/disable`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(disableMaintenanceResponse.status, 200);

  const roleResponse = await fetch(`${baseUrl}/api/v1/system-management/roles`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ key: "auditor", name: "Auditor", permissions: ["report.view"] }),
  });
  assert.equal(roleResponse.status, 201);
  const role = await roleResponse.json();
  const rolePermissionResponse = await fetch(`${baseUrl}/api/v1/system-management/roles/${role.data.id}/permissions`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ permissions: ["report.view", "operational_audit.view"] }),
  });
  assert.equal(rolePermissionResponse.status, 200);
  const rolePermissions = await rolePermissionResponse.json();
  assert.deepEqual(rolePermissions.data.permissions, ["report.view", "operational_audit.view"]);

  const integrationResponse = await fetch(`${baseUrl}/api/v1/system-management/integrations`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Cloud Storage",
      provider: "s3",
      type: "storage",
      secretKey: "do-not-return",
      configuration: { bucket: "wms", secretKey: "hidden", publicKey: "visible" },
    }),
  });
  assert.equal(integrationResponse.status, 201);
  const integration = await integrationResponse.json();
  assert.equal(integration.data.hasSecret, true);
  assert.equal(integration.data.encryptedSecret, undefined);
  assert.equal(integration.data.configuration.secretKey, "[ENCRYPTED]");
  assert.equal(integration.data.configuration.publicKey, "visible");

  const integrationTestResponse = await fetch(`${baseUrl}/api/v1/system-management/integrations/${integration.data.id}/test`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(integrationTestResponse.status, 200);
  const integrationTest = await integrationTestResponse.json();
  assert.equal(integrationTest.data.status, "SUCCESS");

  const emailResponse = await fetch(`${baseUrl}/api/v1/system-management/email/configuration`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      username: "mailer",
      password: "smtp-secret",
      fromName: "WMS",
      fromEmail: "noreply@example.com",
    }),
  });
  assert.equal(emailResponse.status, 200);
  const email = await emailResponse.json();
  assert.equal(email.data.hasPassword, true);
  assert.equal(email.data.encryptedPassword, undefined);

  const emailTestResponse = await fetch(`${baseUrl}/api/v1/system-management/email/test`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ recipient: "admin@example.com" }),
  });
  assert.equal(emailTestResponse.status, 200);
  const emailTest = await emailTestResponse.json();
  assert.equal(emailTest.data.status, "SUCCESS");

  const notificationResponse = await fetch(`${baseUrl}/api/v1/system-management/notifications/configuration`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ leaveApproval: true, payroll: false, channels: ["IN_APP"] }),
  });
  assert.equal(notificationResponse.status, 200);
  const notification = await notificationResponse.json();
  assert.equal(notification.data.payroll, false);

  const templateResponse = await fetch(`${baseUrl}/api/v1/system-management/document-templates`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Employment Letter",
      type: "employment_letter",
      content: "Hello {{employee_name}}",
      variables: ["employee_name"],
    }),
  });
  assert.equal(templateResponse.status, 201);
  const template = await templateResponse.json();
  assert.equal(template.data.version, 1);

  const templatePatchResponse = await fetch(`${baseUrl}/api/v1/system-management/document-templates/${template.data.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ content: "Welcome {{employee_name}}" }),
  });
  assert.equal(templatePatchResponse.status, 200);
  const patchedTemplate = await templatePatchResponse.json();
  assert.equal(patchedTemplate.data.version, 2);
  assert.equal(readCollection("document_template_versions").length, 1);

  const backupResponse = await fetch(`${baseUrl}/api/v1/system-management/backups`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ type: "manual", storageLocation: "secure-vault" }),
  });
  assert.equal(backupResponse.status, 202);
  const backup = await backupResponse.json();
  assert.equal(backup.data.status, "PENDING");
  assert.equal(backup.data.encrypted, true);
  assert.ok(backup.data.checksum);

  const restoreDeniedResponse = await fetch(`${baseUrl}/api/v1/system-management/backups/${backup.data.id}/restore`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ confirmation: "NOPE" }),
  });
  assert.equal(restoreDeniedResponse.status, 400);

  const restoreResponse = await fetch(`${baseUrl}/api/v1/system-management/backups/${backup.data.id}/restore`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ confirmation: "RESTORE BACKUP" }),
  });
  assert.equal(restoreResponse.status, 202);

  const healthResponse = await fetch(`${baseUrl}/api/v1/system-management/health`, { headers: adminHeaders });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.data.api.status, "HEALTHY");

  const auditResponse = await fetch(`${baseUrl}/api/v1/system-management/technical-audit-logs`, { headers: adminHeaders });
  assert.equal(auditResponse.status, 200);
  const audits = await auditResponse.json();
  assert.ok(audits.data.some((entry) => entry.action === "SYSTEM_SETTING_UPDATED"));
  assert.ok(audits.data.some((entry) => entry.action === "BACKUP_STARTED"));

  const auditExportResponse = await fetch(`${baseUrl}/api/v1/system-management/technical-audit-logs/export`, { headers: adminHeaders });
  assert.equal(auditExportResponse.status, 200);
  const csv = await auditExportResponse.text();
  assert.match(csv, /SYSTEM_SETTING_UPDATED/);
});
