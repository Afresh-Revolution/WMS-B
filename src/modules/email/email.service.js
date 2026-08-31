const crypto = require("crypto");
const { hasPermission } = require("../../constants/rbac");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { decryptSecret, encryptSecret } = require("../../utils/encryption");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit, recordTechnicalAuditEvent } = require("../_shared/auditService");
const provider = require("./email.provider");
const queue = require("./email.queue");
const { DEFAULT_EMAIL_TEMPLATES, render } = require("./email.template");

const CONFIG_COLLECTION = "email_configurations";
const TEMPLATE_COLLECTION = "email_templates";

const EMAIL_PERMISSIONS = Object.freeze({
  VIEW: "email_config.view",
  MANAGE: "email_config.manage",
  UPDATE: "email_config.update",
  TEST: "email_config.test",
  TEMPLATES: "email_config.templates",
  SEND: "email.send",
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
  return user?.role === "superadmin" || hasPermission(user, permission) || hasPermission(user, EMAIL_PERMISSIONS.MANAGE);
}

function assertPermission(user, permission) {
  if (!can(user, permission)) {
    throw createHttpError(403, "Access denied.", "ACCESS_DENIED");
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function assertEmail(value, label = "Email") {
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw createHttpError(400, `${label} must be a valid email address.`, "INVALID_EMAIL");
  }
  return email;
}

function getEnvConfig() {
  const providerName = process.env.EMAIL_PROVIDER || "postmark";
  const isEnabled = process.env.EMAIL_ENABLED ? process.env.EMAIL_ENABLED !== "false" : false;
  return {
    id: null,
    provider: providerName,
    emailProvider: providerName,
    email_provider: providerName,
    status: isEnabled ? "operational" : "disabled",
    providerStatus: isEnabled ? "operational" : "disabled",
    provider_status: isEnabled ? "operational" : "disabled",
    fromName: process.env.EMAIL_FROM_NAME || "Afresh",
    from_name: process.env.EMAIL_FROM_NAME || "Afresh",
    fromAddress: process.env.EMAIL_FROM_ADDRESS || "no-reply@afresh.co",
    from_address: process.env.EMAIL_FROM_ADDRESS || "no-reply@afresh.co",
    fromEmail: process.env.EMAIL_FROM_ADDRESS || "no-reply@afresh.co",
    from_email: process.env.EMAIL_FROM_ADDRESS || "no-reply@afresh.co",
    smtpHost: process.env.SMTP_HOST || (providerName === "postmark" ? "smtp.postmark.io" : null),
    smtp_host: process.env.SMTP_HOST || (providerName === "postmark" ? "smtp.postmark.io" : null),
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtp_port: Number(process.env.SMTP_PORT || 587),
    smtpUsername: process.env.SMTP_USERNAME || null,
    smtp_username: process.env.SMTP_USERNAME || null,
    encryptionType: process.env.SMTP_ENCRYPTION || "starttls",
    encryption_type: process.env.SMTP_ENCRYPTION || "starttls",
    isEnabled,
    is_enabled: isEnabled,
    configSource: "environment",
    createdAt: null,
    updatedAt: null,
  };
}

function getStoredConfig() {
  return readCollection(CONFIG_COLLECTION).filter((record) => !record.deletedAt)[0] || null;
}

function getActiveConfig() {
  const stored = getStoredConfig();
  if (!stored) {
    return getEnvConfig();
  }
  return {
    ...getEnvConfig(),
    ...stored,
    provider: stored.provider || stored.emailProvider || stored.email_provider || getEnvConfig().provider,
    fromAddress: stored.fromAddress || stored.from_address || stored.fromEmail || stored.from_email || getEnvConfig().fromAddress,
    from_address: stored.fromAddress || stored.from_address || stored.fromEmail || stored.from_email || getEnvConfig().fromAddress,
    isEnabled: stored.isEnabled ?? stored.is_enabled ?? stored.isActive ?? stored.is_active ?? false,
    is_enabled: stored.isEnabled ?? stored.is_enabled ?? stored.isActive ?? stored.is_active ?? false,
  };
}

function getCredentials(config = getActiveConfig()) {
  return {
    smtpPassword:
      decryptSecret(config.smtpPasswordEncrypted || config.smtp_password_encrypted || config.encryptedPassword || config.encrypted_password) ||
      process.env.SMTP_PASSWORD ||
      null,
    apiKey:
      decryptSecret(config.apiKeyEncrypted || config.api_key_encrypted || config.encryptedSecret || config.encrypted_secret) ||
      process.env.POSTMARK_SERVER_TOKEN ||
      process.env.EMAIL_API_KEY ||
      null,
  };
}

function sanitizeConfig(record = getActiveConfig()) {
  if (!record) {
    return null;
  }
  const isEnabled = record.isEnabled ?? record.is_enabled ?? record.isActive ?? record.is_active ?? false;
  const status = isEnabled ? record.status || record.providerStatus || record.provider_status || "operational" : "disabled";
  return {
    id: record.id || null,
    provider: record.provider || record.emailProvider || record.email_provider || "smtp",
    emailProvider: record.provider || record.emailProvider || record.email_provider || "smtp",
    status,
    providerStatus: status,
    fromName: record.fromName || record.from_name || "Afresh",
    fromAddress: record.fromAddress || record.from_address || record.fromEmail || record.from_email || "no-reply@afresh.co",
    fromEmail: record.fromAddress || record.from_address || record.fromEmail || record.from_email || "no-reply@afresh.co",
    smtpHost: record.smtpHost || record.smtp_host || record.host || null,
    host: record.smtpHost || record.smtp_host || record.host || null,
    smtpPort: Number(record.smtpPort || record.smtp_port || record.port || 587),
    port: Number(record.smtpPort || record.smtp_port || record.port || 587),
    smtpUsername: record.smtpUsername || record.smtp_username || record.username || null,
    username: record.smtpUsername || record.smtp_username || record.username || null,
    encryptionType: record.encryptionType || record.encryption_type || "starttls",
    enabled: Boolean(isEnabled),
    isEnabled: Boolean(isEnabled),
    isActive: Boolean(isEnabled),
    hasPassword: Boolean(record.smtpPasswordEncrypted || record.smtp_password_encrypted || record.encryptedPassword || record.encrypted_password || process.env.SMTP_PASSWORD),
    hasSmtpPassword: Boolean(record.smtpPasswordEncrypted || record.smtp_password_encrypted || record.encryptedPassword || record.encrypted_password || process.env.SMTP_PASSWORD),
    hasApiKey: Boolean(record.apiKeyEncrypted || record.api_key_encrypted || record.encryptedSecret || record.encrypted_secret || process.env.POSTMARK_SERVER_TOKEN || process.env.EMAIL_API_KEY),
    lastCheckedAt: record.lastCheckedAt || record.last_checked_at || null,
    createdAt: record.createdAt || record.created_at || null,
    updatedAt: record.updatedAt || record.updated_at || null,
    updatedBy: record.updatedBy || record.updated_by || null,
  };
}

function audit(req, action, targetId, beforeData, afterData, status = "SUCCESS", metadata = {}) {
  const payload = {
    user: req?.user,
    action,
    module: "Email Configuration",
    recordId: targetId || null,
    targetType: "Email Service",
    targetName: "Outbound Email",
    oldValue: beforeData || null,
    newValue: afterData || null,
    status,
    metadata,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
    requestId: req?.id,
  };
  recordOperationalAudit(payload);
  recordTechnicalAuditEvent({
    user: req?.user,
    action,
    module: "Email Configuration",
    targetType: "Email Service",
    targetId: targetId || null,
    status,
    service: "email",
    metadata,
    beforeData,
    afterData,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
    requestId: req?.id,
  });
}

function normalizeConfigPayload(payload = {}, current = getActiveConfig()) {
  const providerName = String(payload.provider || payload.emailProvider || payload.email_provider || current.provider || "smtp").trim().toLowerCase();
  if (!["smtp", "postmark"].includes(providerName)) {
    throw createHttpError(400, "Email provider must be smtp or postmark.", "INVALID_EMAIL_PROVIDER");
  }
  const fromAddress = assertEmail(payload.fromAddress || payload.from_address || payload.fromEmail || payload.from_email || current.fromAddress, "From address");
  const smtpPort = Number(payload.smtpPort || payload.smtp_port || payload.port || current.smtpPort || 587);
  if (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
    throw createHttpError(400, "SMTP port is invalid.", "INVALID_SMTP_PORT");
  }
  return {
    provider: providerName,
    emailProvider: providerName,
    email_provider: providerName,
    fromName: payload.fromName || payload.from_name || current.fromName || "Afresh",
    from_name: payload.fromName || payload.from_name || current.fromName || "Afresh",
    fromAddress,
    from_address: fromAddress,
    fromEmail: fromAddress,
    from_email: fromAddress,
    smtpHost: payload.smtpHost || payload.smtp_host || payload.host || current.smtpHost || null,
    smtp_host: payload.smtpHost || payload.smtp_host || payload.host || current.smtpHost || null,
    host: payload.smtpHost || payload.smtp_host || payload.host || current.smtpHost || null,
    smtpPort,
    smtp_port: smtpPort,
    port: smtpPort,
    smtpUsername: payload.smtpUsername || payload.smtp_username || payload.username || current.smtpUsername || null,
    smtp_username: payload.smtpUsername || payload.smtp_username || payload.username || current.smtpUsername || null,
    username: payload.smtpUsername || payload.smtp_username || payload.username || current.smtpUsername || null,
    encryptionType: payload.encryptionType || payload.encryption_type || current.encryptionType || "starttls",
    encryption_type: payload.encryptionType || payload.encryption_type || current.encryptionType || "starttls",
    isEnabled: payload.enabled ?? payload.isEnabled ?? payload.is_enabled ?? payload.isActive ?? current.isEnabled ?? false,
    is_enabled: payload.enabled ?? payload.isEnabled ?? payload.is_enabled ?? payload.isActive ?? current.isEnabled ?? false,
  };
}

function saveConfig(payload, req) {
  const current = getStoredConfig();
  const timestamp = now();
  const records = readCollection(CONFIG_COLLECTION);
  if (!current) {
    const record = { id: crypto.randomUUID(), ...payload, createdAt: timestamp, created_at: timestamp, updatedAt: timestamp, updated_at: timestamp, updatedBy: req?.user?.id || null, updated_by: req?.user?.id || null };
    records.push(record);
    writeCollection(CONFIG_COLLECTION, records);
    return record;
  }
  const index = records.findIndex((record) => record.id === current.id);
  records[index] = { ...records[index], ...payload, id: current.id, updatedAt: timestamp, updated_at: timestamp, updatedBy: req?.user?.id || null, updated_by: req?.user?.id || null };
  writeCollection(CONFIG_COLLECTION, records);
  return records[index];
}

function getCurrentConfiguration(user) {
  if (user) {
    assertPermission(user, EMAIL_PERMISSIONS.VIEW);
  }
  return sanitizeConfig(getActiveConfig());
}

function updateConfiguration(payload, req) {
  assertPermission(req.user, EMAIL_PERMISSIONS.UPDATE);
  const current = getActiveConfig();
  const normalized = normalizeConfigPayload(payload, current);
  const credentials = {};
  const smtpPassword = payload.smtpPassword || payload.smtp_password || payload.password;
  const apiKey = payload.apiKey || payload.api_key || payload.postmarkServerToken || payload.postmark_server_token;
  if (smtpPassword) {
    credentials.smtpPasswordEncrypted = encryptSecret(smtpPassword);
    credentials.smtp_password_encrypted = credentials.smtpPasswordEncrypted;
    credentials.encryptedPassword = credentials.smtpPasswordEncrypted;
    credentials.encrypted_password = credentials.smtpPasswordEncrypted;
  } else if (current.smtpPasswordEncrypted || current.smtp_password_encrypted || current.encryptedPassword || current.encrypted_password) {
    credentials.smtpPasswordEncrypted = current.smtpPasswordEncrypted || current.smtp_password_encrypted || current.encryptedPassword || current.encrypted_password;
    credentials.smtp_password_encrypted = credentials.smtpPasswordEncrypted;
    credentials.encryptedPassword = credentials.smtpPasswordEncrypted;
    credentials.encrypted_password = credentials.smtpPasswordEncrypted;
  }
  if (apiKey) {
    credentials.apiKeyEncrypted = encryptSecret(apiKey);
    credentials.api_key_encrypted = credentials.apiKeyEncrypted;
    credentials.encryptedSecret = credentials.apiKeyEncrypted;
    credentials.encrypted_secret = credentials.apiKeyEncrypted;
  } else if (current.apiKeyEncrypted || current.api_key_encrypted || current.encryptedSecret || current.encrypted_secret) {
    credentials.apiKeyEncrypted = current.apiKeyEncrypted || current.api_key_encrypted || current.encryptedSecret || current.encrypted_secret;
    credentials.api_key_encrypted = credentials.apiKeyEncrypted;
    credentials.encryptedSecret = credentials.apiKeyEncrypted;
    credentials.encrypted_secret = credentials.apiKeyEncrypted;
  }
  const previousStatus = String(current.status || "").toLowerCase();
  const status = normalized.isEnabled
    ? payload.status || (["disabled", "inactive"].includes(previousStatus) ? "operational" : current.status) || "operational"
    : "disabled";
  const record = saveConfig({ ...normalized, ...credentials, status, providerStatus: status, provider_status: status }, req);
  const before = sanitizeConfig(current);
  const after = sanitizeConfig(record);
  audit(req, current.provider !== record.provider ? "EMAIL_PROVIDER_CHANGED" : "EMAIL_CONFIG_UPDATED", record.id, before, after);
  return after;
}

function setStatus(payload, req) {
  assertPermission(req.user, EMAIL_PERMISSIONS.UPDATE);
  const current = getActiveConfig();
  const enabled = Boolean(payload.enabled ?? payload.isEnabled ?? payload.is_enabled);
  const status = enabled ? "operational" : "disabled";
  const record = saveConfig({ ...current, isEnabled: enabled, is_enabled: enabled, isActive: enabled, is_active: enabled, status, providerStatus: status, provider_status: status }, req);
  const action = enabled ? "EMAIL_SERVICE_ENABLED" : "EMAIL_SERVICE_DISABLED";
  audit(req, action, record.id, sanitizeConfig(current), sanitizeConfig(record));
  return sanitizeConfig(record);
}

async function checkConfiguration(req) {
  assertPermission(req.user, EMAIL_PERMISSIONS.TEST);
  const current = getActiveConfig();
  const result = await provider.checkStatus(current, getCredentials(current));
  const record = saveConfig({
    ...current,
    status: result.status,
    providerStatus: result.status,
    provider_status: result.status,
    lastCheckedAt: now(),
    last_checked_at: now(),
  }, req);
  audit(req, "EMAIL_CONFIGURATION_CHECKED", record.id, sanitizeConfig(current), sanitizeConfig(record), result.status === "failed" ? "FAILED" : "SUCCESS", { message: result.message });
  return { provider: record.provider, status: result.status, checkedAt: record.lastCheckedAt || record.last_checked_at, message: result.message };
}

function ensureDefaultTemplates() {
  const existing = readCollection(TEMPLATE_COLLECTION).filter((record) => !record.deletedAt);
  if (existing.length) {
    return existing;
  }
  const timestamp = now();
  const seeded = DEFAULT_EMAIL_TEMPLATES.map(([type, name, subject, body]) => ({
    id: crypto.randomUUID(),
    name,
    subject,
    body,
    type,
    templateType: type,
    template_type: type,
    isActive: true,
    is_active: true,
    createdBy: null,
    created_by: null,
    updatedBy: null,
    updated_by: null,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  }));
  writeCollection(TEMPLATE_COLLECTION, seeded);
  return seeded;
}

function sanitizeTemplate(template) {
  return template
    ? {
        id: template.id,
        name: template.name,
        subject: template.subject,
        body: template.body,
        type: template.type || template.templateType || template.template_type,
        isActive: template.isActive ?? template.is_active ?? true,
        createdAt: template.createdAt || template.created_at,
        updatedAt: template.updatedAt || template.updated_at,
      }
    : null;
}

function listTemplates(query = {}, user) {
  if (user) {
    assertPermission(user, EMAIL_PERMISSIONS.TEMPLATES);
  }
  const result = paginate(applyBasicFilters(ensureDefaultTemplates(), { ...query, q: query.q || query.search }, ["name", "subject", "type"]), query);
  result.data = result.data.map(sanitizeTemplate);
  return result;
}

function upsertTemplate(payload, req, id = null) {
  assertPermission(req.user, EMAIL_PERMISSIONS.TEMPLATES);
  if (!payload.name || !payload.subject || !payload.body) {
    throw createHttpError(400, "Template name, subject, and body are required.", "INVALID_EMAIL_TEMPLATE");
  }
  const records = ensureDefaultTemplates();
  const index = id ? records.findIndex((record) => record.id === id) : -1;
  const timestamp = now();
  const values = {
    name: payload.name,
    subject: payload.subject,
    body: payload.body,
    type: payload.type || payload.templateType || payload.template_type || "custom",
    templateType: payload.type || payload.templateType || payload.template_type || "custom",
    template_type: payload.type || payload.templateType || payload.template_type || "custom",
    isActive: payload.isActive ?? payload.is_active ?? true,
    is_active: payload.isActive ?? payload.is_active ?? true,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  if (index === -1) {
    records.push({ id: crypto.randomUUID(), ...values, createdBy: req.user.id, created_by: req.user.id, createdAt: timestamp, created_at: timestamp });
  } else {
    records[index] = { ...records[index], ...values, id };
  }
  writeCollection(TEMPLATE_COLLECTION, records);
  const template = index === -1 ? records[records.length - 1] : records[index];
  audit(req, index === -1 ? "EMAIL_TEMPLATE_CREATED" : "EMAIL_TEMPLATE_UPDATED", template.id, null, sanitizeTemplate(template));
  return sanitizeTemplate(template);
}

function resolveTemplate(templateKey) {
  if (!templateKey) {
    return null;
  }
  return (
    ensureDefaultTemplates().find(
      (template) =>
        !template.deletedAt &&
        (template.id === templateKey || template.type === templateKey || template.templateType === templateKey || template.template_type === templateKey)
    ) || null
  );
}

function buildMessage(payload) {
  const template = resolveTemplate(payload.template || payload.templateType || payload.template_type);
  if (template) {
    return {
      ...payload,
      templateId: template.id,
      subject: render(template.subject, payload.data || {}),
      body: render(template.body, payload.data || {}),
    };
  }
  if (!payload.subject || !payload.body) {
    throw createHttpError(400, "Email subject and body are required when no template is provided.", "INVALID_EMAIL_MESSAGE");
  }
  return payload;
}

async function deliverPayload(payload, req, existingLogId = null) {
  const config = getActiveConfig();
  if (!(config.isEnabled ?? config.is_enabled)) {
    const values = {
      status: "cancelled",
      errorMessage: "Email delivery is disabled.",
      error_message: "Email delivery is disabled.",
    };
    const log = existingLogId
      ? queue.updateEmailLog(existingLogId, values)
      : queue.createEmailLog({
          recipient: Array.isArray(payload.to) ? payload.to.join(",") : payload.to,
          sender: config.fromAddress || config.from_address,
          subject: payload.subject,
          templateId: payload.templateId,
          template: payload.template,
          provider: config.provider,
          ...values,
        });
    return { status: "SKIPPED", log, reason: "EMAIL_DISABLED" };
  }
  const result = await provider.sendEmail(config, getCredentials(config), payload);
  const values = {
    status: "sent",
    messageId: result.messageId,
    message_id: result.messageId,
    retryCount: 0,
    retry_count: 0,
    sentAt: now(),
    sent_at: now(),
  };
  const log = existingLogId
    ? queue.updateEmailLog(existingLogId, values)
    : queue.createEmailLog({
        recipient: Array.isArray(payload.to) ? payload.to.join(",") : payload.to,
        sender: config.fromAddress || config.from_address,
        subject: payload.subject,
        templateId: payload.templateId,
        template: payload.template,
        provider: config.provider,
        ...values,
      });
  audit(req, "EMAIL_SENT", log.id, null, { recipient: log.recipient, subject: log.subject, provider: log.provider });
  return { status: "SUCCESS", log, messageId: result.messageId };
}

async function sendEmail(payload, options = {}) {
  const to = Array.isArray(payload.to) ? payload.to.map((entry) => assertEmail(entry, "Recipient")) : assertEmail(payload.to || payload.recipient, "Recipient");
  const message = buildMessage({
    ...payload,
    to,
    from: payload.from || sanitizeConfig(getActiveConfig()).fromAddress,
  });
  if (options.sendNow) {
    return deliverPayload(message, options.req || null);
  }
  const config = getActiveConfig();
  if (!(config.isEnabled ?? config.is_enabled)) {
    const log = queue.createEmailLog({
      recipient: Array.isArray(to) ? to.join(",") : to,
      sender: config.fromAddress || config.from_address,
      subject: message.subject,
      templateId: message.templateId,
      template: message.template,
      provider: config.provider,
      status: "cancelled",
      errorMessage: "Email delivery is disabled.",
    });
    return { status: "SKIPPED", log, reason: "EMAIL_DISABLED" };
  }
  return { status: "QUEUED", ...queue.enqueueEmail({ ...message, provider: config.provider }) };
}

async function sendTestEmail(payload, req) {
  assertPermission(req.user, EMAIL_PERMISSIONS.TEST);
  const recipient = assertEmail(payload.recipient || payload.to, "Recipient");
  try {
    const result = await sendEmail(
      {
        to: recipient,
        subject: payload.subject || "Afresh email configuration test",
        body: payload.body || "<p>This is a test email from Afresh Work Management System.</p>",
      },
      { sendNow: true, req }
    );
    const action = result.status === "SUCCESS" ? "EMAIL_TEST_SENT" : "EMAIL_TEST_FAILED";
    audit(req, action, result.log?.id || null, null, { recipient, status: result.status }, result.status === "SUCCESS" ? "SUCCESS" : "FAILED");
    return {
      status: result.status,
      recipient,
      message: result.status === "SUCCESS" ? "Test email sent successfully" : "Unable to send test email",
      log: result.log,
    };
  } catch (error) {
    audit(req, "EMAIL_TEST_FAILED", null, null, { recipient }, "FAILED", { errorCode: error.code, message: error.publicMessage || error.message });
    throw error;
  }
}

async function processQueue(limit = 25, req = null) {
  const jobs = queue.listRunnableJobs(limit);
  const results = [];
  for (const job of jobs) {
    queue.updateJob(job.id, { status: "sending", lockedAt: now(), locked_at: now() });
    queue.updateEmailLog(job.logId || job.log_id, { status: "sending" });
    try {
      const delivery = await deliverPayload(job.payload, req, job.logId || job.log_id);
      queue.updateJob(job.id, { status: "sent", lockedAt: null, locked_at: null });
      queue.updateEmailLog(job.logId || job.log_id, { status: "sent", messageId: delivery.messageId, message_id: delivery.messageId, sentAt: now(), sent_at: now() });
      results.push({ jobId: job.id, status: "sent" });
    } catch (error) {
      const retryCount = Number(job.retryCount || job.retry_count || 0) + 1;
      const failed = retryCount >= Number(job.maxRetries || job.max_retries || 3);
      const delayMs = Math.min(15 * 60 * 1000, retryCount * retryCount * 60 * 1000);
      queue.updateJob(job.id, {
        status: failed ? "failed" : "retrying",
        retryCount,
        retry_count: retryCount,
        lockedAt: null,
        locked_at: null,
        nextRunAt: new Date(Date.now() + delayMs).toISOString(),
        next_run_at: new Date(Date.now() + delayMs).toISOString(),
        lastError: error.publicMessage || error.message,
        last_error: error.publicMessage || error.message,
      });
      queue.updateEmailLog(job.logId || job.log_id, {
        status: failed ? "failed" : "queued",
        retryCount,
        retry_count: retryCount,
        errorMessage: error.publicMessage || error.message,
        error_message: error.publicMessage || error.message,
      });
      results.push({ jobId: job.id, status: failed ? "failed" : "retrying" });
    }
  }
  return { processed: results.length, results };
}

function listLogs(query = {}, user) {
  if (user) {
    assertPermission(user, EMAIL_PERMISSIONS.VIEW);
  }
  const logs = applyBasicFilters(readCollection("email_logs"), { ...query, q: query.q || query.search }, ["recipient", "sender", "subject", "template", "provider", "status"]);
  return paginate(logs, query);
}

module.exports = {
  EMAIL_PERMISSIONS,
  checkConfiguration,
  getCurrentConfiguration,
  getCredentials,
  getQueueStats: queue.getQueueStats,
  listLogs,
  listTemplates,
  processQueue,
  sanitizeConfig,
  sendEmail,
  sendTestEmail,
  setStatus,
  updateConfiguration,
  upsertTemplate,
};
