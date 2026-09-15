const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-attendance-checkin";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
process.env.ATTENDANCE_MAX_GPS_ACCURACY_METERS = "100";
process.env.ATTENDANCE_MAX_LOCATION_AGE_SECONDS = "300";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { readCollection, writeCollection } = require("../src/database/jsonStore");
const attendanceService = require("../src/modules/attendance/service");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-attendance-checkin-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

function seed(collection, records) {
  writeCollection(
    collection,
    records.map((record, index) => ({
      id: record.id || `${collection}-${index + 1}`,
      createdAt: record.createdAt || new Date().toISOString(),
      created_at: record.created_at || record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString(),
      updated_at: record.updated_at || record.updatedAt || new Date().toISOString(),
      ...record,
    }))
  );
}

function authHeaders(user, extra = {}) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(user)}`,
    ...extra,
  };
}

function checkInPayload(overrides = {}) {
  return {
    latitude: 6.5244,
    longitude: 3.3792,
    accuracyMeters: 25,
    locationTimestamp: new Date().toISOString(),
    clientTimezone: "Africa/Lagos",
    ...overrides,
  };
}

test("attendance check-in validates server-side location, schedule, duplicate, and manager scope", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const superadmin = createUser({
    name: "Main Admin",
    email: "admin.attendance@example.com",
    passwordHash: hashPassword("password123"),
    role: "superadmin",
    status: "active",
    organizationId: "org-1",
  });
  const manager = createUser({
    name: "Manager One",
    email: "manager.attendance@example.com",
    passwordHash: hashPassword("password123"),
    role: "manager",
    status: "active",
    employeeId: "emp-manager",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });
  const hr = createUser({
    name: "HR One",
    email: "hr.attendance@example.com",
    passwordHash: hashPassword("password123"),
    role: "hr",
    status: "active",
    organizationId: "org-1",
  });
  const employee = createUser({
    name: "Employee One",
    email: "employee.attendance@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    status: "active",
    employeeId: "emp-1",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });
  const otherEmployee = createUser({
    name: "Employee Two",
    email: "employee.two.attendance@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    status: "active",
    employeeId: "emp-2",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });
  const outsiderManager = createUser({
    name: "Manager Two",
    email: "manager.two.attendance@example.com",
    passwordHash: hashPassword("password123"),
    role: "manager",
    status: "active",
    employeeId: "emp-manager-2",
    departmentId: "dept-finance",
    organizationId: "org-1",
  });

  seed("departments", [
    { id: "dept-eng", name: "Engineering", organizationId: "org-1", managerId: "emp-manager" },
    { id: "dept-finance", name: "Finance", organizationId: "org-1", managerId: "emp-manager-2" },
  ]);
  seed("employees", [
    { id: "emp-manager", fullName: "Manager One", userId: manager.id, departmentId: "dept-eng", organizationId: "org-1", status: "active" },
    { id: "emp-manager-2", fullName: "Manager Two", userId: outsiderManager.id, departmentId: "dept-finance", organizationId: "org-1", status: "active" },
    { id: "emp-1", fullName: "Employee One", userId: employee.id, departmentId: "dept-eng", organizationId: "org-1", status: "active" },
    { id: "emp-2", fullName: "Employee Two", userId: otherEmployee.id, departmentId: "dept-eng", organizationId: "org-1", status: "active" },
  ]);

  const locationResponse = await fetch(`${baseUrl}/api/v1/attendance/locations`, {
    method: "POST",
    headers: authHeaders(superadmin),
    body: JSON.stringify({
      name: "Lagos Office",
      latitude: 6.5244,
      longitude: 3.3792,
      radiusMeters: 3000,
      timezone: "Africa/Lagos",
      organizationId: "org-1",
      departmentId: "dept-eng",
    }),
  });
  assert.equal(locationResponse.status, 201);
  const location = await locationResponse.json();

  const scheduleResponse = await fetch(`${baseUrl}/api/v1/attendance/schedules`, {
    method: "POST",
    headers: authHeaders(superadmin),
    body: JSON.stringify({
      name: "Weekday check-in",
      openingTime: "00:00",
      lateAfterTime: "09:30",
      closingTime: "23:59",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      organizationId: "org-1",
      departmentId: "dept-eng",
      locationIds: [location.data.id],
    }),
  });
  assert.equal(scheduleResponse.status, 201);
  const schedule = await scheduleResponse.json();

  const statusResponse = await fetch(`${baseUrl}/api/v1/attendance/me/status`, { headers: authHeaders(employee) });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.data.canCheckIn, true);
  assert.equal(status.data.schedules[0].locations[0].latitude, undefined);

  const checkInResponse = await fetch(`${baseUrl}/api/v1/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(employee, { "idempotency-key": "checkin-1" }),
    body: JSON.stringify(checkInPayload({ scheduleId: schedule.data.id, locationId: location.data.id })),
  });
  assert.equal(checkInResponse.status, 201);
  const checkIn = await checkInResponse.json();
  assert.equal(checkIn.data.employeeId, "emp-1");
  assert.equal(checkIn.data.locationId, location.data.id);
  assert.equal(checkIn.data.status === "on_time" || checkIn.data.status === "late", true);
  assert.equal(checkIn.data.latitude, undefined);

  const repeatResponse = await fetch(`${baseUrl}/api/v1/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(employee, { "idempotency-key": "checkin-1" }),
    body: JSON.stringify(checkInPayload({ scheduleId: schedule.data.id })),
  });
  assert.equal(repeatResponse.status, 200);
  const repeat = await repeatResponse.json();
  assert.equal(repeat.meta.idempotent, true);
  assert.equal(repeat.data.id, checkIn.data.id);

  const duplicateResponse = await fetch(`${baseUrl}/api/v1/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(employee),
    body: JSON.stringify(checkInPayload({ scheduleId: schedule.data.id })),
  });
  assert.equal(duplicateResponse.status, 409);

  const outsideResponse = await fetch(`${baseUrl}/api/v1/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(otherEmployee),
    body: JSON.stringify(checkInPayload({ latitude: 6.9, longitude: 3.9, scheduleId: schedule.data.id })),
  });
  assert.equal(outsideResponse.status, 422);
  const outside = await outsideResponse.json();
  assert.equal(outside.error.code, "OUTSIDE_ATTENDANCE_LOCATION");

  const scopedManagerResponse = await fetch(`${baseUrl}/api/v1/attendance/records`, { headers: authHeaders(manager) });
  assert.equal(scopedManagerResponse.status, 200);
  const scopedManager = await scopedManagerResponse.json();
  assert.equal(scopedManager.data.length, 1);

  const hrRecordsResponse = await fetch(`${baseUrl}/api/v1/attendance/records`, { headers: authHeaders(hr) });
  assert.equal(hrRecordsResponse.status, 200);
  const hrRecords = await hrRecordsResponse.json();
  assert.equal(hrRecords.data.length, 1);
  assert.equal(hrRecords.data[0].locationName, "Lagos Office");
  assert.equal(hrRecords.data[0].latitude, undefined);

  const crossScopeLocationResponse = await fetch(`${baseUrl}/api/v1/attendance/locations`, {
    method: "POST",
    headers: authHeaders(outsiderManager),
    body: JSON.stringify({
      name: "Wrong Department",
      latitude: 6.5244,
      longitude: 3.3792,
      departmentId: "dept-eng",
    }),
  });
  assert.equal(crossScopeLocationResponse.status, 403);

  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "ATTENDANCE_CHECK_IN_ACCEPTED"));
  assert.ok(readCollection("notifications").some((notification) => notification.type === "ATTENDANCE_CHECK_IN_ACCEPTED"));
});

test("attendance check-in is limited to employees, accountants, NYSC members, and interns", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const superadmin = createUser({
    name: "Admin",
    email: "admin.attendance-roles@example.com",
    passwordHash: hashPassword("password123"),
    role: "superadmin",
    status: "active",
    organizationId: "org-1",
  });
  const manager = createUser({
    name: "Manager",
    email: "manager.attendance-roles@example.com",
    passwordHash: hashPassword("password123"),
    role: "manager",
    status: "active",
    employeeId: "emp-manager-roles",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });
  const accountant = createUser({
    name: "Accountant",
    email: "accountant.attendance-roles@example.com",
    passwordHash: hashPassword("password123"),
    role: "accountant",
    status: "active",
    employeeId: "emp-accountant",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });
  const intern = createUser({
    name: "Intern",
    email: "intern.attendance-roles@example.com",
    passwordHash: hashPassword("password123"),
    role: "intern",
    status: "active",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });
  const nysc = createUser({
    name: "NYSC",
    email: "nysc.attendance-roles@example.com",
    passwordHash: hashPassword("password123"),
    role: "nysc_intern",
    status: "active",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });

  seed("departments", [{ id: "dept-eng", name: "Engineering", organizationId: "org-1", managerId: "emp-manager-roles" }]);
  seed("employees", [
    { id: "emp-manager-roles", fullName: "Manager", userId: manager.id, departmentId: "dept-eng", organizationId: "org-1", status: "active" },
    { id: "emp-accountant", fullName: "Accountant", userId: accountant.id, departmentId: "dept-eng", organizationId: "org-1", status: "active" },
  ]);
  seed("nysc_intern_profiles", [
    { id: "profile-intern", fullName: "Intern", email: intern.email, userId: intern.id, type: "INTERN", status: "ACTIVE", organizationId: "org-1", departmentId: "dept-eng" },
    { id: "profile-nysc", fullName: "NYSC", email: nysc.email, userId: nysc.id, type: "NYSC", status: "ACTIVE", organizationId: "org-1", departmentId: "dept-eng" },
  ]);
  seed("placements", [
    { id: "placement-intern", profileId: "profile-intern", departmentId: "dept-eng", placementStatus: "ACTIVE", organizationId: "org-1" },
    { id: "placement-nysc", profileId: "profile-nysc", departmentId: "dept-eng", placementStatus: "ACTIVE", organizationId: "org-1" },
  ]);

  const locationResponse = await fetch(`${baseUrl}/api/v1/attendance/locations`, {
    method: "POST",
    headers: authHeaders(superadmin),
    body: JSON.stringify({
      name: "Lagos Office",
      latitude: 6.5244,
      longitude: 3.3792,
      radiusMeters: 3000,
      timezone: "Africa/Lagos",
      organizationId: "org-1",
      departmentId: "dept-eng",
    }),
  });
  assert.equal(locationResponse.status, 201);
  const location = await locationResponse.json();

  const scheduleResponse = await fetch(`${baseUrl}/api/v1/attendance/schedules`, {
    method: "POST",
    headers: authHeaders(superadmin),
    body: JSON.stringify({
      name: "Weekday check-in",
      openingTime: "00:00",
      lateAfterTime: "09:30",
      closingTime: "23:59",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      organizationId: "org-1",
      departmentId: "dept-eng",
      locationIds: [location.data.id],
    }),
  });
  assert.equal(scheduleResponse.status, 201);
  const schedule = await scheduleResponse.json();
  const payload = checkInPayload({ scheduleId: schedule.data.id, locationId: location.data.id });

  const managerResponse = await fetch(`${baseUrl}/api/v1/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(manager),
    body: JSON.stringify(payload),
  });
  assert.equal(managerResponse.status, 403);

  const accountantResponse = await fetch(`${baseUrl}/api/v1/accountant/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(accountant),
    body: JSON.stringify(payload),
  });
  assert.equal(accountantResponse.status, 201);

  const internResponse = await fetch(`${baseUrl}/api/v1/intern/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(intern),
    body: JSON.stringify(payload),
  });
  assert.equal(internResponse.status, 201);

  const nyscResponse = await fetch(`${baseUrl}/api/v1/intern/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(nysc),
    body: JSON.stringify(payload),
  });
  assert.equal(nyscResponse.status, 201);

  const hod = createUser({
    name: "HOD",
    email: "hod.attendance-roles@example.com",
    passwordHash: hashPassword("password123"),
    role: "hod",
    status: "active",
    employeeId: "emp-hod",
    departmentId: "dept-eng",
    organizationId: "org-1",
  });
  const hodRecords = await fetch(`${baseUrl}/api/v1/attendance/records`, { headers: authHeaders(hod) });
  assert.equal(hodRecords.status, 403);
});

test("attendance helpers handle radius boundary and schedule opening rules", () => {
  const distance = attendanceService.haversineDistanceMeters(
    { latitude: 6.5244, longitude: 3.3792 },
    { latitude: 6.5244, longitude: 3.3792 }
  );
  assert.equal(distance, 0);

  const tooEarly = attendanceService.evaluateScheduleWindow(
    { openingTime: "08:00", lateAfterTime: "09:30", closingTime: "17:00", daysOfWeek: [2], timezone: "Africa/Lagos" },
    new Date("2026-09-08T06:59:00.000Z")
  );
  assert.equal(tooEarly.reason, "ATTENDANCE_NOT_OPEN");

  const open = attendanceService.evaluateScheduleWindow(
    { openingTime: "08:00", lateAfterTime: "09:30", closingTime: "17:00", daysOfWeek: [2], timezone: "Africa/Lagos" },
    new Date("2026-09-08T07:00:00.000Z")
  );
  assert.equal(open.isOpen, true);
  assert.equal(open.isLate, false);

  const late = attendanceService.evaluateScheduleWindow(
    { openingTime: "08:00", lateAfterTime: "09:30", closingTime: "17:00", daysOfWeek: [2], timezone: "Africa/Lagos" },
    new Date("2026-09-08T08:31:00.000Z")
  );
  assert.equal(late.isOpen, true);
  assert.equal(late.isLate, true);

  const overnight = attendanceService.evaluateScheduleWindow(
    { openingTime: "22:00", closingTime: "02:00", daysOfWeek: [2], timezone: "Africa/Lagos" },
    new Date("2026-09-09T00:30:00.000Z")
  );
  assert.equal(overnight.workDate, "2026-09-08");
  assert.equal(overnight.isOpen, true);
});
