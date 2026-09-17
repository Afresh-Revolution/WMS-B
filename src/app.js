const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { superadminRouter } = require("./routes/superadminAuth");
const { createApiV1Router } = require("./modules/apiV1");
const { emailConfigRouter } = require("./modules/email/email.routes");
const emailService = require("./modules/email/email.service");
const { integrationsRouter, paystackPaymentsRouter, paystackWebhookRouter } = require("./modules/integrations/integration.routes");
const { notificationConfigRouter, notificationsRouter } = require("./modules/notifications/notification.routes");
const { securityRouter } = require("./modules/security/routes");
const { backupsRouter } = require("./modules/backups/routes");
const { systemHealthRouter } = require("./modules/systemHealth/routes");
const { profileRouter } = require("./modules/profile/routes");
const { technicalAuditRouter } = require("./modules/technicalAudit/routes");
const { superAdminRouter } = require("./modules/superAdmin/routes");
const { hrRouter } = require("./modules/hr/routes");
const { hodRouter } = require("./modules/hod/routes");
const { employeeRouter } = require("./modules/employee/routes");
const { internRouter } = require("./modules/intern/routes");
const { managerRouter } = require("./modules/manager/routes");
const { secretaryRouter } = require("./modules/secretary/routes");
const { accountantRouter } = require("./modules/accountant/routes");
const { attendanceRouter } = require("./modules/attendance/routes");
const { apiMetricsMiddleware } = require("./middleware/apiMetrics");
const { technicalAuditMiddleware } = require("./middleware/technicalAudit");
const { securityHeadersMiddleware, corsMiddleware, rateLimitMiddleware } = require("./middleware/productionSecurity");
const { recordTechnicalAudit } = require("./modules/_shared/auditService");
const { checkDatabaseConnection } = require("./db");
const { getRuntimeConfig } = require("./config");

function createApp() {
  const app = express();
  const runtimeConfig = getRuntimeConfig();

  app.disable("x-powered-by");
  app.set("trust proxy", runtimeConfig.trustProxy);
  app.use((req, res, next) => {
    req.id = req.get("x-request-id") || crypto.randomUUID();
    res.setHeader("x-request-id", req.id);
    req.startedAt = process.hrtime.bigint();
    return next();
  });
  app.use(securityHeadersMiddleware(runtimeConfig));
  app.use(corsMiddleware(runtimeConfig));
  app.use(rateLimitMiddleware(runtimeConfig.rateLimit));
  app.use(express.json({
    limit: runtimeConfig.bodyLimit,
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  }));
  app.use(apiMetricsMiddleware);
  app.use(technicalAuditMiddleware);

  const publicDir = path.join(__dirname, "..", "public");
  app.get("/sw.js", (_req, res) => {
    res.setHeader("content-type", "application/javascript; charset=utf-8");
    res.setHeader("service-worker-allowed", "/");
    res.setHeader("cache-control", "no-cache");
    return res.sendFile(path.join(publicDir, "sw.js"));
  });
  app.get("/manifest.webmanifest", (_req, res) => {
    res.setHeader("content-type", "application/manifest+json; charset=utf-8");
    return res.sendFile(path.join(publicDir, "manifest.webmanifest"));
  });
  app.get("/check-in", (_req, res) => {
    res.setHeader("cache-control", "no-store");
    return res.sendFile(path.join(publicDir, "check-in.html"));
  });
  app.use("/pwa", express.static(publicDir, { index: false, maxAge: "1h" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "wms-api",
      status: "ok",
      version: process.env.npm_package_version || "1.0.0",
      docs: {
        login: "/api/v1/auth/login",
        superAdmin: "/api/v1/super-admin/modules",
        hod: "/api/v1/hod/dashboard",
        employee: "/api/v1/employee/dashboard",
        intern: "/api/v1/intern/dashboard",
        manager: "/api/v1/manager/dashboard",
        hr: "/api/v1/hr/dashboard",
        secretary: "/api/v1/secretary/dashboard",
        accountant: "/api/v1/accountant/dashboard",
        attendance: "/api/v1/attendance/me/status",
        checkIn: "/check-in",
        webPush: "/api/v1/notifications/push/public-key",
      },
    });
  });
  app.get("/live", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/ready", async (_req, res) => {
    if (!runtimeConfig.requireDatabaseOnReady || !runtimeConfig.databaseUrl) {
      return res.json({ status: "ready", database: runtimeConfig.databaseUrl ? "configured" : "not_configured" });
    }

    try {
      await checkDatabaseConnection();
      return res.json({ status: "ready", database: "ok" });
    } catch (_error) {
      return res.status(503).json({ status: "not_ready", database: "unhealthy" });
    }
  });
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/health/database", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      return res.json({ status: "not_configured" });
    }
    try {
      await checkDatabaseConnection();
      return res.json({ status: "ok" });
    } catch (_error) {
      return res.status(503).json({ status: "unhealthy" });
    }
  });
  app.get("/health/redis", (_req, res) => res.json({ status: "not_configured" }));
  app.get("/health/email", (_req, res) => res.json({ status: emailService.getCurrentConfiguration().status }));
  app.get("/health/storage", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/superadmin", superadminRouter);
  app.use("/api/super-admin", superAdminRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/hr", hrRouter);
  app.use("/api/hod", hodRouter);
  app.use("/api/employee", employeeRouter);
  app.use("/api/employer", employeeRouter);
  app.use("/api/intern", internRouter);
  app.use("/api/nysc", internRouter);
  app.use("/api/nysc-intern", internRouter);
  app.use("/api/manager", managerRouter);
  app.use("/api/secretary", secretaryRouter);
  app.use("/api/accountant", accountantRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/health", systemHealthRouter);
  app.use("/api/admin/system-health", systemHealthRouter);
  app.use("/api/admin/backups", backupsRouter);
  app.use("/api/admin/technical-audit-logs", technicalAuditRouter);
  app.use("/api/admin/security", securityRouter);
  app.use("/api/admin/email-config", emailConfigRouter);
  app.use("/api/admin/notification-config", notificationConfigRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/payments/paystack", paystackPaymentsRouter);
  app.use("/api/webhooks", paystackWebhookRouter);
  app.use("/api/v1", createApiV1Router());

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: "Operation failed",
      error: { code: "ROUTE_NOT_FOUND", details: { path: req.originalUrl } },
    });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    if (!err.statusCode || err.statusCode >= 500) {
      console.error(err);
    }
    if (
      req.originalUrl &&
      (req.originalUrl.startsWith("/api/v1") ||
        req.originalUrl.startsWith("/api/profile") ||
        req.originalUrl.startsWith("/api/hr") ||
        req.originalUrl.startsWith("/api/hod") ||
        req.originalUrl.startsWith("/api/employee") ||
        req.originalUrl.startsWith("/api/employer") ||
        req.originalUrl.startsWith("/api/intern") ||
        req.originalUrl.startsWith("/api/nysc") ||
        req.originalUrl.startsWith("/api/manager") ||
        req.originalUrl.startsWith("/api/secretary") ||
        req.originalUrl.startsWith("/api/accountant") ||
        req.originalUrl.startsWith("/api/attendance") ||
        req.originalUrl.startsWith("/api/admin") ||
        req.originalUrl.startsWith("/api/integrations") ||
        req.originalUrl.startsWith("/api/payments") ||
        req.originalUrl.startsWith("/api/webhooks"))
    ) {
      const elapsedNs = req.startedAt ? process.hrtime.bigint() - req.startedAt : 0n;
      recordTechnicalAudit({
        req,
        statusCode: err.statusCode || 500,
        service: "api",
        error: err,
        responseTimeMs: Number(elapsedNs / 1000000n),
      });

      return res.status(err.statusCode || 500).json({
        success: false,
        message: "Operation failed",
        error: {
          code: err.code || "INTERNAL_SERVER_ERROR",
          details: {
            message: err.publicMessage || "Internal server error",
            ...(err.details || {}),
          },
        },
      });
    }

    return res.status(err.statusCode || 500).json({
      error: err.publicMessage || "Internal server error",
    });
  });

  return app;
}

module.exports = { createApp };
