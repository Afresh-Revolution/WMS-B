const { createHttpError } = require("../../utils/http");

function isMockDelivery() {
  return process.env.NODE_ENV === "test" || process.env.SMS_MOCK_DELIVERY === "true";
}

async function sendSms({ to, message }) {
  if (!to) {
    throw createHttpError(400, "SMS recipient is required.");
  }
  if (!message) {
    throw createHttpError(400, "SMS message is required.");
  }
  if (isMockDelivery()) {
    return { provider: process.env.SMS_PROVIDER || "mock", providerMessageId: `mock-sms-${Date.now()}` };
  }

  const provider = String(process.env.SMS_PROVIDER || "").toLowerCase();
  if (provider === "termii") {
    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TERMII_API_KEY,
        to,
        from: process.env.TERMII_SENDER_ID || "Afresh",
        sms: message,
        type: "plain",
        channel: "generic",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = createHttpError(502, payload.message || "SMS delivery failed.");
      error.code = "SMS_DELIVERY_FAILED";
      throw error;
    }
    return { provider: "termii", providerMessageId: payload.message_id || null };
  }

  const error = createHttpError(503, "SMS provider is not configured.");
  error.code = "SMS_PROVIDER_NOT_CONFIGURED";
  throw error;
}

module.exports = { sendSms };
