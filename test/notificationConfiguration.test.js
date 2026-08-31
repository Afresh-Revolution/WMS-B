const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-notifications";
process.env.ENCRYPTION_KEY = "test-notification-encryption-key-that-is-long-enough";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
process.env.EMAIL_MOCK_DELIVERY = "true";
process.env.SMS_MOCK_DELIVERY = "true";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById, updateUser } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const notificationService = require("../src/modules/notifications/notification.service");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-notifications-"));
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

async function createUser(baseUrl, headers, email) {
  const response = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fullName: "Notification User",
      email,
      roleId: "employee",
      accountType: "STAFF",
      temporaryPassword: "TempPass123!",
      status: "active",
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("manages notification configuration, user bell state, delivery rules, queueing, preferences, and audit", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrap(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const unauthenticated = await fetch(`${baseUrl}/api/admin/notification-config`);
  assert.equal(unauthenticated.status, 401);

  const configResponse = await fetch(`${baseUrl}/api/admin/notification-config`, { headers: adminHeaders });
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.data.channels.inApp, true);
  assert.equal(config.data.channels.email, true);
  assert.equal(config.data.channels.sms, false);

  const disableEmailResponse = await fetch(`${baseUrl}/api/admin/notification-config/channels`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ channel: "email", enabled: false }),
  });
  assert.equal(disableEmailResponse.status, 200);
  const disabledEmail = await disableEmailResponse.json();
  assert.equal(disabledEmail.data.channels.email, false);

  const enableSmsResponse = await fetch(`${baseUrl}/api/admin/notification-config/channels`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ channel: "sms", enabled: true }),
  });
  assert.equal(enableSmsResponse.status, 200);
  const enabledSms = await enableSmsResponse.json();
  assert.equal(enabledSms.data.channels.sms, true);

  const deliveryPrefsResponse = await fetch(`${baseUrl}/api/admin/notification-config/delivery-preferences`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      dailyDigest: { enabled: true, time: "08:00", channels: ["email"] },
      quietHours: { enabled: true, start: "00:00", end: "23:59" },
    }),
  });
  assert.equal(deliveryPrefsResponse.status, 200);
  const deliveryPrefs = await deliveryPrefsResponse.json();
  assert.equal(deliveryPrefs.data.quietHours.enabled, true);

  const ruleResponse = await fetch(`${baseUrl}/api/admin/notification-config/rules/SECURITY_ALERT`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ inAppEnabled: true, emailEnabled: true, smsEnabled: true, priority: "urgent" }),
  });
  assert.equal(ruleResponse.status, 200);
  const rule = await ruleResponse.json();
  assert.equal(rule.data.smsEnabled, true);
  assert.equal(rule.data.priority, "urgent");

  const userResponse = await createUser(baseUrl, adminHeaders, "notify.user@example.com");
  updateUser(userResponse.data.id, { mustChangePassword: false, forcePasswordReset: false });
  const user = getUserById(userResponse.data.id);
  const userHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(user)}`,
  };

  const preferencesResponse = await fetch(`${baseUrl}/api/notifications/preferences`, {
    method: "PATCH",
    headers: userHeaders,
    body: JSON.stringify({
      quietHoursEnabled: true,
      quietHoursStart: "00:00",
      quietHoursEnd: "23:59",
      channelPreferences: { email: false },
      typePreferences: { TASK_ASSIGNED: { in_app: true, email: false, sms: false } },
    }),
  });
  assert.equal(preferencesResponse.status, 200);
  const preferences = await preferencesResponse.json();
  assert.equal(preferences.data.channelPreferences.email, false);

  const taskNotification = notificationService.send({
    userId: user.id,
    type: "TASK_ASSIGNED",
    title: "New task assigned",
    message: "You have been assigned a new task.",
    module: "Tasks",
    entityType: "task",
    entityId: "TASK-001",
    channels: ["in_app", "email", "sms"],
  });
  assert.ok(taskNotification.notification.id);

  const listResponse = await fetch(`${baseUrl}/api/notifications`, { headers: userHeaders });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.ok(list.unreadCount >= 1);
  const taskListItem = list.data.find((item) => item.title === "New task assigned");
  assert.ok(taskListItem);
  assert.equal(taskListItem.isRead, false);

  const readResponse = await fetch(`${baseUrl}/api/notifications/${taskListItem.id}/read`, {
    method: "PATCH",
    headers: userHeaders,
  });
  assert.equal(readResponse.status, 200);
  const read = await readResponse.json();
  assert.equal(read.data.isRead, true);

  notificationService.send({
    userId: user.id,
    type: "SECURITY_ALERT",
    title: "Security alert",
    message: "A sign-in needs your attention.",
    phone: "+2348000000000",
    channels: ["in_app", "email", "sms"],
  });

  const jobsBefore = readCollection("notification_jobs");
  assert.ok(jobsBefore.some((job) => job.channel === "sms"));
  assert.equal(jobsBefore.some((job) => job.channel === "email"), false);

  const queueResponse = await fetch(`${baseUrl}/api/admin/notification-config/queue/process`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ limit: 10 }),
  });
  assert.equal(queueResponse.status, 200);
  const queue = await queueResponse.json();
  assert.equal(queue.data.processed, 1);
  assert.equal(readCollection("notification_jobs").every((job) => job.status === "sent"), true);

  const logsResponse = await fetch(`${baseUrl}/api/admin/notification-config/logs`, { headers: adminHeaders });
  assert.equal(logsResponse.status, 200);
  const logs = await logsResponse.json();
  assert.ok(logs.data.some((log) => log.channel === "sms" && log.status === "sent"));
  assert.ok(logs.data.some((log) => log.channel === "email" && log.status === "skipped"));

  const readAllResponse = await fetch(`${baseUrl}/api/notifications/read-all`, {
    method: "PATCH",
    headers: userHeaders,
  });
  assert.equal(readAllResponse.status, 200);

  const deleteResponse = await fetch(`${baseUrl}/api/notifications/${taskListItem.id}`, {
    method: "DELETE",
    headers: userHeaders,
  });
  assert.equal(deleteResponse.status, 200);

  const legacySystemResponse = await fetch(`${baseUrl}/api/v1/system-management/notifications/configuration`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ payroll: false, channels: ["IN_APP"] }),
  });
  assert.equal(legacySystemResponse.status, 200);
  const legacySystem = await legacySystemResponse.json();
  assert.equal(legacySystem.data.payroll, false);

  const audits = readCollection("operational_audit_logs");
  assert.ok(audits.some((audit) => audit.module === "Notification Configuration" && audit.action === "NOTIFICATION_CHANNEL_DISABLED"));
  assert.ok(audits.some((audit) => audit.action === "NOTIFICATION_RULE_UPDATED"));
  assert.ok(audits.some((audit) => audit.action === "USER_NOTIFICATION_PREFERENCES_UPDATED"));
});
