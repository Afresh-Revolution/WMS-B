const technicalAuditRepository = require("../modules/technicalAudit/repository");

function technicalAuditMiddleware(req, res, next) {
  res.on("finish", () => {
    if (!req.user || !isAuditedPath(req.originalUrl)) {
      return;
    }
    technicalAuditRepository.recordLog({
      req,
      action: inferAction(req),
      module: inferModule(req.originalUrl),
      target: req.params?.id || req.params?.userId || null,
      status: res.statusCode >= 400 ? "failed" : "success",
      statusCode: res.statusCode,
      metadata: {
        statusCode: res.statusCode,
        route: req.route?.path || null,
      },
    }).catch(() => null);
  });
  return next();
}

function isAuditedPath(path = "") {
  const normalized = String(path || "").toLowerCase();
  return normalized.startsWith("/api/admin") || normalized.startsWith("/api/superadmin") || normalized.startsWith("/api/accountant") || normalized.includes("/api/v1/security") || normalized.includes("/api/v1/system");
}

function inferAction(req) {
  if (req.method === "GET") return "ADMIN_VIEWED";
  if (req.method === "POST") return "ADMIN_CREATED_OR_TRIGGERED";
  if (["PUT", "PATCH"].includes(req.method)) return "ADMIN_UPDATED";
  if (req.method === "DELETE") return "ADMIN_DELETED";
  return "ADMIN_ACTION";
}

function inferModule(path = "") {
  const normalized = String(path || "").toLowerCase();
  if (normalized.includes("technical-audit")) return "Technical Audit";
  if (normalized.includes("backup")) return "Backups";
  if (normalized.includes("security")) return "Security";
  if (normalized.includes("email")) return "Email";
  if (normalized.includes("notification")) return "Notifications";
  if (normalized.includes("integration")) return "Integrations";
  if (normalized.includes("accountant")) return "Accountant";
  if (normalized.includes("system-health") || normalized.includes("health")) return "System Health";
  if (normalized.includes("system")) return "System";
  return "Admin";
}

module.exports = { technicalAuditMiddleware };
