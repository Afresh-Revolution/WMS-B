const crypto = require("crypto");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { isDatabaseConfigured, query } = require("../_shared/postgres");

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

      alter table users add column if not exists avatar_url text;
      alter table users add column if not exists job_title text;
      alter table users add column if not exists account_status text not null default 'active';
      alter table users add column if not exists last_login timestamptz;
      alter table users add column if not exists preferences jsonb not null default '{}'::jsonb;

      create table if not exists user_security (
        user_id uuid primary key references users(id) on delete cascade,
        mfa_enabled boolean not null default false,
        backup_codes jsonb not null default '[]'::jsonb,
        pending_otp_hash text,
        pending_otp_expires_at timestamptz,
        updated_at timestamptz not null default now()
      );

      create table if not exists user_sessions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references users(id),
        session_token_hash text not null unique,
        ip_address inet,
        device text,
        browser text,
        user_agent text,
        last_activity timestamptz not null default now(),
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );

      alter table user_sessions add column if not exists device text;
      alter table user_sessions add column if not exists browser text;
      alter table user_sessions add column if not exists user_agent text;

      alter table login_history add column if not exists location text;
      alter table login_history add column if not exists login_time timestamptz;

      create index if not exists idx_profile_user_sessions on user_sessions(user_id, expires_at, last_activity);
      create index if not exists idx_profile_login_history on login_history(user_id, created_at desc);
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

async function upsertUserProfile(user) {
  if (!isDatabaseConfigured() || !user?.id) return null;
  try {
    await ensureSchema();
    await query(
      `update users
       set full_name = coalesce($2, full_name),
           phone = $3,
           avatar_url = coalesce($4, avatar_url),
           account_status = coalesce($5, account_status),
           last_login = coalesce($6, last_login),
           preferences = coalesce($7::jsonb, preferences),
           updated_at = now()
       where id = $1`,
      [
        user.id,
        user.fullName || user.name || null,
        user.phone || null,
        user.avatarUrl || user.avatar_url || null,
        user.status || "active",
        user.lastLoginAt || user.last_login || null,
        JSON.stringify(user.preferences || {}),
      ]
    );
  } catch (_error) {
    return null;
  }
  return null;
}

async function getSecurity(userId) {
  if (isDatabaseConfigured()) {
    try {
      await ensureSchema();
      const result = await query(`select * from user_security where user_id = $1`, [userId]);
      if (result.rows[0]) return mapSecurity(result.rows[0]);
      const inserted = await query(
        `insert into user_security (user_id, mfa_enabled, backup_codes)
         values ($1, false, '[]'::jsonb)
         returning *`,
        [userId]
      );
      return mapSecurity(inserted.rows[0]);
    } catch (_error) {
      // Fallback below.
    }
  }
  const existing = readCollection("user_security").find((record) => record.userId === userId || record.user_id === userId);
  if (existing) return mapSecurity(existing);
  const record = appendRecord("user_security", {
    id: crypto.randomUUID(),
    userId,
    user_id: userId,
    mfaEnabled: false,
    mfa_enabled: false,
    backupCodes: [],
    backup_codes: [],
    updatedAt: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return mapSecurity(record);
}

async function updateSecurity(userId, payload) {
  if (isDatabaseConfigured()) {
    try {
      await ensureSchema();
      const current = await getSecurity(userId);
      const values = {
        mfaEnabled: payload.mfaEnabled ?? payload.mfa_enabled ?? current.mfaEnabled,
        backupCodes: payload.backupCodes ?? payload.backup_codes ?? current.backupCodes,
        pendingOtpHash: payload.pendingOtpHash ?? payload.pending_otp_hash ?? null,
        pendingOtpExpiresAt: payload.pendingOtpExpiresAt ?? payload.pending_otp_expires_at ?? null,
      };
      const result = await query(
        `insert into user_security
          (user_id, mfa_enabled, backup_codes, pending_otp_hash, pending_otp_expires_at, updated_at)
         values ($1, $2, $3::jsonb, $4, $5, now())
         on conflict (user_id)
         do update set mfa_enabled = excluded.mfa_enabled,
                       backup_codes = excluded.backup_codes,
                       pending_otp_hash = excluded.pending_otp_hash,
                       pending_otp_expires_at = excluded.pending_otp_expires_at,
                       updated_at = now()
         returning *`,
        [userId, values.mfaEnabled, JSON.stringify(values.backupCodes), values.pendingOtpHash, values.pendingOtpExpiresAt]
      );
      return mapSecurity(result.rows[0]);
    } catch (_error) {
      // Fallback below.
    }
  }
  const records = readCollection("user_security");
  const index = records.findIndex((record) => record.userId === userId || record.user_id === userId);
  const current = index === -1 ? { id: crypto.randomUUID(), userId, user_id: userId } : records[index];
  const updated = {
    ...current,
    mfaEnabled: payload.mfaEnabled ?? payload.mfa_enabled ?? current.mfaEnabled ?? false,
    mfa_enabled: payload.mfaEnabled ?? payload.mfa_enabled ?? current.mfa_enabled ?? false,
    backupCodes: payload.backupCodes ?? payload.backup_codes ?? current.backupCodes ?? current.backup_codes ?? [],
    backup_codes: payload.backupCodes ?? payload.backup_codes ?? current.backupCodes ?? current.backup_codes ?? [],
    pendingOtpHash: payload.pendingOtpHash ?? payload.pending_otp_hash ?? null,
    pending_otp_hash: payload.pendingOtpHash ?? payload.pending_otp_hash ?? null,
    pendingOtpExpiresAt: payload.pendingOtpExpiresAt ?? payload.pending_otp_expires_at ?? null,
    pending_otp_expires_at: payload.pendingOtpExpiresAt ?? payload.pending_otp_expires_at ?? null,
    updatedAt: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (index === -1) records.push(updated);
  else records[index] = updated;
  writeCollection("user_security", records);
  return mapSecurity(updated);
}

function mapSecurity(row) {
  if (!row) return null;
  return {
    userId: row.user_id || row.userId,
    mfaEnabled: Boolean(row.mfa_enabled ?? row.mfaEnabled),
    backupCodes: row.backup_codes || row.backupCodes || [],
    pendingOtpHash: row.pending_otp_hash || row.pendingOtpHash || null,
    pendingOtpExpiresAt: row.pending_otp_expires_at || row.pendingOtpExpiresAt || null,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

module.exports = { ensureSchema, getSecurity, updateSecurity, upsertUserProfile };
