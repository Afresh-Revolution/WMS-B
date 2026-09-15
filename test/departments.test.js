const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-departments";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-departments-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

async function bootstrap(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main Admin",
      email: "admin@example.com",
      password: "password123",
      setupToken: "setup-token",
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("manages department dashboard, HOD assignment, relations, and deactivation safeguards", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrap(baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const createDepartmentResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Software Engineering",
      code: "ENG-001",
      description: "Builds product systems",
      location: "Lagos",
      budget: 5000000,
      status: "active",
    }),
  });
  assert.equal(createDepartmentResponse.status, 201);
  const createdDepartment = await createDepartmentResponse.json();

  const createEmployeeResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Omar",
        lastName: "Reyes",
        email: "omar.reyes@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-100",
        jobTitle: "Engineering Manager",
        departmentId: createdDepartment.data.id,
        department: "Software Engineering",
        employmentType: "Full-time",
        status: "active",
      },
    }),
  });
  assert.equal(createEmployeeResponse.status, 201);
  const employee = await createEmployeeResponse.json();

  const listResponse = await fetch(`${baseUrl}/api/v1/departments?filter=no_hod`, { headers });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.meta.summary.departments, 1);
  assert.equal(list.meta.summary.totalHeadcount, 1);
  assert.equal(list.meta.summary.hodNotAssigned, 1);
  assert.equal(list.data[0].headcount, 1);

  const hodResponse = await fetch(`${baseUrl}/api/v1/departments/${createdDepartment.data.id}/hod`, {
    method: "POST",
    headers,
    body: JSON.stringify({ employeeId: employee.data.id }),
  });
  assert.equal(hodResponse.status, 200);
  const hodDepartment = await hodResponse.json();
  assert.equal(hodDepartment.data.hod.name, "Omar Reyes");

  const overviewResponse = await fetch(`${baseUrl}/api/v1/departments/${createdDepartment.data.id}/overview`, {
    headers,
  });
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.data.headcount, 1);
  assert.equal(overview.data.activeEmployees, 1);

  const employeesResponse = await fetch(`${baseUrl}/api/v1/departments/${createdDepartment.data.id}/employees`, {
    headers,
  });
  assert.equal(employeesResponse.status, 200);
  const employees = await employeesResponse.json();
  assert.equal(employees.data.length, 1);

  const blockedDeactivateResponse = await fetch(`${baseUrl}/api/v1/departments/${createdDepartment.data.id}/deactivate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason: "reorg" }),
  });
  assert.equal(blockedDeactivateResponse.status, 409);

  const deactivateResponse = await fetch(`${baseUrl}/api/v1/departments/${createdDepartment.data.id}/deactivate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason: "reorg", confirmation: "DEACTIVATE DEPARTMENT" }),
  });
  assert.equal(deactivateResponse.status, 200);
  const deactivated = await deactivateResponse.json();
  assert.equal(deactivated.data.status, "inactive");

  const formCreateResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "software",
      headOfDepartment: "william",
      description: "build apps",
    }),
  });
  assert.equal(formCreateResponse.status, 201);
  const formCreated = await formCreateResponse.json();
  assert.equal(formCreated.data.name, "software");
  assert.ok(formCreated.data.code);
  assert.equal(formCreated.data.description, "build apps");
  assert.equal(formCreated.data.hod.name, "william");

  const { createUser } = require("../src/auth/userStore");
  const { hashPassword } = require("../src/auth/passwords");
  createUser({
    name: "HR User",
    email: "hr.dept@example.com",
    passwordHash: hashPassword("password123"),
    role: "hr",
    status: "active",
  });
  const hrLoginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "hr.dept@example.com", password: "password123" }),
  });
  assert.equal(hrLoginResponse.status, 200);
  const hrLogin = await hrLoginResponse.json();
  const hrCreateResponse = await fetch(`${baseUrl}/api/v1/hr/departments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${hrLogin.token}`,
    },
    body: JSON.stringify({ name: "should-fail", description: "HR cannot add this" }),
  });
  assert.equal(hrCreateResponse.status, 403);
});
