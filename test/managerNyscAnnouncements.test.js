const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-manager-nysc";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";
delete process.env.DATABASE_URL;

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById, updateUser } = require("../src/auth/userStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-manager-nysc-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

function addDays(days) {
  const date = new Date(Date.now() + days * 86400000);
  return date.toISOString().slice(0, 10);
}

test("manager can add NYSC members, publish announcements, and only privileged roles can create users", async (t) => {
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
    body: JSON.stringify({ name: "Engineering", code: "ENG-NYSC", status: "active" }),
  });
  assert.equal(deptResponse.status, 201);
  const department = await deptResponse.json();

  const supervisorResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fullName: "Omar Reyes",
      email: "omar.supervisor@example.com",
      role: "employee",
      departmentId: department.data.id,
      locationType: "onsite",
      location: "Lagos Office",
    }),
  });
  assert.equal(supervisorResponse.status, 201);
  const supervisor = await supervisorResponse.json();
  assert.equal(supervisor.data.location, "Lagos Office");
  assert.equal(supervisor.data.locationType, "onsite");

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
  updateUser(managerCreated.data.id, { mustChangePassword: false, forcePasswordReset: false, departmentId: department.data.id });
  const managerUser = getUserById(managerCreated.data.id);
  const managerHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(managerUser)}`,
  };

  const lookups = await fetch(`${baseUrl}/api/v1/manager/lookups`, { headers: managerHeaders });
  assert.equal(lookups.status, 200);
  const lookupBody = await lookups.json();
  assert.ok(lookupBody.data.departments.some((item) => item.id === department.data.id));
  assert.ok(lookupBody.data.locationTypes.some((item) => item.key === "remote"));

  const createMember = await fetch(`${baseUrl}/api/v1/manager/nysc-interns`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      fullName: "Plangnan Nungse",
      email: "nungseplangnan@gmail.com",
      phone: "07088944773",
      type: "NYSC",
      departmentId: department.data.id,
      startDate: addDays(1),
      endDate: addDays(120),
      supervisorEmployeeId: supervisor.data.id,
    }),
  });
  assert.equal(createMember.status, 201);
  const member = await createMember.json();
  assert.equal(member.data.profile.fullName, "Plangnan Nungse");
  assert.equal(member.data.placement.departmentId, department.data.id);
  assert.equal(member.meta.temporaryPassword, "Plangnan");
  const internLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "nungseplangnan@gmail.com",
      password: "Plangnan",
    }),
  });
  assert.equal(internLogin.status, 200);
  const internAuth = await internLogin.json();
  assert.equal(internAuth.mustChangePassword, true);

  const listMembers = await fetch(`${baseUrl}/api/v1/manager/nysc-interns`, { headers: managerHeaders });
  assert.equal(listMembers.status, 200);
  const listed = await listMembers.json();
  assert.equal(listed.data.length, 1);

  const publish = await fetch(`${baseUrl}/api/v1/manager/announcements`, {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({
      title: "Placement update",
      message: "Welcome the new NYSC member.",
      status: "published",
    }),
  });
  assert.equal(publish.status, 201);

  const employeeUserResponse = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fullName: "Regular Staff",
      email: "regular.staff@example.com",
      role: "employee",
      status: "active",
      temporaryPassword: "TempPass123!",
    }),
  });
  assert.equal(employeeUserResponse.status, 201);
  const employeeCreated = await employeeUserResponse.json();
  updateUser(employeeCreated.data.id, { mustChangePassword: false, forcePasswordReset: false });
  const employeeUser = getUserById(employeeCreated.data.id);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };
  const blocked = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      fullName: "Should Fail",
      email: "should.fail@example.com",
      role: "employee",
      temporaryPassword: "TempPass123!",
    }),
  });
  assert.equal(blocked.status, 403);

  const hodResponse = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fullName: "Department Head",
      email: "hod.nysc@example.com",
      role: "hod",
      status: "active",
      departmentId: department.data.id,
      temporaryPassword: "TempPass123!",
    }),
  });
  assert.equal(hodResponse.status, 201);
  const hodCreated = await hodResponse.json();
  updateUser(hodCreated.data.id, { mustChangePassword: false, forcePasswordReset: false, departmentId: department.data.id });
  const hodHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(getUserById(hodCreated.data.id))}`,
  };
  const hodCreate = await fetch(`${baseUrl}/api/v1/hod/nysc-interns`, {
    method: "POST",
    headers: hodHeaders,
    body: JSON.stringify({
      fullName: "Ifeanyi Intern",
      email: "ifeanyi.intern@example.com",
      type: "INTERN",
      departmentId: department.data.id,
      startDate: addDays(1),
      endDate: addDays(90),
      supervisorEmployeeId: supervisor.data.id,
    }),
  });
  assert.equal(hodCreate.status, 201, JSON.stringify(await hodCreate.clone().json()));
  const hodMember = await hodCreate.json();
  assert.equal(hodMember.data.profile.fullName, "Ifeanyi Intern");
  assert.equal(hodMember.meta.temporaryPassword, "Ifeanyi");
});
