const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-events";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-events-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
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

test("manages event publishing, audience notifications, attendance, sponsors, documents, budgets, and reports", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const departmentResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Engineering", code: "ENG-001", status: "active" }),
  });
  assert.equal(departmentResponse.status, 201);
  const department = await departmentResponse.json();

  const employee = await createEmployee(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Ada",
      lastName: "Nwosu",
      email: "ada.events@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-EVT-001",
      jobTitle: "Software Engineer",
      departmentId: department.data.id,
      department: "Engineering",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "ada.events@example.com",
      initialPassword: "password123",
      role: "employee",
    },
  });
  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  const employeeCreateResponse = await fetch(`${baseUrl}/api/v1/events`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      title: "Unauthorized event",
      type: "TRAINING",
      date: "2026-09-01",
      targetAudienceType: "ALL_STAFF",
      description: "Should fail.",
    }),
  });
  assert.equal(employeeCreateResponse.status, 403);

  const createResponse = await fetch(`${baseUrl}/api/v1/events`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Afresh Annual Staff Retreat",
      type: "RETREAT",
      date: "2026-09-12",
      startTime: "09:00",
      endDate: "2026-09-13",
      endTime: "17:00",
      targetAudienceType: "SPECIFIC_DEPARTMENT",
      departmentId: department.data.id,
      description: "Two-day annual staff retreat.",
      location: "Transcorp Hilton, Abuja",
      virtualLink: "https://meet.example.com/retreat",
      status: "COMPLETED",
      createdBy: employeeUser.id,
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.data.eventCode, /^EVT-\d{4}$/);
  assert.equal(created.data.status, "DRAFT");
  assert.equal(created.data.createdBy, auth.user.id);
  assert.equal(created.data.targetAudienceType, "SPECIFIC_DEPARTMENT");
  assert.equal(created.data.audiences.length, 1);

  const publishResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/publish`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ notify: true }),
  });
  assert.equal(publishResponse.status, 200);
  const published = await publishResponse.json();
  assert.equal(published.data.status, "PUBLISHED");
  assert.equal(published.data.publishedBy, auth.user.id);
  assert.equal(published.meta.notifiedUsers, 1);
  assert.equal(published.meta.attendees, 1);

  const notifications = readCollection("notifications");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].entityType, "EVENT");
  assert.equal(notifications[0].entityId, created.data.id);
  const deliveries = readCollection("notification_deliveries");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].channel, "IN_APP");

  const rsvpResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/rsvp`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ status: "GOING" }),
  });
  assert.equal(rsvpResponse.status, 200);
  const rsvp = await rsvpResponse.json();
  assert.equal(rsvp.data.status, "GOING");

  const activeStart = new Date(Date.now() - 60 * 60 * 1000);
  const activeEnd = new Date(Date.now() + 60 * 60 * 1000);
  const rescheduleResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/reschedule`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      date: activeStart.toISOString().slice(0, 10),
      startTime: activeStart.toISOString().slice(11, 16),
      endDate: activeEnd.toISOString().slice(0, 10),
      endTime: activeEnd.toISOString().slice(11, 16),
      reason: "Testing active event check-in.",
    }),
  });
  assert.equal(rescheduleResponse.status, 200);

  const checkInResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/check-in`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(checkInResponse.status, 200);
  const checkIn = await checkInResponse.json();
  assert.equal(checkIn.data.status, "ATTENDED");
  assert.ok(checkIn.data.checkedInAt);

  const checkOutResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/check-out`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(checkOutResponse.status, 200);

  const sponsorResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/sponsors`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Blue Ocean Bank",
      company: "Blue Ocean Bank",
      email: "events@blueocean.example.com",
      sponsorshipType: "GOLD",
      amount: 2000000,
      currency: "NGN",
      notes: "Retreat headline sponsor.",
    }),
  });
  assert.equal(sponsorResponse.status, 201);
  const sponsor = await sponsorResponse.json();
  assert.equal(sponsor.data.sponsorshipType, "GOLD");
  assert.equal(sponsor.data.sponsor.company, "Blue Ocean Bank");

  const documentResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/documents`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      documentType: "AGENDA",
      fileName: "retreat-agenda.pdf",
      fileUrl: "https://example.com/retreat-agenda.pdf",
    }),
  });
  assert.equal(documentResponse.status, 201);

  const budgetResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/budget`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      estimatedBudget: 5000000,
      approvedBudget: 4500000,
      currency: "NGN",
    }),
  });
  assert.equal(budgetResponse.status, 200);
  const budget = await budgetResponse.json();
  assert.equal(budget.data.approvedBudget, 4500000);
  assert.equal(budget.data.remainingBudget, 4500000);

  const detailsResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}`, { headers: employeeHeaders });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.attendees.length, 1);
  assert.equal(details.data.documents.length, 1);
  assert.equal(details.data.sponsors.length, 1);
  assert.equal(details.data.attendanceStatistics.attended, 1);
  assert.ok(details.data.changeHistory.length >= 1);

  const reportResponse = await fetch(`${baseUrl}/api/v1/events/${created.data.id}/report`, { headers: adminHeaders });
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.data.sponsorContributions, 2000000);
  assert.equal(report.data.attendanceStatistics.attendanceRate, 100);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/events/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.totalEvents, 1);
  assert.equal(dashboard.data.publishedEvents, 1);
  assert.equal(dashboard.data.totalNotifiedStaff, 1);

  const exportResponse = await fetch(`${baseUrl}/api/v1/events/export`, { headers: adminHeaders });
  assert.equal(exportResponse.status, 200);
  const csv = await exportResponse.text();
  assert.match(csv, /Afresh Annual Staff Retreat/);

  const auditLogs = readCollection("audit_logs");
  assert.ok(auditLogs.some((entry) => entry.action === "EVENT_CREATED" && entry.module === "events"));
  assert.ok(auditLogs.some((entry) => entry.action === "EVENT_PUBLISHED" && entry.module === "events"));
  assert.ok(auditLogs.some((entry) => entry.action === "EVENT_CHECKIN" && entry.module === "events"));
});
