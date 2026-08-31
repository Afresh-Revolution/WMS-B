const crypto = require("crypto");
const { getUserById } = require("../../auth/userStore");
const { hasPermission } = require("../../constants/rbac");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { decryptSecret, encryptSecret } = require("../../utils/encryption");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const googleService = require("./google.service");
const paystackService = require("./paystack.service");
const slackService = require("./slack.service");
const zoomService = require("./zoom.service");

const INTEGRATION_COLLECTION = "integrations";
const LOG_COLLECTION = "integration_logs";
const STATE_COLLECTION = "integration_oauth_states";
const PAYMENT_COLLECTION = "payments";
const WEBHOOK_COLLECTION = "paystack_webhook_events";

const INTEGRATION_PERMISSIONS = Object.freeze({
  VIEW: "view_integrations",
  MANAGE: "manage_integrations",
  CONNECT: "connect_integrations",
  DISCONNECT: "disconnect_integrations",
  CONFIGURE: "configure_integrations",
  TEST: "test_integrations",
  USE_PAYSTACK: "paystack.payments",
});

const PROVIDERS = Object.freeze({
  slack: {
    provider: "slack",
    name: "Slack",
    description: "Company announcements, alerts, HR notifications, payroll notifications, and task notifications.",
    oauth: true,
    service: slackService,
  },
  google_workspace: {
    provider: "google_workspace",
    name: "Google Workspace",
    description: "Google authentication, Calendar, Meet, employee email, and calendar synchronization.",
    oauth: true,
    service: googleService,
  },
  paystack: {
    provider: "paystack",
    name: "Paystack",
    description: "Payroll payments, vendor payments, company payments, and payment verification.",
    oauth: false,
    service: paystackService,
  },
  zoom: {
    provider: "zoom",
    name: "Zoom",
    description: "Virtual meetings, HR meetings, team meetings, and online company meetings.",
    oauth: true,
    service: zoomService,
  },
});

function now() {
  return new Date().toISOString();
}

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!PROVIDERS[normalized]) {
    throw createHttpError(400, "Integration provider is invalid.", "INVALID_PROVIDER");
  }
  return normalized;
}

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission) || hasPermission(user, "integrations.manage");
}

function assertPermission(user, permission) {
  if (!can(user, permission)) {
    throw createHttpError(403, "Access denied.", "ACCESS_DENIED");
  }
}

function sanitizeConfig(config = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(config || {})) {
    redacted[key] = /token|secret|key|password/i.test(key) && key !== "publicKey" ? "[REDACTED]" : value;
  }
  return redacted;
}

function sanitizeIntegration(record) {
  if (!record) {
    return null;
  }
  const definition = PROVIDERS[record.provider] || {};
  return {
    id: record.id,
    provider: record.provider,
    name: record.name || definition.name,
    description: record.description || definition.description,
    status: record.status || "inactive",
    connectedBy: record.connectedBy || record.connected_by || null,
    accountEmail: record.accountEmail || record.account_email || null,
    externalAccountId: record.externalAccountId || record.external_account_id || null,
    config: sanitizeConfig(record.config || {}),
    connectedAt: record.connectedAt || record.connected_at || null,
    disconnectedAt: record.disconnectedAt || record.disconnected_at || null,
    lastTestedAt: record.lastTestedAt || record.last_tested_at || null,
    createdAt: record.createdAt || record.created_at || null,
    updatedAt: record.updatedAt || record.updated_at || null,
    hasAccessToken: Boolean(record.accessToken || record.access_token),
    hasRefreshToken: Boolean(record.refreshToken || record.refresh_token),
    hasApiKey: Boolean(record.apiKey || record.api_key),
  };
}

function readIntegrations() {
  return readCollection(INTEGRATION_COLLECTION).filter((record) => !record.deletedAt);
}

function findIntegration(provider) {
  const normalized = normalizeProvider(provider);
  return readIntegrations().find((record) => record.provider === normalized) || null;
}

function buildDefaultIntegration(provider) {
  const definition = PROVIDERS[provider];
  return {
    id: null,
    provider,
    name: definition.name,
    description: definition.description,
    status: "inactive",
    connectedBy: null,
    accountEmail: null,
    externalAccountId: null,
    config: {},
    connectedAt: null,
    disconnectedAt: null,
    lastTestedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

function upsertIntegration(provider, payload) {
  const normalized = normalizeProvider(provider);
  const records = readCollection(INTEGRATION_COLLECTION);
  const index = records.findIndex((record) => record.provider === normalized && !record.deletedAt);
  const timestamp = now();
  const definition = PROVIDERS[normalized];
  const base = {
    provider: normalized,
    name: definition.name,
    description: definition.description,
    updatedAt: timestamp,
    updated_at: timestamp,
  };

  if (index === -1) {
    const record = {
      id: crypto.randomUUID(),
      ...base,
      status: "inactive",
      config: {},
      createdAt: timestamp,
      created_at: timestamp,
      ...payload,
    };
    records.push(record);
    writeCollection(INTEGRATION_COLLECTION, records);
    return record;
  }

  records[index] = {
    ...records[index],
    ...base,
    ...payload,
    id: records[index].id,
    provider: normalized,
  };
  writeCollection(INTEGRATION_COLLECTION, records);
  return records[index];
}

function listIntegrations(query = {}) {
  const recordsByProvider = new Map(readIntegrations().map((record) => [record.provider, record]));
  const records = Object.keys(PROVIDERS).map((provider) => sanitizeIntegration(recordsByProvider.get(provider) || buildDefaultIntegration(provider)));
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["provider", "name", "status", "accountEmail"]), query);
}

function getIntegration(provider) {
  const normalized = normalizeProvider(provider);
  return sanitizeIntegration(findIntegration(normalized) || buildDefaultIntegration(normalized));
}

function recordIntegrationLog({ provider, integration, action, status, message, errorCode, responseCode, user, req, metadata }) {
  const timestamp = now();
  const log = appendRecord(LOG_COLLECTION, {
    id: crypto.randomUUID(),
    integrationId: integration?.id || null,
    integration_id: integration?.id || null,
    provider,
    action,
    status,
    message,
    errorCode: errorCode || null,
    error_code: errorCode || null,
    responseCode: responseCode || null,
    response_code: responseCode || null,
    performedBy: user?.id || null,
    performed_by: user?.id || null,
    metadata: sanitizeConfig(metadata || {}),
    createdAt: timestamp,
    created_at: timestamp,
  });

  recordOperationalAudit({
    user,
    action,
    module: "Integrations",
    recordId: integration?.id || provider,
    targetType: "Integration",
    targetName: PROVIDERS[provider]?.name || provider,
    status: String(status || "").toLowerCase() === "failed" ? "FAILED" : "SUCCESS",
    errorCode,
    metadata: { provider, message, ...(metadata || {}) },
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
    requestId: req?.id,
  });

  return log;
}

function createOAuthState(provider, req) {
  const state = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  appendRecord(STATE_COLLECTION, {
    id: crypto.randomUUID(),
    provider,
    state,
    userId: req.user?.id || null,
    usedAt: null,
    expiresAt,
    createdAt: now(),
  });
  return { state, expiresAt };
}

function consumeOAuthState(provider, state, req) {
  const records = readCollection(STATE_COLLECTION);
  const index = records.findIndex((record) => record.provider === provider && record.state === state && !record.usedAt);
  if (index === -1 || records[index].expiresAt < now()) {
    throw createHttpError(400, "OAuth state is invalid or expired.", "OAUTH_STATE_INVALID");
  }
  records[index] = { ...records[index], usedAt: now(), usedBy: req.user?.id || null };
  writeCollection(STATE_COLLECTION, records);
  return records[index];
}

function normalizeConfig(provider, payload = {}) {
  const currentConfig = payload.config && typeof payload.config === "object" ? payload.config : payload;
  if (provider === "paystack") {
    const environment = currentConfig.environment || "test";
    if (!["test", "live"].includes(environment)) {
      throw createHttpError(400, "Paystack environment must be test or live.", "INVALID_CONFIGURATION");
    }
    return {
      environment,
      publicKey: currentConfig.publicKey || currentConfig.public_key || process.env.PAYSTACK_PUBLIC_KEY || null,
    };
  }
  if (provider === "slack") {
    return {
      channelId: currentConfig.channelId || currentConfig.channel_id || null,
      announcementChannel: currentConfig.announcementChannel || currentConfig.announcement_channel || null,
      alertChannel: currentConfig.alertChannel || currentConfig.alert_channel || null,
      defaultChannel: currentConfig.defaultChannel || currentConfig.default_channel || null,
    };
  }
  if (provider === "google_workspace") {
    return {
      calendarId: currentConfig.calendarId || currentConfig.calendar_id || "primary",
      createMeetByDefault: currentConfig.createMeetByDefault !== false && currentConfig.create_meet_by_default !== false,
    };
  }
  return {
    defaultMeetingDuration: Number(currentConfig.defaultMeetingDuration || currentConfig.default_meeting_duration || 60),
    timezone: currentConfig.timezone || "UTC",
  };
}

function getCredentials(integration) {
  return {
    accessToken: decryptSecret(integration.accessToken || integration.access_token),
    refreshToken: decryptSecret(integration.refreshToken || integration.refresh_token),
    apiKey: decryptSecret(integration.apiKey || integration.api_key),
  };
}

async function connectIntegration(provider, payload = {}, req) {
  const normalized = normalizeProvider(provider);
  assertPermission(req.user, INTEGRATION_PERMISSIONS.CONNECT);
  const definition = PROVIDERS[normalized];

  if (definition.oauth && !payload.accessToken && !payload.access_token) {
    const state = createOAuthState(normalized, req);
    return {
      provider: normalized,
      authUrl: definition.service.getAuthUrl(state.state),
      state: state.state,
      expiresAt: state.expiresAt,
    };
  }

  if (normalized === "paystack") {
    const secret = payload.secretKey || payload.secret_key || payload.apiKey || payload.api_key || process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      throw createHttpError(400, "Paystack secret key is required.", "INVALID_CONFIGURATION");
    }
    const integration = upsertIntegration(normalized, {
      status: "active",
      connectedBy: req.user.id,
      connected_by: req.user.id,
      accountEmail: payload.accountEmail || payload.account_email || null,
      account_email: payload.accountEmail || payload.account_email || null,
      externalAccountId: payload.externalAccountId || payload.external_account_id || null,
      external_account_id: payload.externalAccountId || payload.external_account_id || null,
      apiKey: encryptSecret(secret),
      api_key: encryptSecret(secret),
      accessToken: null,
      access_token: null,
      refreshToken: null,
      refresh_token: null,
      config: normalizeConfig(normalized, payload),
      connectedAt: now(),
      connected_at: now(),
      disconnectedAt: null,
      disconnected_at: null,
    });
    recordIntegrationLog({ provider: normalized, integration, action: "INTEGRATION_CONNECTED", status: "success", message: "Paystack connected.", user: req.user, req });
    return sanitizeIntegration(integration);
  }

  const integration = upsertIntegration(normalized, {
    status: "active",
    connectedBy: req.user.id,
    connected_by: req.user.id,
    accountEmail: payload.accountEmail || payload.account_email || null,
    account_email: payload.accountEmail || payload.account_email || null,
    externalAccountId: payload.externalAccountId || payload.external_account_id || null,
    external_account_id: payload.externalAccountId || payload.external_account_id || null,
    accessToken: encryptSecret(payload.accessToken || payload.access_token),
    access_token: encryptSecret(payload.accessToken || payload.access_token),
    refreshToken: encryptSecret(payload.refreshToken || payload.refresh_token),
    refresh_token: encryptSecret(payload.refreshToken || payload.refresh_token),
    apiKey: null,
    api_key: null,
    config: { ...normalizeConfig(normalized, payload), ...(payload.config || {}) },
    expiresAt: payload.expiresAt || payload.expires_at || null,
    expires_at: payload.expiresAt || payload.expires_at || null,
    connectedAt: now(),
    connected_at: now(),
    disconnectedAt: null,
    disconnected_at: null,
  });
  recordIntegrationLog({ provider: normalized, integration, action: "INTEGRATION_CONNECTED", status: "success", message: `${definition.name} connected.`, user: req.user, req });
  return sanitizeIntegration(integration);
}

async function handleOAuthCallback(provider, query = {}, req) {
  const normalized = normalizeProvider(provider);
  const definition = PROVIDERS[normalized];
  if (!definition.oauth) {
    throw createHttpError(400, "This provider does not use OAuth.", "INVALID_PROVIDER");
  }
  if (query.error) {
    throw createHttpError(400, "OAuth provider returned an error.", "OAUTH_FAILED", { providerError: query.error });
  }
  const stateRecord = consumeOAuthState(normalized, query.state, req);
  const actor = req.user || getUserById(stateRecord.userId) || null;
  if (!query.code) {
    throw createHttpError(400, "OAuth authorization code is required.", "OAUTH_FAILED");
  }
  const tokenResult = await definition.service.exchangeCode(query.code);
  const existing = findIntegration(normalized);
  const expiresAt = tokenResult.expiresIn ? new Date(Date.now() + Number(tokenResult.expiresIn) * 1000).toISOString() : null;
  const integration = upsertIntegration(normalized, {
    status: "active",
    connectedBy: actor?.id || stateRecord.userId || null,
    connected_by: actor?.id || stateRecord.userId || null,
    accountEmail: tokenResult.accountEmail || existing?.accountEmail || existing?.account_email || null,
    account_email: tokenResult.accountEmail || existing?.accountEmail || existing?.account_email || null,
    externalAccountId: tokenResult.externalAccountId || existing?.externalAccountId || existing?.external_account_id || null,
    external_account_id: tokenResult.externalAccountId || existing?.externalAccountId || existing?.external_account_id || null,
    accessToken: encryptSecret(tokenResult.accessToken),
    access_token: encryptSecret(tokenResult.accessToken),
    refreshToken: tokenResult.refreshToken ? encryptSecret(tokenResult.refreshToken) : existing?.refreshToken || existing?.refresh_token || null,
    refresh_token: tokenResult.refreshToken ? encryptSecret(tokenResult.refreshToken) : existing?.refreshToken || existing?.refresh_token || null,
    config: { ...(existing?.config || {}), ...(tokenResult.config || {}) },
    expiresAt,
    expires_at: expiresAt,
    connectedAt: now(),
    connected_at: now(),
    disconnectedAt: null,
    disconnected_at: null,
  });
  recordIntegrationLog({ provider: normalized, integration, action: "OAUTH_CONNECTED", status: "success", message: `${definition.name} connected.`, user: actor, req });
  return sanitizeIntegration(integration);
}

function markStatus(provider, status, payload = {}) {
  return upsertIntegration(provider, { status, ...payload });
}

async function refreshIfNeeded(integration, req) {
  if (!integration || !integration.expiresAt || integration.expiresAt > new Date(Date.now() + 60 * 1000).toISOString()) {
    return integration;
  }
  if (!["google_workspace", "zoom"].includes(integration.provider)) {
    return integration;
  }
  const credentials = getCredentials(integration);
  if (!credentials.refreshToken) {
    markStatus(integration.provider, "expired");
    throw createHttpError(401, "Integration token expired. Please reconnect.", "INTEGRATION_EXPIRED");
  }
  try {
    const refreshed = await PROVIDERS[integration.provider].service.refreshAccessToken(credentials.refreshToken);
    const expiresAt = refreshed.expiresIn ? new Date(Date.now() + Number(refreshed.expiresIn) * 1000).toISOString() : null;
    const updated = upsertIntegration(integration.provider, {
      status: "active",
      accessToken: encryptSecret(refreshed.accessToken),
      access_token: encryptSecret(refreshed.accessToken),
      refreshToken: encryptSecret(refreshed.refreshToken || credentials.refreshToken),
      refresh_token: encryptSecret(refreshed.refreshToken || credentials.refreshToken),
      expiresAt,
      expires_at: expiresAt,
      lastTestedAt: now(),
      last_tested_at: now(),
    });
    recordIntegrationLog({ provider: integration.provider, integration: updated, action: "TOKEN_REFRESHED", status: "success", message: "Integration token refreshed.", user: req?.user, req });
    return updated;
  } catch (error) {
    markStatus(integration.provider, "expired");
    recordIntegrationLog({ provider: integration.provider, integration, action: "TOKEN_REFRESH_FAILED", status: "failed", message: error.publicMessage || error.message, errorCode: error.code || "TOKEN_REFRESH_FAILED", user: req?.user, req });
    throw error;
  }
}

async function getActiveIntegration(provider, req) {
  const normalized = normalizeProvider(provider);
  const integration = findIntegration(normalized);
  if (!integration || integration.status !== "active") {
    throw createHttpError(409, `${PROVIDERS[normalized].name} is not connected. Please connect ${PROVIDERS[normalized].name} before continuing.`, "INTEGRATION_NOT_CONNECTED");
  }
  return refreshIfNeeded(integration, req);
}

async function disconnectIntegration(provider, req) {
  const normalized = normalizeProvider(provider);
  assertPermission(req.user, INTEGRATION_PERMISSIONS.DISCONNECT);
  const existing = findIntegration(normalized);
  if (!existing || existing.status === "inactive") {
    throw createHttpError(409, "Integration is not connected.", "INTEGRATION_NOT_CONNECTED");
  }
  const integration = upsertIntegration(normalized, {
    status: "inactive",
    accessToken: null,
    access_token: null,
    refreshToken: null,
    refresh_token: null,
    apiKey: null,
    api_key: null,
    disconnectedAt: now(),
    disconnected_at: now(),
  });
  recordIntegrationLog({ provider: normalized, integration, action: "INTEGRATION_DISCONNECTED", status: "success", message: `${PROVIDERS[normalized].name} disconnected.`, user: req.user, req });
  return sanitizeIntegration(integration);
}

async function testIntegration(provider, req) {
  const normalized = normalizeProvider(provider);
  assertPermission(req.user, INTEGRATION_PERMISSIONS.TEST);
  const integration = await getActiveIntegration(normalized, req);
  const credentials = getCredentials(integration);
  const result = await PROVIDERS[normalized].service.testConnection(credentials, integration.config || {});
  const status = result.ok ? "active" : "error";
  const updated = markStatus(normalized, status, {
    lastTestedAt: now(),
    last_tested_at: now(),
    ...(result.accountEmail ? { accountEmail: result.accountEmail, account_email: result.accountEmail } : {}),
    ...(result.externalAccountId ? { externalAccountId: result.externalAccountId, external_account_id: result.externalAccountId } : {}),
  });
  recordIntegrationLog({
    provider: normalized,
    integration: updated,
    action: "INTEGRATION_TESTED",
    status: result.ok ? "success" : "failed",
    message: result.message,
    responseCode: result.responseCode,
    errorCode: result.ok ? null : "EXTERNAL_API_ERROR",
    user: req.user,
    req,
  });
  return { provider: normalized, status, message: result.ok ? "Connection is working" : "Connection expired. Please reconnect." };
}

function updateIntegrationConfig(provider, payload, req) {
  const normalized = normalizeProvider(provider);
  assertPermission(req.user, INTEGRATION_PERMISSIONS.CONFIGURE);
  const existing = findIntegration(normalized) || buildDefaultIntegration(normalized);
  const config = normalizeConfig(normalized, { ...(existing.config || {}), ...(payload || {}) });
  const integration = upsertIntegration(normalized, { config });
  recordIntegrationLog({ provider: normalized, integration, action: "INTEGRATION_CONFIGURATION_CHANGED", status: "success", message: `${PROVIDERS[normalized].name} configuration changed.`, user: req.user, req });
  return sanitizeIntegration(integration);
}

async function sendSlackMessage(payload, req, action = "SLACK_MESSAGE_SENT") {
  const integration = await getActiveIntegration("slack", req);
  const channel = payload.channel || integration.config?.channelId || integration.config?.defaultChannel || "general";
  if (!payload.message) {
    throw createHttpError(400, "Message is required.", "INVALID_CONFIGURATION");
  }
  const result = await slackService.sendMessage(getCredentials(integration), { channel, message: payload.message });
  if (!result.ok) {
    markStatus("slack", result.responseCode === 401 ? "expired" : "error");
  }
  recordIntegrationLog({
    provider: "slack",
    integration,
    action,
    status: result.ok ? "success" : "failed",
    message: result.message || (result.ok ? "Slack message sent." : "Slack message failed."),
    responseCode: result.responseCode,
    errorCode: result.ok ? null : "EXTERNAL_API_ERROR",
    user: req.user,
    req,
    metadata: { channel },
  });
  if (!result.ok) {
    throw createHttpError(502, result.message || "Slack message failed.", "EXTERNAL_API_ERROR");
  }
  return { provider: "slack", channel, providerMessageId: result.providerMessageId || null };
}

async function sendSlackAnnouncement(payload, req) {
  const integration = await getActiveIntegration("slack", req);
  return sendSlackMessage(
    {
      ...payload,
      channel: payload.channel || integration.config?.announcementChannel || integration.config?.defaultChannel || "general",
    },
    req,
    "SLACK_ANNOUNCEMENT_SENT"
  );
}

function normalizeEventPayload(payload) {
  const date = payload.date || new Date().toISOString().slice(0, 10);
  const startTime = payload.startTime || payload.start_time || "09:00";
  const duration = Number(payload.duration || payload.durationMinutes || payload.duration_minutes || 60);
  const startAt = payload.startAt || payload.start_at || `${date}T${startTime}:00.000Z`;
  const endAt = payload.endAt || payload.end_at || new Date(new Date(startAt).getTime() + duration * 60 * 1000).toISOString();
  return { ...payload, startAt, endAt, duration };
}

async function createGoogleCalendarEvent(payload, req) {
  const integration = await getActiveIntegration("google_workspace", req);
  const result = await googleService.createCalendarEvent(getCredentials(integration), integration.config || {}, normalizeEventPayload(payload));
  recordIntegrationLog({
    provider: "google_workspace",
    integration,
    action: "GOOGLE_CALENDAR_EVENT_CREATED",
    status: result.ok ? "success" : "failed",
    message: result.message || "Google calendar event created.",
    responseCode: result.responseCode,
    errorCode: result.ok ? null : "EXTERNAL_API_ERROR",
    user: req?.user,
    req,
  });
  if (!result.ok) {
    throw createHttpError(502, result.message || "Google Calendar event failed.", "EXTERNAL_API_ERROR");
  }
  return { provider: "google_workspace", googleEventId: result.eventId, virtualLink: result.meetLink || result.htmlLink, htmlLink: result.htmlLink, meetLink: result.meetLink };
}

async function updateGoogleCalendarEvent(eventId, payload, req) {
  const integration = await getActiveIntegration("google_workspace", req);
  const result = await googleService.updateCalendarEvent(getCredentials(integration), integration.config || {}, eventId, payload);
  if (!result.ok) {
    throw createHttpError(502, result.message || "Google Calendar update failed.", "EXTERNAL_API_ERROR");
  }
  return { provider: "google_workspace", googleEventId: eventId };
}

async function deleteGoogleCalendarEvent(eventId, payload, req) {
  const integration = await getActiveIntegration("google_workspace", req);
  const result = await googleService.deleteCalendarEvent(getCredentials(integration), integration.config || {}, eventId, payload);
  if (!result.ok) {
    throw createHttpError(502, result.message || "Google Calendar deletion failed.", "EXTERNAL_API_ERROR");
  }
  return { provider: "google_workspace", googleEventId: eventId };
}

async function createZoomMeeting(payload, req) {
  const integration = await getActiveIntegration("zoom", req);
  const result = await zoomService.createMeeting(getCredentials(integration), integration.config || {}, normalizeEventPayload(payload));
  recordIntegrationLog({
    provider: "zoom",
    integration,
    action: "ZOOM_MEETING_CREATED",
    status: result.ok ? "success" : "failed",
    message: result.message || "Zoom meeting created.",
    responseCode: result.responseCode,
    errorCode: result.ok ? null : "EXTERNAL_API_ERROR",
    user: req?.user,
    req,
  });
  if (!result.ok) {
    throw createHttpError(502, result.message || "Zoom meeting failed.", "EXTERNAL_API_ERROR");
  }
  return { provider: "zoom", zoomMeetingId: result.meetingId, virtualLink: result.joinUrl, startUrl: result.startUrl };
}

async function updateZoomMeeting(meetingId, payload, req) {
  const integration = await getActiveIntegration("zoom", req);
  const result = await zoomService.updateMeeting(getCredentials(integration), meetingId, payload);
  if (!result.ok) {
    throw createHttpError(502, result.message || "Zoom meeting update failed.", "EXTERNAL_API_ERROR");
  }
  return { provider: "zoom", zoomMeetingId: meetingId };
}

async function deleteZoomMeeting(meetingId, req) {
  const integration = await getActiveIntegration("zoom", req);
  const result = await zoomService.deleteMeeting(getCredentials(integration), meetingId);
  if (!result.ok) {
    throw createHttpError(502, result.message || "Zoom meeting deletion failed.", "EXTERNAL_API_ERROR");
  }
  return { provider: "zoom", zoomMeetingId: meetingId };
}

function findPaymentByReference(reference) {
  return readCollection(PAYMENT_COLLECTION).find((payment) => payment.reference === reference && !payment.deletedAt) || null;
}

function savePayment(record) {
  const records = readCollection(PAYMENT_COLLECTION);
  const index = records.findIndex((entry) => entry.reference === record.reference && !entry.deletedAt);
  if (index === -1) {
    records.push(record);
  } else {
    records[index] = { ...records[index], ...record, id: records[index].id, updatedAt: now(), updated_at: now() };
  }
  writeCollection(PAYMENT_COLLECTION, records);
  return index === -1 ? record : records[index];
}

async function initializePaystackPayment(payload, req) {
  assertPermission(req.user, INTEGRATION_PERMISSIONS.USE_PAYSTACK);
  const integration = await getActiveIntegration("paystack", req);
  const reference = payload.reference || `AFRESH-${crypto.randomUUID()}`;
  const existing = findPaymentByReference(reference);
  if (existing) {
    return sanitizeConfig(existing);
  }
  const result = await paystackService.initializePayment(getCredentials(integration), { ...payload, reference });
  const payment = savePayment({
    id: crypto.randomUUID(),
    provider: "paystack",
    reference,
    amount: Number(payload.amount || 0),
    currency: payload.currency || "NGN",
    email: payload.email,
    status: result.ok ? "pending" : "failed",
    authorizationUrl: result.authorizationUrl || null,
    authorization_url: result.authorizationUrl || null,
    accessCode: result.accessCode || null,
    access_code: result.accessCode || null,
    metadata: payload.metadata || {},
    createdBy: req.user.id,
    created_by: req.user.id,
    createdAt: now(),
    created_at: now(),
    updatedAt: now(),
    updated_at: now(),
  });
  recordIntegrationLog({ provider: "paystack", integration, action: result.ok ? "PAYSTACK_PAYMENT_CREATED" : "PAYSTACK_PAYMENT_FAILED", status: result.ok ? "success" : "failed", message: result.message || "Paystack payment initialized.", responseCode: result.responseCode, errorCode: result.ok ? null : "PAYMENT_FAILED", user: req.user, req, metadata: { reference } });
  if (!result.ok) {
    throw createHttpError(502, result.message || "Payment failed.", "PAYMENT_FAILED");
  }
  return payment;
}

async function verifyPaystackPayment(reference, req) {
  assertPermission(req.user, INTEGRATION_PERMISSIONS.USE_PAYSTACK);
  const integration = await getActiveIntegration("paystack", req);
  const result = await paystackService.verifyPayment(getCredentials(integration), reference);
  const existing = findPaymentByReference(reference);
  const payment = savePayment({
    id: existing?.id || crypto.randomUUID(),
    ...(existing || {}),
    provider: "paystack",
    reference,
    status: result.ok ? "success" : "failed",
    verifiedAt: now(),
    verified_at: now(),
    amount: result.amount ?? existing?.amount ?? null,
    updatedAt: now(),
    updated_at: now(),
  });
  recordIntegrationLog({ provider: "paystack", integration, action: result.ok ? "PAYSTACK_PAYMENT_VERIFIED" : "PAYSTACK_PAYMENT_FAILED", status: result.ok ? "success" : "failed", message: result.message || "Paystack payment verified.", responseCode: result.responseCode, errorCode: result.ok ? null : "PAYMENT_VERIFICATION_FAILED", user: req.user, req, metadata: { reference } });
  return payment;
}

async function createPaystackTransfer(payload, req) {
  assertPermission(req.user, INTEGRATION_PERMISSIONS.USE_PAYSTACK);
  const integration = await getActiveIntegration("paystack", req);
  const result = await paystackService.createTransfer(getCredentials(integration), payload);
  recordIntegrationLog({ provider: "paystack", integration, action: result.ok ? "PAYSTACK_TRANSFER_CREATED" : "PAYSTACK_PAYMENT_FAILED", status: result.ok ? "success" : "failed", message: result.message || "Paystack transfer created.", responseCode: result.responseCode, errorCode: result.ok ? null : "PAYMENT_FAILED", user: req.user, req, metadata: { reference: result.reference } });
  if (!result.ok) {
    throw createHttpError(502, result.message || "Transfer failed.", "PAYMENT_FAILED");
  }
  return result;
}

async function handlePaystackWebhook(req) {
  const integration = findIntegration("paystack");
  const secret = decryptSecret(integration?.apiKey || integration?.api_key) || process.env.PAYSTACK_SECRET_KEY;
  if (!paystackService.verifyWebhookSignature(req.rawBody || JSON.stringify(req.body || {}), req.get("x-paystack-signature"), secret)) {
    throw createHttpError(401, "Paystack webhook signature is invalid.", "WEBHOOK_SIGNATURE_INVALID");
  }

  const event = req.body || {};
  const eventId = String(event.id || event.event_id || event.data?.id || `${event.event}:${event.data?.reference || event.data?.transfer_code || ""}`);
  const existing = readCollection(WEBHOOK_COLLECTION).find((record) => record.eventId === eventId);
  if (existing) {
    return { duplicate: true, eventId, processed: false };
  }

  appendRecord(WEBHOOK_COLLECTION, {
    id: crypto.randomUUID(),
    eventId,
    event_id: eventId,
    event: event.event,
    reference: event.data?.reference || event.data?.transfer_code || null,
    payload: event,
    processedAt: now(),
    processed_at: now(),
  });

  const reference = event.data?.reference || event.data?.transfer_code || null;
  if (reference) {
    const existingPayment = findPaymentByReference(reference);
    const successEvents = ["charge.success", "transfer.success"];
    const failedEvents = ["charge.failed", "transfer.failed", "transfer.reversed"];
    if (existingPayment || successEvents.includes(event.event) || failedEvents.includes(event.event)) {
      savePayment({
        id: existingPayment?.id || crypto.randomUUID(),
        ...(existingPayment || {}),
        provider: "paystack",
        reference,
        status: successEvents.includes(event.event) ? "success" : failedEvents.includes(event.event) ? "failed" : existingPayment?.status || "pending",
        webhookEvent: event.event,
        webhook_event: event.event,
        updatedAt: now(),
        updated_at: now(),
      });
    }
  }

  recordIntegrationLog({ provider: "paystack", integration, action: "PAYSTACK_WEBHOOK_RECEIVED", status: "success", message: "Paystack webhook processed.", responseCode: 200, user: null, req, metadata: { event: event.event, reference } });
  return { duplicate: false, eventId, processed: true };
}

function listIntegrationLogs(query = {}) {
  const logs = applyBasicFilters(readCollection(LOG_COLLECTION), { ...query, q: query.q || query.search }, ["provider", "action", "status", "message"]);
  return paginate(logs, query);
}

module.exports = {
  INTEGRATION_PERMISSIONS,
  PROVIDERS,
  connectIntegration,
  createGoogleCalendarEvent,
  createPaystackTransfer,
  createZoomMeeting,
  deleteGoogleCalendarEvent,
  deleteZoomMeeting,
  disconnectIntegration,
  getActiveIntegration,
  getCredentials,
  getIntegration,
  handleOAuthCallback,
  handlePaystackWebhook,
  initializePaystackPayment,
  listIntegrationLogs,
  listIntegrations,
  recordIntegrationLog,
  sanitizeIntegration,
  sendSlackAnnouncement,
  sendSlackMessage,
  testIntegration,
  updateGoogleCalendarEvent,
  updateIntegrationConfig,
  updateZoomMeeting,
  verifyPaystackPayment,
};
