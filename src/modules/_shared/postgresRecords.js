const { isDatabaseConfigured, query } = require("./postgres");

let schemaReady = false;
let schemaPromise = null;

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function asJson(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function logPersistError(collection, error) {
  console.error(`Failed to persist ${collection} to Postgres:`, error.publicMessage || error.message);
}

async function ensureSchema() {
  if (!isDatabaseConfigured()) {
    return false;
  }
  if (schemaReady) {
    return true;
  }
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        create table if not exists operational_records (
          id uuid primary key default gen_random_uuid(),
          collection text not null,
          record_id text not null,
          payload jsonb not null default '{}'::jsonb,
          updated_at timestamptz not null default now(),
          unique (collection, record_id)
        );
      `);
      await query(`create index if not exists idx_operational_records_collection on operational_records(collection, updated_at desc)`);
      await query(`
        create table if not exists employees (
          id uuid primary key default gen_random_uuid(),
          user_id uuid references users(id),
          employee_id text not null unique,
          full_name text not null,
          email text,
          phone text,
          department_id uuid,
          employment_type text,
          hire_date date,
          salary numeric(14,2),
          status text not null default 'active',
          bank_information jsonb not null default '{}'::jsonb,
          emergency_contact jsonb not null default '{}'::jsonb,
          deleted_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
      `);
      await query(`alter table employees add column if not exists job_title text`);
      await query(`alter table employees add column if not exists organization_id uuid`);
      await query(`
        create table if not exists leave_types (
          id uuid primary key default gen_random_uuid(),
          name text not null,
          code text not null unique,
          description text,
          default_days numeric(8,2) not null default 0,
          paid boolean not null default true,
          requires_document boolean not null default false,
          requires_approval boolean not null default true,
          carry_forward_allowed boolean not null default false,
          max_carry_forward_days numeric(8,2) not null default 0,
          status text not null default 'active',
          policy jsonb not null default '{}'::jsonb,
          deleted_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
      `);
      await query(`
        create table if not exists leave_balances (
          id uuid primary key default gen_random_uuid(),
          employee_id uuid not null,
          leave_type_id uuid not null,
          year integer not null,
          allocated_days numeric(8,2) not null default 0,
          carried_forward_days numeric(8,2) not null default 0,
          accrued_days numeric(8,2) not null default 0,
          used_days numeric(8,2) not null default 0,
          pending_days numeric(8,2) not null default 0,
          remaining_days numeric(8,2) not null default 0,
          balance numeric(8,2) not null default 0,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (employee_id, leave_type_id, year)
        );
      `);
      await query(`
        create table if not exists leave_requests (
          id uuid primary key default gen_random_uuid(),
          employee_id uuid not null,
          leave_type_id uuid not null,
          start_date date not null,
          end_date date not null,
          duration numeric(8,2) not null default 0,
          calendar_days numeric(8,2) not null default 0,
          duration_type text not null default 'FULL_DAY',
          note text,
          reason text,
          status text not null default 'PENDING',
          submitted_at timestamptz,
          approved_at timestamptz,
          rejected_at timestamptz,
          cancelled_at timestamptz,
          withdrawn_at timestamptz,
          approved_by uuid,
          rejected_by uuid,
          cancelled_by uuid,
          withdrawn_by uuid,
          rejection_reason text,
          cancellation_reason text,
          withdrawal_reason text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          deleted_at timestamptz
        );
      `);
      schemaReady = true;
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function upsertOperationalRecord(collection, record) {
  if (!record?.id) {
    return;
  }
  await query(
    `insert into operational_records (collection, record_id, payload, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict (collection, record_id)
     do update set payload = excluded.payload, updated_at = now()`,
    [collection, String(record.id), asJson(record)]
  );
}

async function upsertEmployeeRow(record) {
  if (!isUuid(record.id)) {
    return;
  }
  const employeeNumber = String(record.employeeId || record.employee_id || `EMP-${String(record.id).replace(/-/g, "").slice(0, 8)}`).slice(0, 64);
  const departmentId = isUuid(record.departmentId || record.department_id) ? record.departmentId || record.department_id : null;
  const userId = isUuid(record.userId || record.user_id) ? record.userId || record.user_id : null;
  const hireDate = record.hireDate || record.hire_date || record.startDate || record.employmentStartDate || null;
  try {
    await query(
      `insert into employees
        (id, user_id, employee_id, full_name, email, phone, department_id, employment_type, hire_date, salary, status, job_title, organization_id, bank_information, emergency_contact, updated_at)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, now())
       on conflict (id) do update set
        user_id = coalesce(excluded.user_id, employees.user_id),
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        department_id = coalesce(excluded.department_id, employees.department_id),
        employment_type = excluded.employment_type,
        hire_date = coalesce(excluded.hire_date, employees.hire_date),
        salary = coalesce(excluded.salary, employees.salary),
        status = excluded.status,
        job_title = excluded.job_title,
        organization_id = coalesce(excluded.organization_id, employees.organization_id),
        bank_information = excluded.bank_information,
        emergency_contact = excluded.emergency_contact,
        updated_at = now()`,
      [
        record.id,
        userId,
        employeeNumber,
        record.fullName || record.name || record.email || "Staff member",
        record.email || null,
        record.phone || null,
        departmentId,
        record.employmentType || record.employment_type || null,
        hireDate,
        record.salary || null,
        record.status || "active",
        record.jobTitle || record.job_title || record.position || null,
        isUuid(record.organizationId || record.organization_id) ? record.organizationId || record.organization_id : null,
        asJson(record.bankInformation || record.bank_information || {}),
        asJson(record.emergencyContact || record.emergency_contact || {}),
      ]
    );
  } catch (error) {
    if (String(error.message || "").includes("employees_employee_id_key")) {
      await query(
        `insert into employees
          (id, user_id, employee_id, full_name, email, phone, status, job_title, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (id) do update set user_id = coalesce(excluded.user_id, employees.user_id), email = excluded.email, updated_at = now()`,
        [
          record.id,
          userId,
          `EMP-${String(record.id).replace(/-/g, "").slice(0, 12)}`,
          record.fullName || record.name || record.email || "Staff member",
          record.email || null,
          record.phone || null,
          record.status || "active",
          record.jobTitle || record.job_title || null,
        ]
      );
      return;
    }
    throw error;
  }
}

async function upsertLeaveTypeRow(record) {
  if (!isUuid(record.id) || !record.code) {
    return;
  }
  await query(
    `insert into leave_types
      (id, name, code, description, default_days, paid, requires_document, requires_approval, carry_forward_allowed, max_carry_forward_days, status, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     on conflict (code) do update set
      name = excluded.name,
      description = excluded.description,
      default_days = excluded.default_days,
      paid = excluded.paid,
      requires_document = excluded.requires_document,
      requires_approval = excluded.requires_approval,
      carry_forward_allowed = excluded.carry_forward_allowed,
      max_carry_forward_days = excluded.max_carry_forward_days,
      status = excluded.status,
      updated_at = now()`,
    [
      record.id,
      record.name,
      String(record.code).toUpperCase(),
      record.description || null,
      Number(record.defaultDays || record.default_days || 0),
      record.paid !== false,
      Boolean(record.requiresDocument || record.requires_document),
      record.requiresApproval !== false && record.requires_approval !== false,
      Boolean(record.carryForwardAllowed || record.carry_forward_allowed),
      Number(record.maxCarryForwardDays || record.max_carry_forward_days || 0),
      record.status || "active",
    ]
  );
}

async function resolveLeaveTypeId(record) {
  const id = record.leaveTypeId || record.leave_type_id;
  if (isUuid(id)) {
    const existing = await query(`select id from leave_types where id = $1 or code = $2 limit 1`, [id, String(record.leaveTypeName || record.leave_type_name || "").toUpperCase()]);
    if (existing.rows[0]) {
      return existing.rows[0].id;
    }
  }
  const byCode = await query(`select id from leave_types where upper(code) = upper($1) limit 1`, [record.leaveTypeName || record.code || "ANNUAL"]);
  return byCode.rows[0]?.id || null;
}

async function upsertLeaveRequestRow(record) {
  if (!isUuid(record.id) || !isUuid(record.employeeId || record.employee_id)) {
    return;
  }
  const leaveTypeId = await resolveLeaveTypeId(record);
  if (!leaveTypeId) {
    return;
  }
  await query(
    `insert into leave_requests
      (id, employee_id, leave_type_id, start_date, end_date, duration, calendar_days, duration_type, note, reason, status,
       submitted_at, approved_at, rejected_at, cancelled_at, withdrawn_at, approved_by, rejected_by, cancelled_by, withdrawn_by,
       rejection_reason, cancellation_reason, withdrawal_reason, updated_at)
     values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, now())
     on conflict (id) do update set
      status = excluded.status,
      note = excluded.note,
      approved_at = excluded.approved_at,
      rejected_at = excluded.rejected_at,
      cancelled_at = excluded.cancelled_at,
      withdrawn_at = excluded.withdrawn_at,
      approved_by = excluded.approved_by,
      rejected_by = excluded.rejected_by,
      rejection_reason = excluded.rejection_reason,
      cancellation_reason = excluded.cancellation_reason,
      withdrawal_reason = excluded.withdrawal_reason,
      updated_at = now()`,
    [
      record.id,
      record.employeeId || record.employee_id,
      leaveTypeId,
      record.startDate || record.start_date,
      record.endDate || record.end_date,
      Number(record.duration || 0),
      Number(record.calendarDays || record.calendar_days || 0),
      record.durationType || record.duration_type || "FULL_DAY",
      record.note || null,
      record.reason || record.note || null,
      record.status || "PENDING",
      record.submittedAt || record.submitted_at || null,
      record.approvedAt || record.approved_at || null,
      record.rejectedAt || record.rejected_at || null,
      record.cancelledAt || record.cancelled_at || null,
      record.withdrawnAt || record.withdrawn_at || null,
      isUuid(record.approvedBy || record.approved_by) ? record.approvedBy || record.approved_by : null,
      isUuid(record.rejectedBy || record.rejected_by) ? record.rejectedBy || record.rejected_by : null,
      isUuid(record.cancelledBy || record.cancelled_by) ? record.cancelledBy || record.cancelled_by : null,
      isUuid(record.withdrawnBy || record.withdrawn_by) ? record.withdrawnBy || record.withdrawn_by : null,
      record.rejectionReason || record.rejection_reason || null,
      record.cancellationReason || record.cancellation_reason || null,
      record.withdrawalReason || record.withdrawal_reason || null,
    ]
  );
}

async function upsertLeaveBalanceRow(record) {
  const employeeId = record.employeeId || record.employee_id;
  const leaveTypeId = record.leaveTypeId || record.leave_type_id;
  if (!isUuid(record.id) || !isUuid(employeeId) || !isUuid(leaveTypeId)) {
    return;
  }
  await query(
    `insert into leave_balances
      (id, employee_id, leave_type_id, year, allocated_days, carried_forward_days, accrued_days, used_days, pending_days, remaining_days, balance, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10, now())
     on conflict (employee_id, leave_type_id, year) do update set
      allocated_days = excluded.allocated_days,
      carried_forward_days = excluded.carried_forward_days,
      accrued_days = excluded.accrued_days,
      used_days = excluded.used_days,
      pending_days = excluded.pending_days,
      remaining_days = excluded.remaining_days,
      balance = excluded.remaining_days,
      updated_at = now()`,
    [
      record.id,
      employeeId,
      leaveTypeId,
      Number(record.year || new Date().getUTCFullYear()),
      Number(record.allocatedDays || record.allocated_days || 0),
      Number(record.carriedForwardDays || record.carried_forward_days || 0),
      Number(record.accruedDays || record.accrued_days || 0),
      Number(record.usedDays || record.used_days || 0),
      Number(record.pendingDays || record.pending_days || 0),
      Number(record.remainingDays || record.remaining_days || 0),
    ]
  );
}

async function persistTypedRecord(collection, record) {
  if (collection === "employees") {
    await upsertEmployeeRow(record);
  } else if (collection === "leave_types") {
    await upsertLeaveTypeRow(record);
  } else if (collection === "leave_requests") {
    await upsertLeaveRequestRow(record);
  } else if (collection === "leave_balances") {
    await upsertLeaveBalanceRow(record);
  }
}

async function persistCollection(collection, records) {
  if (!isDatabaseConfigured() || !Array.isArray(records)) {
    return { enabled: false, stored: 0 };
  }
  await ensureSchema();
  let stored = 0;
  for (const record of records) {
    if (!record?.id) {
      continue;
    }
    try {
      await upsertOperationalRecord(collection, record);
      await persistTypedRecord(collection, record);
      stored += 1;
    } catch (error) {
      logPersistError(`${collection}:${record.id}`, error);
    }
  }
  return { enabled: true, stored };
}

let persistTail = Promise.resolve();

function queuePersist(collection, records) {
  if (!isDatabaseConfigured()) {
    return;
  }
  persistTail = persistTail
    .then(() => persistCollection(collection, records))
    .catch((error) => logPersistError(collection, error));
}

async function loadCollectionsFromPostgres() {
  if (!isDatabaseConfigured()) {
    return {};
  }
  await ensureSchema();
  const result = await query(`select collection, record_id, payload, updated_at from operational_records`);
  const grouped = {};
  for (const row of result.rows) {
    const collection = row.collection;
    grouped[collection] = grouped[collection] || [];
    grouped[collection].push({
      ...(row.payload || {}),
      id: row.payload?.id || row.record_id,
      updatedAt: row.payload?.updatedAt || row.updated_at,
    });
  }
  return grouped;
}

async function hydrateJsonStoreFromPostgres({ logger = console } = {}) {
  if (!isDatabaseConfigured()) {
    return { enabled: false, collections: 0 };
  }
  const { readCollection, writeCollection } = require("../../database/jsonStore");
  const grouped = await loadCollectionsFromPostgres();
  let collections = 0;
  for (const [collection, remoteRecords] of Object.entries(grouped)) {
    const local = readCollection(collection);
    const byId = new Map(local.map((record) => [String(record.id), record]));
    for (const record of remoteRecords) {
      const existing = byId.get(String(record.id));
      if (!existing) {
        byId.set(String(record.id), record);
        continue;
      }
      const remoteTime = new Date(record.updatedAt || record.updated_at || 0).getTime();
      const localTime = new Date(existing.updatedAt || existing.updated_at || 0).getTime();
      if (remoteTime >= localTime) {
        byId.set(String(record.id), { ...existing, ...record });
      }
    }
    writeCollection(collection, [...byId.values()], { skipPersist: true });
    collections += 1;
  }
  logger.log(`Hydrated ${collections} collections from Supabase.`);
  return { enabled: true, collections };
}

module.exports = {
  ensureSchema,
  hydrateJsonStoreFromPostgres,
  persistCollection,
  queuePersist,
};
