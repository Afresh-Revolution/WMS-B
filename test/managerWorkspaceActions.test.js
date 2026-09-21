const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-manager-workspace";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
delete process.env.DATABASE_URL;

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById, updateUser } = require("../src/auth/userStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-manager-workspace-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

function addDays(days) {
  const date = new Date(Date.now() + days * 86400000);
  return date.toISOString().slice(0, 10);
}

async function json(response) {
  return response.json();
}

test("manager can submit claims, add vendors, clock in, add NYSC members, and publish announcements", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const bootstrap = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main Admin",
      email: "admin@example.com",
      password: "password123",
      setupToken: "setup-token",
    }),
  });
  assert.equal(bootstrap.status, 201);
  const auth = await bootstrap.json();
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const deptResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Administration", code: "ADM-MGR", status: "active" }),
  });
  assert.equal(deptResponse.status, 201);
  const department = await deptResponse.json();

  const supervisorResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fullName: "Smoke Accountant",
      email: "smoke.accountant@example.com",
      role: "accountant",
      departmentId: department.data.id,
    }),
  });
  assert.equal(supervisorResponse.status, 201);
  const supervisor = await supervisorResponse.json();

  const managerResponse = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fullName: "Smoke Manager",
      email: "smoke.manager@example.com",
      role: "manager",
      status: "active",
      departmentId: department.data.id,
      temporaryPassword: "TempPass123!",
    }),
  });
  assert.equal(managerResponse.status, 201);
  const managerCreated = await managerResponse.json();
  updateUser(managerCreated.data.id, {
    mustChangePassword: false,
    forcePasswordReset: false,
    departmentId: department.data.id,
  });
  const managerUser = getUserById(managerCreated.data.id);
  const managerHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(managerUser)}`,
  };

  const claim = await fetch(`${baseUrl}/api/v1/expenses`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      description: "cyzdfhguinft",
      category: "Meals",
      date: new Date().toISOString().slice(0, 10),
      amount: 100000,
    }),
  });
  assert.equal(claim.status, 201, JSON.stringify(await claim.clone().json()));
  const claimBody = await json(claim);
  assert.equal(claimBody.data.category, "Meals");
  assert.equal(claimBody.data.amount, 100000);

  const vendor = await fetch(`${baseUrl}/api/v1/vendors`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      vendorName: "Plangnan",
      category: "Meals",
      location: "Jos",
      email: "nungseplangnan@gmail.com",
    }),
  });
  assert.equal(vendor.status, 201, JSON.stringify(await vendor.clone().json()));
  const vendorBody = await json(vendor);
  assert.equal(vendorBody.data.name, "Plangnan");

  const clockIn = await fetch(`${baseUrl}/api/v1/employee/attendance/clock-in`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({}),
  });
  assert.ok([200, 201].includes(clockIn.status), JSON.stringify(await clockIn.clone().json()));
  const clocked = await json(clockIn);
  assert.ok(clocked.data.checkIn || clocked.data.check_in);

  const nysc = await fetch(`${baseUrl}/api/v1/hr/nysc-interns`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      fullName: "Samuel Nungse",
      email: "samuelnungse0@gmail.com",
      phone: "07088944773",
      type: "NYSC",
      department: "admin",
      supervisor: "Smoke Accountant",
      startDate: "09/21/2026",
      endDate: "09/20/2027",
    }),
  });
  assert.equal(nysc.status, 201, JSON.stringify(await nysc.clone().json()));
  const nyscBody = await json(nysc);
  assert.equal(nyscBody.data.profile.fullName, "Samuel Nungse");
  assert.equal(nyscBody.data.placement.departmentId, department.data.id);
  assert.equal(nyscBody.data.supervisor.assignment.employeeId, supervisor.data.id);

  const announcement = await fetch(`${baseUrl}/api/v1/announcements`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      body: "welehjodkjfhfoikidsjfnkjdbvhjbv",
      category: "Events",
      priority: "Normal",
      audience: "All staff",
      department: "Administration",
      pinToTop: "No",
      whenToSend: "Publish now",
    }),
  });
  assert.equal(announcement.status, 201, JSON.stringify(await announcement.clone().json()));
  const announcementBody = await json(announcement);
  assert.equal(announcementBody.data.message, "welehjodkjfhfoikidsjfnkjdbvhjbv");
  assert.equal(announcementBody.data.status, "published");

  const superAdminNysc = await fetch(`${baseUrl}/api/v1/super-admin/nysc-interns`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      fullName: "Ada Intern",
      email: "ada.intern@example.com",
      type: "INTERN",
      supervisor: supervisor.data.id,
      startDate: addDays(2),
      endDate: addDays(90),
    }),
  });
  assert.equal(superAdminNysc.status, 201, JSON.stringify(await superAdminNysc.clone().json()));

  const managerClock = await fetch(`${baseUrl}/api/v1/manager/attendance/clock-in`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({}),
  });
  assert.ok([200, 201].includes(managerClock.status), JSON.stringify(await managerClock.clone().json()));

  const clockStatus = await fetch(`${baseUrl}/api/v1/manager/attendance/status`, { headers: managerHeaders });
  assert.equal(clockStatus.status, 200, JSON.stringify(await clockStatus.clone().json()));
  const clockStatusBody = await json(clockStatus);
  assert.equal(clockStatusBody.data.alreadyCheckedIn, true);

  const announcementDashboard = await fetch(`${baseUrl}/api/v1/manager/announcements/dashboard`, {
    headers: managerHeaders,
  });
  assert.equal(announcementDashboard.status, 200, JSON.stringify(await announcementDashboard.clone().json()));

  const managerAnnouncement = await fetch(`${baseUrl}/api/v1/manager/announcements`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      body: "Team stand-up moved to 10am",
      category: "Events",
      audience: "All staff",
      whenToSend: "Publish now",
    }),
  });
  assert.equal(managerAnnouncement.status, 201, JSON.stringify(await managerAnnouncement.clone().json()));

  const managerNysc = await fetch(`${baseUrl}/api/v1/manager/nysc-interns`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      fullName: "Blessing Intern",
      email: "blessing.intern@example.com",
      type: "NYSC",
      department: "admin",
      supervisor: "Smoke Accountant",
      startDate: addDays(3),
      endDate: addDays(120),
    }),
  });
  assert.equal(managerNysc.status, 201, JSON.stringify(await managerNysc.clone().json()));

  const managerClaim = await fetch(`${baseUrl}/api/v1/manager/expenses`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      description: "Taxi to site",
      category: "Transport",
      date: new Date().toISOString().slice(0, 10),
      amount: 4500,
    }),
  });
  assert.equal(managerClaim.status, 201, JSON.stringify(await managerClaim.clone().json()));

  const managerVendor = await fetch(`${baseUrl}/api/v1/manager/vendors`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      vendorName: "Jos Supplies",
      category: "Office",
      location: "Jos",
      email: "jos.supplies@example.com",
    }),
  });
  assert.equal(managerVendor.status, 201, JSON.stringify(await managerVendor.clone().json()));
});
