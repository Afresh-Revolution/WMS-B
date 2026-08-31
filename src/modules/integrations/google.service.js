const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://www.googleapis.com/oauth2/v1/tokeninfo";
const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";

function isMockExternal() {
  return process.env.NODE_ENV === "test" && process.env.INTEGRATIONS_MOCK_EXTERNAL === "true";
}

function requireEnv(name) {
  if (!process.env[name]) {
    const error = new Error(`${name} is not configured.`);
    error.statusCode = 503;
    error.publicMessage = "Google Workspace OAuth is not configured.";
    error.code = "INTEGRATION_CONNECTION_FAILED";
    throw error;
  }
  return process.env[name];
}

function getAuthUrl(state) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("GOOGLE_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set(
    "scope",
    [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" ")
  );
  return url.toString();
}

async function exchangeCode(code) {
  if (isMockExternal()) {
    return {
      accessToken: `ya29.${code}`,
      refreshToken: `refresh-${code}`,
      expiresIn: 3600,
      accountEmail: "workspace-admin@example.com",
      externalAccountId: "google-mock-account",
      config: {},
    };
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
      code,
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = new Error(payload.error_description || payload.error || "Google OAuth failed.");
    error.statusCode = 400;
    error.publicMessage = "Unable to connect Google Workspace.";
    error.code = "OAUTH_FAILED";
    throw error;
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresIn: payload.expires_in || null,
    accountEmail: null,
    externalAccountId: payload.scope || null,
    config: {},
  };
}

async function refreshAccessToken(refreshToken) {
  if (isMockExternal()) {
    return { accessToken: `ya29.refresh.${Date.now()}`, expiresIn: 3600 };
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = new Error(payload.error_description || payload.error || "Google token refresh failed.");
    error.statusCode = 401;
    error.publicMessage = "Google Workspace connection has expired. Please reconnect.";
    error.code = "TOKEN_REFRESH_FAILED";
    throw error;
  }
  return { accessToken: payload.access_token, expiresIn: payload.expires_in || null };
}

async function testConnection(credentials) {
  if (isMockExternal()) {
    return { ok: true, message: "Connection is working", responseCode: 200 };
  }
  const url = new URL(GOOGLE_TOKEN_INFO_URL);
  url.searchParams.set("access_token", credentials.accessToken);
  const response = await fetch(url);
  const payload = await response.json();
  return {
    ok: response.ok && !payload.error,
    message: payload.error_description || payload.error || "Connection is working",
    accountEmail: payload.email || null,
    responseCode: response.status,
  };
}

async function createCalendarEvent(credentials, config, payload) {
  if (isMockExternal()) {
    const eventId = `google-event-${Date.now()}`;
    return {
      ok: true,
      eventId,
      htmlLink: `https://calendar.google.com/calendar/event?eid=${eventId}`,
      meetLink: payload.createMeetLink === false ? null : `https://meet.google.com/mock-${eventId.slice(-6)}`,
      responseCode: 200,
    };
  }

  const calendarId = encodeURIComponent(config.calendarId || payload.calendarId || "primary");
  const response = await fetch(`${GOOGLE_CALENDAR_URL}/${calendarId}/events?conferenceDataVersion=1`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      summary: payload.title,
      description: payload.agenda || payload.description || null,
      start: { dateTime: payload.startAt },
      end: { dateTime: payload.endAt },
      location: payload.location || null,
      conferenceData:
        payload.createMeetLink === false
          ? undefined
          : { createRequest: { requestId: `afresh-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  const result = await response.json();
  return {
    ok: response.ok,
    eventId: result.id || null,
    htmlLink: result.htmlLink || null,
    meetLink: result.hangoutLink || result.conferenceData?.entryPoints?.[0]?.uri || null,
    message: result.error?.message || "Calendar event created.",
    responseCode: response.status,
  };
}

async function updateCalendarEvent(credentials, config, eventId, payload) {
  if (isMockExternal()) {
    return { ok: true, eventId, responseCode: 200 };
  }
  const calendarId = encodeURIComponent(config.calendarId || payload.calendarId || "primary");
  const response = await fetch(`${GOOGLE_CALENDAR_URL}/${calendarId}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, eventId: result.id || eventId, message: result.error?.message || "Calendar event updated.", responseCode: response.status };
}

async function deleteCalendarEvent(credentials, config, eventId, payload = {}) {
  if (isMockExternal()) {
    return { ok: true, eventId, responseCode: 204 };
  }
  const calendarId = encodeURIComponent(config.calendarId || payload.calendarId || "primary");
  const response = await fetch(`${GOOGLE_CALENDAR_URL}/${calendarId}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${credentials.accessToken}` },
  });
  return { ok: response.ok, eventId, message: response.ok ? "Calendar event deleted." : "Calendar event deletion failed.", responseCode: response.status };
}

module.exports = {
  createCalendarEvent,
  deleteCalendarEvent,
  exchangeCode,
  getAuthUrl,
  refreshAccessToken,
  testConnection,
  updateCalendarEvent,
};
