const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { checkDatabaseConnection } = require("../../db");
const emailService = require("../email/email.service");
const { recordPostgresAudit } = require("../_shared/postgresAudit");
const repository = require("./repository");

const SERVICE_NAMES = Object.freeze({
  API: "api_server",
  DATABASE: "database",
  EMAIL: "email_service",
  STORAGE: "file_storage",
  NOTIFICATION_WORKER: "notification_worker",
  BACKGROUND_WORKER: "background_worker",
});

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function unavailablePayload() {
  return {
    uptime: { range: "24h", percent: 0, successfulChecks: 0, totalChecks: 0 },
    healthyServices: { healthy: 0, total: 0, label: "0/0" },
    activeSessions: 0,
    averageApiLatencyMs: 0,
    services: [],
    infrastructure: null,
    infrastructureHistory: [],
    serviceResponseTimes: [],
    unavailable: true,
    reason: "DATABASE_URL is not configured or the health schema is unavailable.",
  };
}

async function getDashboard(range) {
  try {
    return await repository.getDashboard(range);
  } catch (error) {
    if (error.code === "DATABASE_NOT_CONFIGURED") {
      return unavailablePayload();
    }
    throw error;
  }
}

async function listServices() {
  try {
    return await repository.listServices();
  } catch (error) {
    if (error.code === "DATABASE_NOT_CONFIGURED") return [];
    throw error;
  }
}

async function listInfrastructure(range) {
  try {
    return await repository.listInfrastructure(range);
  } catch (error) {
    if (error.code === "DATABASE_NOT_CONFIGURED") return [];
    throw error;
  }
}

async function listApiMetrics(range) {
  try {
    return await repository.listApiMetrics(range);
  } catch (error) {
    if (error.code === "DATABASE_NOT_CONFIGURED") return [];
    throw error;
  }
}

async function recordApiMetric(metric) {
  try {
    await repository.recordApiMetric(metric);
  } catch (_error) {
    // Metrics must never break the request that generated them.
  }
}

async function runHealthChecks() {
  await repository.ensureSchema();
  await repository.recordHeartbeat("health_monitor", { pid: process.pid });
  const checks = await Promise.all([
    checkApiServer(),
    checkDatabase(),
    checkEmailService(),
    checkFileStorage(),
    checkWorkerHeartbeat(SERVICE_NAMES.NOTIFICATION_WORKER, "worker"),
    checkWorkerHeartbeat(SERVICE_NAMES.BACKGROUND_WORKER, "worker"),
  ]);

  const saved = [];
  for (const check of checks) {
    const previousStatus = await repository.getPreviousServiceStatus(check.serviceName);
    const record = await repository.recordHealthCheck(check);
    saved.push(record);
    if (previousStatus && previousStatus !== check.status) {
      await recordPostgresAudit({
        action: "HEALTH_STATUS_CHANGED",
        module: "System Health",
        targetType: "Service",
        targetName: check.serviceName,
        outcome: check.status === "operational" ? "SUCCESS" : "FAILED",
        severity: check.status === "operational" ? "INFO" : "WARNING",
        description: `${check.serviceName} changed from ${previousStatus} to ${check.status}.`,
        metadata: { previousStatus, currentStatus: check.status, responseTimeMs: check.responseTimeMs },
      });
    }
    if (check.status === "down") {
      await recordPostgresAudit({
        action: "SERVICE_FAILURE_DETECTED",
        module: "System Health",
        targetType: "Service",
        targetName: check.serviceName,
        outcome: "FAILED",
        severity: "ERROR",
        description: `${check.serviceName} is down.`,
        metadata: { errorMessage: check.errorMessage },
      });
    }
  }
  return saved;
}

async function recordInfrastructureSnapshot() {
  await repository.ensureSchema();
  const metric = await collectInfrastructureMetrics();
  await repository.recordInfrastructureMetric(metric);
  return metric;
}

async function checkApiServer() {
  const started = performance.now();
  const responseTimeMs = Math.round(performance.now() - started);
  return {
    serviceName: SERVICE_NAMES.API,
    serviceType: "api",
    status: responseTimeMs > Number(process.env.HEALTH_API_DEGRADED_MS || 1000) ? "degraded" : "operational",
    responseTimeMs,
  };
}

async function checkDatabase() {
  const started = performance.now();
  try {
    await checkDatabaseConnection();
    const responseTimeMs = Math.round(performance.now() - started);
    return {
      serviceName: SERVICE_NAMES.DATABASE,
      serviceType: "database",
      status: responseTimeMs > Number(process.env.HEALTH_DATABASE_DEGRADED_MS || 500) ? "degraded" : "operational",
      responseTimeMs,
    };
  } catch (error) {
    return {
      serviceName: SERVICE_NAMES.DATABASE,
      serviceType: "database",
      status: "down",
      responseTimeMs: Math.round(performance.now() - started),
      errorMessage: error.publicMessage || error.message,
    };
  }
}

async function checkEmailService() {
  const started = performance.now();
  try {
    const config = emailService.getCurrentConfiguration();
    const status = String(config.status || "").toLowerCase();
    return {
      serviceName: SERVICE_NAMES.EMAIL,
      serviceType: "email",
      status: status === "operational" ? "operational" : status === "disabled" ? "unknown" : "degraded",
      responseTimeMs: Math.round(performance.now() - started),
      errorMessage: status === "disabled" ? "Email delivery is disabled." : null,
    };
  } catch (error) {
    return {
      serviceName: SERVICE_NAMES.EMAIL,
      serviceType: "email",
      status: "down",
      responseTimeMs: Math.round(performance.now() - started),
      errorMessage: error.publicMessage || error.message,
    };
  }
}

async function checkFileStorage() {
  const started = performance.now();
  const storagePath = path.resolve(process.env.FILE_STORAGE_PATH || process.env.DATA_DIR || path.join(process.cwd(), "data"));
  try {
    await fs.mkdir(storagePath, { recursive: true });
    await fs.access(storagePath);
    return {
      serviceName: SERVICE_NAMES.STORAGE,
      serviceType: "storage",
      status: "operational",
      responseTimeMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      serviceName: SERVICE_NAMES.STORAGE,
      serviceType: "storage",
      status: "down",
      responseTimeMs: Math.round(performance.now() - started),
      errorMessage: error.publicMessage || error.message,
    };
  }
}

async function checkWorkerHeartbeat(workerName, serviceType) {
  const started = performance.now();
  const heartbeat = await repository.getWorkerHeartbeat(workerName);
  const ageMs = heartbeat ? Date.now() - new Date(heartbeat.last_heartbeat_at).getTime() : Infinity;
  let status = "down";
  if (ageMs < 60 * 1000) status = "operational";
  else if (ageMs <= 180 * 1000) status = "degraded";
  return {
    serviceName: workerName,
    serviceType,
    status,
    responseTimeMs: Math.round(performance.now() - started),
    errorMessage: heartbeat ? null : "Worker heartbeat has not been recorded.",
  };
}

async function collectInfrastructureMetrics() {
  const memoryPercent = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
  const cpuPercent = await measureCpuPercent();
  const diskPercent = await measureDiskPercent();
  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memoryPercent: Number(memoryPercent.toFixed(2)),
    diskPercent: Number(diskPercent.toFixed(2)),
  };
}

async function measureCpuPercent() {
  const first = cpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = cpuSnapshot();
  const idle = second.idle - first.idle;
  const total = second.total - first.total;
  return total > 0 ? Math.min(100, Math.max(0, 100 - (idle / total) * 100)) : 0;
}

function cpuSnapshot() {
  return os.cpus().reduce(
    (summary, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return { idle: summary.idle + cpu.times.idle, total: summary.total + total };
    },
    { idle: 0, total: 0 }
  );
}

async function measureDiskPercent() {
  const target = path.resolve(process.env.FILE_STORAGE_PATH || process.env.DATA_DIR || process.cwd());
  if (typeof fs.statfs !== "function") {
    return 0;
  }
  const stats = await fs.statfs(target);
  const total = Number(stats.blocks) * Number(stats.bsize);
  const available = Number(stats.bavail) * Number(stats.bsize);
  return total > 0 ? ((total - available) / total) * 100 : 0;
}

function metricStatus(kind, percent) {
  if (kind === "disk") {
    if (percent > 85) return "critical";
    if (percent >= 70) return "degraded";
    return "operational";
  }
  if (percent > 90) return "critical";
  if (percent >= 70) return "degraded";
  return "operational";
}

async function getInfrastructureStatus() {
  const metric = await collectInfrastructureMetrics();
  return {
    ...metric,
    cpuStatus: metricStatus("cpu", metric.cpuPercent),
    memoryStatus: metricStatus("memory", metric.memoryPercent),
    diskStatus: metricStatus("disk", metric.diskPercent),
  };
}

module.exports = {
  SERVICE_NAMES,
  createHttpError,
  getDashboard,
  getInfrastructureStatus,
  listApiMetrics,
  listInfrastructure,
  listServices,
  recordApiMetric,
  recordInfrastructureSnapshot,
  runHealthChecks,
};
