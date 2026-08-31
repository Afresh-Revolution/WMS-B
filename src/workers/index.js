const backupService = require("../modules/backups/service");
const systemHealthService = require("../modules/systemHealth/service");
const healthRepository = require("../modules/systemHealth/repository");
const notificationService = require("../modules/notifications/notification.service");

let started = false;
const timers = [];

function startBackgroundWorkers() {
  if (started || process.env.DISABLE_BACKGROUND_WORKERS === "true") {
    return { started };
  }
  started = true;

  schedule("health-monitor", 30 * 1000, async () => {
    await systemHealthService.runHealthChecks();
  });

  schedule("infrastructure-monitor", 60 * 1000, async () => {
    await systemHealthService.recordInfrastructureSnapshot();
  });

  schedule("backup-scheduler", 60 * 1000, async () => {
    await healthRepository.recordHeartbeat("background_worker", { worker: "backup_scheduler" }).catch(() => null);
    await backupService.queueAutomaticBackup();
  });

  schedule("backup-retention", 60 * 60 * 1000, async () => {
    await backupService.enforceRetention();
  });

  schedule("notification-worker", 60 * 1000, async () => {
    await notificationService.processQueue(25);
    await healthRepository.recordHeartbeat("notification_worker", { worker: "notification_queue" }).catch(() => null);
  });

  return { started, timers: timers.length };
}

function stopBackgroundWorkers() {
  for (const timer of timers.splice(0)) {
    clearInterval(timer);
  }
  started = false;
}

function schedule(_name, intervalMs, task) {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error(error);
    }
  };
  const immediate = setTimeout(run, 100);
  const timer = setInterval(run, intervalMs);
  if (typeof immediate.unref === "function") immediate.unref();
  if (typeof timer.unref === "function") timer.unref();
  timers.push(timer);
}

module.exports = { startBackgroundWorkers, stopBackgroundWorkers };
