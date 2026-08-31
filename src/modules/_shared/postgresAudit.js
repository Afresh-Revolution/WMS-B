const crypto = require("crypto");
const { isDatabaseConfigured, query } = require("./postgres");
const { recordOperationalAudit } = require("./auditService");

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function safeIp(value) {
  return value && value.length <= 64 ? value : null;
}

async function recordPostgresAudit({
  req,
  user,
  action,
  module,
  targetType,
  targetId,
  targetName,
  outcome,
  status,
  severity,
  description,
  metadata,
  oldValue,
  newValue,
  error,
}) {
  const actor = user || req?.user || null;
  const timestamp = new Date();
  const normalizedAction = normalizeAction(action);
  const eventId = `AUD-${timestamp.toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const effectiveStatus = status || outcome || (error ? "FAILED" : "SUCCESS");
  const safeMetadata = {
    ...(metadata || {}),
    ...(targetId && !isUuid(targetId) ? { targetId } : {}),
  };

  if (isDatabaseConfigured()) {
    try {
      await query(
        `insert into operational_audit_logs
          (event_id, timestamp, actor_id, actor_name, actor_role, user_id, action, action_label, module,
           target_type, target_id, target_name, description, old_value, new_value, before_data, after_data,
           ip_address, user_agent, request_id, session_id, status, severity, metadata, error_code, error_message,
           created_at, updated_at)
         values
          ($1, $2, $3, $4, $5, $3, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $13::jsonb, $14::jsonb,
           $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23, $2, $2)`,
        [
          eventId,
          timestamp,
          actor?.id || null,
          actor?.name || actor?.email || null,
          actor?.role || null,
          normalizedAction,
          titleize(action),
          module,
          targetType || null,
          isUuid(targetId) ? targetId : null,
          targetName || null,
          description || titleize(action),
          JSON.stringify(oldValue || null),
          JSON.stringify(newValue || null),
          safeIp(req?.ip || req?.socket?.remoteAddress || null),
          req?.get?.("user-agent") || null,
          req?.id || null,
          req?.authSessionId || null,
          effectiveStatus,
          severity || (error ? "ERROR" : "INFO"),
          JSON.stringify(safeMetadata),
          error?.code || null,
          error?.publicMessage || error?.message || null,
        ]
      );
      return { eventId };
    } catch (_error) {
      // Fall through to the existing local audit trail so the action is still recorded.
    }
  }

  return recordOperationalAudit({
    user: actor,
    action,
    module,
    recordId: isUuid(targetId) ? targetId : null,
    oldValue,
    newValue,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
    requestId: req?.id,
    sessionId: req?.authSessionId,
    status: effectiveStatus,
    severity: severity || (error ? "ERROR" : "INFO"),
    targetType,
    targetName,
    description,
    metadata: safeMetadata,
    errorCode: error?.code,
    errorMessage: error?.publicMessage || error?.message,
  });
}

module.exports = { recordPostgresAudit };
