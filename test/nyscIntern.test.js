const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-nysc-intern";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-nysc-intern-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

function addDays(days) {
  const date = new Date(Date.now() + days * 86400000);
  return date.toISOString().slice(0, 10);
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

test("manages NYSC/intern placement lifecycle with calculated progress, supervisor, attendance, reviews, exit, conversion, and audit trace", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const engineeringResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Software Engineering", code: "SWE-001", status: "active" }),
  });
  assert.equal(engineeringResponse.status, 201);
  const engineering = await engineeringResponse.json();

  const productResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Product", code: "PROD-001", status: "active" }),
  });
  assert.equal(productResponse.status, 201);
  const product = await productResponse.json();

  const supervisor = await createEmployee(baseUrl, adminHeaders, {
    staffType: "employee",
    personalInformation: {
      firstName: "Omar",
      lastName: "Reyes",
      email: "omar.supervisor@example.com",
    },
    employmentInformation: {
      employeeId: "EMP-NYSC-001",
      jobTitle: "Engineering Lead",
      departmentId: engineering.data.id,
      department: "Software Engineering",
      employmentType: "Full-time",
      status: "active",
    },
    systemAccess: {
      createAccount: true,
      email: "omar.supervisor@example.com",
      initialPassword: "password123",
      role: "department_manager",
    },
  });
  const supervisorUser = getUserById(supervisor.data.userId);
  const supervisorHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(supervisorUser)}`,
  };

  const createResponse = await fetch(`${baseUrl}/api/v1/nysc-interns`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fullName: "Chidi Eze",
      profileNumber: "FRONTEND-FAKE",
      type: "NYSC",
      institution: "Covenant University",
      courseOfStudy: "Software Engineering",
      email: "chidi.nysc@example.com",
      phone: "08030000000",
      startDate: addDays(-10),
      endDate: addDays(20),
      departmentId: engineering.data.id,
      role: "Backend Trainee",
      workLocation: "Lagos Office",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.data.profile.profileNumber, /^NYSC-\d{4}-\d{4}$/);
  assert.notEqual(created.data.profile.profileNumber, "FRONTEND-FAKE");
  assert.equal(created.data.profile.type, "NYSC");
  assert.equal(created.data.placement.departmentId, engineering.data.id);
  assert.equal(created.data.placement.placementStatus, "ENDING_SOON");
  assert.ok(created.data.placement.progress.progressPercentage > 0);
  assert.ok(created.data.placement.progress.daysRemaining <= 30);

  const duplicateResponse = await fetch(`${baseUrl}/api/v1/nysc-interns`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fullName: "Chidi Eze",
      type: "NYSC",
      institution: "Covenant University",
      courseOfStudy: "Software Engineering",
      email: "chidi.nysc@example.com",
      startDate: addDays(1),
      endDate: addDays(60),
      departmentId: engineering.data.id,
    }),
  });
  assert.equal(duplicateResponse.status, 409);

  const supervisorResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/supervisor`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ employeeId: supervisor.data.id }),
  });
  assert.equal(supervisorResponse.status, 200);
  const supervisorAssignment = await supervisorResponse.json();
  assert.equal(supervisorAssignment.data.employeeId, supervisor.data.id);

  const supervisorDetailsResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}`, { headers: supervisorHeaders });
  assert.equal(supervisorDetailsResponse.status, 200);
  const supervisorDetails = await supervisorDetailsResponse.json();
  assert.equal(supervisorDetails.data.supervisor.id, supervisor.data.id);

  const departmentChangeResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/department`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ departmentId: product.data.id }),
  });
  assert.equal(departmentChangeResponse.status, 200);
  const departmentChanged = await departmentChangeResponse.json();
  assert.equal(departmentChanged.data.department.id, product.data.id);

  const attendanceResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/attendance`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      date: addDays(0),
      checkIn: "09:05",
      checkOut: "17:10",
      status: "PRESENT",
      notes: "Worked on onboarding API.",
    }),
  });
  assert.equal(attendanceResponse.status, 201);
  const attendance = await attendanceResponse.json();
  assert.equal(attendance.data.status, "PRESENT");

  const duplicateAttendanceResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/attendance`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ date: addDays(0), status: "REMOTE" }),
  });
  assert.equal(duplicateAttendanceResponse.status, 409);

  const attendancePatchResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/attendance/${attendance.data.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ status: "REMOTE", notes: "Remote project work approved." }),
  });
  assert.equal(attendancePatchResponse.status, 200);
  const attendancePatch = await attendancePatchResponse.json();
  assert.equal(attendancePatch.data.status, "REMOTE");

  const documentResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/documents`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      documentType: "NYSC_POSTING_LETTER",
      fileName: "posting-letter.pdf",
      fileUrl: "https://secure.example.com/posting-letter.pdf",
      fileType: "application/pdf",
      fileSize: 4096,
    }),
  });
  assert.equal(documentResponse.status, 201);
  const document = await documentResponse.json();

  const downloadResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/documents/${document.data.id}/download`, { headers: adminHeaders });
  assert.equal(downloadResponse.status, 200);
  const download = await downloadResponse.json();
  assert.equal(download.data.downloadUrl, "https://secure.example.com/posting-letter.pdf");

  const reviewResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/reviews`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      reviewPeriod: "MID_PLACEMENT",
      attendanceScore: 80,
      performanceScore: 85,
      teamworkScore: 90,
      communicationScore: 75,
      technicalScore: 88,
      strengths: "Learns quickly",
      weaknesses: "Needs more documentation discipline",
      comments: "Strong midpoint review.",
      recommendation: "CONTINUE",
    }),
  });
  assert.equal(reviewResponse.status, 201);
  const review = await reviewResponse.json();
  assert.equal(review.data.overallScore, 83.6);

  const extendResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/extend`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ newEndDate: addDays(60), reason: "Additional project training period" }),
  });
  assert.equal(extendResponse.status, 200);
  const extended = await extendResponse.json();
  assert.equal(extended.data.placement.expectedEndDate, addDays(60));

  const summaryResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/reports/summary`, { headers: adminHeaders });
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json();
  assert.equal(summary.data.totalPlacements, 1);
  assert.equal(summary.data.departments[0].total, 1);
  assert.equal(summary.data.averagePerformance, 83.6);

  const completeResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/complete`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      exitDate: addDays(60),
      reason: "Placement completed successfully",
      certificateIssued: true,
      eligibleForEmployment: true,
    }),
  });
  assert.equal(completeResponse.status, 200);
  const completed = await completeResponse.json();
  assert.equal(completed.data.exitType, "COMPLETED");
  assert.match(completed.data.certificateNumber, /^CERT-\d{4}-\d{4}$/);
  assert.equal(completed.data.placement.placementStatus, "COMPLETED");

  const conversionResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}/convert-to-employee`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ employeeId: "EMP-CONV-001", jobTitle: "Junior Backend Engineer" }),
  });
  assert.equal(conversionResponse.status, 201);
  const conversion = await conversionResponse.json();
  assert.equal(conversion.data.employeeId, "EMP-CONV-001");
  assert.equal(conversion.data.convertedFromProfileId, created.data.profile.id);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.completed, 1);
  assert.equal(dashboard.data.totalPlacements, 1);

  const detailsResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/${created.data.profile.id}`, { headers: adminHeaders });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.documents.length, 1);
  assert.equal(details.data.attendance.length, 1);
  assert.equal(details.data.reviews.length, 1);
  assert.equal(details.data.history.some((entry) => entry.eventType === "PLACEMENT_COMPLETED"), true);

  const exportResponse = await fetch(`${baseUrl}/api/v1/nysc-interns/export`, { headers: adminHeaders });
  assert.equal(exportResponse.status, 200);
  const csv = await exportResponse.text();
  assert.match(csv, /Chidi Eze/);
  assert.match(csv, /NYSC-/);

  const legacyNysc = readCollection("nysc_members");
  assert.equal(legacyNysc.length, 1);
  assert.equal(legacyNysc[0].profileId, created.data.profile.id);

  const auditLogs = readCollection("audit_logs");
  assert.ok(auditLogs.some((entry) => entry.action === "NYSC_CREATED" && entry.module === "nysc_intern"));
  assert.ok(auditLogs.some((entry) => entry.action === "DOCUMENT_VIEWED" && entry.module === "nysc_intern"));
  assert.ok(auditLogs.some((entry) => entry.action === "EMPLOYEE_CONVERSION" && entry.module === "nysc_intern"));
});
