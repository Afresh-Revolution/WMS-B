const { isDatabaseConfigured, query } = require("../modules/_shared/postgres");

let schemaReady = false;
let schemaPromise = null;

function isEnabled() {
  return isDatabaseConfigured();
}

async function ensureSchema() {
  if (!isEnabled()) {
    return false;
  }
  if (schemaReady) {
    return true;
  }
  if (!schemaPromise) {
    schemaPromise = query(`
      create extension if not exists "pgcrypto";

      create table if not exists users (
        id uuid primary key default gen_random_uuid(),
        employee_id uuid,
        full_name text,
        email text not null unique,
        username text unique,
        phone text,
        password_hash text not null,
        role text not null default 'employee',
        role_id uuid,
        department_id uuid,
        account_type text not null default 'STAFF',
        status text not null default 'active',
        permissions jsonb not null default '[]'::jsonb,
        email_verified boolean not null default false,
        phone_verified boolean not null default false,
        must_change_password boolean not null default false,
        failed_login_count integer not null default 0,
        failed_login_attempts integer not null default 0,
        force_password_reset boolean not null default false,
        locked_until timestamptz,
        last_login_at timestamptz,
        last_login_ip inet,
        last_activity_at timestamptz,
        password_changed_at timestamptz,
        password_expires_at timestamptz,
        locked_at timestamptz,
        created_by uuid,
        updated_by uuid,
        deactivated_at timestamptz,
        deactivated_by uuid,
        activation_token_hash text,
        activation_token_expires_at timestamptz,
        deleted_at timestamptz,
        deleted_by uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
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

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function nullableUuid(value) {
  return isUuid(value) ? value : null;
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  const fullName = row.full_name || row.name || null;
  return {
    id: row.id,
    name: fullName,
    fullName,
    email: row.email,
    phone: row.phone || null,
    passwordHash: row.password_hash,
    role: row.role,
    roleId: row.role_id || row.role,
    departmentId: row.department_id || null,
    employeeId: row.employee_id || null,
    accountType: row.account_type || (row.role === "superadmin" ? "SUPER_ADMIN" : "STAFF"),
    status: row.status || "active",
    permissions: parseJsonArray(row.permissions),
    emailVerified: Boolean(row.email_verified),
    phoneVerified: Boolean(row.phone_verified),
    mustChangePassword: Boolean(row.must_change_password || row.force_password_reset),
    forcePasswordReset: Boolean(row.force_password_reset || row.must_change_password),
    failedLoginCount: Number(row.failed_login_count || row.failed_login_attempts || 0),
    failedLoginAttempts: Number(row.failed_login_attempts || row.failed_login_count || 0),
    lockedUntil: row.locked_until ? row.locked_until.toISOString?.() || row.locked_until : null,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString?.() || row.last_login_at : null,
    lastLoginIp: row.last_login_ip || null,
    lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString?.() || row.last_activity_at : null,
    passwordChangedAt: row.password_changed_at ? row.password_changed_at.toISOString?.() || row.password_changed_at : null,
    passwordExpiresAt: row.password_expires_at ? row.password_expires_at.toISOString?.() || row.password_expires_at : null,
    lockedAt: row.locked_at ? row.locked_at.toISOString?.() || row.locked_at : null,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    deactivatedAt: row.deactivated_at ? row.deactivated_at.toISOString?.() || row.deactivated_at : null,
    deactivatedBy: row.deactivated_by || null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString?.() || row.deleted_at : null,
    deletedBy: row.deleted_by || null,
    createdAt: row.created_at ? row.created_at.toISOString?.() || row.created_at : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString?.() || row.updated_at : null,
  };
}

async function getUserByEmail(email) {
  await ensureSchema();
  const result = await query(`select * from users where lower(email) = $1 and deleted_at is null limit 1`, [
    normalizeEmail(email),
  ]);
  return mapUser(result.rows[0]);
}

async function getUserById(id) {
  await ensureSchema();
  const result = await query(`select * from users where id = $1 and deleted_at is null limit 1`, [id]);
  return mapUser(result.rows[0]);
}

async function hasSuperadmin() {
  await ensureSchema();
  const result = await query(
    `select exists(select 1 from users where role = 'superadmin' and deleted_at is null) as exists`
  );
  return Boolean(result.rows[0]?.exists);
}

async function createSuperadmin({ name, email, passwordHash }) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const existing = await query(
    `select email, role from users where (lower(email) = $1 or role = 'superadmin') and deleted_at is null limit 1`,
    [normalizedEmail]
  );

  if (existing.rows[0]?.email === normalizedEmail) {
    const error = new Error("A user with this email already exists.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }
  if (existing.rows[0]?.role === "superadmin") {
    const error = new Error("Superadmin has already been bootstrapped.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }

  const result = await query(
    `insert into users
      (full_name, email, password_hash, role, role_id, account_type, status, permissions,
       email_verified, phone_verified, must_change_password, force_password_reset,
       failed_login_count, failed_login_attempts, password_changed_at)
     values ($1, $2, $3, 'superadmin', null, 'SUPER_ADMIN', 'active', '[]'::jsonb,
       true, false, false, false, 0, 0, now())
     returning *`,
    [String(name || "Main Admin").trim(), normalizedEmail, passwordHash]
  );
  return mapUser(result.rows[0]);
}

async function createUser({
  name,
  fullName,
  email,
  phone,
  passwordHash,
  role = "employee",
  roleId,
  permissions = [],
  status = "active",
  accountType,
  departmentId,
  employeeId,
  createdBy,
  mustChangePassword = false,
  activationTokenHash,
  activationTokenExpiresAt,
}) {
  await ensureSchema();
  const normalizedEmail = normalizeEmail(email);
  const existing = await query(
    `select id from users where lower(email) = $1 and deleted_at is null limit 1`,
    [normalizedEmail]
  );

  if (existing.rows[0]) {
    const error = new Error("A user with this email already exists.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }

  const result = await query(
    `insert into users
      (full_name, email, phone, password_hash, role, role_id, department_id, employee_id,
       account_type, status, permissions, email_verified, phone_verified,
       must_change_password, force_password_reset, failed_login_count,
       failed_login_attempts, password_changed_at, created_by,
       activation_token_hash, activation_token_expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11::jsonb, false, false,
       $12, $12, 0, 0, now(), $13, $14, $15)
     returning *`,
    [
      String(fullName || name || "").trim(),
      normalizedEmail,
      phone || null,
      passwordHash,
      role,
      nullableUuid(roleId),
      nullableUuid(departmentId),
      nullableUuid(employeeId),
      accountType || (role === "superadmin" ? "SUPER_ADMIN" : role === "admin" ? "ADMIN" : "STAFF"),
      status,
      JSON.stringify(Array.isArray(permissions) ? permissions : []),
      Boolean(mustChangePassword),
      nullableUuid(createdBy),
      activationTokenHash || null,
      activationTokenExpiresAt || null,
    ]
  );
  return mapUser(result.rows[0]);
}

async function updateUser(id, payload = {}) {
  await ensureSchema();
  const fields = [];
  const values = [];

  function set(column, value) {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  }

  if (payload.failedLoginAttempts !== undefined || payload.failedLoginCount !== undefined) {
    const value = Number(payload.failedLoginAttempts ?? payload.failedLoginCount ?? 0);
    set("failed_login_attempts", value);
    set("failed_login_count", value);
  }
  if (payload.status !== undefined) set("status", payload.status);
  if (payload.lockedAt !== undefined) set("locked_at", payload.lockedAt);
  if (payload.lockedUntil !== undefined) set("locked_until", payload.lockedUntil);
  if (payload.lastLoginAt !== undefined) set("last_login_at", payload.lastLoginAt);
  if (payload.lastLoginIp !== undefined) set("last_login_ip", payload.lastLoginIp);
  if (payload.lastActivityAt !== undefined) set("last_activity_at", payload.lastActivityAt);
  if (payload.mustChangePassword !== undefined) set("must_change_password", Boolean(payload.mustChangePassword));
  if (payload.forcePasswordReset !== undefined) set("force_password_reset", Boolean(payload.forcePasswordReset));
  if (payload.updatedBy !== undefined) set("updated_by", payload.updatedBy || null);

  if (!fields.length) {
    return getUserById(id);
  }

  values.push(id);
  const result = await query(
    `update users set ${fields.join(", ")}, updated_at = now() where id = $${values.length} returning *`,
    values
  );
  return mapUser(result.rows[0]);
}

async function updateUserPassword(id, passwordHash) {
  await ensureSchema();
  const result = await query(
    `update users
     set password_hash = $2,
         force_password_reset = false,
         must_change_password = false,
         password_changed_at = now(),
         updated_at = now()
     where id = $1
     returning *`,
    [id, passwordHash]
  );
  return mapUser(result.rows[0]);
}

module.exports = {
  createUser,
  createSuperadmin,
  ensureSchema,
  getUserByEmail,
  getUserById,
  hasSuperadmin,
  isEnabled,
  updateUser,
  updateUserPassword,
};
