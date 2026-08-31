const crypto = require("crypto");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function isMockExternal() {
  return process.env.NODE_ENV === "test" && process.env.INTEGRATIONS_MOCK_EXTERNAL === "true";
}

function getSecret(credentials = {}) {
  return credentials.apiKey || process.env.PAYSTACK_SECRET_KEY || null;
}

function assertSecret(credentials = {}) {
  const secret = getSecret(credentials);
  if (!secret) {
    const error = new Error("Paystack secret key is not configured.");
    error.statusCode = 503;
    error.publicMessage = "Paystack is not configured.";
    error.code = "INTEGRATION_CONNECTION_FAILED";
    throw error;
  }
  return secret;
}

function verifyWebhookSignature(rawBody, signature, secretKey) {
  if (!rawBody || !signature || !secretKey) {
    return false;
  }
  const expected = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function paystackFetch(path, credentials, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${assertSecret(credentials)}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function testConnection(credentials) {
  if (isMockExternal()) {
    return { ok: true, message: "Connection is working", responseCode: 200 };
  }
  const { response, payload } = await paystackFetch("/bank", credentials);
  return {
    ok: response.ok && payload.status !== false,
    message: payload.message || "Connection is working",
    responseCode: response.status,
  };
}

async function initializePayment(credentials, payload) {
  if (isMockExternal()) {
    return {
      ok: true,
      reference: payload.reference || `AFRESH-${Date.now()}`,
      authorizationUrl: `https://checkout.paystack.com/mock-${Date.now()}`,
      accessCode: `mock-access-${Date.now()}`,
      responseCode: 200,
    };
  }
  const { response, payload: result } = await paystackFetch("/transaction/initialize", credentials, {
    method: "POST",
    body: JSON.stringify({
      email: payload.email,
      amount: Math.round(Number(payload.amount || 0) * 100),
      reference: payload.reference,
      callback_url: payload.callbackUrl || payload.callback_url || null,
      metadata: payload.metadata || {},
    }),
  });
  return {
    ok: response.ok && result.status !== false,
    reference: result.data?.reference || payload.reference || null,
    authorizationUrl: result.data?.authorization_url || null,
    accessCode: result.data?.access_code || null,
    message: result.message || "Payment initialized.",
    responseCode: response.status,
  };
}

async function verifyPayment(credentials, reference) {
  if (isMockExternal()) {
    return { ok: true, reference, status: "success", amount: null, responseCode: 200 };
  }
  const { response, payload } = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, credentials);
  return {
    ok: response.ok && payload.status !== false && payload.data?.status === "success",
    reference: payload.data?.reference || reference,
    status: payload.data?.status || "failed",
    amount: payload.data?.amount ? Number(payload.data.amount) / 100 : null,
    message: payload.message || "Payment verification completed.",
    responseCode: response.status,
  };
}

async function createTransfer(credentials, payload) {
  if (isMockExternal()) {
    return { ok: true, reference: payload.reference || `TRF-${Date.now()}`, transferCode: `TRF_mock_${Date.now()}`, responseCode: 200 };
  }
  const { response, payload: result } = await paystackFetch("/transfer", credentials, {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: Math.round(Number(payload.amount || 0) * 100),
      recipient: payload.recipient,
      reason: payload.reason || "Afresh payment",
      reference: payload.reference,
    }),
  });
  return {
    ok: response.ok && result.status !== false,
    reference: result.data?.reference || payload.reference || null,
    transferCode: result.data?.transfer_code || null,
    message: result.message || "Transfer created.",
    responseCode: response.status,
  };
}

async function verifyTransfer(credentials, transferCode) {
  if (isMockExternal()) {
    return { ok: true, transferCode, status: "success", responseCode: 200 };
  }
  const { response, payload } = await paystackFetch(`/transfer/verify/${encodeURIComponent(transferCode)}`, credentials);
  return {
    ok: response.ok && payload.status !== false,
    transferCode,
    status: payload.data?.status || "failed",
    message: payload.message || "Transfer verification completed.",
    responseCode: response.status,
  };
}

module.exports = {
  createTransfer,
  initializePayment,
  testConnection,
  verifyPayment,
  verifyTransfer,
  verifyWebhookSignature,
};
