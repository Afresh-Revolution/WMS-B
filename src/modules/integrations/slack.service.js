const SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_TEST_URL = "https://slack.com/api/auth.test";
const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

function isMockExternal() {
  return process.env.NODE_ENV === "test" && process.env.INTEGRATIONS_MOCK_EXTERNAL === "true";
}

function requireEnv(name) {
  if (!process.env[name]) {
    const error = new Error(`${name} is not configured.`);
    error.statusCode = 503;
    error.publicMessage = "Slack OAuth is not configured.";
    error.code = "INTEGRATION_CONNECTION_FAILED";
    throw error;
  }
  return process.env[name];
}

function getAuthUrl(state) {
  const url = new URL(SLACK_AUTH_URL);
  url.searchParams.set("client_id", requireEnv("SLACK_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("SLACK_REDIRECT_URI"));
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "chat:write,channels:read,groups:read,users:read");
  return url.toString();
}

async function exchangeCode(code) {
  if (isMockExternal()) {
    return {
      accessToken: `xoxb-${code}`,
      refreshToken: null,
      accountEmail: "mock-slack-workspace@example.com",
      externalAccountId: "T-MOCK-SLACK",
      config: { teamName: "Mock Slack Workspace" },
    };
  }

  const body = new URLSearchParams({
    client_id: requireEnv("SLACK_CLIENT_ID"),
    client_secret: requireEnv("SLACK_CLIENT_SECRET"),
    redirect_uri: requireEnv("SLACK_REDIRECT_URI"),
    code,
  });
  const response = await fetch(SLACK_TOKEN_URL, { method: "POST", body });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || "Slack OAuth failed.");
    error.statusCode = 400;
    error.publicMessage = "Unable to connect Slack.";
    error.code = "OAUTH_FAILED";
    throw error;
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    accountEmail: payload.authed_user?.email || null,
    externalAccountId: payload.team?.id || payload.enterprise?.id || null,
    config: { teamName: payload.team?.name || payload.enterprise?.name || null },
  };
}

async function testConnection(credentials) {
  if (isMockExternal()) {
    return { ok: true, message: "Connection is working", accountEmail: "mock-slack-workspace@example.com" };
  }
  const response = await fetch(SLACK_TEST_URL, {
    headers: { authorization: `Bearer ${credentials.accessToken}` },
  });
  const payload = await response.json();
  return {
    ok: response.ok && payload.ok !== false,
    message: payload.ok === false ? payload.error || "Slack connection failed." : "Connection is working",
    accountEmail: payload.user || payload.team || null,
    responseCode: response.status,
  };
}

async function sendMessage(credentials, { channel, message }) {
  if (isMockExternal()) {
    return { ok: true, providerMessageId: `mock-slack-${Date.now()}`, responseCode: 200 };
  }
  const response = await fetch(SLACK_POST_MESSAGE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel, text: message }),
  });
  const payload = await response.json();
  return {
    ok: response.ok && payload.ok !== false,
    providerMessageId: payload.ts || null,
    message: payload.ok === false ? payload.error || "Slack message failed." : "Message sent.",
    responseCode: response.status,
  };
}

module.exports = { exchangeCode, getAuthUrl, sendMessage, testConnection };
