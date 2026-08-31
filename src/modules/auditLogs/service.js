const { hasPermission, PERMISSIONS } = require("../../constants/rbac");
const { readCollection } = require("../../database/jsonStore");
const { recordOperationalAudit } = require("../_shared/auditService");

const MAX_LIMIT = 100;

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function canViewAudit(user) {
  return (
    user?.role === "superadmin" ||
    hasPermission(user, PERMISSIONS.VIEW_AUDIT_LOGS) ||
    hasPermission(user, PERMISSIONS.OPERATIONAL_AUDIT_VIEW)
  );
}

function assertAuditAccess(user) {
  if (!canViewAudit(user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function normalizeLog(record) {
  const actor = record.user || {};
  const eventId = record.eventId || record.event_id || `AUD-LEGACY-${String(record.id || "").slice(0, 8)}`;
  const actorId = record.actorId || record.actor_id || record.userId || record.user_id || actor.id || null;
  const actorName = record.actorName || record.actor_name || actor.name || actor.email || null;
  const actorRole = record.actorRole || record.actor_role || actor.role || null;
  const targetId = record.targetId || record.target_id || record.recordId || record.record_id || null;
  const timestamp = record.timestamp || record.createdAt || record.created_at;
  return {
    id: record.id,
    eventId,
    event_id: eventId,
    timestamp,
    actorId,
    actor_id: actorId,
    actorName,
    actor_name: actorName,
    actorRole,
    actor_role: actorRole,
    action: record.action,
    actionLabel: record.actionLabel || record.action_label || humanize(record.action),
    action_label: record.actionLabel || record.action_label || humanize(record.action),
    module: record.module,
    targetType: record.targetType || record.target_type || null,
    target_type: record.targetType || record.target_type || null,
    targetId,
    target_id: targetId,
    targetName: record.targetName || record.target_name || null,
    target_name: record.targetName || record.target_name || null,
    description: record.description || humanize(record.action),
    ipAddress: record.ipAddress || record.ip_address || null,
    ip_address: record.ipAddress || record.ip_address || null,
    userAgent: record.userAgent || record.user_agent || null,
    user_agent: record.userAgent || record.user_agent || null,
    requestId: record.requestId || record.request_id || null,
    request_id: record.requestId || record.request_id || null,
    sessionId: record.sessionId || record.session_id || null,
    session_id: record.sessionId || record.session_id || null,
    status: record.status || "SUCCESS",
    severity: record.severity || "INFO",
    metadata: record.metadata || {},
    beforeData: record.beforeData || record.before_data || record.oldValue || record.old_value || null,
    before_data: record.beforeData || record.before_data || record.oldValue || record.old_value || null,
    afterData: record.afterData || record.after_data || record.newValue || record.new_value || null,
    after_data: record.afterData || record.after_data || record.newValue || record.new_value || null,
    errorCode: record.errorCode || record.error_code || null,
    error_code: record.errorCode || record.error_code || null,
    errorMessage: record.errorMessage || record.error_message || null,
    error_message: record.errorMessage || record.error_message || null,
    previousHash: record.previousHash || record.previous_hash || null,
    previous_hash: record.previousHash || record.previous_hash || null,
    recordHash: record.recordHash || record.record_hash || null,
    record_hash: record.recordHash || record.record_hash || null,
    createdAt: record.createdAt || record.created_at || timestamp,
    created_at: record.createdAt || record.created_at || timestamp,
  };
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getAllLogs() {
  return readCollection("operational_audit_logs")
    .filter((record) => !record.deletedAt && !record.deleted_at)
    .map(normalizeLog)
    .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")));
}

function matchesDate(log, query = {}) {
  const from = query.date_from || query.dateFrom || presetFrom(query.datePreset || query.date_filter);
  const to = query.date_to || query.dateTo;
  const timestamp = new Date(log.timestamp || log.createdAt || 0).getTime();
  if (from && timestamp < new Date(`${from}T00:00:00.000Z`).getTime()) {
    return false;
  }
  if (to && timestamp > new Date(`${to}T23:59:59.999Z`).getTime()) {
    return false;
  }
  return true;
}

function presetFrom(preset) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (preset === "today") {
    return today.toISOString().slice(0, 10);
  }
  if (preset === "yesterday") {
    return new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  }
  if (preset === "last_7_days") {
    return new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  }
  if (preset === "last_30_days") {
    return new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  }
  if (preset === "this_month") {
    return today.toISOString().slice(0, 7) + "-01";
  }
  return null;
}

function applyFilters(logs, query = {}) {
  const search = String(query.search || query.q || "").toLowerCase();
  return logs.filter((log) => {
    if (!matchesDate(log, query)) {
      return false;
    }
    if (query.module && String(log.module || "").toLowerCase() !== String(query.module).toLowerCase()) {
      return false;
    }
    if (query.action && String(log.action || "").toLowerCase() !== String(query.action).toLowerCase()) {
      return false;
    }
    if (query.status && String(log.status || "").toLowerCase() !== String(query.status).toLowerCase()) {
      return false;
    }
    if (query.severity && String(log.severity || "").toLowerCase() !== String(query.severity).toLowerCase()) {
      return false;
    }
    if (query.actor) {
      const actor = `${log.actorId || ""} ${log.actorName || ""}`.toLowerCase();
      if (!actor.includes(String(query.actor).toLowerCase())) {
        return false;
      }
    }
    if (query.target) {
      const target = `${log.targetId || ""} ${log.targetName || ""} ${log.targetType || ""}`.toLowerCase();
      if (!target.includes(String(query.target).toLowerCase())) {
        return false;
      }
    }
    if (!search) {
      return true;
    }
    return [
      log.actorName,
      log.actorId,
      log.action,
      log.actionLabel,
      log.module,
      log.targetName,
      log.targetId,
      log.description,
      log.ipAddress,
      log.eventId,
    ]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
}

function paginate(records, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || 25));
  const total = records.length;
  const start = (page - 1) * limit;
  return {
    data: records.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

function listAuditLogs(user, query = {}) {
  assertAuditAccess(user);
  return paginate(applyFilters(getAllLogs(), query), query);
}

function getAuditLog(id, user) {
  assertAuditAccess(user);
  const logs = getAllLogs();
  const log = logs.find((entry) => entry.id === id || entry.eventId === id);
  if (!log) {
    return null;
  }
  return {
    ...log,
    integrity: verifyLogIntegrity(log, logs),
  };
}

function verifyLogIntegrity(log, logs) {
  if (!log.recordHash) {
    return { verified: false, reason: "Legacy record has no hash." };
  }
  const previous = logs
    .slice()
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
    .find((entry) => entry.recordHash === log.previousHash);
  return {
    verified: log.previousHash ? Boolean(previous) : true,
    previousHash: log.previousHash,
    recordHash: log.recordHash,
  };
}

function getAuditStats(user, query = {}) {
  assertAuditAccess(user);
  const logs = applyFilters(getAllLogs(), query);
  const today = new Date().toISOString().slice(0, 10);
  return {
    totalEvents: logs.length,
    successfulEvents: logs.filter((log) => log.status === "SUCCESS").length,
    failedEvents: logs.filter((log) => log.status === "FAILED").length,
    securityEvents: logs.filter((log) => String(log.module || "").toLowerCase().includes("security")).length,
    criticalEvents: logs.filter((log) => log.severity === "CRITICAL").length,
    eventsToday: logs.filter((log) => String(log.timestamp || "").startsWith(today)).length,
    eventsByModule: countBy(logs, "module"),
    eventsByUser: countBy(logs, "actorName"),
    eventsByAction: countBy(logs, "action"),
    eventsByStatus: countBy(logs, "status"),
    eventsByDay: logs.reduce((summary, log) => {
      const day = String(log.timestamp || "").slice(0, 10);
      summary[day] = (summary[day] || 0) + 1;
      return summary;
    }, {}),
  };
}

function countBy(records, field) {
  return records.reduce((summary, record) => {
    const key = record[field] || "Unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function exportAuditLogs(user, query = {}, requestContext = {}) {
  assertAuditAccess(user);
  const format = String(query.format || "csv").toLowerCase();
  if (!["csv", "xlsx", "json"].includes(format)) {
    throw createHttpError(400, "Unsupported audit export format.", "UNSUPPORTED_AUDIT_EXPORT_FORMAT");
  }
  const logs = applyFilters(getAllLogs(), query);
  const content = format === "json" ? JSON.stringify(logs, null, 2) : toCsv(logs);
  const audit = recordOperationalAudit({
    user,
    action: "AUDIT_LOGS_EXPORTED",
    module: "operational_audit",
    recordId: null,
    newValue: { format, filters: query, exportedRows: logs.length },
    ipAddress: requestContext.ipAddress,
    userAgent: requestContext.userAgent,
    requestId: requestContext.requestId,
    sessionId: requestContext.sessionId,
    targetType: "OperationalAuditLog",
    description: `Exported ${logs.length} operational audit log records as ${format.toUpperCase()}.`,
    metadata: { format, exportedRows: logs.length },
  });
  return { format, content, count: logs.length, auditEventId: audit.eventId };
}

function toCsv(logs) {
  const headers = [
    "eventId",
    "timestamp",
    "actorName",
    "actorRole",
    "action",
    "actionLabel",
    "module",
    "targetType",
    "targetId",
    "targetName",
    "ipAddress",
    "status",
    "severity",
    "requestId",
  ];
  return [headers, ...logs.map((log) => headers.map((header) => log[header] || ""))]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

module.exports = {
  exportAuditLogs,
  getAuditLog,
  getAuditStats,
  listAuditLogs,
};
