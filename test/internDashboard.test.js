const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-intern-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { readCollection, writeCollection } = require("../src/database/jsonStore");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-intern-dashboard-"));
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

test("intern dashboard follows self-service placement UI flow and blocks other placements", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const internUser = createUser({
    name: "Chidi Eze",
    email: "chidi.intern@example.com",
    passwordHash: hashPassword("password123"),
    role: "nysc_intern",
    roleId: "nysc_intern",
    status: "active",
    departmentId: "dept-engineering",
    organizationId: "org-1",
  });
  const otherInternUser = createUser({
    name: "Other Intern",
    email: "other.intern@example.com",
    passwordHash: hashPassword("password123"),
    role: "nysc_intern",
    roleId: "nysc_intern",
    status: "active",
    departmentId: "dept-finance",
    organizationId: "org-1",
  });
  const employeeUser = createUser({
    name: "Employee",
    email: "employee.intern-test@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    roleId: "employee",
    status: "active",
    departmentId: "dept-engineering",
    organizationId: "org-1",
  });

  seed("departments", [
    { id: "dept-engineering", name: "Software Engineering", organizationId: "org-1", status: "active" },
    { id: "dept-finance", name: "Finance", organizationId: "org-1", status: "active" },
  ]);
  seed("employees", [
    { id: "emp-supervisor", fullName: "Omar Reyes", email: "omar@example.com", userId: "user-supervisor", departmentId: "dept-engineering", organizationId: "org-1", status: "active" },
  ]);
  seed("nysc_intern_profiles", [
    { id: "profile-chidi", profileNumber: "INT-2026-0001", fullName: "Chidi Eze", email: "chidi.intern@example.com", userId: internUser.id, type: "INTERN", institution: "Covenant University", courseOfStudy: "Software Engineering", phone: "08030000000", status: "ACTIVE", organizationId: "org-1" },
    { id: "profile-other", profileNumber: "NYSC-2026-0002", fullName: "Other Intern", email: "other.intern@example.com", userId: otherInternUser.id, type: "NYSC", institution: "Babcock University", courseOfStudy: "Accounting", status: "ACTIVE", organizationId: "org-1" },
  ]);
  seed("placements", [
    { id: "placement-chidi", profileId: "profile-chidi", departmentId: "dept-engineering", departmentName: "Software Engineering", startDate: isoDate(-20), expectedEndDate: isoDate(70), placementStatus: "ACTIVE", role: "Backend Trainee", workLocation: "Lagos Office", organizationId: "org-1" },
    { id: "placement-other", profileId: "profile-other", departmentId: "dept-finance", departmentName: "Finance", startDate: isoDate(-20), expectedEndDate: isoDate(70), placementStatus: "ACTIVE", role: "Finance Intern", organizationId: "org-1" },
  ]);
  seed("placement_supervisors", [
    { id: "supervisor-chidi", placementId: "placement-chidi", employeeId: "emp-supervisor", isActive: true },
  ]);
  seed("tasks", [
    { id: "task-chidi", title: "Build onboarding endpoint", assignedToProfileId: "profile-chidi", placementId: "placement-chidi", organizationId: "org-1", status: "IN_PROGRESS", dueDate: isoDate(4), progress: 30 },
    { id: "task-other", title: "Prepare finance schedule", assignedToProfileId: "profile-other", placementId: "placement-other", organizationId: "org-1", status: "PENDING", dueDate: isoDate(4), progress: 0 },
  ]);
  seed("targets", [
    { id: "target-chidi", title: "Complete API training", profileId: "profile-chidi", placementId: "placement-chidi", organizationId: "org-1", targetValue: 100, currentValue: 45, progress: 45, status: "ACTIVE" },
    { id: "target-other", title: "Complete finance training", profileId: "profile-other", placementId: "placement-other", organizationId: "org-1", targetValue: 100, currentValue: 20, progress: 20, status: "ACTIVE" },
  ]);
  seed("meetings", [
    { id: "meeting-chidi", title: "Weekly mentor sync", placementId: "placement-chidi", organizationId: "org-1", departmentId: "dept-engineering", status: "SCHEDULED", startAt: `${isoDate(3)}T09:00:00.000Z` },
    { id: "meeting-other", title: "Finance review", placementId: "placement-other", organizationId: "org-1", departmentId: "dept-finance", status: "SCHEDULED", startAt: `${isoDate(3)}T09:00:00.000Z` },
  ]);
  seed("placement_attendance", [
    { id: "attendance-chidi", placementId: "placement-chidi", date: isoDate(-1), status: "PRESENT", checkIn: "09:00" },
  ]);
  seed("placement_reviews", [
    { id: "review-chidi", placementId: "placement-chidi", reviewPeriod: "MID_PLACEMENT", overallScore: 82, recommendation: "CONTINUE" },
  ]);
  seed("placement_documents", [
    { id: "document-chidi", profileId: "profile-chidi", placementId: "placement-chidi", documentType: "ACCEPTANCE_LETTER", fileName: "acceptance-letter.pdf", fileUrl: "https://secure.example.com/acceptance-letter.pdf" },
  ]);
  seed("announcements", [
    { id: "announcement-company", title: "Company town hall", message: "All hands this Friday", status: "published", audienceType: "all_staff", organizationId: "org-1", publishedAt: `${isoDate(-1)}T10:00:00.000Z` },
    { id: "announcement-dept", title: "Engineering demo day", message: "Bring your demo", status: "published", audienceType: "department", departmentId: "dept-engineering", organizationId: "org-1", publishedAt: `${isoDate(-1)}T11:00:00.000Z` },
    { id: "announcement-hidden", title: "Finance only", message: "Finance update", status: "published", audienceType: "department", departmentId: "dept-finance", organizationId: "org-1", publishedAt: `${isoDate(-1)}T12:00:00.000Z` },
  ]);
  seed("announcement_audiences", [
    { id: "audience-company", announcementId: "announcement-company", audienceType: "all_staff" },
    { id: "audience-dept", announcementId: "announcement-dept", audienceType: "department", departmentId: "dept-engineering" },
    { id: "audience-hidden", announcementId: "announcement-hidden", audienceType: "department", departmentId: "dept-finance" },
  ]);
  seed("notifications", [
    { id: "notification-chidi", recipientUserId: internUser.id, type: "PLACEMENT_ENDING", title: "Placement update", status: "unread" },
  ]);

  const headers = authHeaders(internUser);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/intern/dashboard`, { headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.profile.fullName, "Chidi Eze");
  assert.equal(dashboard.data.metrics.assignedTasks, 1);
  assert.equal(dashboard.data.metrics.upcomingMeetings, 1);
  assert.equal(dashboard.data.metrics.documents, 1);
  assert.equal(dashboard.data.metrics.news, 2);
  assert.ok(dashboard.data.navigation.includes("Placement Progress"));
  assert.equal(dashboard.data.assignedToMe.some((task) => task.id === "task-other"), false);

  const recordResponse = await fetch(`${baseUrl}/api/v1/intern/placement-record`, { headers });
  assert.equal(recordResponse.status, 200);
  const record = await recordResponse.json();
  assert.equal(record.data.supervisor, undefined);
  assert.equal(record.data.overview.supervisor.fullName, "Omar Reyes");
  assert.equal(record.data.documents.length, 1);
  assert.equal(record.data.reviews.length, 1);
  assert.equal(record.data.tasks.length, 1);

  const forbiddenProfileResponse = await fetch(`${baseUrl}/api/v1/intern/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ placementStatus: "COMPLETED" }),
  });
  assert.equal(forbiddenProfileResponse.status, 403);

  const taskProgressResponse = await fetch(`${baseUrl}/api/v1/intern/tasks/task-chidi/progress`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ progress: 75, note: "API flow is wired", placementId: "placement-other" }),
  });
  assert.equal(taskProgressResponse.status, 200);
  const taskProgress = await taskProgressResponse.json();
  assert.equal(taskProgress.data.progress, 75);
  assert.equal(taskProgress.data.placementId, "placement-chidi");

  const foreignTaskResponse = await fetch(`${baseUrl}/api/v1/intern/tasks/task-other/progress`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ progress: 50 }),
  });
  assert.equal(foreignTaskResponse.status, 403);

  const targetProgressResponse = await fetch(`${baseUrl}/api/v1/intern/targets/target-chidi/progress`, {
    method: "POST",
    headers,
    body: JSON.stringify({ value: 80, note: "Training modules almost done" }),
  });
  assert.equal(targetProgressResponse.status, 201);
  const targetProgress = await targetProgressResponse.json();
  assert.equal(targetProgress.data.progress, 80);

  const foreignTargetResponse = await fetch(`${baseUrl}/api/v1/intern/targets/target-other/progress`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ value: 70 }),
  });
  assert.equal(foreignTargetResponse.status, 403);

  const attendanceResponse = await fetch(`${baseUrl}/api/v1/intern/attendance`, {
    method: "POST",
    headers,
    body: JSON.stringify({ date: isoDate(0), checkIn: "09:02", status: "PRESENT" }),
  });
  assert.equal(attendanceResponse.status, 201);
  const attendance = await attendanceResponse.json();
  assert.equal(attendance.data.placementId, "placement-chidi");

  const newsResponse = await fetch(`${baseUrl}/api/v1/intern/news`, { headers });
  assert.equal(newsResponse.status, 200);
  const news = await newsResponse.json();
  assert.equal(news.data.length, 2);
  assert.equal(news.data.some((item) => item.id === "announcement-hidden"), false);

  const aliasResponse = await fetch(`${baseUrl}/api/nysc-intern/dashboard`, { headers });
  assert.equal(aliasResponse.status, 200);

  const employeeResponse = await fetch(`${baseUrl}/api/v1/intern/dashboard`, { headers: authHeaders(employeeUser) });
  assert.equal(employeeResponse.status, 403);

  const auditLogs = readCollection("audit_logs");
  assert.ok(auditLogs.some((entry) => entry.action === "INTERN_TASK_PROGRESS_UPDATED"));
  assert.ok(auditLogs.some((entry) => entry.action === "INTERN_TARGET_PROGRESS_UPDATED"));
  assert.ok(auditLogs.some((entry) => entry.action === "INTERN_ATTENDANCE_RECORDED"));
});
