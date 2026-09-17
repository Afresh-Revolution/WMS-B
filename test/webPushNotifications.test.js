const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-web-push";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "test-public-key";
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "test-private-key";
process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:admin@example.com";
process.env.WEB_PUSH_MOCK_DELIVERY = "success";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { readCollection } = require("../src/database/jsonStore");
const notificationService = require("../src/modules/notifications/notification.service");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-web-push-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

function authHeaders(user) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(user)}`,
  };
}

function subscriptionPayload(endpoint) {
  return {
    endpoint,
    keys: {
      p256dh: "p256dh-key",
      auth: "auth-key",
    },
    metadata: {
      browser: "Chromium",
      device: "Desktop",
    },
    userId: "malicious-user-id",
  };
}

test("notification center and push subscriptions are self-scoped and idempotent", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const user = createUser({
    name: "Push User",
    email: "push.user@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    status: "active",
    organizationId: "org-1",
  });
  const other = createUser({
    name: "Other User",
    email: "other.push@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    status: "active",
    organizationId: "org-1",
  });

  const publicKeyResponse = await fetch(`${baseUrl}/api/v1/notifications/push/public-key`, { headers: authHeaders(user) });
  assert.equal(publicKeyResponse.status, 200);
  const publicKey = await publicKeyResponse.json();
  assert.equal(publicKey.data.publicKey, "test-public-key");

  const subscribeResponse = await fetch(`${baseUrl}/api/v1/notifications/push/subscribe`, {
    method: "POST",
    headers: authHeaders(user),
    body: JSON.stringify(subscriptionPayload("https://push.example.com/subscription/1")),
  });
  assert.equal(subscribeResponse.status, 201);
  const subscription = await subscribeResponse.json();
  assert.equal(subscription.data.userId, user.id);
  assert.equal(subscription.data.endpoint, undefined);
  assert.equal(subscription.data.p256dh, undefined);

  const duplicateSubscribeResponse = await fetch(`${baseUrl}/api/v1/notifications/push/subscribe`, {
    method: "POST",
    headers: authHeaders(user),
    body: JSON.stringify(subscriptionPayload("https://push.example.com/subscription/1")),
  });
  assert.equal(duplicateSubscribeResponse.status, 201);
  assert.equal(readCollection("push_subscriptions").length, 1);

  assert.throws(() => notificationService.send({
    userId: user.id,
    type: "GENERAL",
    title: "Unsafe",
    message: "Unsafe",
    destinationUrl: "https://example.com/phishing",
  }), /internal route/);

  const first = notificationService.send({
    userId: user.id,
    type: "MESSAGE_RECEIVED",
    title: "New message",
    message: "Open your inbox.",
    destinationUrl: "/messages",
    idempotencyKey: "message-1",
    channels: ["in_app", "push"],
  });
  const second = notificationService.send({
    userId: user.id,
    type: "MESSAGE_RECEIVED",
    title: "New message duplicate",
    message: "Open your inbox.",
    destinationUrl: "/messages",
    idempotencyKey: "message-1",
    channels: ["in_app", "push"],
  });
  assert.equal(first.notification.id, second.notification.id);

  const listResponse = await fetch(`${baseUrl}/api/v1/notifications`, { headers: authHeaders(user) });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.unreadCount, 1);
  assert.equal(list.data[0].destinationUrl, "/messages");

  const otherListResponse = await fetch(`${baseUrl}/api/v1/notifications`, { headers: authHeaders(other) });
  assert.equal(otherListResponse.status, 200);
  const otherList = await otherListResponse.json();
  assert.equal(otherList.data.length, 0);

  const unreadResponse = await fetch(`${baseUrl}/api/v1/notifications/unread-count`, { headers: authHeaders(user) });
  assert.equal(unreadResponse.status, 200);
  const unread = await unreadResponse.json();
  assert.equal(unread.data.unreadCount, 1);

  const processResponse = await fetch(`${baseUrl}/api/v1/notification-config/queue/process`, {
    method: "POST",
    headers: authHeaders(createUser({
      name: "Admin",
      email: "push.admin@example.com",
      passwordHash: hashPassword("password123"),
      role: "superadmin",
      status: "active",
    })),
    body: JSON.stringify({ limit: 10 }),
  });
  assert.equal(processResponse.status, 200);
  assert.ok(readCollection("notification_delivery_logs").some((log) => log.channel === "push" && log.status === "sent"));

  const blockedUnsubscribeResponse = await fetch(`${baseUrl}/api/v1/notifications/push/subscriptions/${subscription.data.id}`, {
    method: "DELETE",
    headers: authHeaders(other),
  });
  assert.equal(blockedUnsubscribeResponse.status, 404);

  const unsubscribeResponse = await fetch(`${baseUrl}/api/v1/notifications/push/subscriptions/${subscription.data.id}`, {
    method: "DELETE",
    headers: authHeaders(user),
  });
  assert.equal(unsubscribeResponse.status, 200);
  assert.ok(readCollection("push_subscriptions").find((record) => record.id === subscription.data.id).revokedAt);
});

test("expired push subscriptions are disabled and destinations stay internal", async (t) => {
  const previous = process.env.WEB_PUSH_MOCK_DELIVERY;
  process.env.WEB_PUSH_MOCK_DELIVERY = "gone";
  t.after(() => {
    process.env.WEB_PUSH_MOCK_DELIVERY = previous;
  });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-web-push-expired-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const user = createUser({
    name: "Expired Push",
    email: "expired.push@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    status: "active",
    organizationId: "org-1",
  });
  notificationService.subscribePush(user, subscriptionPayload("https://push.example.com/expired"));
  notificationService.send({
    userId: user.id,
    type: "MESSAGE_RECEIVED",
    title: "Inbox",
    message: "Hello",
    destinationUrl: "/messages",
    channels: ["in_app", "push"],
  });
  await notificationService.processQueue(10);
  const subscription = readCollection("push_subscriptions")[0];
  assert.ok(subscription.disabledAt || subscription.disabled_at);

  assert.equal(notificationService.normalizeDestinationUrl("/employee/attendance"), "/employee/attendance");
  assert.throws(() => notificationService.normalizeDestinationUrl("/evil"), /internal route/);
  assert.equal(notificationService.retryDelayMs(1), 60 * 1000);
  assert.equal(notificationService.retryDelayMs(3), 4 * 60 * 1000);
});

test("serves PWA check-in assets", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const page = await fetch(`${baseUrl}/check-in`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Check in/);

  const worker = await fetch(`${baseUrl}/sw.js`);
  assert.equal(worker.status, 200);
  assert.equal(worker.headers.get("service-worker-allowed"), "/");
  assert.match(await worker.text(), /push/);
});
