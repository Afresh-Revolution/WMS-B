const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-manager-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { writeCollection, readCollection } = require("../src/database/jsonStore");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-manager-dashboard-"));
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

test("manager dashboard is scoped to the manager's department and blocks ID tampering", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  seed("departments", [
    { id: "dept-a", name: "Operations", organizationId: "org-1", managerEmployeeId: "emp-manager" },
    { id: "dept-b", name: "Finance", organizationId: "org-1" },
  ]);
  seed("employees", [
    { id: "emp-manager", employeeId: "MGR-001", fullName: "Morgan Manager", departmentId: "dept-a", organizationId: "org-1", status: "active" },
    { id: "emp-a", employeeId: "EMP-001", fullName: "Team Member", departmentId: "dept-a", organizationId: "org-1", status: "active" },
    { id: "emp-b", employeeId: "EMP-002", fullName: "Other Team", departmentId: "dept-b", organizationId: "org-1", status: "active" },
  ]);
  seed("leave_requests", [
    { id: "leave-a", employeeId: "emp-a", departmentId: "dept-a", organizationId: "org-1", status: "PENDING" },
    { id: "leave-active", employeeId: "emp-a", departmentId: "dept-a", organizationId: "org-1", status: "APPROVED", startDate: "2026-01-01", endDate: "2999-12-31" },
    { id: "leave-b", employeeId: "emp-b", departmentId: "dept-b", organizationId: "org-1", status: "PENDING" },
  ]);
  seed("attendance", [
    { id: "attendance-a", employeeId: "emp-a", employeeName: "Team Member", departmentId: "dept-a", organizationId: "org-1", date: new Date().toISOString().slice(0, 10), status: "PRESENT" },
    { id: "attendance-b", employeeId: "emp-b", employeeName: "Other Team", departmentId: "dept-b", organizationId: "org-1", date: new Date().toISOString().slice(0, 10), status: "ABSENT" },
  ]);
  seed("tasks", [
    { id: "task-a", title: "Scoped task", employeeId: "emp-a", departmentId: "dept-a", organizationId: "org-1", status: "PENDING", dueDate: "2020-01-01" },
    { id: "task-b", title: "Foreign task", employeeId: "emp-b", departmentId: "dept-b", organizationId: "org-1", status: "PENDING", dueDate: "2020-01-01" },
  ]);
  seed("targets", [
    { id: "target-a", title: "Scoped target", employeeId: "emp-a", departmentId: "dept-a", organizationId: "org-1", status: "ACTIVE", currentValue: 75, targetValue: 100 },
  ]);
  seed("performance_reviews", [
    { id: "review-a", employeeId: "emp-a", employeeName: "Team Member", departmentId: "dept-a", organizationId: "org-1", status: "PENDING" },
    { id: "review-b", employeeId: "emp-b", employeeName: "Other Team", departmentId: "dept-b", organizationId: "org-1", status: "PENDING" },
  ]);
  seed("meetings", [
    { id: "meeting-a", title: "Scoped meeting", employeeId: "emp-a", departmentId: "dept-a", organizationId: "org-1", status: "SCHEDULED", startAt: "2999-01-01T10:00:00.000Z" },
    { id: "meeting-b", title: "Foreign meeting", employeeId: "emp-b", departmentId: "dept-b", organizationId: "org-1", status: "SCHEDULED", startAt: "2999-01-01T10:00:00.000Z" },
  ]);
  seed("employee_documents", [
    { id: "doc-manager", employeeId: "emp-manager", organizationId: "org-1", title: "Employment letter", status: "active" },
  ]);

  const manager = createUser({
    name: "Morgan Manager",
    email: "manager@example.com",
    passwordHash: hashPassword("password123"),
    role: "manager",
    roleId: "manager",
    status: "active",
    departmentId: "dept-a",
    employeeId: "emp-manager",
    organizationId: "org-1",
  });
  const headers = authHeaders(manager);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/manager/dashboard`, { headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.metrics.teamEmployees, 2);
  assert.equal(dashboard.data.metrics.departments, 1);
  assert.equal(dashboard.data.metrics.pendingLeave, 1);
  assert.equal(dashboard.data.metrics.presentToday, 1);
  assert.equal(dashboard.data.metrics.absentToday, 0);
  assert.equal(dashboard.data.metrics.employeesOnLeave, 1);
  assert.equal(dashboard.data.metrics.targetProgress, 75);
  assert.equal(dashboard.data.metrics.pendingPerformanceReviews, 1);
  assert.deepEqual(dashboard.data.scope.departmentIds, ["dept-a"]);
  assert.ok(dashboard.data.navigation.includes("My Team"));
  assert.ok(dashboard.data.navigation.includes("Settings"));

  const employmentRecordResponse = await fetch(`${baseUrl}/api/v1/manager/employment-record`, { headers });
  assert.equal(employmentRecordResponse.status, 200);
  const employmentRecord = await employmentRecordResponse.json();
  assert.equal(employmentRecord.data.overview.employeeId, "MGR-001");
  assert.equal(employmentRecord.data.documents.length, 1);

  const profileResponse = await fetch(`${baseUrl}/api/v1/manager/profile`, { headers });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.data.user.role, "manager");

  const updateProfileResponse = await fetch(`${baseUrl}/api/v1/manager/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ displayName: "Morgan Lead", phone: "+1555000100" }),
  });
  assert.equal(updateProfileResponse.status, 200);
  const updatedProfile = await updateProfileResponse.json();
  assert.equal(updatedProfile.data.user.fullName, "Morgan Lead");

  const forbiddenProfileResponse = await fetch(`${baseUrl}/api/v1/manager/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "super_admin" }),
  });
  assert.equal(forbiddenProfileResponse.status, 403);

  const settingsResponse = await fetch(`${baseUrl}/api/v1/manager/settings`, { headers });
  assert.equal(settingsResponse.status, 200);
  const settingsUpdateResponse = await fetch(`${baseUrl}/api/v1/manager/settings`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ preferences: { density: "compact" } }),
  });
  assert.equal(settingsUpdateResponse.status, 200);
  const settingsUpdate = await settingsUpdateResponse.json();
  assert.equal(settingsUpdate.data.preferences.density, "compact");

  const helpCenterResponse = await fetch(`${baseUrl}/api/v1/manager/help-center`, { headers });
  assert.equal(helpCenterResponse.status, 200);
  const helpCenter = await helpCenterResponse.json();
  assert.ok(helpCenter.data.sections.some((section) => section.key === "work"));

  const employeesResponse = await fetch(`${baseUrl}/api/v1/manager/team`, { headers });
  assert.equal(employeesResponse.status, 200);
  const employees = await employeesResponse.json();
  assert.deepEqual(
    employees.data.map((employee) => employee.id).sort(),
    ["emp-a", "emp-manager"]
  );

  const foreignEmployeeResponse = await fetch(`${baseUrl}/api/v1/manager/employees/emp-b`, { headers });
  assert.equal(foreignEmployeeResponse.status, 403);
  const foreignEmployee = await foreignEmployeeResponse.json();
  assert.equal(foreignEmployee.error.code, "RESOURCE_OUT_OF_MANAGER_SCOPE");

  const attendanceResponse = await fetch(`${baseUrl}/api/v1/manager/attendance`, { headers });
  assert.equal(attendanceResponse.status, 200);
  const attendance = await attendanceResponse.json();
  assert.deepEqual(attendance.data.map((record) => record.id), ["attendance-a"]);

  const foreignAttendancePatchResponse = await fetch(`${baseUrl}/api/v1/manager/attendance/attendance-b/correct`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "PRESENT", reason: "tamper" }),
  });
  assert.equal(foreignAttendancePatchResponse.status, 403);

  const ownAttendancePatchResponse = await fetch(`${baseUrl}/api/v1/manager/attendance/attendance-a/correct`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "LATE", lateMinutes: 5, reason: "Clock-in correction" }),
  });
  assert.equal(ownAttendancePatchResponse.status, 200);
  const ownAttendancePatch = await ownAttendancePatchResponse.json();
  assert.equal(ownAttendancePatch.data.status, "LATE");

  const performanceResponse = await fetch(`${baseUrl}/api/v1/manager/performance`, { headers });
  assert.equal(performanceResponse.status, 200);
  const performance = await performanceResponse.json();
  assert.deepEqual(performance.data.map((record) => record.id), ["review-a"]);

  const foreignPerformanceResponse = await fetch(`${baseUrl}/api/v1/manager/performance`, {
    method: "POST",
    headers,
    body: JSON.stringify({ employeeId: "emp-b", departmentId: "dept-b", rating: "A" }),
  });
  assert.equal(foreignPerformanceResponse.status, 403);

  const ownPerformanceResponse = await fetch(`${baseUrl}/api/v1/manager/performance`, {
    method: "POST",
    headers,
    body: JSON.stringify({ employeeId: "emp-a", departmentId: "dept-a", rating: "A", comments: "Strong delivery" }),
  });
  assert.equal(ownPerformanceResponse.status, 201);
  const ownPerformance = await ownPerformanceResponse.json();
  assert.equal(ownPerformance.data.employeeId, "emp-a");

  const foreignTaskResponse = await fetch(`${baseUrl}/api/v1/manager/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Cross department task", employeeId: "emp-b", departmentId: "dept-b" }),
  });
  assert.equal(foreignTaskResponse.status, 403);

  const ownTaskResponse = await fetch(`${baseUrl}/api/v1/manager/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Own department task", employeeId: "emp-a", departmentId: "dept-a" }),
  });
  assert.equal(ownTaskResponse.status, 201);
  const ownTask = await ownTaskResponse.json();
  assert.equal(ownTask.data.departmentId, "dept-a");

  const tasksResponse = await fetch(`${baseUrl}/api/v1/manager/tasks`, { headers });
  assert.equal(tasksResponse.status, 200);
  const tasks = await tasksResponse.json();
  assert.ok(tasks.data.some((task) => task.title === "Own department task"));
  assert.equal(tasks.data.some((task) => task.id === "task-b"), false);

  const overdueTasksResponse = await fetch(`${baseUrl}/api/v1/manager/tasks/overdue`, { headers });
  assert.equal(overdueTasksResponse.status, 200);
  const overdueTasks = await overdueTasksResponse.json();
  assert.deepEqual(overdueTasks.data.map((task) => task.id), ["task-a"]);

  const taskDetailResponse = await fetch(`${baseUrl}/api/v1/manager/tasks/task-a`, { headers });
  assert.equal(taskDetailResponse.status, 200);
  const foreignTaskDetailResponse = await fetch(`${baseUrl}/api/v1/manager/tasks/task-b`, { headers });
  assert.equal(foreignTaskDetailResponse.status, 403);

  const completeTaskResponse = await fetch(`${baseUrl}/api/v1/manager/tasks/task-a/complete`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ completionNote: "Done" }),
  });
  assert.equal(completeTaskResponse.status, 200);
  const completeTask = await completeTaskResponse.json();
  assert.equal(completeTask.data.status, "COMPLETED");

  const targetDetailResponse = await fetch(`${baseUrl}/api/v1/manager/targets/target-a`, { headers });
  assert.equal(targetDetailResponse.status, 200);
  const targetProgressResponse = await fetch(`${baseUrl}/api/v1/manager/targets/target-a/progress`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ progress: 90, currentValue: 90 }),
  });
  assert.equal(targetProgressResponse.status, 200);
  const targetProgress = await targetProgressResponse.json();
  assert.equal(targetProgress.data.progress, 90);
  const completeTargetResponse = await fetch(`${baseUrl}/api/v1/manager/targets/target-a/complete`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ completionNote: "Target reached" }),
  });
  assert.equal(completeTargetResponse.status, 200);
  const completeTarget = await completeTargetResponse.json();
  assert.equal(completeTarget.data.status, "COMPLETED");

  const meetingDetailResponse = await fetch(`${baseUrl}/api/v1/manager/meetings/meeting-a`, { headers });
  assert.equal(meetingDetailResponse.status, 200);
  const foreignMeetingResponse = await fetch(`${baseUrl}/api/v1/manager/meetings/meeting-b`, { headers });
  assert.equal(foreignMeetingResponse.status, 403);
  const rescheduleMeetingResponse = await fetch(`${baseUrl}/api/v1/manager/meetings/meeting-a/reschedule`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ startAt: "2999-01-02T10:00:00.000Z" }),
  });
  assert.equal(rescheduleMeetingResponse.status, 200);
  const rescheduleMeeting = await rescheduleMeetingResponse.json();
  assert.equal(rescheduleMeeting.data.startAt, "2999-01-02T10:00:00.000Z");
  const cancelMeetingResponse = await fetch(`${baseUrl}/api/v1/manager/meetings/meeting-a/cancel`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ reason: "Conflict" }),
  });
  assert.equal(cancelMeetingResponse.status, 200);
  const cancelMeeting = await cancelMeetingResponse.json();
  assert.equal(cancelMeeting.data.status, "CANCELLED");

  const approvalResponse = await fetch(`${baseUrl}/api/v1/manager/approvals`, { headers });
  assert.equal(approvalResponse.status, 200);
  const approvals = await approvalResponse.json();
  assert.ok(approvals.data.some((approval) => approval.entityId === "leave-a"));
  assert.equal(approvals.data.some((approval) => approval.entityId === "leave-b"), false);

  const approveLeaveResponse = await fetch(`${baseUrl}/api/v1/manager/leave/leave-a/approve`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ comment: "Approved by manager" }),
  });
  assert.equal(approveLeaveResponse.status, 200);
  const approveLeaveAgainResponse = await fetch(`${baseUrl}/api/v1/manager/leave/leave-a/approve`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ comment: "Duplicate approval" }),
  });
  assert.equal(approveLeaveAgainResponse.status, 409);

  const superAdminDashboardResponse = await fetch(`${baseUrl}/api/v1/dashboard/super-admin`, { headers });
  assert.equal(superAdminDashboardResponse.status, 403);

  const hrDashboardResponse = await fetch(`${baseUrl}/api/v1/hr/dashboard`, { headers });
  assert.equal(hrDashboardResponse.status, 403);

  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "MANAGER_TASK_CREATED"));
  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "MANAGER_TASK_COMPLETED"));
  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "MANAGER_TARGET_COMPLETED"));
  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "MANAGER_MEETING_CANCELLED"));
  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "MANAGER_ATTENDANCE_CORRECTED"));
  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "MANAGER_LEAVE_APPROVED"));
  assert.ok(readCollection("notifications").some((notification) => notification.type === "LEAVE_REQUEST_APPROVED" && notification.recipientEmployeeId === "emp-a"));
});
