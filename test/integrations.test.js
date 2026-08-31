const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-integrations";
process.env.ENCRYPTION_KEY = "test-encryption-key-that-is-long-enough";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
process.env.INTEGRATIONS_MOCK_EXTERNAL = "true";
process.env.SLACK_CLIENT_ID = "slack-client";
process.env.SLACK_CLIENT_SECRET = "slack-secret";
process.env.SLACK_REDIRECT_URI = "http://127.0.0.1/api/integrations/slack/callback";
process.env.GOOGLE_CLIENT_ID = "google-client";
process.env.GOOGLE_CLIENT_SECRET = "google-secret";
process.env.GOOGLE_REDIRECT_URI = "http://127.0.0.1/api/integrations/google_workspace/callback";
process.env.ZOOM_CLIENT_ID = "zoom-client";
process.env.ZOOM_CLIENT_SECRET = "zoom-secret";
process.env.ZOOM_REDIRECT_URI = "http://127.0.0.1/api/integrations/zoom/callback";

const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-integrations-"));
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

function signPaystack(body, secret) {
  return crypto.createHmac("sha512", secret).update(body).digest("hex");
}

test("manages integrations with encrypted credentials, provider actions, webhook idempotency, and audit logs", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrap(baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const unauthenticated = await fetch(`${baseUrl}/api/integrations`);
  assert.equal(unauthenticated.status, 401);

  const listResponse = await fetch(`${baseUrl}/api/integrations`, { headers });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.deepEqual(
    list.data.map((item) => item.provider).sort(),
    ["google_workspace", "paystack", "slack", "zoom"]
  );
  assert.equal(list.data.every((item) => item.status === "inactive"), true);
  assert.equal(list.data.some((item) => "accessToken" in item || "refreshToken" in item || "apiKey" in item), false);

  const slackConnectResponse = await fetch(`${baseUrl}/api/integrations/slack/connect`, {
    method: "POST",
    headers,
  });
  assert.equal(slackConnectResponse.status, 200);
  const slackConnect = await slackConnectResponse.json();
  assert.match(slackConnect.data.authUrl, /^https:\/\/slack\.com\/oauth/);

  const invalidStateResponse = await fetch(`${baseUrl}/api/integrations/google_workspace/callback?state=bad&code=bad`);
  assert.equal(invalidStateResponse.status, 400);
  const invalidState = await invalidStateResponse.json();
  assert.equal(invalidState.error.code, "OAUTH_STATE_INVALID");

  const slackCallbackResponse = await fetch(
    `${baseUrl}/api/integrations/slack/callback?state=${slackConnect.data.state}&code=slack-code`
  );
  assert.equal(slackCallbackResponse.status, 200);
  const slackCallback = await slackCallbackResponse.json();
  assert.equal(slackCallback.data.status, "active");
  assert.equal("accessToken" in slackCallback.data, false);

  const storedSlack = readCollection("integrations").find((item) => item.provider === "slack");
  assert.match(storedSlack.accessToken, /^enc:v1:/);
  assert.equal(storedSlack.accessToken.includes("slack-code"), false);

  const slackTestResponse = await fetch(`${baseUrl}/api/integrations/slack/test`, { method: "POST", headers });
  assert.equal(slackTestResponse.status, 200);
  const slackTest = await slackTestResponse.json();
  assert.equal(slackTest.status, "active");

  const slackMessageResponse = await fetch(`${baseUrl}/api/integrations/slack/message`, {
    method: "POST",
    headers,
    body: JSON.stringify({ channel: "general", message: "July payroll has been processed." }),
  });
  assert.equal(slackMessageResponse.status, 200);

  const googleConnectResponse = await fetch(`${baseUrl}/api/integrations/google_workspace/connect`, { method: "POST", headers });
  assert.equal(googleConnectResponse.status, 200);
  const googleConnect = await googleConnectResponse.json();
  const googleCallbackResponse = await fetch(
    `${baseUrl}/api/integrations/google_workspace/callback?state=${googleConnect.data.state}&code=google-code`
  );
  assert.equal(googleCallbackResponse.status, 200);

  const calendarResponse = await fetch(`${baseUrl}/api/integrations/google_workspace/calendar/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Design Review",
      date: "2026-08-20",
      startTime: "10:00",
      duration: 60,
      agenda: "Weekly design review",
      createMeetLink: true,
    }),
  });
  assert.equal(calendarResponse.status, 201);
  const calendarEvent = await calendarResponse.json();
  assert.ok(calendarEvent.data.googleEventId);
  assert.match(calendarEvent.data.meetLink, /^https:\/\/meet\.google\.com/);

  const zoomConnectResponse = await fetch(`${baseUrl}/api/integrations/zoom/connect`, { method: "POST", headers });
  assert.equal(zoomConnectResponse.status, 200);
  const zoomConnect = await zoomConnectResponse.json();
  const zoomCallbackResponse = await fetch(`${baseUrl}/api/integrations/zoom/callback?state=${zoomConnect.data.state}&code=zoom-code`);
  assert.equal(zoomCallbackResponse.status, 200);

  const meetingTypesResponse = await fetch(`${baseUrl}/api/v1/meeting-types`, { headers });
  assert.equal(meetingTypesResponse.status, 200);
  const meetingTypes = await meetingTypesResponse.json();
  const virtualType = meetingTypes.data.find((item) => item.code === "VIRTUAL");
  assert.ok(virtualType);

  const zoomMeetingResponse = await fetch(`${baseUrl}/api/v1/meetings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Design Team Weekly Sync",
      type: "virtual",
      provider: "zoom",
      date: "2026-08-20",
      startTime: "12:00",
      durationMinutes: 60,
      meetingTypeId: virtualType.id,
      agenda: "Weekly design review",
    }),
  });
  assert.equal(zoomMeetingResponse.status, 201);
  const zoomMeeting = await zoomMeetingResponse.json();
  assert.equal(zoomMeeting.data.virtualProvider, "zoom");
  assert.ok(zoomMeeting.data.zoomMeetingId);
  assert.match(zoomMeeting.data.virtualLink, /^https:\/\/zoom\.us\/j\//);

  const paystackSecret = "sk_test_afresh_secret";
  const paystackConnectResponse = await fetch(`${baseUrl}/api/integrations/paystack/connect`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      publicKey: "pk_test_afresh",
      secretKey: paystackSecret,
      environment: "test",
      accountEmail: "finance@example.com",
    }),
  });
  assert.equal(paystackConnectResponse.status, 200);
  const paystackConnect = await paystackConnectResponse.json();
  assert.equal(paystackConnect.data.status, "active");
  assert.equal("apiKey" in paystackConnect.data, false);
  assert.equal(paystackConnect.data.config.publicKey, "pk_test_afresh");

  const storedPaystack = readCollection("integrations").find((item) => item.provider === "paystack");
  assert.match(storedPaystack.apiKey, /^enc:v1:/);
  assert.equal(storedPaystack.apiKey.includes(paystackSecret), false);

  const paymentResponse = await fetch(`${baseUrl}/api/payments/paystack/initialize`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      reference: "INV-001",
      amount: 25000,
      email: "customer@example.com",
      metadata: { source: "test" },
    }),
  });
  assert.equal(paymentResponse.status, 201);
  const payment = await paymentResponse.json();
  assert.equal(payment.data.reference, "INV-001");

  const verifyResponse = await fetch(`${baseUrl}/api/payments/paystack/verify/INV-001`, { headers });
  assert.equal(verifyResponse.status, 200);
  const verified = await verifyResponse.json();
  assert.equal(verified.data.status, "success");

  const webhookBody = JSON.stringify({
    id: "evt_001",
    event: "charge.success",
    data: { reference: "INV-001", id: 1001 },
  });
  const invalidWebhookResponse = await fetch(`${baseUrl}/api/webhooks/paystack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": "bad" },
    body: webhookBody,
  });
  assert.equal(invalidWebhookResponse.status, 401);

  const validWebhookResponse = await fetch(`${baseUrl}/api/webhooks/paystack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": signPaystack(webhookBody, paystackSecret) },
    body: webhookBody,
  });
  assert.equal(validWebhookResponse.status, 200);
  const validWebhook = await validWebhookResponse.json();
  assert.equal(validWebhook.data.processed, true);

  const duplicateWebhookResponse = await fetch(`${baseUrl}/api/webhooks/paystack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": signPaystack(webhookBody, paystackSecret) },
    body: webhookBody,
  });
  assert.equal(duplicateWebhookResponse.status, 200);
  const duplicateWebhook = await duplicateWebhookResponse.json();
  assert.equal(duplicateWebhook.data.duplicate, true);

  const disconnectResponse = await fetch(`${baseUrl}/api/integrations/slack/disconnect`, { method: "POST", headers });
  assert.equal(disconnectResponse.status, 200);
  const disconnectedSlack = await disconnectResponse.json();
  assert.equal(disconnectedSlack.data.status, "inactive");
  const storedDisconnectedSlack = readCollection("integrations").find((item) => item.provider === "slack");
  assert.equal(storedDisconnectedSlack.accessToken, null);

  const logs = readCollection("integration_logs");
  assert.ok(logs.some((log) => log.provider === "slack" && log.action === "SLACK_MESSAGE_SENT"));
  assert.ok(logs.some((log) => log.provider === "paystack" && log.action === "PAYSTACK_WEBHOOK_RECEIVED"));
  assert.equal(JSON.stringify(logs).includes(paystackSecret), false);

  const audits = readCollection("operational_audit_logs");
  assert.ok(audits.some((audit) => audit.module === "Integrations" && audit.action === "INTEGRATION_CONNECTED"));
});
