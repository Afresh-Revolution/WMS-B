const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-employee-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { readCollection, writeCollection } = require("../src/database/jsonStore");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-employee-dashboard-"));
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

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function nextWorkday(offsetDays = 1) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  while ([0, 6].includes(date.getUTCDay())) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

test("employee dashboard follows self-service UI flow and blocks other employee records", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const employeeUser = createUser({
    name: "Tunde Balogun",
    email: "tunde@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    roleId: "employee",
    status: "active",
    employeeId: "emp-tunde",
    departmentId: "dept-product",
    organizationId: "org-1",
  });
  const otherUser = createUser({
    name: "Other Employee",
    email: "other.employee@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    roleId: "employee",
    status: "active",
    employeeId: "emp-other",
    departmentId: "dept-finance",
    organizationId: "org-1",
  });
  const managerUser = createUser({
    name: "Morgan Manager",
    email: "manager.employee-test@example.com",
    passwordHash: hashPassword("password123"),
    role: "manager",
    roleId: "manager",
    status: "active",
    employeeId: "emp-manager",
    departmentId: "dept-product",
    organizationId: "org-1",
  });

  seed("departments", [
    { id: "dept-product", name: "Product", organizationId: "org-1" },
    { id: "dept-finance", name: "Finance", organizationId: "org-1" },
  ]);
  seed("employees", [
    { id: "emp-tunde", employeeId: "EMP-001", fullName: "Tunde Balogun", email: "tunde@example.com", userId: employeeUser.id, departmentId: "dept-product", organizationId: "org-1", managerId: "emp-manager", status: "active" },
    { id: "emp-manager", employeeId: "MGR-001", fullName: "Morgan Manager", email: "manager@example.com", userId: managerUser.id, departmentId: "dept-product", organizationId: "org-1", status: "active" },
    { id: "emp-other", employeeId: "EMP-002", fullName: "Other Employee", email: "other.employee@example.com", userId: otherUser.id, departmentId: "dept-finance", organizationId: "org-1", status: "active" },
  ]);
  seed("leave_types", [
    { id: "leave-annual", name: "Annual Leave", code: "ANNUAL", defaultDays: 29, status: "active" },
  ]);
  seed("leave_balances", [
    { id: "balance-tunde", employeeId: "emp-tunde", leaveTypeId: "leave-annual", leaveTypeName: "Annual Leave", allocatedDays: 29, usedDays: 0, pendingDays: 0, remainingDays: 29 },
    { id: "balance-other", employeeId: "emp-other", leaveTypeId: "leave-annual", leaveTypeName: "Annual Leave", allocatedDays: 29, usedDays: 0, pendingDays: 0, remainingDays: 29 },
  ]);
  seed("tasks", [
    { id: "task-tunde", title: "Ship onboarding redesign", employeeId: "emp-tunde", assignedTo: employeeUser.id, departmentId: "dept-product", organizationId: "org-1", status: "IN_PROGRESS", dueDate: isoDate(3), progress: 20 },
    { id: "task-other", title: "Close finance report", employeeId: "emp-other", assignedTo: otherUser.id, departmentId: "dept-finance", organizationId: "org-1", status: "PENDING", dueDate: isoDate(3), progress: 0 },
  ]);
  seed("targets", [
    { id: "target-tunde", title: "Complete onboarding work", departmentId: "dept-product", organizationId: "org-1", targetValue: 100, currentValue: 35, progress: 35, status: "ACTIVE" },
  ]);
  seed("target_assignments", [
    { id: "target-assignment-tunde", targetId: "target-tunde", employeeId: "emp-tunde", departmentId: "dept-product", status: "ASSIGNED" },
  ]);
  seed("meetings", [
    { id: "meeting-tunde", title: "Sprint planning", organizationId: "org-1", departmentId: "dept-product", status: "SCHEDULED", startAt: `${isoDate(2)}T09:00:00.000Z`, endAt: `${isoDate(2)}T10:00:00.000Z` },
    { id: "meeting-other", title: "Finance review", organizationId: "org-1", departmentId: "dept-finance", status: "SCHEDULED", startAt: `${isoDate(2)}T09:00:00.000Z`, endAt: `${isoDate(2)}T10:00:00.000Z` },
  ]);
  seed("meeting_participants", [
    { id: "participant-tunde", meetingId: "meeting-tunde", userId: employeeUser.id, employeeId: "emp-tunde", participantRole: "ATTENDEE" },
    { id: "participant-other", meetingId: "meeting-other", userId: otherUser.id, employeeId: "emp-other", participantRole: "ATTENDEE" },
  ]);
  seed("expenses", [
    { id: "expense-tunde", reference: "EXP-0001", employeeId: "emp-tunde", employeeName: "Tunde Balogun", departmentId: "dept-product", organizationId: "org-1", description: "Team coffee", category: "Meals", amount: 12000, status: "SUBMITTED", reimbursementStatus: "PENDING", expenseDate: isoDate(-1), createdBy: employeeUser.id },
    { id: "expense-other", reference: "EXP-0002", employeeId: "emp-other", employeeName: "Other Employee", departmentId: "dept-finance", organizationId: "org-1", description: "Taxi", category: "Transport", amount: 8000, status: "SUBMITTED", reimbursementStatus: "PENDING", expenseDate: isoDate(-1), createdBy: otherUser.id },
  ]);
  seed("performance_reviews", [
    { id: "review-tunde", employeeId: "emp-tunde", departmentId: "dept-product", organizationId: "org-1", rating: "A", status: "COMPLETED" },
  ]);
  seed("employee_documents", [
    { id: "document-tunde", employeeId: "emp-tunde", title: "Employment letter", status: "active" },
  ]);
  seed("notifications", [
    { id: "notification-tunde", recipientUserId: employeeUser.id, type: "TASK_DUE", title: "Task due soon", status: "unread" },
  ]);

  const headers = authHeaders(employeeUser);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/employee/dashboard`, { headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.profile.fullName, "Tunde Balogun");
  assert.equal(dashboard.data.metrics.leaveDaysRemaining, 29);
  assert.equal(dashboard.data.metrics.assignedTasks, 1);
  assert.equal(dashboard.data.metrics.upcomingMeetings, 1);
  assert.equal(dashboard.data.metrics.pendingExpenseClaims, 1);
  assert.equal(dashboard.data.metrics.performanceReviews, 1);
  assert.ok(dashboard.data.navigation.includes("My Expenses"));
  assert.equal(dashboard.data.myWork.some((task) => task.id === "task-other"), false);

  const recordResponse = await fetch(`${baseUrl}/api/v1/employee/employment-record`, { headers });
  assert.equal(recordResponse.status, 200);
  const record = await recordResponse.json();
  assert.equal(record.data.documents.length, 1);
  assert.equal(record.data.tasks.length, 1);

  const forbiddenProfileResponse = await fetch(`${baseUrl}/api/v1/employee/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "superadmin" }),
  });
  assert.equal(forbiddenProfileResponse.status, 403);

  const leaveTypesResponse = await fetch(`${baseUrl}/api/v1/employee/leave/types`, { headers });
  assert.equal(leaveTypesResponse.status, 200);
  const leaveTypes = await leaveTypesResponse.json();
  assert.equal(leaveTypes.data[0].id, "leave-annual");

  const leaveResponse = await fetch(`${baseUrl}/api/v1/employee/leave`, {
    method: "POST",
    headers,
    body: JSON.stringify({ leaveTypeId: "leave-annual", startDate: nextWorkday(10), endDate: nextWorkday(11), reason: "Family appointment" }),
  });
  assert.equal(leaveResponse.status, 201);
  const leave = await leaveResponse.json();
  assert.equal(leave.data.employeeId, "emp-tunde");

  const foreignTaskResponse = await fetch(`${baseUrl}/api/v1/employee/tasks/task-other/progress`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ progress: 60, employeeId: "emp-other" }),
  });
  assert.equal(foreignTaskResponse.status, 403);

  const taskProgressResponse = await fetch(`${baseUrl}/api/v1/employee/tasks/task-tunde/progress`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ progress: 70, note: "Almost done", employeeId: "emp-other" }),
  });
  assert.equal(taskProgressResponse.status, 200);
  const taskProgress = await taskProgressResponse.json();
  assert.equal(taskProgress.data.progress, 70);
  assert.equal(taskProgress.data.employeeId, "emp-tunde");

  const targetProgressResponse = await fetch(`${baseUrl}/api/v1/employee/targets/target-tunde/progress`, {
    method: "POST",
    headers,
    body: JSON.stringify({ value: 80, note: "New progress" }),
  });
  assert.equal(targetProgressResponse.status, 201);

  const scheduleResponse = await fetch(`${baseUrl}/api/v1/employee/schedule`, { headers });
  assert.equal(scheduleResponse.status, 200);
  const schedule = await scheduleResponse.json();
  assert.deepEqual(schedule.data.map((meeting) => meeting.id), ["meeting-tunde"]);

  const expenseResponse = await fetch(`${baseUrl}/api/v1/employee/expense-claims`, {
    method: "POST",
    headers,
    body: JSON.stringify({ category: "Communication", amount: 24000, expenseDate: isoDate(), description: "Client call data" }),
  });
  assert.equal(expenseResponse.status, 201);
  const expense = await expenseResponse.json();
  assert.equal(expense.data.employeeId, "emp-tunde");

  const otherExpenseResponse = await fetch(`${baseUrl}/api/v1/employee/expenses/expense-other`, { headers });
  assert.equal(otherExpenseResponse.status, 403);

  const legacyResponse = await fetch(`${baseUrl}/api/employer/dashboard`, { headers });
  assert.equal(legacyResponse.status, 200);

  const managerBlockedResponse = await fetch(`${baseUrl}/api/v1/employee/dashboard`, { headers: authHeaders(managerUser) });
  assert.equal(managerBlockedResponse.status, 403);

  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "EMPLOYEE_TASK_PROGRESS_UPDATED"));
});
