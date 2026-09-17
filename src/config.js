const crypto = require("crypto");

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireProductionSecret(name, minimumLength = 32) {
  const value = process.env[name];
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} must be set to at least ${minimumLength} characters in production.`);
  }
}

function getRuntimeConfig() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    env: process.env.NODE_ENV || "development",
    isProduction,
    port: parseInteger(process.env.PORT, 3000),
    bodyLimit: process.env.REQUEST_BODY_LIMIT || "1mb",
    requestIdHeader: "x-request-id",
    trustProxy: parseBoolean(process.env.TRUST_PROXY, isProduction),
    databaseUrl: process.env.DATABASE_URL || "",
    requireDatabaseOnReady: parseBoolean(process.env.REQUIRE_DATABASE_ON_READY, isProduction),
    cors: {
      origins: parseCsv(process.env.CORS_ORIGIN || process.env.FRONTEND_URL),
      allowCredentials: parseBoolean(process.env.CORS_CREDENTIALS, true),
    },
    rateLimit: {
      windowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      max: parseInteger(process.env.RATE_LIMIT_MAX, process.env.NODE_ENV === "test" ? 10000 : 600),
      authMax: parseInteger(process.env.AUTH_RATE_LIMIT_MAX, process.env.NODE_ENV === "test" ? 10000 : 30),
      checkInMax: parseInteger(process.env.CHECK_IN_RATE_LIMIT_MAX, process.env.NODE_ENV === "test" ? 10000 : 30),
      pushMax: parseInteger(process.env.PUSH_RATE_LIMIT_MAX, process.env.NODE_ENV === "test" ? 10000 : 40),
    },
    attendance: {
      defaultOpeningTime: process.env.ATTENDANCE_DEFAULT_OPENING_TIME || "08:50",
      defaultLateAfterTime: process.env.ATTENDANCE_DEFAULT_LATE_AFTER_TIME || "09:30",
      defaultClosingTime: process.env.ATTENDANCE_DEFAULT_CLOSING_TIME || "17:00",
      locationRetentionDays: parseInteger(process.env.ATTENDANCE_LOCATION_RETENTION_DAYS, 365),
    },
    webPush: {
      publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "",
      subject: process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:admin@example.com",
    },
    shutdownTimeoutMs: parseInteger(process.env.SHUTDOWN_TIMEOUT_MS, 10 * 1000),
  };
}

function assertRuntimeConfig() {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    requireProductionSecret("AUTH_TOKEN_SECRET");
    requireProductionSecret("SUPERADMIN_SETUP_TOKEN", 24);
    requireProductionSecret("ENCRYPTION_KEY", 32);
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required in production.");
    }
  }

  if (!process.env.AUTH_TOKEN_SECRET) {
    process.env.AUTH_TOKEN_SECRET = crypto.randomBytes(32).toString("hex");
    console.warn("AUTH_TOKEN_SECRET is not set. Using an insecure development default.");
  }
}

module.exports = { assertRuntimeConfig, getRuntimeConfig };
