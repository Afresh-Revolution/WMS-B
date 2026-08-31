const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-announcements";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-announcements-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

function addDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

async function bootstrapSuperadmin(baseUrl) {
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

async function createEmployee(baseUrl, headers, body) {
  const response = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function createDepartment(baseUrl, headers, name, code) {
  const response = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, code, status: "active" }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("manages announcement lifecycle with audience targeting, recipients, notifications, read tracking, analytics, and audit", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const finance = await createDepartment(baseUrl, adminHeaders, "Finance", "FIN-ANN-001");
  const operations = await createDepartment(baseUrl, adminHeaders, "Operations", "OPS-ANN-001");

  const financeEmployee = await createEmployee(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Ada",
      lastName: "Okonkwo",
      email: "ada.announcements@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-ANN-001",
      jobTitle: "Accountant",
      departmentId: finance.data.id,
      department: "Finance",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "ada.announcements@example.com",
      initialPassword: "password123",
      role: "employee",
    },
  });
  const operationsEmployee = await createEmployee(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Bola",
      lastName: "Ibrahim",
      email: "bola.announcements@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-ANN-002",
      jobTitle: "Operations Analyst",
      departmentId: operations.data.id,
      department: "Operations",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "bola.announcements@example.com",
      initialPassword: "password123",
      role: "employee",
    },
  });

  const financeUser = getUserById(financeEmployee.data.userId);
  const operationsUser = getUserById(operationsEmployee.data.userId);
  const financeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(financeUser)}`,
  };
  const operationsHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(operationsUser)}`,
  };

  const unauthorizedResponse = await fetch(`${baseUrl}/api/v1/announcements/admin`, {
    method: "POST",
    headers: financeHeaders,
    body: JSON.stringify({ title: "Nope", message: "Should fail.", audienceType: "all_staff" }),
  });
  assert.equal(unauthorizedResponse.status, 403);

  const draftResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/drafts`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Company Retreat",
      category: "Events",
      audienceType: "all_staff",
      message: "Our annual retreat will hold in September.",
      priority: "normal",
      status: "published",
    }),
  });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal(draft.data.status, "draft");
  assert.equal(readCollection("announcement_recipients").length, 0);
  assert.equal(readCollection("notifications").length, 0);

  const publishDraftResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${draft.data.id}/publish`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ notify: true }),
  });
  assert.equal(publishDraftResponse.status, 200);
  const publishedDraft = await publishDraftResponse.json();
  assert.equal(publishedDraft.data.status, "published");
  assert.equal(publishedDraft.data.publishedBy, auth.user.id);
  assert.equal(publishedDraft.meta.recipients, 2);
  assert.equal(publishedDraft.meta.notifications, 2);

  const duplicatePublishResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${draft.data.id}/publish`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(duplicatePublishResponse.status, 409);

  const financeUnreadBeforeResponse = await fetch(`${baseUrl}/api/v1/announcements/unread-count`, { headers: financeHeaders });
  assert.equal(financeUnreadBeforeResponse.status, 200);
  const financeUnreadBefore = await financeUnreadBeforeResponse.json();
  assert.equal(financeUnreadBefore.data.count, 1);

  const financeFeedResponse = await fetch(`${baseUrl}/api/v1/announcements`, { headers: financeHeaders });
  assert.equal(financeFeedResponse.status, 200);
  const financeFeed = await financeFeedResponse.json();
  assert.equal(financeFeed.data.length, 1);
  assert.equal(financeFeed.data[0].title, "Company Retreat");

  const readResponse = await fetch(`${baseUrl}/api/v1/announcements/${draft.data.id}/read`, {
    method: "PATCH",
    headers: financeHeaders,
    body: JSON.stringify({ employeeId: operationsEmployee.data.id }),
  });
  assert.equal(readResponse.status, 200);
  const readReceipt = await readResponse.json();
  assert.equal(readReceipt.data.employeeId, financeEmployee.data.id);
  assert.equal(readReceipt.data.isRead, true);

  const departmentPublishResponse = await fetch(`${baseUrl}/api/v1/announcements/admin`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "July Payroll Processing",
      category: "Finance",
      audienceType: "department",
      departmentId: finance.data.id,
      message: "The July payroll will be processed today.",
      priority: "important",
      isPinned: true,
      status: "published",
      createdBy: operationsUser.id,
    }),
  });
  assert.equal(departmentPublishResponse.status, 201);
  const departmentAnnouncement = await departmentPublishResponse.json();
  assert.match(departmentAnnouncement.data.announcementCode, /^ANN-\d{4}$/);
  assert.equal(departmentAnnouncement.data.status, "published");
  assert.equal(departmentAnnouncement.data.createdBy, auth.user.id);
  assert.equal(departmentAnnouncement.data.isPinned, true);
  assert.equal(departmentAnnouncement.meta.recipients, 1);

  const operationsFeedResponse = await fetch(`${baseUrl}/api/v1/announcements`, { headers: operationsHeaders });
  assert.equal(operationsFeedResponse.status, 200);
  const operationsFeed = await operationsFeedResponse.json();
  assert.equal(operationsFeed.data.some((announcement) => announcement.id === departmentAnnouncement.data.id), false);

  const financeUnreadAfterResponse = await fetch(`${baseUrl}/api/v1/announcements/unread-count`, { headers: financeHeaders });
  assert.equal(financeUnreadAfterResponse.status, 200);
  const financeUnreadAfter = await financeUnreadAfterResponse.json();
  assert.equal(financeUnreadAfter.data.count, 1);

  const recipientsResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${departmentAnnouncement.data.id}/recipients`, {
    headers: adminHeaders,
  });
  assert.equal(recipientsResponse.status, 200);
  const recipients = await recipientsResponse.json();
  assert.equal(recipients.data.length, 1);
  assert.equal(recipients.data[0].employeeId, financeEmployee.data.id);

  const analyticsResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${departmentAnnouncement.data.id}/analytics`, {
    headers: adminHeaders,
  });
  assert.equal(analyticsResponse.status, 200);
  const analytics = await analyticsResponse.json();
  assert.equal(analytics.data.recipients, 1);
  assert.equal(analytics.data.delivered, 1);
  assert.equal(analytics.data.read, 0);
  assert.equal(analytics.data.unread, 1);
  assert.equal(analytics.data.readPercentage, 0);
  assert.equal(analytics.data.departmentBreakdown[0].departmentId, finance.data.id);

  const unpinResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${departmentAnnouncement.data.id}/unpin`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(unpinResponse.status, 200);
  const unpinned = await unpinResponse.json();
  assert.equal(unpinned.data.isPinned, false);

  const updateResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${departmentAnnouncement.data.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ title: "July Payroll Processing Update", priority: "urgent" }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.data.title, "July Payroll Processing Update");
  assert.equal(updated.data.priority, "urgent");

  const detailsResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${departmentAnnouncement.data.id}`, {
    headers: adminHeaders,
  });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.analytics.recipients, 1);
  assert.ok(details.data.auditHistory.some((entry) => entry.action === "UPDATED_PUBLISHED"));

  const scheduleResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${draft.data.id}/schedule`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ scheduledAt: addDays(2) }),
  });
  assert.equal(scheduleResponse.status, 409);

  const scheduledDraftResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/drafts`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Security Maintenance",
      category: "Security",
      audienceType: "multiple_departments",
      departmentIds: [finance.data.id, operations.data.id],
      message: "Badges will be rotated next week.",
      priority: "important",
    }),
  });
  assert.equal(scheduledDraftResponse.status, 201);
  const scheduledDraft = await scheduledDraftResponse.json();
  const scheduleNewResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${scheduledDraft.data.id}/schedule`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ scheduledAt: addDays(3) }),
  });
  assert.equal(scheduleNewResponse.status, 200);
  const scheduled = await scheduleNewResponse.json();
  assert.equal(scheduled.data.status, "scheduled");

  const archiveResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${departmentAnnouncement.data.id}/archive`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(archiveResponse.status, 200);
  const archived = await archiveResponse.json();
  assert.equal(archived.data.status, "archived");

  const deleteResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${scheduledDraft.data.id}`, {
    method: "DELETE",
    headers: adminHeaders,
    body: JSON.stringify({ reason: "Superseded by a different memo." }),
  });
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  assert.equal(deleted.data.status, "deleted");
  assert.equal(deleted.data.deletedBy, auth.user.id);

  const auditLogsResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/${departmentAnnouncement.data.id}/audit-logs`, {
    headers: adminHeaders,
  });
  assert.equal(auditLogsResponse.status, 200);
  const auditLogs = await auditLogsResponse.json();
  assert.ok(auditLogs.data.length >= 1);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.totalAnnouncements, 2);
  assert.equal(dashboard.data.archived, 1);

  const exportResponse = await fetch(`${baseUrl}/api/v1/announcements/admin/export`, { headers: adminHeaders });
  assert.equal(exportResponse.status, 200);
  const csv = await exportResponse.text();
  assert.match(csv, /announcementCode/);
  assert.match(csv, /Company Retreat/);

  const notifications = readCollection("notifications");
  assert.equal(notifications.filter((notification) => notification.referenceType === "announcement").length, 3);
  const deliveries = readCollection("notification_deliveries");
  assert.equal(deliveries.length, 3);
});
