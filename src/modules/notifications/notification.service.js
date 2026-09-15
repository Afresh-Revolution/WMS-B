const crypto = require("crypto");
const { getUserById, listUsers } = require("../../auth/userStore");
const { hasPermission } = require("../../constants/rbac");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit, recordTechnicalAuditEvent } = require("../_shared/auditService");
const emailService = require("../email/email.service");
const smsService = require("./sms.service");

const NOTIFICATION_COLLECTION = "notifications";
const DELIVERY_LOG_COLLECTION = "notification_delivery_logs";
const LEGACY_DELIVERY_COLLECTION = "notification_deliveries";
const CHANNEL_COLLECTION = "notification_channels";
const RULE_COLLECTION = "notification_rules";
const PREFERENCE_COLLECTION = "notification_preferences";
const JOB_COLLECTION = "notification_jobs";
const PUSH_SUBSCRIPTION_COLLECTION = "push_subscriptions";

const CHANNELS = Object.freeze(["in_app", "email", "sms", "push"]);
const PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
const MAX_RETRIES = 3;

const NOTIFICATION_PERMISSIONS = Object.freeze({
  VIEW_CONFIG: "notification_config.view",
  MANAGE_CONFIG: "notification_config.manage",
  UPDATE_CONFIG: "notification_config.update",
  RULES: "notification_config.rules",
  LOGS: "notification_config.logs",
  VIEW_ALL: "notifications.view_all",
});

const DEFAULT_RULES = Object.freeze({
  LEAVE_SUBMITTED: ["in_app", "email", "normal"],
  LEAVE_APPROVED: ["in_app", "email", "normal"],
  LEAVE_REJECTED: ["in_app", "email", "normal"],
  MEETING_CREATED: ["in_app", "email", "normal"],
  MEETING_UPDATED: ["in_app", "email", "normal"],
  MEETING_CANCELLED: ["in_app", "email", "high"],
  MEETING_REMINDER: ["in_app", "email", "normal"],
  TASK_ASSIGNED: ["in_app", "email", "normal"],
  TASK_UPDATED: ["in_app", "normal"],
  TASK_COMPLETED: ["in_app", "normal"],
  TASK_OVERDUE: ["in_app", "email", "high"],
  TARGET_ASSIGNED: ["in_app", "email", "normal"],
  TARGET_UPDATED: ["in_app", "normal"],
  TARGET_COMPLETED: ["in_app", "normal"],
  PAYROLL_PROCESSED: ["in_app", "email", "high"],
  PAYSLIP_AVAILABLE: ["in_app", "email", "high"],
  PURCHASE_SUBMITTED: ["in_app", "email", "normal"],
  PURCHASE_APPROVED: ["in_app", "email", "normal"],
  PURCHASE_REJECTED: ["in_app", "email", "normal"],
  BILL_CREATED: ["in_app", "email", "normal"],
  BILL_APPROVED: ["in_app", "email", "normal"],
  BILL_OVERDUE: ["in_app", "email", "high"],
  EXPENSE_SUBMITTED: ["in_app", "email", "normal"],
  EXPENSE_APPROVED: ["in_app", "email", "normal"],
  EXPENSE_REJECTED: ["in_app", "email", "normal"],
  EVENT_CREATED: ["in_app", "email", "normal"],
  EVENT_REMINDER: ["in_app", "email", "normal"],
  DISCIPLINARY_ACTION_CREATED: ["in_app", "email", "high"],
  NYSC_ADDED: ["in_app", "email", "normal"],
  INTERN_ADDED: ["in_app", "email", "normal"],
  PLACEMENT_ENDING: ["in_app", "email", "normal"],
  ANNOUNCEMENT_CREATED: ["in_app", "email", "normal"],
  SECURITY_ALERT: ["in_app", "email", "sms", "urgent"],
  PASSWORD_CHANGED: ["in_app", "email", "high"],
  ACCOUNT_LOCKED: ["in_app", "email", "sms", "urgent"],
  ATTENDANCE_CHECK_IN_ACCEPTED: ["in_app", "push", "normal"],
  ATTENDANCE_LOCATION_UPDATED: ["in_app", "push", "normal"],
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

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission) || hasPermission(user, NOTIFICATION_PERMISSIONS.MANAGE_CONFIG);
}

function assertPermission(user, permission) {
  if (!can(user, permission)) {
    throw createHttpError(403, "Access denied.", "ACCESS_DENIED");
  }
}

function normalizeChannel(channel) {
  const normalized = String(channel || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!CHANNELS.includes(normalized)) {
    throw createHttpError(400, "Notification channel is invalid.", "INVALID_NOTIFICATION_CHANNEL");
  }
  return normalized;
}

function normalizeType(type) {
  return String(type || "GENERAL").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function normalizeDestinationUrl(value) {
  if (!value) {
    return null;
  }
  const destination = String(value).trim();
  if (!destination.startsWith("/") || destination.startsWith("//") || destination.includes("\\") || /[\r\n]/.test(destination)) {
    throw createHttpError(400, "Notification destination URL must be an internal route.", "INVALID_NOTIFICATION_DESTINATION");
  }
  return destination;
}

function normalizePriority(priority) {
  const normalized = String(priority || "normal").toLowerCase();
  return PRIORITIES.includes(normalized) ? normalized : "normal";
}

function endpointHash(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint || "")).digest("hex");
}

function getVapidPublicKey() {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY || null;
}

function getCollectionRecord(collection, predicate) {
  return readCollection(collection).find((record) => !record.deletedAt && predicate(record)) || null;
}

function upsertBy(collection, predicate, payload) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => !record.deletedAt && predicate(record));
  const timestamp = now();
  if (index === -1) {
    const record = { id: crypto.randomUUID(), ...payload, createdAt: timestamp, created_at: timestamp, updatedAt: timestamp, updated_at: timestamp };
    records.push(record);
    writeCollection(collection, records);
    return record;
  }
  records[index] = { ...records[index], ...payload, id: records[index].id, updatedAt: timestamp, updated_at: timestamp };
  writeCollection(collection, records);
  return records[index];
}

function ensureDefaultChannels() {
  for (const channel of CHANNELS) {
    if (!getCollectionRecord(CHANNEL_COLLECTION, (record) => record.channel === channel)) {
      upsertBy(CHANNEL_COLLECTION, (record) => record.channel === channel, {
        channel,
        isEnabled: channel !== "sms",
        is_enabled: channel !== "sms",
        updatedBy: null,
        updated_by: null,
      });
    }
  }
  return readCollection(CHANNEL_COLLECTION).filter((record) => !record.deletedAt);
}

function ensureDefaultRules() {
  for (const [type, values] of Object.entries(DEFAULT_RULES)) {
    if (!getCollectionRecord(RULE_COLLECTION, (record) => record.notificationType === type || record.notification_type === type)) {
      const priority = values[values.length - 1];
      const channels = values.slice(0, -1);
      upsertBy(RULE_COLLECTION, (record) => record.notificationType === type || record.notification_type === type, {
        notificationType: type,
        notification_type: type,
        inAppEnabled: channels.includes("in_app"),
        in_app_enabled: channels.includes("in_app"),
        emailEnabled: channels.includes("email"),
        email_enabled: channels.includes("email"),
        smsEnabled: channels.includes("sms"),
        sms_enabled: channels.includes("sms"),
        pushEnabled: channels.includes("push"),
        push_enabled: channels.includes("push"),
        priority,
        updatedBy: null,
        updated_by: null,
      });
    }
  }
  return readCollection(RULE_COLLECTION).filter((record) => !record.deletedAt);
}

function getGlobalSettings() {
  const setting =
    getCollectionRecord("notification_settings", () => true) ||
    getCollectionRecord("notification_configurations", () => true) ||
    null;
  return {
    serviceStatus: "operational",
    dailyDigestEnabled: setting?.dailyDigestEnabled ?? setting?.daily_digest_enabled ?? true,
    dailyDigestTime: setting?.dailyDigestTime || setting?.daily_digest_time || "08:00",
    dailyDigestChannels: setting?.dailyDigestChannels || setting?.daily_digest_channels || ["email"],
    quietHoursEnabled: setting?.quietHoursEnabled ?? setting?.quiet_hours_enabled ?? false,
    quietHoursStart: setting?.quietHoursStart || setting?.quiet_hours_start || "22:00",
    quietHoursEnd: setting?.quietHoursEnd || setting?.quiet_hours_end || "07:00",
  };
}

function saveGlobalSettings(payload, req) {
  return upsertBy("notification_settings", () => true, {
    dailyDigestEnabled: payload.dailyDigest?.enabled ?? payload.dailyDigestEnabled ?? payload.daily_digest_enabled ?? getGlobalSettings().dailyDigestEnabled,
    daily_digest_enabled: payload.dailyDigest?.enabled ?? payload.dailyDigestEnabled ?? payload.daily_digest_enabled ?? getGlobalSettings().dailyDigestEnabled,
    dailyDigestTime: payload.dailyDigest?.time || payload.dailyDigestTime || payload.daily_digest_time || getGlobalSettings().dailyDigestTime,
    daily_digest_time: payload.dailyDigest?.time || payload.dailyDigestTime || payload.daily_digest_time || getGlobalSettings().dailyDigestTime,
    dailyDigestChannels: payload.dailyDigest?.channels || payload.dailyDigestChannels || payload.daily_digest_channels || getGlobalSettings().dailyDigestChannels,
    daily_digest_channels: payload.dailyDigest?.channels || payload.dailyDigestChannels || payload.daily_digest_channels || getGlobalSettings().dailyDigestChannels,
    quietHoursEnabled: payload.quietHours?.enabled ?? payload.quietHoursEnabled ?? payload.quiet_hours_enabled ?? getGlobalSettings().quietHoursEnabled,
    quiet_hours_enabled: payload.quietHours?.enabled ?? payload.quietHoursEnabled ?? payload.quiet_hours_enabled ?? getGlobalSettings().quietHoursEnabled,
    quietHoursStart: payload.quietHours?.start || payload.quietHoursStart || payload.quiet_hours_start || getGlobalSettings().quietHoursStart,
    quiet_hours_start: payload.quietHours?.start || payload.quietHoursStart || payload.quiet_hours_start || getGlobalSettings().quietHoursStart,
    quietHoursEnd: payload.quietHours?.end || payload.quietHoursEnd || payload.quiet_hours_end || getGlobalSettings().quietHoursEnd,
    quiet_hours_end: payload.quietHours?.end || payload.quietHoursEnd || payload.quiet_hours_end || getGlobalSettings().quietHoursEnd,
    updatedBy: req?.user?.id || null,
    updated_by: req?.user?.id || null,
  });
}

function sanitizeRule(rule) {
  return {
    id: rule.id,
    notificationType: rule.notificationType || rule.notification_type,
    inAppEnabled: Boolean(rule.inAppEnabled ?? rule.in_app_enabled),
    emailEnabled: Boolean(rule.emailEnabled ?? rule.email_enabled),
    smsEnabled: Boolean(rule.smsEnabled ?? rule.sms_enabled),
    pushEnabled: Boolean(rule.pushEnabled ?? rule.push_enabled ?? true),
    priority: normalizePriority(rule.priority),
    updatedAt: rule.updatedAt || rule.updated_at,
    updatedBy: rule.updatedBy || rule.updated_by || null,
  };
}

function getRule(type) {
  ensureDefaultRules();
  const normalizedType = normalizeType(type);
  return (
    getCollectionRecord(RULE_COLLECTION, (record) => record.notificationType === normalizedType || record.notification_type === normalizedType) ||
    {
      notificationType: normalizedType,
      notification_type: normalizedType,
      inAppEnabled: true,
      in_app_enabled: true,
      emailEnabled: true,
      email_enabled: true,
      smsEnabled: false,
      sms_enabled: false,
      priority: "normal",
    }
  );
}

function getChannelsMap() {
  return ensureDefaultChannels().reduce(
    (summary, record) => {
      summary[record.channel] = Boolean(record.isEnabled ?? record.is_enabled);
      return summary;
    },
    { in_app: true, email: true, sms: false }
  );
}

function getConfiguration(user = null) {
  if (user) {
    assertPermission(user, NOTIFICATION_PERMISSIONS.VIEW_CONFIG);
  }
  const channels = getChannelsMap();
  const settings = getGlobalSettings();
  return {
    service: { status: settings.serviceStatus },
    channels: {
      inApp: channels.in_app,
      email: channels.email,
      sms: channels.sms,
      push: channels.push,
    },
    dailyDigest: {
      enabled: Boolean(settings.dailyDigestEnabled),
      time: settings.dailyDigestTime,
      channels: settings.dailyDigestChannels,
    },
    quietHours: {
      enabled: Boolean(settings.quietHoursEnabled),
      start: settings.quietHoursStart,
      end: settings.quietHoursEnd,
    },
  };
}

function audit(req, action, targetId, beforeData, afterData, status = "SUCCESS", metadata = {}) {
  recordOperationalAudit({
    user: req?.user,
    action,
    module: "Notification Configuration",
    recordId: targetId || null,
    targetType: "Notification",
    targetName: metadata.channel || metadata.notificationType || "Notification Service",
    oldValue: beforeData || null,
    newValue: afterData || null,
    status,
    metadata,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
    requestId: req?.id,
  });
  recordTechnicalAuditEvent({
    user: req?.user,
    action,
    module: "Notification Configuration",
    targetType: "Notification",
    targetId: targetId || null,
    status,
    service: "notifications",
    metadata,
    beforeData,
    afterData,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
    requestId: req?.id,
  });
}

function updateChannel(payload, req) {
  assertPermission(req.user, NOTIFICATION_PERMISSIONS.UPDATE_CONFIG);
  const channel = normalizeChannel(payload.channel);
  const before = getCollectionRecord(CHANNEL_COLLECTION, (record) => record.channel === channel);
  const enabled = Boolean(payload.enabled ?? payload.isEnabled ?? payload.is_enabled);
  const record = upsertBy(CHANNEL_COLLECTION, (entry) => entry.channel === channel, {
    channel,
    isEnabled: enabled,
    is_enabled: enabled,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, enabled ? "NOTIFICATION_CHANNEL_ENABLED" : "NOTIFICATION_CHANNEL_DISABLED", record.id, before, record, "SUCCESS", { channel });
  return getConfiguration(req.user);
}

function updateGlobalConfiguration(payload, req) {
  assertPermission(req.user, NOTIFICATION_PERMISSIONS.UPDATE_CONFIG);
  const before = getGlobalSettings();
  const record = saveGlobalSettings(payload, req);
  const after = getGlobalSettings();
  const action =
    payload.dailyDigest || payload.dailyDigestEnabled !== undefined || payload.daily_digest_enabled !== undefined
      ? "DAILY_DIGEST_UPDATED"
      : "QUIET_HOURS_UPDATED";
  audit(req, action, record.id, before, after);
  return getConfiguration(req.user);
}

function listRules(query = {}, user = null) {
  if (user) {
    assertPermission(user, NOTIFICATION_PERMISSIONS.RULES);
  }
  const result = paginate(applyBasicFilters(ensureDefaultRules(), { ...query, q: query.q || query.search }, ["notificationType", "notification_type", "priority"]), query);
  result.data = result.data.map(sanitizeRule);
  return result;
}

function updateRule(type, payload, req) {
  assertPermission(req.user, NOTIFICATION_PERMISSIONS.RULES);
  const notificationType = normalizeType(type || payload.notificationType || payload.notification_type);
  const before = getCollectionRecord(RULE_COLLECTION, (record) => record.notificationType === notificationType || record.notification_type === notificationType);
  const record = upsertBy(RULE_COLLECTION, (entry) => entry.notificationType === notificationType || entry.notification_type === notificationType, {
    notificationType,
    notification_type: notificationType,
    inAppEnabled: payload.inAppEnabled ?? payload.in_app_enabled ?? before?.inAppEnabled ?? before?.in_app_enabled ?? true,
    in_app_enabled: payload.inAppEnabled ?? payload.in_app_enabled ?? before?.inAppEnabled ?? before?.in_app_enabled ?? true,
    emailEnabled: payload.emailEnabled ?? payload.email_enabled ?? before?.emailEnabled ?? before?.email_enabled ?? true,
    email_enabled: payload.emailEnabled ?? payload.email_enabled ?? before?.emailEnabled ?? before?.email_enabled ?? true,
    smsEnabled: payload.smsEnabled ?? payload.sms_enabled ?? before?.smsEnabled ?? before?.sms_enabled ?? false,
    sms_enabled: payload.smsEnabled ?? payload.sms_enabled ?? before?.smsEnabled ?? before?.sms_enabled ?? false,
    pushEnabled: payload.pushEnabled ?? payload.push_enabled ?? before?.pushEnabled ?? before?.push_enabled ?? true,
    push_enabled: payload.pushEnabled ?? payload.push_enabled ?? before?.pushEnabled ?? before?.push_enabled ?? true,
    priority: normalizePriority(payload.priority || before?.priority || "normal"),
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "NOTIFICATION_RULE_UPDATED", record.id, before, record, "SUCCESS", { notificationType });
  return sanitizeRule(record);
}

function getUserPreferences(userId) {
  const existing = getCollectionRecord(PREFERENCE_COLLECTION, (record) => record.userId === userId || record.user_id === userId);
  return {
    id: existing?.id || null,
    userId,
    dailyDigestEnabled: existing?.dailyDigestEnabled ?? existing?.daily_digest_enabled ?? getGlobalSettings().dailyDigestEnabled,
    dailyDigestTime: existing?.dailyDigestTime || existing?.daily_digest_time || getGlobalSettings().dailyDigestTime,
    quietHoursEnabled: existing?.quietHoursEnabled ?? existing?.quiet_hours_enabled ?? getGlobalSettings().quietHoursEnabled,
    quietHoursStart: existing?.quietHoursStart || existing?.quiet_hours_start || getGlobalSettings().quietHoursStart,
    quietHoursEnd: existing?.quietHoursEnd || existing?.quiet_hours_end || getGlobalSettings().quietHoursEnd,
    channelPreferences: existing?.channelPreferences || existing?.channel_preferences || {},
    typePreferences: existing?.typePreferences || existing?.type_preferences || {},
  };
}

function updatePreferences(user, payload, req) {
  const targetUserId = payload.userId && can(req.user, NOTIFICATION_PERMISSIONS.VIEW_ALL) ? payload.userId : user.id;
  const before = getUserPreferences(targetUserId);
  const securityPreferences = payload.typePreferences?.SECURITY_ALERT || payload.type_preferences?.SECURITY_ALERT;
  if (securityPreferences && securityPreferences.inApp === false && !can(req.user, NOTIFICATION_PERMISSIONS.MANAGE_CONFIG)) {
    throw createHttpError(403, "Security notifications cannot be fully disabled.", "SECURITY_NOTIFICATION_REQUIRED");
  }
  const record = upsertBy(PREFERENCE_COLLECTION, (entry) => entry.userId === targetUserId || entry.user_id === targetUserId, {
    userId: targetUserId,
    user_id: targetUserId,
    dailyDigestEnabled: payload.dailyDigestEnabled ?? payload.daily_digest_enabled ?? before.dailyDigestEnabled,
    daily_digest_enabled: payload.dailyDigestEnabled ?? payload.daily_digest_enabled ?? before.dailyDigestEnabled,
    dailyDigestTime: payload.dailyDigestTime || payload.daily_digest_time || before.dailyDigestTime,
    daily_digest_time: payload.dailyDigestTime || payload.daily_digest_time || before.dailyDigestTime,
    quietHoursEnabled: payload.quietHoursEnabled ?? payload.quiet_hours_enabled ?? before.quietHoursEnabled,
    quiet_hours_enabled: payload.quietHoursEnabled ?? payload.quiet_hours_enabled ?? before.quietHoursEnabled,
    quietHoursStart: payload.quietHoursStart || payload.quiet_hours_start || before.quietHoursStart,
    quiet_hours_start: payload.quietHoursStart || payload.quiet_hours_start || before.quietHoursStart,
    quietHoursEnd: payload.quietHoursEnd || payload.quiet_hours_end || before.quietHoursEnd,
    quiet_hours_end: payload.quietHoursEnd || payload.quiet_hours_end || before.quietHoursEnd,
    channelPreferences: payload.channelPreferences || payload.channel_preferences || before.channelPreferences,
    channel_preferences: payload.channelPreferences || payload.channel_preferences || before.channelPreferences,
    typePreferences: payload.typePreferences || payload.type_preferences || before.typePreferences,
    type_preferences: payload.typePreferences || payload.type_preferences || before.typePreferences,
  });
  audit(req, "USER_NOTIFICATION_PREFERENCES_UPDATED", record.id, before, getUserPreferences(targetUserId), "SUCCESS", { userId: targetUserId });
  return getUserPreferences(targetUserId);
}

function isQuietHours(preferences, priority) {
  if (!preferences.quietHoursEnabled || ["urgent", "high"].includes(priority)) {
    return false;
  }
  const current = new Date().toISOString().slice(11, 16);
  const start = preferences.quietHoursStart || "22:00";
  const end = preferences.quietHoursEnd || "07:00";
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

function nextAfterQuietHours(preferences) {
  const [hours, minutes] = String(preferences.quietHoursEnd || "07:00").split(":").map(Number);
  const date = new Date();
  date.setUTCHours(Number.isFinite(hours) ? hours : 7, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  if (date <= new Date()) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString();
}

function createNotificationRecord(payload, user, priority) {
  const destinationUrl = normalizeDestinationUrl(payload.destinationUrl || payload.destination_url || payload.url);
  const organizationId = payload.organizationId || payload.organization_id || user?.organizationId || user?.organization_id || null;
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key || null;
  return appendRecord(NOTIFICATION_COLLECTION, {
    id: crypto.randomUUID(),
    userId: user?.id || payload.userId || payload.recipientUserId || null,
    user_id: user?.id || payload.userId || payload.recipientUserId || null,
    recipientUserId: user?.id || payload.userId || payload.recipientUserId || null,
    recipient_user_id: user?.id || payload.userId || payload.recipientUserId || null,
    recipientEmployeeId: payload.recipientEmployeeId || payload.recipient_employee_id || null,
    organizationId,
    organization_id: organizationId,
    type: normalizeType(payload.type),
    title: payload.title,
    message: payload.message || payload.body || null,
    body: payload.message || payload.body || null,
    module: payload.module || null,
    entityType: payload.entityType || payload.entity_type || payload.referenceType || null,
    entity_type: payload.entityType || payload.entity_type || payload.referenceType || null,
    entityId: payload.entityId || payload.entity_id || payload.referenceId || null,
    entity_id: payload.entityId || payload.entity_id || payload.referenceId || null,
    priority,
    isRead: false,
    is_read: false,
    readAt: null,
    read_at: null,
    status: "queued",
    data: payload.data || {},
    destinationUrl,
    destination_url: destinationUrl,
    idempotencyKey,
    idempotency_key: idempotencyKey,
    expiresAt: payload.expiresAt || payload.expires_at || null,
    expires_at: payload.expiresAt || payload.expires_at || null,
    createdAt: now(),
    created_at: now(),
    updatedAt: now(),
    updated_at: now(),
  });
}

function createDeliveryLog({ notification, user, channel, status, provider, providerMessageId, errorMessage, attemptCount }) {
  const timestamp = now();
  const log = appendRecord(DELIVERY_LOG_COLLECTION, {
    id: crypto.randomUUID(),
    notificationId: notification?.id || null,
    notification_id: notification?.id || null,
    userId: user?.id || notification?.userId || notification?.user_id || null,
    user_id: user?.id || notification?.userId || notification?.user_id || null,
    channel,
    provider: provider || null,
    status,
    providerMessageId: providerMessageId || null,
    provider_message_id: providerMessageId || null,
    errorMessage: errorMessage || null,
    error_message: errorMessage || null,
    attemptCount: attemptCount || 0,
    attempt_count: attemptCount || 0,
    sentAt: status === "sent" || status === "delivered" ? timestamp : null,
    sent_at: status === "sent" || status === "delivered" ? timestamp : null,
    deliveredAt: status === "delivered" ? timestamp : null,
    delivered_at: status === "delivered" ? timestamp : null,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  });

  appendRecord(LEGACY_DELIVERY_COLLECTION, {
    id: crypto.randomUUID(),
    notificationId: log.notificationId,
    notification_id: log.notificationId,
    channel: channel.toUpperCase(),
    status: status.toUpperCase(),
    sentAt: log.sentAt,
    sent_at: log.sentAt,
    deliveredAt: log.deliveredAt,
    delivered_at: log.deliveredAt,
    errorMessage: errorMessage || null,
    error_message: errorMessage || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return log;
}

function enqueueDelivery({ notification, user, channel, payload, runAt }) {
  createDeliveryLog({ notification, user, channel, status: "queued", attemptCount: 0 });
  return appendRecord(JOB_COLLECTION, {
    id: crypto.randomUUID(),
    notificationId: notification.id,
    notification_id: notification.id,
    userId: user?.id || notification.userId || notification.user_id || null,
    user_id: user?.id || notification.userId || notification.user_id || null,
    channel,
    payload,
    status: "queued",
    retryCount: 0,
    retry_count: 0,
    maxRetries: MAX_RETRIES,
    max_retries: MAX_RETRIES,
    nextRunAt: runAt || now(),
    next_run_at: runAt || now(),
    lastError: null,
    last_error: null,
    createdAt: now(),
    created_at: now(),
    updatedAt: now(),
    updated_at: now(),
  });
}

function getUserContact(user, channel) {
  if (channel === "email") {
    return user?.email || null;
  }
  if (channel === "sms") {
    return user?.phone || user?.phoneNumber || user?.phone_number || null;
  }
  return null;
}

function getActivePushSubscriptions(userId) {
  if (!userId) return [];
  return readCollection(PUSH_SUBSCRIPTION_COLLECTION).filter((subscription) =>
    !subscription.deletedAt &&
    !subscription.deleted_at &&
    !subscription.revokedAt &&
    !subscription.revoked_at &&
    !subscription.disabledAt &&
    !subscription.disabled_at &&
    (subscription.userId || subscription.user_id) === userId
  );
}

function minimalPushMessage(payload = {}) {
  return {
    title: payload.title || "Notification",
    body: payload.pushBody || payload.push_body || payload.message || payload.body || "",
    destinationUrl: normalizeDestinationUrl(payload.destinationUrl || payload.destination_url || payload.url) || "/notifications",
  };
}

function shouldUseChannel({ rule, channels, preferences, channel, type }) {
  if (!channels[channel]) {
    return false;
  }
  const ruleEnabled =
    channel === "in_app"
      ? rule.inAppEnabled ?? rule.in_app_enabled
      : channel === "email"
        ? rule.emailEnabled ?? rule.email_enabled
        : channel === "sms"
          ? rule.smsEnabled ?? rule.sms_enabled
          : rule.pushEnabled ?? rule.push_enabled ?? true;
  if (!ruleEnabled) {
    return false;
  }
  const typePreference = preferences.typePreferences?.[type] || preferences.typePreferences?.[type.toLowerCase()];
  const channelPreference = preferences.channelPreferences?.[channel];
  if (typePreference && typePreference[channel] === false) {
    return false;
  }
  if (channelPreference === false) {
    return false;
  }
  return true;
}

function send(payload = {}, options = {}) {
  const type = normalizeType(payload.type);
  const userId = payload.userId || payload.recipientUserId || payload.user_id || payload.recipient_user_id;
  const user = userId ? getUserById(userId) : null;
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key || options.idempotencyKey || null;
  if (idempotencyKey) {
    const existing = readCollection(NOTIFICATION_COLLECTION).find(
      (record) => !record.deletedAt && !record.deleted_at && (record.idempotencyKey || record.idempotency_key) === idempotencyKey
    );
    if (existing) {
      return { notification: existing, jobs: [], delayedUntil: null, idempotent: true };
    }
  }
  const rule = getRule(type);
  const channels = getChannelsMap();
  const preferences = getUserPreferences(userId || "anonymous");
  const priority = normalizePriority(payload.priority || rule.priority);
  const requestedChannels = Array.isArray(payload.channels) ? payload.channels.map(normalizeChannel) : CHANNELS;
  const runAt = isQuietHours(preferences, priority) ? nextAfterQuietHours(preferences) : now();
  const notification = shouldUseChannel({ rule, channels, preferences, channel: "in_app", type }) && requestedChannels.includes("in_app")
    ? createNotificationRecord(payload, user, priority)
    : null;

  const effectiveNotification = notification || createNotificationRecord({ ...payload, title: payload.title || type, message: payload.message || payload.body || "" }, user, priority);
  const jobs = [];
  if (notification) {
    createDeliveryLog({ notification, user, channel: "in_app", status: "delivered", provider: "database", attemptCount: 1 });
  } else {
    createDeliveryLog({ notification: effectiveNotification, user, channel: "in_app", status: "skipped", errorMessage: "In-app channel disabled.", attemptCount: 0 });
  }

  for (const channel of ["email", "sms", "push"]) {
    if (!requestedChannels.includes(channel)) {
      continue;
    }
    if (!shouldUseChannel({ rule, channels, preferences, channel, type })) {
      createDeliveryLog({ notification: effectiveNotification, user, channel, status: "skipped", errorMessage: "Channel disabled by configuration or preference.", attemptCount: 0 });
      continue;
    }
    const contact = channel === "push" ? getActivePushSubscriptions(user?.id || userId) : getUserContact(user, channel) || payload[channel === "email" ? "email" : "phone"];
    if ((Array.isArray(contact) && !contact.length) || (!Array.isArray(contact) && !contact)) {
      createDeliveryLog({ notification: effectiveNotification, user, channel, status: "skipped", errorMessage: "Recipient contact is missing.", attemptCount: 0 });
      continue;
    }
    jobs.push(
      enqueueDelivery({
        notification: effectiveNotification,
        user,
        channel,
        runAt,
        payload: {
          to: contact,
          subject: payload.subject || payload.title,
          message: channel === "push" ? minimalPushMessage(payload) : payload.message || payload.body,
          body: channel === "push" ? minimalPushMessage(payload) : payload.body || payload.message,
          template: payload.template || null,
          data: channel === "push" ? { destinationUrl: minimalPushMessage(payload).destinationUrl } : payload.data || {},
        },
      })
    );
  }

  return { notification: effectiveNotification, jobs, delayedUntil: runAt > now() ? runAt : null };
}

function sanitizeNotification(notification) {
  return {
    id: notification.id,
    userId: notification.userId || notification.user_id || notification.recipientUserId || notification.recipient_user_id || null,
    type: notification.type,
    title: notification.title,
    message: notification.message || notification.body || null,
    module: notification.module || null,
    entityType: notification.entityType || notification.entity_type || null,
    entityId: notification.entityId || notification.entity_id || null,
    priority: normalizePriority(notification.priority),
    isRead: Boolean(notification.isRead ?? notification.is_read ?? notification.readAt ?? notification.read_at),
    readAt: notification.readAt || notification.read_at || null,
    createdAt: notification.createdAt || notification.created_at || null,
    expiresAt: notification.expiresAt || notification.expires_at || null,
    destinationUrl: notification.destinationUrl || notification.destination_url || null,
    data: notification.data || {},
  };
}

function getUnreadCount(user) {
  return { unreadCount: listUserNotifications(user, { limit: 1 }).unreadCount };
}

function sanitizePushSubscription(subscription) {
  return {
    id: subscription.id,
    userId: subscription.userId || subscription.user_id,
    organizationId: subscription.organizationId || subscription.organization_id || null,
    endpointHash: subscription.endpointHash || subscription.endpoint_hash,
    browser: subscription.browser || null,
    device: subscription.device || null,
    userAgent: subscription.userAgent || subscription.user_agent || null,
    lastSuccessfulDeliveryAt: subscription.lastSuccessfulDeliveryAt || subscription.last_successful_delivery_at || null,
    failureCount: Number(subscription.failureCount || subscription.failure_count || 0),
    revokedAt: subscription.revokedAt || subscription.revoked_at || null,
    disabledAt: subscription.disabledAt || subscription.disabled_at || null,
    createdAt: subscription.createdAt || subscription.created_at || null,
    updatedAt: subscription.updatedAt || subscription.updated_at || null,
  };
}

function validatePushSubscriptionPayload(payload = {}) {
  const subscription = payload.subscription || payload;
  const endpoint = String(subscription.endpoint || "").trim();
  if (!/^https:\/\/.+/i.test(endpoint)) {
    throw createHttpError(400, "A valid HTTPS push endpoint is required.", "INVALID_PUSH_ENDPOINT");
  }
  const keys = subscription.keys || {};
  const p256dh = String(keys.p256dh || subscription.p256dh || "").trim();
  const auth = String(keys.auth || subscription.auth || "").trim();
  if (!p256dh || !auth) {
    throw createHttpError(400, "Push subscription encryption keys are required.", "INVALID_PUSH_KEYS");
  }
  return {
    endpoint,
    p256dh,
    auth,
    expirationTime: subscription.expirationTime || subscription.expiration_time || null,
  };
}

function subscribePush(user, payload = {}, req = null) {
  const validated = validatePushSubscriptionPayload(payload);
  const hash = endpointHash(validated.endpoint);
  const records = readCollection(PUSH_SUBSCRIPTION_COLLECTION);
  const existingIndex = records.findIndex((record) =>
    !record.revokedAt &&
    !record.revoked_at &&
    !record.disabledAt &&
    !record.disabled_at &&
    (record.userId || record.user_id) === user.id &&
    (record.endpointHash || record.endpoint_hash) === hash
  );
  const timestamp = now();
  const organizationId = user.organizationId || user.organization_id || null;
  const metadata = payload.metadata || payload.device || {};
  const record = {
    ...(existingIndex === -1 ? { id: crypto.randomUUID(), createdAt: timestamp, created_at: timestamp } : records[existingIndex]),
    userId: user.id,
    user_id: user.id,
    organizationId,
    organization_id: organizationId,
    endpoint: validated.endpoint,
    endpointHash: hash,
    endpoint_hash: hash,
    p256dh: validated.p256dh,
    auth: validated.auth,
    expirationTime: validated.expirationTime,
    expiration_time: validated.expirationTime,
    browser: metadata.browser || payload.browser || null,
    device: metadata.device || payload.deviceName || payload.device_name || null,
    userAgent: req?.get?.("user-agent") || metadata.userAgent || metadata.user_agent || null,
    user_agent: req?.get?.("user-agent") || metadata.userAgent || metadata.user_agent || null,
    failureCount: 0,
    failure_count: 0,
    revokedAt: null,
    revoked_at: null,
    disabledAt: null,
    disabled_at: null,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  if (existingIndex === -1) {
    records.push(record);
  } else {
    records[existingIndex] = record;
  }
  writeCollection(PUSH_SUBSCRIPTION_COLLECTION, records);
  audit(req, "PUSH_SUBSCRIPTION_ENABLED", record.id, null, sanitizePushSubscription(record), "SUCCESS", { endpointHash: hash });
  return sanitizePushSubscription(record);
}

function findOwnedPushSubscription(user, idOrEndpoint) {
  const hash = idOrEndpoint && String(idOrEndpoint).startsWith("http") ? endpointHash(idOrEndpoint) : null;
  return readCollection(PUSH_SUBSCRIPTION_COLLECTION).find((record) =>
    (record.userId || record.user_id) === user.id &&
    (record.id === idOrEndpoint || (hash && (record.endpointHash || record.endpoint_hash) === hash)) &&
    !record.deletedAt &&
    !record.deleted_at
  ) || null;
}

function updatePushSubscription(id, updates) {
  const records = readCollection(PUSH_SUBSCRIPTION_COLLECTION);
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) return null;
  records[index] = { ...records[index], ...updates, id, updatedAt: now(), updated_at: now() };
  writeCollection(PUSH_SUBSCRIPTION_COLLECTION, records);
  return records[index];
}

function unsubscribePush(user, payload = {}, req = null) {
  const idOrEndpoint = payload.id || payload.subscriptionId || payload.subscription_id || payload.endpoint;
  const record = findOwnedPushSubscription(user, idOrEndpoint);
  if (!record) {
    throw createHttpError(404, "Push subscription was not found.", "PUSH_SUBSCRIPTION_NOT_FOUND");
  }
  const timestamp = now();
  const updated = updatePushSubscription(record.id, {
    revokedAt: timestamp,
    revoked_at: timestamp,
    disabledAt: timestamp,
    disabled_at: timestamp,
    disabledReason: payload.reason || "user_unsubscribed",
    disabled_reason: payload.reason || "user_unsubscribed",
  });
  audit(req, "PUSH_SUBSCRIPTION_DISABLED", record.id, sanitizePushSubscription(record), sanitizePushSubscription(updated), "SUCCESS", {
    endpointHash: record.endpointHash || record.endpoint_hash,
  });
  return sanitizePushSubscription(updated);
}

function listPushSubscriptions(user, query = {}) {
  const records = getActivePushSubscriptions(user.id);
  const result = paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["browser", "device", "userAgent"]), query);
  return { data: result.data.map(sanitizePushSubscription), meta: result.meta };
}

function listUserNotifications(user, query = {}) {
  const canViewAll = can(user, NOTIFICATION_PERMISSIONS.VIEW_ALL);
  const userId = canViewAll && query.userId ? query.userId : user.id;
  const notifications = readCollection(NOTIFICATION_COLLECTION).filter((notification) => {
    if (notification.deletedAt || notification.deleted_at) {
      return false;
    }
    if (!canViewAll || userId) {
      return (notification.userId || notification.user_id || notification.recipientUserId || notification.recipient_user_id) === userId;
    }
    return true;
  });
  const result = paginate(applyBasicFilters(notifications, { ...query, q: query.q || query.search }, ["type", "title", "message", "body", "module", "priority"]), query);
  const unreadCount = notifications.filter((notification) => !(notification.isRead ?? notification.is_read) && !(notification.readAt || notification.read_at)).length;
  return {
    notifications: result.data.map(sanitizeNotification),
    unreadCount,
    page: result.meta.page,
    limit: result.meta.limit,
    total: result.meta.total,
    totalPages: result.meta.totalPages,
  };
}

function assertNotificationOwner(notification, user) {
  if (can(user, NOTIFICATION_PERMISSIONS.VIEW_ALL)) {
    return;
  }
  const ownerId = notification.userId || notification.user_id || notification.recipientUserId || notification.recipient_user_id;
  if (ownerId !== user.id) {
    throw createHttpError(404, "Notification was not found.", "NOTIFICATION_NOT_FOUND");
  }
}

function updateNotification(id, payload) {
  const records = readCollection(NOTIFICATION_COLLECTION);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) {
    return null;
  }
  records[index] = { ...records[index], ...payload, id, updatedAt: now(), updated_at: now() };
  writeCollection(NOTIFICATION_COLLECTION, records);
  return records[index];
}

function markAsRead(id, user) {
  const notification = readCollection(NOTIFICATION_COLLECTION).find((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (!notification) {
    throw createHttpError(404, "Notification was not found.", "NOTIFICATION_NOT_FOUND");
  }
  assertNotificationOwner(notification, user);
  return sanitizeNotification(updateNotification(id, { isRead: true, is_read: true, readAt: now(), read_at: now() }));
}

function markAllAsRead(user) {
  const records = readCollection(NOTIFICATION_COLLECTION);
  const timestamp = now();
  let count = 0;
  const updated = records.map((record) => {
    const ownerId = record.userId || record.user_id || record.recipientUserId || record.recipient_user_id;
    if (ownerId !== user.id || record.deletedAt || record.deleted_at || record.isRead || record.is_read) {
      return record;
    }
    count += 1;
    return { ...record, isRead: true, is_read: true, readAt: timestamp, read_at: timestamp, updatedAt: timestamp, updated_at: timestamp };
  });
  writeCollection(NOTIFICATION_COLLECTION, updated);
  return { updatedCount: count };
}

function deleteNotification(id, user) {
  const notification = readCollection(NOTIFICATION_COLLECTION).find((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (!notification) {
    throw createHttpError(404, "Notification was not found.", "NOTIFICATION_NOT_FOUND");
  }
  assertNotificationOwner(notification, user);
  return sanitizeNotification(updateNotification(id, { deletedAt: now(), deleted_at: now(), deletedBy: user.id, deleted_by: user.id }));
}

function updateJob(id, payload) {
  const jobs = readCollection(JOB_COLLECTION);
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) {
    return null;
  }
  jobs[index] = { ...jobs[index], ...payload, id, updatedAt: now(), updated_at: now() };
  writeCollection(JOB_COLLECTION, jobs);
  return jobs[index];
}

async function deliverJob(job, req = null) {
  const notification = readCollection(NOTIFICATION_COLLECTION).find((record) => record.id === (job.notificationId || job.notification_id));
  const user = getUserById(job.userId || job.user_id);
  if (job.channel === "push") {
    const subscriptions = Array.isArray(job.payload.to) ? job.payload.to : [];
    const configured = Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY && process.env.WEB_PUSH_VAPID_PRIVATE_KEY && process.env.WEB_PUSH_VAPID_SUBJECT);
    let sent = 0;
    let skipped = 0;
    for (const subscription of subscriptions) {
      if (!subscription || subscription.forceGone || subscription.force_gone) {
        if (subscription?.id) {
          updatePushSubscription(subscription.id, {
            disabledAt: now(),
            disabled_at: now(),
            disabledReason: "expired",
            disabled_reason: "expired",
          });
        }
        createDeliveryLog({ notification, user, channel: "push", status: "failed", provider: "web-push", errorMessage: "Subscription expired.", attemptCount: Number(job.retryCount || job.retry_count || 0) + 1 });
        continue;
      }
      if (!configured && process.env.WEB_PUSH_MOCK_DELIVERY !== "success") {
        skipped += 1;
        createDeliveryLog({ notification, user, channel: "push", status: "skipped", provider: "web-push", errorMessage: "Web Push transport is not configured.", attemptCount: Number(job.retryCount || job.retry_count || 0) + 1 });
        continue;
      }
      sent += 1;
      updatePushSubscription(subscription.id, {
        lastSuccessfulDeliveryAt: now(),
        last_successful_delivery_at: now(),
        failureCount: 0,
        failure_count: 0,
      });
      createDeliveryLog({ notification, user, channel: "push", status: "sent", provider: "web-push", providerMessageId: notification?.id, attemptCount: Number(job.retryCount || job.retry_count || 0) + 1 });
    }
    return { status: sent ? "sent" : "skipped", sent, skipped };
  }
  if (job.channel === "email") {
    const result = await emailService.sendEmail({
      to: job.payload.to,
      subject: job.payload.subject,
      body: job.payload.body || job.payload.message,
      template: job.payload.template,
      data: job.payload.data,
    }, { sendNow: false });
    createDeliveryLog({ notification, user, channel: "email", status: result.status === "QUEUED" ? "sent" : "skipped", provider: "email", providerMessageId: result.log?.id, attemptCount: Number(job.retryCount || job.retry_count || 0) + 1 });
    return result;
  }
  if (job.channel === "sms") {
    const result = await smsService.sendSms({ to: job.payload.to, message: job.payload.message || job.payload.body });
    createDeliveryLog({ notification, user, channel: "sms", status: "sent", provider: result.provider, providerMessageId: result.providerMessageId, attemptCount: Number(job.retryCount || job.retry_count || 0) + 1 });
    return result;
  }
  return null;
}

async function processQueue(limit = 25, req = null) {
  const timestamp = now();
  const jobs = readCollection(JOB_COLLECTION)
    .filter((job) => ["queued", "retrying"].includes(job.status) && (job.nextRunAt || job.next_run_at || timestamp) <= timestamp)
    .slice(0, limit);
  const results = [];
  for (const job of jobs) {
    updateJob(job.id, { status: "sending" });
    try {
      const delivery = await deliverJob(job, req);
      const status = delivery?.status === "skipped" ? "skipped" : "sent";
      updateJob(job.id, { status, sentAt: now(), sent_at: now() });
      results.push({ jobId: job.id, status });
    } catch (error) {
      const retryCount = Number(job.retryCount || job.retry_count || 0) + 1;
      const failed = retryCount >= Number(job.maxRetries || job.max_retries || MAX_RETRIES);
      updateJob(job.id, {
        status: failed ? "failed" : "retrying",
        retryCount,
        retry_count: retryCount,
        nextRunAt: new Date(Date.now() + retryCount * 60 * 1000).toISOString(),
        next_run_at: new Date(Date.now() + retryCount * 60 * 1000).toISOString(),
        lastError: error.publicMessage || error.message,
        last_error: error.publicMessage || error.message,
      });
      createDeliveryLog({
        notification: readCollection(NOTIFICATION_COLLECTION).find((record) => record.id === (job.notificationId || job.notification_id)),
        user: getUserById(job.userId || job.user_id),
        channel: job.channel,
        status: failed ? "failed" : "queued",
        errorMessage: error.publicMessage || error.message,
        attemptCount: retryCount,
      });
      results.push({ jobId: job.id, status: failed ? "failed" : "retrying" });
    }
  }
  return { processed: results.length, results };
}

function listDeliveryLogs(query = {}, user = null) {
  if (user) {
    assertPermission(user, NOTIFICATION_PERMISSIONS.LOGS);
  }
  const result = paginate(applyBasicFilters(readCollection(DELIVERY_LOG_COLLECTION), { ...query, q: query.q || query.search }, ["channel", "provider", "status", "errorMessage"]), query);
  return result;
}

function getQueueStats() {
  return readCollection(JOB_COLLECTION).reduce(
    (summary, job) => {
      summary.total += 1;
      summary[job.status] = (summary[job.status] || 0) + 1;
      return summary;
    },
    { total: 0, queued: 0, retrying: 0, sending: 0, sent: 0, skipped: 0, failed: 0 }
  );
}

module.exports = {
  CHANNELS,
  NOTIFICATION_PERMISSIONS,
  deleteNotification,
  getConfiguration,
  getQueueStats,
  getRule,
  getUserPreferences,
  getUnreadCount,
  getVapidPublicKey,
  listDeliveryLogs,
  listPushSubscriptions,
  listRules,
  listUserNotifications,
  markAllAsRead,
  markAsRead,
  processQueue,
  send,
  subscribePush,
  unsubscribePush,
  updateChannel,
  updateGlobalConfiguration,
  updatePreferences,
  updateRule,
};
