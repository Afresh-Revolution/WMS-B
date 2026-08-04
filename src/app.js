const express = require("express");
const { superadminRouter } = require("./routes/superadminAuth");

function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/superadmin", superadminRouter);

  app.use((req, res) => {
    res.status(404).json({ error: "Route not found" });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    console.error(err);
    return res.status(err.statusCode || 500).json({
      error: err.publicMessage || "Internal server error",
    });
  });

  return app;
}

module.exports = { createApp };
