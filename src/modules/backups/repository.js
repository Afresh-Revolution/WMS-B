const { isDatabaseConfigured, query, withClient } = require("../_shared/postgres");

let schemaReady = false;
let schemaPromise = null;

async function ensureSchema() {
  if (!isDatabaseConfigured()) {
    return false;
  }
  if (schemaReady) {
    return true;
  }
  if (!schemaPromise) {
    schemaPromise = query(`
      create extension if not exists "pgcrypto";

      create table if not exists backup_settings (
        id uuid primary key default gen_random_uuid(),
        enabled boolean not null default true,
        schedule text not null default '02:00',
        frequency text not null default 'daily',
        retention_days integer not null default 30,
        destination text not null default 'local',
        encryption_enabled boolean not null default true,
        last_backup_at timestamptz,
        next_backup_at timestamptz,
        updated_by uuid references users(id),
        updated_at timestamptz not null default now()
      );

      create table if not exists backups (
        id uuid primary key default gen_random_uuid(),
        backup_id text unique,
        type text,
        backup_type text,
        status text not null default 'pending',
        file_path text,
        storage_provider text,
        storage_location text,
        storage text,
        size_bytes bigint,
        checksum text,
        verification_status text not null default 'pending',
        started_at timestamptz,
        completed_at timestamptz,
        error_message text,
        created_by uuid references users(id),
        encrypted boolean not null default true,
        restore_requires_confirmation boolean not null default true,
        deleted_at timestamptz,
        deleted_by uuid references users(id),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      alter table backups add column if not exists backup_id text;
      alter table backups add column if not exists type text;
      alter table backups add column if not exists backup_type text;
      alter table backups add column if not exists file_path text;
      alter table backups add column if not exists storage_provider text;
      alter table backups add column if not exists storage_location text;
      alter table backups add column if not exists storage text;
      alter table backups add column if not exists size_bytes bigint;
      alter table backups add column if not exists checksum text;
      alter table backups add column if not exists verification_status text not null default 'pending';
      alter table backups add column if not exists started_at timestamptz;
      alter table backups add column if not exists completed_at timestamptz;
      alter table backups add column if not exists error_message text;
      alter table backups add column if not exists created_by uuid references users(id);
      alter table backups add column if not exists encrypted boolean not null default true;
      alter table backups add column if not exists restore_requires_confirmation boolean not null default true;
      alter table backups add column if not exists deleted_at timestamptz;
      alter table backups add column if not exists deleted_by uuid references users(id);

      create index if not exists idx_backups_status_created_at on backups(status, created_at desc);
      create index if not exists idx_backups_completed_at on backups(completed_at desc);
    `)
      .then(() => {
        schemaReady = true;
        return true;
      })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

function mapBackup(row) {
  if (!row) return null;
  return {
    id: row.id,
    backupId: row.backup_id,
    backupType: row.backup_type || row.type,
    type: row.backup_type || row.type,
    status: row.status,
    filePath: row.file_path,
    storageProvider: row.storage_provider || row.storage,
    storageLocation: row.storage_location,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
    checksum: row.checksum,
    verificationStatus: row.verification_status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    encrypted: row.encrypted,
    restoreRequiresConfirmation: row.restore_requires_confirmation,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSettings(row) {
  if (!row) return null;
  return {
    id: row.id,
    enabled: row.enabled,
    schedule: row.schedule,
    frequency: row.frequency,
    retentionDays: row.retention_days,
    destination: row.destination,
    encryptionEnabled: row.encryption_enabled,
    lastBackupAt: row.last_backup_at,
    nextBackupAt: row.next_backup_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

async function getSettings() {
  await ensureSchema();
  const result = await query(`select * from backup_settings order by updated_at desc limit 1`);
  if (result.rows[0]) {
    return mapSettings(result.rows[0]);
  }
  const inserted = await query(
    `insert into backup_settings (enabled, schedule, frequency, retention_days, destination, encryption_enabled, next_backup_at)
     values (true, '02:00', 'daily', 30, 'local', true, $1)
     returning *`,
    [calculateNextBackupAt("02:00", "daily")]
  );
  return mapSettings(inserted.rows[0]);
}

async function updateSettings(payload, userId) {
  await ensureSchema();
  const current = await getSettings();
  const values = {
    enabled: payload.enabled ?? current.enabled,
    schedule: payload.schedule || current.schedule,
    frequency: payload.frequency || current.frequency,
    retentionDays: Number(payload.retentionDays ?? payload.retention_days ?? current.retentionDays),
    destination: payload.destination || current.destination,
    encryptionEnabled: payload.encryptionEnabled ?? payload.encryption_enabled ?? current.encryptionEnabled,
  };
  const result = await query(
    `update backup_settings
     set enabled = $1,
         schedule = $2,
         frequency = $3,
         retention_days = $4,
         destination = $5,
         encryption_enabled = $6,
         next_backup_at = $7,
         updated_by = $8,
         updated_at = now()
     where id = $9
     returning *`,
    [
      values.enabled,
      values.schedule,
      values.frequency,
      values.retentionDays,
      values.destination,
      values.encryptionEnabled,
      calculateNextBackupAt(values.schedule, values.frequency),
      userId || null,
      current.id,
    ]
  );
  return { before: current, after: mapSettings(result.rows[0]) };
}

async function hasActiveBackup() {
  await ensureSchema();
  const result = await query(
    `select id from backups
     where deleted_at is null and status in ('pending', 'running', 'restoring')
     limit 1`
  );
  return Boolean(result.rows[0]);
}

async function createBackupJob({ backupType, storageProvider, createdBy }) {
  await ensureSchema();
  const backupId = `backup-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await query(
    `insert into backups
      (backup_id, type, backup_type, status, storage_provider, storage, verification_status,
       created_by, encrypted, restore_requires_confirmation, created_at, updated_at)
     values ($1, $2, $2, 'pending', $3, $3, 'pending', $4, true, true, now(), now())
     returning *`,
    [backupId, backupType, storageProvider || "local", createdBy || null]
  );
  return mapBackup(result.rows[0]);
}

async function listBackups({ limit = 50, offset = 0, status } = {}) {
  await ensureSchema();
  const params = [];
  let where = "where deleted_at is null";
  if (status) {
    params.push(status);
    where += ` and status = $${params.length}`;
  }
  params.push(Number(limit), Number(offset));
  const result = await query(
    `select * from backups
     ${where}
     order by created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );
  const count = await query(`select count(*)::int as total from backups ${where}`, params.slice(0, -2));
  return { data: result.rows.map(mapBackup), total: count.rows[0]?.total || 0 };
}

async function getBackup(id) {
  await ensureSchema();
  const result = await query(`select * from backups where id = $1 and deleted_at is null`, [id]);
  return mapBackup(result.rows[0]);
}

async function updateBackup(id, payload) {
  await ensureSchema();
  const allowed = {
    status: "status",
    filePath: "file_path",
    storageProvider: "storage_provider",
    storageLocation: "storage_location",
    sizeBytes: "size_bytes",
    checksum: "checksum",
    verificationStatus: "verification_status",
    startedAt: "started_at",
    completedAt: "completed_at",
    errorMessage: "error_message",
    encrypted: "encrypted",
  };
  const entries = Object.entries(payload).filter(([key]) => allowed[key]);
  if (!entries.length) {
    return getBackup(id);
  }
  const params = [];
  const sets = entries.map(([key, value]) => {
    params.push(value);
    return `${allowed[key]} = $${params.length}`;
  });
  params.push(id);
  const result = await query(
    `update backups set ${sets.join(", ")}, updated_at = now()
     where id = $${params.length}
     returning *`,
    params
  );
  return mapBackup(result.rows[0]);
}

async function markDeleted(id, userId) {
  await ensureSchema();
  const result = await query(
    `update backups
     set status = 'deleted', deleted_at = now(), deleted_by = $2, updated_at = now()
     where id = $1 and deleted_at is null
     returning *`,
    [id, userId || null]
  );
  return mapBackup(result.rows[0]);
}

async function acquireBackupJob(id) {
  await ensureSchema();
  const result = await query(
    `update backups
     set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
     where id = $1 and status = 'pending' and deleted_at is null
     returning *`,
    [id]
  );
  return mapBackup(result.rows[0]);
}

async function acquireRestoreJob(id) {
  await ensureSchema();
  const result = await query(
    `update backups
     set status = 'restoring', updated_at = now()
     where id = $1 and status = 'completed' and deleted_at is null
     returning *`,
    [id]
  );
  return mapBackup(result.rows[0]);
}

async function getDueAutomaticBackup(settings) {
  await ensureSchema();
  if (!settings.enabled || !settings.nextBackupAt || new Date(settings.nextBackupAt) > new Date()) {
    return null;
  }
  const result = await query(
    `select id from backups
     where backup_type = 'automatic'
       and created_at::date = current_date
       and status <> 'deleted'
     limit 1`
  );
  return result.rows[0] ? null : settings;
}

async function markAutomaticQueued(settings) {
  await ensureSchema();
  await query(
    `update backup_settings
     set next_backup_at = $1, updated_at = now()
     where id = $2`,
    [calculateNextBackupAt(settings.schedule, settings.frequency), settings.id]
  );
}

async function markSettingsBackupCompleted(backup) {
  await ensureSchema();
  const settings = await getSettings();
  await query(
    `update backup_settings
     set last_backup_at = $1,
         next_backup_at = $2,
         updated_at = now()
     where id = $3`,
    [backup.completedAt || new Date(), calculateNextBackupAt(settings.schedule, settings.frequency), settings.id]
  );
}

async function listExpiredBackups(retentionDays) {
  await ensureSchema();
  const result = await query(
    `select * from backups
     where deleted_at is null
       and status = 'completed'
       and completed_at < now() - $1::interval
     order by completed_at asc`,
    [`${Number(retentionDays || 30)} days`]
  );
  return result.rows.map(mapBackup);
}

async function getBackupHealth() {
  await ensureSchema();
  const settings = await getSettings();
  const result = await query(
    `select
       max(completed_at) filter (where status = 'completed' and verification_status = 'verified') as last_successful_backup_at,
       count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')::int as failures_24h
     from backups
     where deleted_at is null`
  );
  const row = result.rows[0] || {};
  const expectedHours = settings.frequency === "hourly" ? 2 : settings.frequency === "weekly" ? 8 * 24 : 36;
  const stale = !row.last_successful_backup_at ||
    Date.now() - new Date(row.last_successful_backup_at).getTime() > expectedHours * 60 * 60 * 1000;
  return {
    status: row.failures_24h >= 2 || stale ? "degraded" : "healthy",
    lastSuccessfulBackupAt: row.last_successful_backup_at || null,
    failures24h: row.failures_24h || 0,
    expectedFrequency: settings.frequency,
  };
}

function calculateNextBackupAt(schedule = "02:00", frequency = "daily") {
  const now = new Date();
  if (frequency === "hourly") {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  const [hours, minutes] = String(schedule || "02:00").split(":").map(Number);
  const next = new Date(now);
  next.setUTCHours(Number.isFinite(hours) ? hours : 2, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + (frequency === "weekly" ? 7 : 1));
  }
  return next;
}

module.exports = {
  acquireBackupJob,
  acquireRestoreJob,
  createBackupJob,
  ensureSchema,
  getBackup,
  getBackupHealth,
  getDueAutomaticBackup,
  getSettings,
  hasActiveBackup,
  listBackups,
  listExpiredBackups,
  markAutomaticQueued,
  markDeleted,
  markSettingsBackupCompleted,
  updateBackup,
  updateSettings,
};
