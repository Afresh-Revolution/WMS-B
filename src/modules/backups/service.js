const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { recordPostgresAudit } = require("../_shared/postgresAudit");
const healthRepository = require("../systemHealth/repository");
const { checkDatabaseConnection } = require("../../db");
const repository = require("./repository");
const { createStorageProvider } = require("./storage");

const execFileAsync = promisify(execFile);
const backupQueue = [];
const restoreQueue = [];
const runningBackups = new Set();
const runningRestores = new Set();

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function getPagination(query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 25)));
  return { page, limit, offset: (page - 1) * limit };
}

async function listBackups(query = {}) {
  const { page, limit, offset } = getPagination(query);
  const result = await repository.listBackups({ limit, offset, status: query.status });
  return {
    data: result.data,
    meta: {
      page,
      limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / limit)),
    },
  };
}

async function getBackup(id) {
  return repository.getBackup(id);
}

async function getSettings() {
  return repository.getSettings();
}

async function updateSettings(payload, req) {
  const result = await repository.updateSettings(payload || {}, req.user.id);
  await recordPostgresAudit({
    req,
    action: "BACKUP_SETTINGS_CHANGED",
    module: "Backups",
    targetType: "BackupSettings",
    targetId: result.after.id,
    outcome: "SUCCESS",
    description: "Backup settings changed.",
    oldValue: result.before,
    newValue: result.after,
  });
  return result.after;
}

async function queueManualBackup(payload = {}, req) {
  if (await repository.hasActiveBackup()) {
    throw createHttpError(409, "Another backup is already running or queued.", "BACKUP_ALREADY_RUNNING");
  }
  const settings = await repository.getSettings();
  const backup = await repository.createBackupJob({
    backupType: "manual",
    storageProvider: payload.destination || settings.destination,
    createdBy: req.user.id,
  });
  await recordPostgresAudit({
    req,
    action: "MANUAL_BACKUP_STARTED",
    module: "Backups",
    targetType: "Backup",
    targetId: backup.id,
    outcome: "SUCCESS",
    description: "Manual backup queued.",
    newValue: backup,
  });
  enqueueBackup(backup.id);
  return { jobId: backup.id, backup };
}

async function queueAutomaticBackup() {
  const settings = await repository.getSettings();
  const due = await repository.getDueAutomaticBackup(settings);
  if (!due || (await repository.hasActiveBackup())) {
    return null;
  }
  const backup = await repository.createBackupJob({
    backupType: "automatic",
    storageProvider: settings.destination,
    createdBy: null,
  });
  await repository.markAutomaticQueued(settings);
  await recordPostgresAudit({
    action: "AUTOMATIC_BACKUP_QUEUED",
    module: "Backups",
    targetType: "Backup",
    targetId: backup.id,
    outcome: "SUCCESS",
    description: "Automatic backup queued.",
    newValue: backup,
  });
  enqueueBackup(backup.id);
  return backup;
}

async function queueRestore(id, payload = {}, req) {
  if (payload.confirmation !== "RESTORE BACKUP" && payload.confirm !== true) {
    throw createHttpError(400, "Restore confirmation is required.", "RESTORE_CONFIRMATION_REQUIRED");
  }
  const backup = await repository.getBackup(id);
  if (!backup) {
    return null;
  }
  if (backup.status !== "completed" || backup.verificationStatus !== "verified") {
    throw createHttpError(409, "Only completed and verified backups can be restored.", "BACKUP_NOT_RESTORABLE");
  }
  restoreQueue.push({ id, user: req.user, request: requestAuditContext(req) });
  setImmediate(processRestoreQueue);
  await recordPostgresAudit({
    req,
    action: "BACKUP_RESTORE_QUEUED",
    module: "Backups",
    targetType: "Backup",
    targetId: backup.id,
    outcome: "SUCCESS",
    description: "Backup restore queued.",
    newValue: { backupId: backup.id },
  });
  return { jobId: id, backup };
}

async function deleteBackup(id, req) {
  const backup = await repository.getBackup(id);
  if (!backup) {
    return null;
  }
  if (["running", "restoring"].includes(backup.status)) {
    throw createHttpError(409, "Running or restoring backups cannot be deleted.", "BACKUP_BUSY");
  }
  const storage = createStorageProvider(backup.storageProvider);
  if (backup.filePath) {
    await storage.delete(backup.filePath).catch(() => false);
  }
  const deleted = await repository.markDeleted(id, req.user.id);
  await recordPostgresAudit({
    req,
    action: "BACKUP_DELETED",
    module: "Backups",
    targetType: "Backup",
    targetId: id,
    outcome: "SUCCESS",
    description: "Backup deleted.",
    oldValue: backup,
    newValue: deleted,
  });
  return deleted;
}

async function getStatus(id) {
  const backup = await repository.getBackup(id);
  if (!backup) return null;
  return {
    id: backup.id,
    backupId: backup.backupId,
    status: backup.status,
    verificationStatus: backup.verificationStatus,
    startedAt: backup.startedAt,
    completedAt: backup.completedAt,
    errorMessage: backup.errorMessage,
  };
}

async function getBackupHealth() {
  return repository.getBackupHealth();
}

function enqueueBackup(id) {
  backupQueue.push(id);
  setImmediate(processBackupQueue);
}

async function processBackupQueue() {
  if (!backupQueue.length) {
    return;
  }
  const id = backupQueue.shift();
  if (runningBackups.has(id)) {
    return;
  }
  runningBackups.add(id);
  try {
    await runBackupJob(id);
  } finally {
    runningBackups.delete(id);
    if (backupQueue.length) setImmediate(processBackupQueue);
  }
}

async function runBackupJob(id) {
  let backup = await repository.acquireBackupJob(id);
  if (!backup) {
    return null;
  }
  const tempDir = await fs.mkdtemp(path.join(process.cwd(), "data", "backup-work-"));
  try {
    await healthRepository.recordHeartbeat("backup_worker", { jobId: id, status: "running" }).catch(() => null);
    const settings = await repository.getSettings();
    const archive = await createBackupArchive(tempDir);
    const encryptedArchive = settings.encryptionEnabled
      ? await encryptFile(archive, `${archive}.enc`)
      : archive;
    const checksum = await checksumFile(encryptedArchive);
    const storage = createStorageProvider(backup.storageProvider || settings.destination);
    const key = path.basename(encryptedArchive);
    const upload = await storage.upload(encryptedArchive, key);
    const exists = await storage.exists(upload.key || upload.location);
    const metadata = await storage.metadata(upload.key || upload.location);
    const uploadedChecksum = await checksumFile(upload.location);
    if (!exists || uploadedChecksum !== checksum) {
      throw createHttpError(500, "Backup verification failed.", "BACKUP_VERIFICATION_FAILED");
    }
    backup = await repository.updateBackup(id, {
      status: "completed",
      filePath: upload.key || upload.location,
      storageProvider: upload.provider,
      storageLocation: upload.location,
      sizeBytes: metadata.sizeBytes,
      checksum,
      verificationStatus: "verified",
      completedAt: new Date(),
      errorMessage: null,
      encrypted: settings.encryptionEnabled,
    });
    await repository.markSettingsBackupCompleted(backup);
    await recordPostgresAudit({
      action: backup.backupType === "automatic" ? "AUTOMATIC_BACKUP_COMPLETED" : "MANUAL_BACKUP_COMPLETED",
      module: "Backups",
      targetType: "Backup",
      targetId: id,
      outcome: "SUCCESS",
      description: "Backup completed and verified.",
      newValue: backup,
    });
    return backup;
  } catch (error) {
    backup = await repository.updateBackup(id, {
      status: "failed",
      verificationStatus: "failed",
      completedAt: new Date(),
      errorMessage: error.publicMessage || error.message,
    });
    await recordPostgresAudit({
      action: "BACKUP_FAILED",
      module: "Backups",
      targetType: "Backup",
      targetId: id,
      outcome: "FAILED",
      severity: "ERROR",
      description: "Backup failed.",
      newValue: backup,
      error,
    });
    return backup;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    await healthRepository.recordHeartbeat("backup_worker", { jobId: id, status: "idle" }).catch(() => null);
  }
}

async function processRestoreQueue() {
  if (!restoreQueue.length) {
    return;
  }
  const job = restoreQueue.shift();
  if (runningRestores.has(job.id)) {
    return;
  }
  runningRestores.add(job.id);
  try {
    await runRestoreJob(job);
  } finally {
    runningRestores.delete(job.id);
    if (restoreQueue.length) setImmediate(processRestoreQueue);
  }
}

async function runRestoreJob(job) {
  const backup = await repository.acquireRestoreJob(job.id);
  if (!backup) {
    return null;
  }
  const tempDir = await fs.mkdtemp(path.join(process.cwd(), "data", "restore-work-"));
  try {
    const storage = createStorageProvider(backup.storageProvider);
    const downloaded = path.join(tempDir, path.basename(backup.filePath || `${backup.id}.backup`));
    await storage.download(backup.filePath, downloaded);
    const checksum = await checksumFile(downloaded);
    if (checksum !== backup.checksum) {
      throw createHttpError(409, "Backup checksum mismatch.", "BACKUP_CHECKSUM_MISMATCH");
    }
    const archive = backup.encrypted ? await decryptFile(downloaded, path.join(tempDir, "backup.tar.gz")) : downloaded;
    const extractDir = path.join(tempDir, "extract");
    await fs.mkdir(extractDir, { recursive: true });
    await runCommand(process.env.BACKUP_TAR_COMMAND || "tar", ["-xzf", archive, "-C", extractDir]);
    const dumpPath = path.join(extractDir, "database.sql");
    await fs.access(dumpPath);
    await runCommand(process.env.BACKUP_PSQL_COMMAND || "psql", [process.env.DATABASE_URL, "-f", dumpPath], {
      maxBuffer: 50 * 1024 * 1024,
    });
    await checkDatabaseConnection();
    const restored = await repository.updateBackup(job.id, {
      status: "completed",
      verificationStatus: "verified",
      errorMessage: null,
    });
    await recordPostgresAudit({
      user: job.user,
      action: "BACKUP_RESTORED",
      module: "Backups",
      targetType: "Backup",
      targetId: job.id,
      outcome: "SUCCESS",
      description: "Backup restored.",
      newValue: restored,
      metadata: job.request,
    });
    return restored;
  } catch (error) {
    const failed = await repository.updateBackup(job.id, {
      status: "completed",
      errorMessage: `Restore failed: ${error.publicMessage || error.message}`,
    });
    await recordPostgresAudit({
      user: job.user,
      action: "BACKUP_RESTORE_FAILED",
      module: "Backups",
      targetType: "Backup",
      targetId: job.id,
      outcome: "FAILED",
      severity: "ERROR",
      description: "Backup restore failed.",
      newValue: failed,
      metadata: job.request,
      error,
    });
    return failed;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function createBackupArchive(tempDir) {
  await fs.mkdir(tempDir, { recursive: true });
  const dumpPath = path.join(tempDir, "database.sql");
  const appArchive = path.join(tempDir, "application-files.tar");
  const archivePath = path.join(tempDir, `wms-backup-${Date.now()}.tar.gz`);
  await runCommand(process.env.BACKUP_PG_DUMP_COMMAND || "pg_dump", [
    process.env.DATABASE_URL,
    "--no-owner",
    "--no-privileges",
    "-f",
    dumpPath,
  ], { maxBuffer: 50 * 1024 * 1024 });
  await runCommand(process.env.BACKUP_TAR_COMMAND || "tar", [
    "-cf",
    appArchive,
    "src",
    "prisma",
    "package.json",
    "package-lock.json",
    ".env.example",
  ]);
  await runCommand(process.env.BACKUP_TAR_COMMAND || "tar", ["-czf", archivePath, "-C", tempDir, "database.sql", "application-files.tar"]);
  return archivePath;
}

async function encryptFile(sourcePath, targetPath) {
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw createHttpError(500, "ENCRYPTION_KEY is required for encrypted backups.", "BACKUP_ENCRYPTION_KEY_REQUIRED");
  }
  const key = crypto.scryptSync(secret, "wms-backups", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const input = await fs.readFile(sourcePath);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();
  await fs.writeFile(targetPath, Buffer.concat([Buffer.from("WMSB1"), iv, tag, encrypted]));
  return targetPath;
}

async function decryptFile(sourcePath, targetPath) {
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw createHttpError(500, "ENCRYPTION_KEY is required to decrypt backups.", "BACKUP_ENCRYPTION_KEY_REQUIRED");
  }
  const payload = await fs.readFile(sourcePath);
  if (payload.slice(0, 5).toString("utf8") !== "WMSB1") {
    throw createHttpError(400, "Backup archive is not a supported encrypted backup.", "INVALID_BACKUP_FORMAT");
  }
  const key = crypto.scryptSync(secret, "wms-backups", 32);
  const iv = payload.slice(5, 17);
  const tag = payload.slice(17, 33);
  const encrypted = payload.slice(33);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  await fs.writeFile(targetPath, decrypted);
  return targetPath;
}

async function checksumFile(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function runCommand(command, args, options = {}) {
  try {
    await execFileAsync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
    });
  } catch (error) {
    const wrapped = createHttpError(500, `${command} failed during backup operation.`, "BACKUP_COMMAND_FAILED", {
      command,
      stderr: error.stderr ? String(error.stderr).slice(0, 500) : null,
    });
    throw wrapped;
  }
}

async function enforceRetention() {
  const settings = await repository.getSettings();
  const expired = await repository.listExpiredBackups(settings.retentionDays);
  const results = [];
  for (const backup of expired) {
    const storage = createStorageProvider(backup.storageProvider);
    if (backup.filePath) {
      await storage.delete(backup.filePath).catch(() => false);
    }
    const deleted = await repository.markDeleted(backup.id, null);
    await recordPostgresAudit({
      action: "BACKUP_DELETED",
      module: "Backups",
      targetType: "Backup",
      targetId: backup.id,
      outcome: "SUCCESS",
      description: "Backup deleted by retention policy.",
      oldValue: backup,
      newValue: deleted,
      metadata: { retentionDays: settings.retentionDays },
    });
    results.push(deleted);
  }
  return results;
}

function requestAuditContext(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    sessionId: req.authSessionId,
  };
}

module.exports = {
  deleteBackup,
  enforceRetention,
  getBackup,
  getBackupHealth,
  getSettings,
  getStatus,
  listBackups,
  processBackupQueue,
  processRestoreQueue,
  queueAutomaticBackup,
  queueManualBackup,
  queueRestore,
  updateSettings,
};
