let webPushClient = null;
let vapidConfigured = false;

function isMockSuccess() {
  return String(process.env.WEB_PUSH_MOCK_DELIVERY || "").toLowerCase() === "success";
}

function isMockGone() {
  return ["gone", "410", "404"].includes(String(process.env.WEB_PUSH_MOCK_DELIVERY || "").toLowerCase());
}

function getVapidConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || null;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || null;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:admin@example.com";
  return { publicKey, privateKey, subject, configured: Boolean(publicKey && privateKey && subject) };
}

function loadWebPush() {
  if (webPushClient !== null) {
    return webPushClient || null;
  }
  try {
    webPushClient = require("web-push");
    return webPushClient;
  } catch (_error) {
    webPushClient = false;
    return null;
  }
}

function configureVapid() {
  const vapid = getVapidConfig();
  if (!vapid.configured) {
    vapidConfigured = false;
    return vapid;
  }
  const client = loadWebPush();
  if (!client) {
    vapidConfigured = false;
    return vapid;
  }
  if (!vapidConfigured) {
    client.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    vapidConfigured = true;
  }
  return vapid;
}

function isPermanentExpiration(statusCode) {
  return statusCode === 404 || statusCode === 410;
}

async function sendPushNotification(subscription, payload) {
  if (!subscription || !subscription.endpoint) {
    return { status: "skipped", statusCode: null, expired: false, reason: "missing_subscription" };
  }

  if (isMockGone()) {
    return { status: "failed", statusCode: 410, expired: true, reason: "expired" };
  }

  if (subscription.forceGone || subscription.force_gone) {
    return { status: "failed", statusCode: 410, expired: true, reason: "expired" };
  }

  if (isMockSuccess()) {
    return { status: "sent", statusCode: 201, expired: false, reason: null };
  }

  const vapid = configureVapid();
  const client = loadWebPush();
  if (!vapid.configured || !client) {
    return { status: "skipped", statusCode: null, expired: false, reason: "not_configured" };
  }

  try {
    const result = await client.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: "normal", headers: {} }
    );
    return { status: "sent", statusCode: result?.statusCode || 201, expired: false, reason: null };
  } catch (error) {
    const statusCode = Number(error.statusCode || error.status) || null;
    if (isPermanentExpiration(statusCode)) {
      return { status: "failed", statusCode, expired: true, reason: "expired" };
    }
    const safeError = new Error("Web Push delivery failed.");
    safeError.statusCode = statusCode || 502;
    safeError.code = "WEB_PUSH_DELIVERY_FAILED";
    safeError.publicMessage = "Web Push delivery failed.";
    throw safeError;
  }
}

module.exports = {
  getVapidConfig,
  isPermanentExpiration,
  sendPushNotification,
};
