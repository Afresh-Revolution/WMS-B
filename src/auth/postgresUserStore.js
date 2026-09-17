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
    schemaPromise = (async () => {
      await query(`
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
      `);
      await query(`alter table users add column if not exists job_title text`);
      await query(`alter table users add column if not exists avatar_url text`);
      await query(`alter table users add column if not exists department text`);
      await query(`alter table users add column if not exists employee_number text`);
      await query(`alter table users add column if not exists organization_id uuid`);
      await query(`
        create table if not exists user_profiles (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references users(id),
          full_name text not null,
          phone text,
          photo_file_id uuid,
          notification_preferences jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
      `);
      await query(`create unique index if not exists idx_user_profiles_user_id on user_profiles(user_id)`);
      schemaReady = true;
      return true;
    })().catch((error) => {
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
    username: row.username || null,
    phone: row.phone || null,
    passwordHash: row.password_hash,
    role: row.role,
    roleId: row.role_id || row.role,
    departmentId: row.department_id || null,
    department: row.department || null,
    employeeId: row.employee_id || row.employee_number || null,
    employeeNumber: row.employee_number || null,
    jobTitle: row.job_title || null,
    avatarUrl: row.avatar_url || null,
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
  const user = mapUser(result.rows[0]);
  await ensureUserProfile(user);
  return user;
}

function usernameFromEmail(email) {
  const localPart = String(email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  return localPart || null;
}

async function ensureUserProfile(user) {
  if (!user?.id) {
    return;
  }
  const existing = await query(`select id from user_profiles where user_id = $1 limit 1`, [user.id]);
  if (existing.rows[0]) {
    await query(
      `update user_profiles
       set full_name = $2,
           phone = coalesce($3, phone),
           updated_at = now()
       where user_id = $1`,
      [user.id, user.fullName || user.name || user.email, user.phone || null]
    );
    return;
  }
  await query(`insert into user_profiles (user_id, full_name, phone) values ($1, $2, $3)`, [
    user.id,
    user.fullName || user.name || user.email,
    user.phone || null,
  ]);
}

async function listUsers() {
  await ensureSchema();
  const result = await query(`select * from users where deleted_at is null order by created_at asc`);
  return result.rows.map(mapUser);
}

async function createUser({
  id,
  name,
  fullName,
  email,
  username,
  phone,
  passwordHash,
  role = "employee",
  roleId,
  permissions = [],
  status = "active",
  accountType,
  department,
  departmentId,
  employeeId,
  jobTitle,
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

  const employeeUuid = nullableUuid(employeeId);
  const employeeNumber = employeeUuid ? null : employeeId ? String(employeeId) : null;
  const userId = isUuid(id) ? id : null;
  const generatedUsername = username || usernameFromEmail(normalizedEmail);
  const columns = [
    userId ? "id" : null,
    "full_name",
    "email",
    "username",
    "phone",
    "password_hash",
    "role",
    "role_id",
    "department_id",
    "department",
    "employee_id",
    "employee_number",
    "job_title",
    "account_type",
    "status",
    "permissions",
    "email_verified",
    "phone_verified",
    "must_change_password",
    "force_password_reset",
    "failed_login_count",
    "failed_login_attempts",
    "password_changed_at",
    "created_by",
    "activation_token_hash",
    "activation_token_expires_at",
  ].filter(Boolean);

  const values = [
    ...(userId ? [userId] : []),
    String(fullName || name || "").trim(),
    normalizedEmail,
    generatedUsername,
    phone || null,
    passwordHash,
    role,
    nullableUuid(roleId),
    nullableUuid(departmentId),
    department || null,
    employeeUuid,
    employeeNumber,
    jobTitle || null,
    accountType || (role === "superadmin" ? "SUPER_ADMIN" : role === "admin" ? "ADMIN" : "STAFF"),
    status,
    JSON.stringify(Array.isArray(permissions) ? permissions : []),
    false,
    false,
    Boolean(mustChangePassword),
    Boolean(mustChangePassword),
    0,
    0,
    new Date().toISOString(),
    nullableUuid(createdBy),
    activationTokenHash || null,
    activationTokenExpiresAt || null,
  ];
  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  const permissionPlaceholderIndex = columns.indexOf("permissions") + 1;

  let result;
  try {
    result = await query(
      `insert into users (${columns.join(", ")})
       values (${placeholders.replace(`$${permissionPlaceholderIndex}`, `$${permissionPlaceholderIndex}::jsonb`)})
       returning *`,
      values
    );
  } catch (error) {
    if (String(error.message || "").includes("users_username_key") && generatedUsername) {
      values[columns.indexOf("username")] = `${generatedUsername}.${String(Date.now()).slice(-4)}`;
      result = await query(
        `insert into users (${columns.join(", ")})
         values (${placeholders.replace(`$${permissionPlaceholderIndex}`, `$${permissionPlaceholderIndex}::jsonb`)})
         returning *`,
        values
      );
    } else {
      throw error;
    }
  }

  const user = mapUser(result.rows[0]);
  await ensureUserProfile(user);
  return user;
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
  if (payload.name !== undefined || payload.fullName !== undefined) set("full_name", payload.fullName || payload.name || null);
  if (payload.email !== undefined) set("email", normalizeEmail(payload.email));
  if (payload.phone !== undefined) set("phone", payload.phone || null);
  if (payload.role !== undefined) set("role", payload.role);
  if (payload.accountType !== undefined) set("account_type", payload.accountType);
  if (payload.permissions !== undefined) {
    values.push(JSON.stringify(Array.isArray(payload.permissions) ? payload.permissions : []));
    fields.push(`permissions = $${values.length}::jsonb`);
  }
  if (payload.deactivatedAt !== undefined) set("deactivated_at", payload.deactivatedAt);
  if (payload.deactivatedBy !== undefined) set("deactivated_by", nullableUuid(payload.deactivatedBy));
  if (payload.departmentId !== undefined) set("department_id", nullableUuid(payload.departmentId));
  if (payload.department !== undefined) set("department", payload.department || null);
  if (payload.employeeId !== undefined) {
    const employeeUuid = nullableUuid(payload.employeeId);
    set("employee_id", employeeUuid);
    if (!employeeUuid) set("employee_number", payload.employeeId || null);
  }
  if (payload.jobTitle !== undefined || payload.job_title !== undefined) set("job_title", payload.jobTitle || payload.job_title || null);
  if (payload.avatarUrl !== undefined || payload.avatar_url !== undefined) set("avatar_url", payload.avatarUrl || payload.avatar_url || null);
  if (payload.updatedBy !== undefined) set("updated_by", nullableUuid(payload.updatedBy));

  if (!fields.length) {
    return getUserById(id);
  }

  values.push(id);
  const result = await query(
    `update users set ${fields.join(", ")}, updated_at = now() where id = $${values.length} returning *`,
    values
  );
  const user = mapUser(result.rows[0]);
  if (user) {
    await ensureUserProfile(user);
  }
  return user;
}

async function upsertUser(payload = {}) {
  await ensureSchema();
  const existing = payload.email ? await getUserByEmail(payload.email) : payload.id ? await getUserById(payload.id) : null;
  if (existing) {
    const updates = {
      name: payload.fullName || payload.name || existing.name,
      fullName: payload.fullName || payload.name || existing.fullName,
      phone: payload.phone !== undefined ? payload.phone : existing.phone,
      status: payload.status || existing.status,
      department: payload.department,
      departmentId: payload.departmentId,
      employeeId: payload.employeeId,
      jobTitle: payload.jobTitle,
    };
    const user = await updateUser(existing.id, updates);
    if (payload.passwordHash && payload.passwordHash !== existing.passwordHash) {
      return updateUserPassword(existing.id, payload.passwordHash);
    }
    return user;
  }
  return createUser(payload);
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
  listUsers,
  updateUser,
  updateUserPassword,
  upsertUser,
};
