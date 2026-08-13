const crypto = require("crypto");
const { appendRecord } = require("../../database/jsonStore");

function recordOperationalAudit({ user, action, module, recordId, oldValue, newValue, ipAddress, userAgent }) {
  const timestamp = new Date().toISOString();
  const operationalAudit = appendRecord("operational_audit_logs", {
    id: crypto.randomUUID(),
    user: user
      ? {
          id: user.id,
          email: user.email,
          role: user.role,
        }
      : null,
    action,
    module,
    recordId: recordId || null,
    oldValue: oldValue || null,
    newValue: newValue || null,
    ipAddress: ipAddress || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  appendRecord("audit_logs", {
    id: crypto.randomUUID(),
    actorId: user?.id || null,
    action,
    module,
    targetId: recordId || null,
    oldValues: oldValue || null,
    newValues: newValue || null,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    createdAt: timestamp,
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

module.exports = { recordOperationalAudit, recordTechnicalAudit };
