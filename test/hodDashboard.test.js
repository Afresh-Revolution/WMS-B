const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-hod-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { readCollection, writeCollection } = require("../src/database/jsonStore");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-hod-dashboard-"));
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

function authHeaders(user) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(user)}`,
  };
}

test("hod dashboard follows department UI flow and blocks cross-department records", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  seed("departments", [
    { id: "dept-engineering", name: "Software Engineers", organizationId: "org-1", hodId: "emp-hod" },
    { id: "dept-finance", name: "Finance", organizationId: "org-1" },
  ]);
  seed("employees", [
    { id: "emp-hod", employeeId: "HOD-001", fullName: "Nina Head", departmentId: "dept-engineering", organizationId: "org-1", status: "active" },
    { id: "emp-engineer", employeeId: "ENG-001", fullName: "Sam Engineer", departmentId: "dept-engineering", organizationId: "org-1", status: "active" },
    { id: "emp-finance", employeeId: "FIN-001", fullName: "Faye Finance", departmentId: "dept-finance", organizationId: "org-1", status: "active" },
  ]);
  seed("tasks", [
    { id: "task-engineering", title: "Ship sprint work", employeeId: "emp-engineer", departmentId: "dept-engineering", organizationId: "org-1", status: "PENDING", dueDate: "2999-01-01" },
    { id: "task-finance", title: "Close month end", employeeId: "emp-finance", departmentId: "dept-finance", organizationId: "org-1", status: "PENDING", dueDate: "2999-01-01" },
  ]);
  seed("targets", [
    { id: "target-engineering", title: "API uptime", employeeId: "emp-engineer", departmentId: "dept-engineering", organizationId: "org-1", status: "ACTIVE", currentValue: 80, targetValue: 100 },
  ]);
  seed("meetings", [
    { id: "meeting-engineering", title: "Engineering standup", departmentId: "dept-engineering", organizationId: "org-1", status: "SCHEDULED", startAt: "2999-01-01T09:00:00.000Z" },
    { id: "meeting-finance", title: "Finance standup", departmentId: "dept-finance", organizationId: "org-1", status: "SCHEDULED", startAt: "2999-01-01T09:00:00.000Z" },
  ]);

  const hod = createUser({
    name: "Nina Head",
    email: "hod@example.com",
    passwordHash: hashPassword("password123"),
    role: "hod",
    roleId: "hod",
    status: "active",
    employeeId: "emp-hod",
    organizationId: "org-1",
  });
  const headers = authHeaders(hod);

  const overviewResponse = await fetch(`${baseUrl}/api/v1/hod/overview`, { headers });
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.data.department.id, "dept-engineering");
  assert.equal(overview.data.department.name, "Software Engineers");
  assert.equal(overview.data.metrics.teamEmployees, 2);
  assert.equal(overview.data.targets.averageProgress, 80);
  assert.ok(overview.data.navigation.includes("Team Members"));
  assert.ok(overview.data.tasks.items.some((task) => task.id === "task-engineering"));
  assert.equal(overview.data.tasks.items.some((task) => task.id === "task-finance"), false);

  const teamResponse = await fetch(`${baseUrl}/api/v1/hod/team-members`, { headers });
  assert.equal(teamResponse.status, 200);
  const team = await teamResponse.json();
  assert.deepEqual(
    team.data.map((employee) => employee.id).sort(),
    ["emp-engineer", "emp-hod"]
  );

  const foreignTeamResponse = await fetch(`${baseUrl}/api/v1/hod/team-members/emp-finance`, { headers });
  assert.equal(foreignTeamResponse.status, 403);

  const foreignTaskResponse = await fetch(`${baseUrl}/api/v1/hod/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Cross-department task", employeeId: "emp-finance", departmentId: "dept-finance" }),
  });
  assert.equal(foreignTaskResponse.status, 403);

  const taskResponse = await fetch(`${baseUrl}/api/v1/hod/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Review API contracts", employeeId: "emp-engineer", departmentId: "dept-engineering", priority: "HIGH" }),
  });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json();
  assert.equal(task.data.departmentId, "dept-engineering");
  assert.equal(task.data.createdBy, hod.id);

  const targetResponse = await fetch(`${baseUrl}/api/v1/hod/targets`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Reduce incidents", employeeId: "emp-engineer", departmentId: "dept-engineering", targetValue: 5 }),
  });
  assert.equal(targetResponse.status, 201);

  const meetingResponse = await fetch(`${baseUrl}/api/v1/hod/meetings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Sprint planning", departmentId: "dept-engineering", startAt: "2999-01-02T09:00:00.000Z" }),
  });
  assert.equal(meetingResponse.status, 201);

  const legacyDashboardResponse = await fetch(`${baseUrl}/api/hod/dashboard`, { headers });
  assert.equal(legacyDashboardResponse.status, 200);

  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "HOD_TASK_CREATED"));
  assert.ok(readCollection("notifications").some((notification) => notification.type === "HOD_TASK_CREATED" && notification.recipientEmployeeId === "emp-engineer"));
});
