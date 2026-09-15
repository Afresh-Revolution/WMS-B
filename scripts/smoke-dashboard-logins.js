require("dotenv").config();

const { randomUUID } = require("crypto");
const { createApp } = require("../src/app");
const { hashPassword } = require("../src/auth/passwords");
const { getRolePermissions } = require("../src/constants/rbac");
const { readCollection, writeCollection } = require("../src/database/jsonStore");
const postgresUserStore = require("../src/auth/postgresUserStore");
const { query } = require("../src/modules/_shared/postgres");

const SMOKE_PASSWORD = process.env.SMOKE_DASHBOARD_PASSWORD || "SmokePass123!";
const ORG_ID = "10000000-0000-4000-8000-000000000001";
const DEPARTMENT_ID = "10000000-0000-4000-8000-000000000002";

const STAFF_ROLES = [
  { key: "hr", name: "Smoke HR", email: "smoke.hr@example.test", userId: "10000000-0000-4000-8000-000000000011", employeeId: "10000000-0000-4000-8000-000000000111", dashboard: "/api/v1/hr/dashboard" },
  { key: "hod", name: "Smoke HOD", email: "smoke.hod@example.test", userId: "10000000-0000-4000-8000-000000000012", employeeId: "10000000-0000-4000-8000-000000000112", dashboard: "/api/v1/hod/dashboard" },
  { key: "manager", name: "Smoke Manager", email: "smoke.manager@example.test", userId: "10000000-0000-4000-8000-000000000013", employeeId: "10000000-0000-4000-8000-000000000113", dashboard: "/api/v1/manager/dashboard" },
  { key: "secretary", name: "Smoke Secretary", email: "smoke.secretary@example.test", userId: "10000000-0000-4000-8000-000000000014", employeeId: "10000000-0000-4000-8000-000000000114", dashboard: "/api/v1/secretary/dashboard" },
  { key: "accountant", name: "Smoke Accountant", email: "smoke.accountant@example.test", userId: "10000000-0000-4000-8000-000000000015", employeeId: "10000000-0000-4000-8000-000000000115", dashboard: "/api/v1/accountant/dashboard" },
  { key: "employee", name: "Smoke Employee", email: "smoke.employee@example.test", userId: "10000000-0000-4000-8000-000000000016", employeeId: "10000000-0000-4000-8000-000000000116", dashboard: "/api/v1/employee/dashboard" },
  { key: "nysc_intern", name: "Smoke NYSC Intern", email: "smoke.nysc@example.test", userId: "10000000-0000-4000-8000-000000000017", employeeId: null, dashboard: "/api/v1/nysc-intern/dashboard" },
];

function upsertCollectionRecord(collection, id, record) {
  const records = readCollection(collection);
  const index = records.findIndex((item) => item.id === id);
  const next = { ...(index >= 0 ? records[index] : {}), ...record, id };
  if (index >= 0) {
    records[index] = next;
  } else {
    records.push(next);
  }
  writeCollection(collection, records);
  return next;
}

async function upsertSmokeUser(role) {
  const permissions = getRolePermissions(role.key);
  const passwordHash = hashPassword(SMOKE_PASSWORD);

  await query(
    `
      insert into users (
        id, full_name, email, password_hash, role, role_id, department_id, employee_id,
        account_type, status, permissions, email_verified, phone_verified,
        must_change_password, force_password_reset, failed_login_count,
        failed_login_attempts, password_changed_at
      )
      values (
        $1, $2, $3, $4, $5, null, $6, $7,
        'STAFF', 'active', $8::jsonb, true, false,
        false, false, 0, 0, now()
      )
      on conflict (email) do update set
        full_name = excluded.full_name,
        password_hash = excluded.password_hash,
        role = excluded.role,
        role_id = null,
        department_id = excluded.department_id,
        employee_id = excluded.employee_id,
        account_type = excluded.account_type,
        status = 'active',
        permissions = excluded.permissions,
        must_change_password = false,
        force_password_reset = false,
        failed_login_count = 0,
        failed_login_attempts = 0,
        locked_at = null,
        locked_until = null,
        updated_at = now()
    `,
    [
      role.userId,
      role.name,
      role.email,
      passwordHash,
      role.key,
      role.employeeId ? DEPARTMENT_ID : null,
      role.employeeId,
      JSON.stringify(permissions),
    ]
  );
}

function seedScopeFixtures() {
  const timestamp = new Date().toISOString();

  upsertCollectionRecord("organizations", ORG_ID, {
    companyName: "Smoke Test Organization",
    company_name: "Smoke Test Organization",
    companyEmail: "smoke@example.test",
    company_email: "smoke@example.test",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  upsertCollectionRecord("departments", DEPARTMENT_ID, {
    name: "Smoke Department",
    code: "SMOKE",
    status: "active",
    organizationId: ORG_ID,
    organization_id: ORG_ID,
    hodId: STAFF_ROLES.find((role) => role.key === "hod").employeeId,
    hod_id: STAFF_ROLES.find((role) => role.key === "hod").employeeId,
    managerId: STAFF_ROLES.find((role) => role.key === "manager").employeeId,
    manager_id: STAFF_ROLES.find((role) => role.key === "manager").employeeId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  for (const role of STAFF_ROLES.filter((item) => item.employeeId)) {
    upsertCollectionRecord("employees", role.employeeId, {
      employeeId: `SMOKE-${role.key.toUpperCase()}`,
      employee_id: `SMOKE-${role.key.toUpperCase()}`,
      fullName: role.name,
      full_name: role.name,
      email: role.email,
      userId: role.userId,
      user_id: role.userId,
      role: role.key,
      departmentId: DEPARTMENT_ID,
      department_id: DEPARTMENT_ID,
      organizationId: ORG_ID,
      organization_id: ORG_ID,
      status: "active",
      employmentStatus: "active",
      employment_status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const intern = STAFF_ROLES.find((role) => role.key === "nysc_intern");
  upsertCollectionRecord("nysc_intern_profiles", "smoke-profile-nysc", {
    profileNumber: "SMOKE-NYSC-001",
    profile_number: "SMOKE-NYSC-001",
    fullName: intern.name,
    full_name: intern.name,
    email: intern.email,
    userId: intern.userId,
    user_id: intern.userId,
    type: "NYSC",
    status: "ACTIVE",
    departmentId: DEPARTMENT_ID,
    department_id: DEPARTMENT_ID,
    organizationId: ORG_ID,
    organization_id: ORG_ID,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  upsertCollectionRecord("placements", "smoke-placement-nysc", {
    profileId: "smoke-profile-nysc",
    profile_id: "smoke-profile-nysc",
    departmentId: DEPARTMENT_ID,
    department_id: DEPARTMENT_ID,
    organizationId: ORG_ID,
    organization_id: ORG_ID,
    placementStatus: "ACTIVE",
    placement_status: "ACTIVE",
    startDate: "2026-01-01",
    start_date: "2026-01-01",
    expectedEndDate: "2026-12-31",
    expected_end_date: "2026-12-31",
    supervisorEmployeeId: STAFF_ROLES.find((role) => role.key === "manager").employeeId,
    supervisor_employee_id: STAFF_ROLES.find((role) => role.key === "manager").employeeId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

async function startServer() {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function checkDashboard(baseUrl, check) {
  const loginResponse = await postJson(`${baseUrl}/api/v1/auth/login`, {
    email: check.email,
    password: check.password,
  });
  const loginBody = await loginResponse.json().catch(() => ({}));

  if (loginResponse.status !== 200) {
    return {
      role: check.role,
      email: check.email,
      loginStatus: loginResponse.status,
      dashboardStatus: null,
      ok: false,
      error: loginBody.error?.code || loginBody.message || "LOGIN_FAILED",
    };
  }

  const token = loginBody.token || loginBody.accessToken;
  const dashboardResponse = await fetch(`${baseUrl}${check.dashboard}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const dashboardBody = await dashboardResponse.json().catch(() => ({}));

  return {
    role: check.role,
    email: check.email,
    loginStatus: loginResponse.status,
    dashboardStatus: dashboardResponse.status,
    ok: dashboardResponse.status === 200 && dashboardBody.success !== false,
    error: dashboardResponse.status === 200 ? null : dashboardBody.error?.code || dashboardBody.message || "DASHBOARD_FAILED",
  };
}

async function main() {
  if (!postgresUserStore.isEnabled()) {
    throw new Error("DATABASE_URL is required for real database login smoke tests.");
  }

  await postgresUserStore.ensureSchema();
  seedScopeFixtures();

  for (const role of STAFF_ROLES) {
    await upsertSmokeUser(role);
  }

  const checks = [
    {
      role: "superadmin",
      email: process.env.SUPERADMIN_EMAIL,
      password: process.env.SUPERADMIN_PASSWORD,
      dashboard: "/api/v1/super-admin/dashboard",
    },
    ...STAFF_ROLES.map((role) => ({
      role: role.key,
      email: role.email,
      password: SMOKE_PASSWORD,
      dashboard: role.dashboard,
    })),
  ].filter((check) => check.email && check.password);

  const { server, baseUrl } = await startServer();
  try {
    const results = [];
    for (const check of checks) {
      results.push(await checkDashboard(baseUrl, check));
    }

    const failed = results.filter((result) => !result.ok);
    console.table(results.map(({ role, email, loginStatus, dashboardStatus, ok, error }) => ({
      role,
      email,
      loginStatus,
      dashboardStatus,
      ok,
      error: error || "",
    })));

    if (failed.length) {
      process.exitCode = 1;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.publicMessage || error.message);
  process.exit(1);
});
