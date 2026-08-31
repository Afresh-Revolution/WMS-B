const ZOOM_AUTH_URL = "https://zoom.us/oauth/authorize";
const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_ME_URL = "https://api.zoom.us/v2/users/me";
const ZOOM_MEETINGS_URL = "https://api.zoom.us/v2/users/me/meetings";

function isMockExternal() {
  return process.env.NODE_ENV === "test" && process.env.INTEGRATIONS_MOCK_EXTERNAL === "true";
}

function requireEnv(name) {
  if (!process.env[name]) {
    const error = new Error(`${name} is not configured.`);
    error.statusCode = 503;
    error.publicMessage = "Zoom OAuth is not configured.";
    error.code = "INTEGRATION_CONNECTION_FAILED";
    throw error;
  }
  return process.env[name];
}

function authHeader() {
  return `Basic ${Buffer.from(`${requireEnv("ZOOM_CLIENT_ID")}:${requireEnv("ZOOM_CLIENT_SECRET")}`).toString("base64")}`;
}

function getAuthUrl(state) {
  const url = new URL(ZOOM_AUTH_URL);
  url.searchParams.set("client_id", requireEnv("ZOOM_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("ZOOM_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(code) {
  if (isMockExternal()) {
    return {
      accessToken: `zoom-access-${code}`,
      refreshToken: `zoom-refresh-${code}`,
      expiresIn: 3600,
      accountEmail: "zoom-admin@example.com",
      externalAccountId: "zoom-mock-account",
      config: {},
    };
  }
  const url = new URL(ZOOM_TOKEN_URL);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", requireEnv("ZOOM_REDIRECT_URI"));
  const response = await fetch(url, { method: "POST", headers: { authorization: authHeader() } });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = new Error(payload.reason || payload.error || "Zoom OAuth failed.");
    error.statusCode = 400;
    error.publicMessage = "Unable to connect Zoom.";
    error.code = "OAUTH_FAILED";
    throw error;
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresIn: payload.expires_in || null,
    accountEmail: null,
    externalAccountId: null,
    config: {},
  };
}

async function refreshAccessToken(refreshToken) {
  if (isMockExternal()) {
    return { accessToken: `zoom-refresh-access-${Date.now()}`, expiresIn: 3600 };
  }
  const url = new URL(ZOOM_TOKEN_URL);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", refreshToken);
  const response = await fetch(url, { method: "POST", headers: { authorization: authHeader() } });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = new Error(payload.reason || payload.error || "Zoom token refresh failed.");
    error.statusCode = 401;
    error.publicMessage = "Zoom connection has expired. Please reconnect.";
    error.code = "TOKEN_REFRESH_FAILED";
    throw error;
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token || refreshToken, expiresIn: payload.expires_in || null };
}

async function testConnection(credentials) {
  if (isMockExternal()) {
    return { ok: true, message: "Connection is working", accountEmail: "zoom-admin@example.com", responseCode: 200 };
  }
  const response = await fetch(ZOOM_ME_URL, { headers: { authorization: `Bearer ${credentials.accessToken}` } });
  const payload = await response.json();
  return {
    ok: response.ok,
    message: payload.message || "Connection is working",
    accountEmail: payload.email || null,
    externalAccountId: payload.id || null,
    responseCode: response.status,
  };
}

async function createMeeting(credentials, config, payload) {
  if (isMockExternal()) {
    const id = `zoom-${Date.now()}`;
    return {
      ok: true,
      meetingId: id,
      joinUrl: `https://zoom.us/j/${id}`,
      startUrl: `https://zoom.us/s/${id}?zak=mock`,
      responseCode: 201,
    };
  }
  const response = await fetch(ZOOM_MEETINGS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      topic: payload.title,
      type: 2,
      start_time: payload.startAt,
      duration: Number(payload.duration || payload.durationMinutes || config.defaultMeetingDuration || 60),
      agenda: payload.agenda || null,
      timezone: payload.timezone || "UTC",
    }),
  });
  const result = await response.json();
  return {
    ok: response.ok,
    meetingId: result.id ? String(result.id) : null,
    joinUrl: result.join_url || null,
    startUrl: result.start_url || null,
    message: result.message || "Zoom meeting created.",
    responseCode: response.status,
  };
}

async function updateMeeting(credentials, meetingId, payload) {
  if (isMockExternal()) {
    return { ok: true, meetingId, responseCode: 204 };
  }
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: response.ok, meetingId, message: response.ok ? "Zoom meeting updated." : "Zoom meeting update failed.", responseCode: response.status };
}

async function deleteMeeting(credentials, meetingId) {
  if (isMockExternal()) {
    return { ok: true, meetingId, responseCode: 204 };
  }
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${credentials.accessToken}` },
  });
  return { ok: response.ok, meetingId, message: response.ok ? "Zoom meeting deleted." : "Zoom meeting deletion failed.", responseCode: response.status };
}

module.exports = { createMeeting, deleteMeeting, exchangeCode, getAuthUrl, refreshAccessToken, testConnection, updateMeeting };
