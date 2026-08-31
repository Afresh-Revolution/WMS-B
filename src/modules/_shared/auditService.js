const crypto = require("crypto");
const { appendRecord, readCollection } = require("../../database/jsonStore");

const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "refreshTokenHash",
  "apiKey",
  "secret",
  "authorization",
  "creditCard",
  "cardNumber",
  "cvv",
];

function isSensitiveKey(key) {
  const normalized = String(key || "").toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive.toLowerCase()));
}

function redactSensitiveData(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveData);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.entries(value).reduce((result, [key, entry]) => {
    result[key] = isSensitiveKey(key) ? "[REDACTED]" : redactSensitiveData(entry);
    return result;
  }, {});
}

function normalizeAction(action) {
  return String(action || "AUDIT_EVENT")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function titleize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildEventId(timestamp) {
  const date = timestamp.slice(0, 10).replace(/-/g, "");
  const sequence = readCollection("operational_audit_logs").length + 1;
  return `AUD-${date}-${String(sequence).padStart(6, "0")}`;
}

function hashAuditRecord(record) {
  return crypto
    .createHash("sha256")
    .update(
      [
        record.eventId,
        record.event_id,
        record.timestamp,
        record.actorId,
        record.actor_id,
        record.action,
        record.module,
        record.targetId,
        record.target_id,
        record.previousHash,
        record.previous_hash,
      ]
        .filter((value) => value !== undefined && value !== null)
        .join("|")
    )
    .digest("hex");
}

function getPreviousHash() {
  const records = readCollection("operational_audit_logs");
  return records.length ? records[records.length - 1].recordHash || records[records.length - 1].record_hash || null : null;
}

function recordOperationalAudit({
  user,
  action,
  module,
  recordId,
  oldValue,
  newValue,
  ipAddress,
  userAgent,
  requestId,
  sessionId,
  status,
  severity,
  targetType,
  targetName,
  description,
  metadata,
  errorCode,
  errorMessage,
}) {
  const timestamp = new Date().toISOString();
  const normalizedAction = normalizeAction(action);
  const previousHash = getPreviousHash();
  const eventId = buildEventId(timestamp);
  const beforeData = redactSensitiveData(oldValue || null);
  const afterData = redactSensitiveData(newValue || null);
  const actorName = user?.name || user?.email || null;
  const actorRole = user?.role || null;
  const auditPayload = {
    id: crypto.randomUUID(),
    eventId,
    event_id: eventId,
    timestamp,
    actorId: user?.id || null,
    actor_id: user?.id || null,
    actorName,
    actor_name: actorName,
    actorRole,
    actor_role: actorRole,
    userId: user?.id || null,
    user_id: user?.id || null,
    user: user
      ? {
          id: user.id,
          email: user.email,
          role: user.role,
          name: user.name || null,
        }
      : null,
    action: normalizedAction,
    actionLabel: titleize(action),
    action_label: titleize(action),
    module,
    targetType: targetType || null,
    target_type: targetType || null,
    targetId: recordId || null,
    target_id: recordId || null,
    recordId: recordId || null,
    record_id: recordId || null,
    targetName: targetName || null,
    target_name: targetName || null,
    description: description || titleize(action),
    ipAddress: ipAddress || null,
    ip_address: ipAddress || null,
    userAgent: userAgent || null,
    user_agent: userAgent || null,
    requestId: requestId || null,
    request_id: requestId || null,
    sessionId: sessionId || null,
    session_id: sessionId || null,
    status: status || "SUCCESS",
    severity: severity || "INFO",
    metadata: redactSensitiveData(metadata || {}),
    beforeData,
    before_data: beforeData,
    afterData,
    after_data: afterData,
    oldValue: beforeData,
    old_value: beforeData,
    newValue: afterData,
    new_value: afterData,
    errorCode: errorCode || null,
    error_code: errorCode || null,
    errorMessage: errorMessage || null,
    error_message: errorMessage || null,
    previousHash,
    previous_hash: previousHash,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  auditPayload.recordHash = hashAuditRecord(auditPayload);
  auditPayload.record_hash = auditPayload.recordHash;

  const operationalAudit = appendRecord("operational_audit_logs", {
    ...auditPayload,
  });

  appendRecord("audit_logs", {
    id: crypto.randomUUID(),
    eventId,
    event_id: eventId,
    actorId: user?.id || null,
    actor_id: user?.id || null,
    actorName,
    actor_name: actorName,
    actorRole,
    actor_role: actorRole,
    action: normalizedAction,
    actionLabel: titleize(action),
    action_label: titleize(action),
    module,
    targetId: recordId || null,
    target_id: recordId || null,
    targetType: targetType || null,
    target_type: targetType || null,
    targetName: targetName || null,
    target_name: targetName || null,
    description: description || titleize(action),
    oldValues: beforeData,
    old_values: beforeData,
    newValues: afterData,
    new_values: afterData,
    ipAddress: ipAddress || null,
    ip_address: ipAddress || null,
    userAgent: userAgent || null,
    user_agent: userAgent || null,
    requestId: requestId || null,
    request_id: requestId || null,
    sessionId: sessionId || null,
    session_id: sessionId || null,
    status: status || "SUCCESS",
    severity: severity || "INFO",
    metadata: redactSensitiveData(metadata || {}),
    errorCode: errorCode || null,
    error_code: errorCode || null,
    errorMessage: errorMessage || null,
    error_message: errorMessage || null,
    previousHash,
    previous_hash: previousHash,
    recordHash: auditPayload.recordHash,
    record_hash: auditPayload.recordHash,
    createdAt: timestamp,
    created_at: timestamp,
  });

  return operationalAudit;
}

function recordTechnicalAudit({ req, statusCode, service, error, responseTimeMs }) {
  return appendRecord("technical_audit_logs", {
    id: crypto.randomUUID(),
    requestId: req.id || crypto.randomUUID(),
    user: req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : null,
    ip: req.ip || req.socket?.remoteAddress || null,
    endpoint: req.originalUrl,
    method: req.method,
    statusCode,
    responseTimeMs: responseTimeMs || null,
    service: service || "api",
    error: error
      ? {
          name: error.name,
          message: error.publicMessage || error.message,
        }
      : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function buildTechnicalEventId(timestamp) {
  const date = timestamp.slice(0, 10).replace(/-/g, "");
  const sequence = readCollection("technical_audit_logs").length + 1;
  return `TECH-${date}-${String(sequence).padStart(5, "0")}`;
}

function recordTechnicalAuditEvent({
  user,
  action,
  module,
  targetType,
  targetId,
  description,
  status,
  severity,
  metadata,
  beforeData,
  afterData,
  ipAddress,
  userAgent,
  requestId,
  service,
  error,
}) {
  const timestamp = new Date().toISOString();
  const eventId = buildTechnicalEventId(timestamp);
  return appendRecord("technical_audit_logs", {
    id: crypto.randomUUID(),
    eventId,
    event_id: eventId,
    timestamp,
    actorId: user?.id || null,
    actor_id: user?.id || null,
    actorName: user?.name || user?.email || null,
    actor_name: user?.name || user?.email || null,
    actorRole: user?.role || null,
    actor_role: user?.role || null,
    userId: user?.id || null,
    user_id: user?.id || null,
    user: user ? { id: user.id, email: user.email, role: user.role, name: user.name || null } : null,
    action: normalizeAction(action),
    actionLabel: titleize(action),
    action_label: titleize(action),
    module: module || "system-management",
    targetType: targetType || null,
    target_type: targetType || null,
    targetId: targetId || null,
    target_id: targetId || null,
    description: description || titleize(action),
    ip: ipAddress || null,
    ipAddress: ipAddress || null,
    ip_address: ipAddress || null,
    userAgent: userAgent || null,
    user_agent: userAgent || null,
    requestId: requestId || null,
    request_id: requestId || null,
    statusCode: status === "FAILED" ? 500 : 200,
    status_code: status === "FAILED" ? 500 : 200,
    status: status || "SUCCESS",
    severity: severity || "INFO",
    service: service || "system-management",
    metadata: redactSensitiveData(metadata || {}),
    beforeData: redactSensitiveData(beforeData || null),
    before_data: redactSensitiveData(beforeData || null),
    afterData: redactSensitiveData(afterData || null),
    after_data: redactSensitiveData(afterData || null),
    error: error ? { name: error.name, message: error.publicMessage || error.message } : null,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  });
}

module.exports = { recordOperationalAudit, recordTechnicalAudit, recordTechnicalAuditEvent, redactSensitiveData };
