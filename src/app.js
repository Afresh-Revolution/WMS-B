const express = require("express");
const { superadminRouter } = require("./routes/superadminAuth");
const { createApiV1Router } = require("./modules/apiV1");
const { recordTechnicalAudit } = require("./modules/_shared/auditService");

function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    req.startedAt = process.hrtime.bigint();
    return next();
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/superadmin", superadminRouter);
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
    if (req.originalUrl && req.originalUrl.startsWith("/api/v1")) {
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
