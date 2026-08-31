const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-discipline";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-discipline-"));
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

test("manages disciplinary case lifecycle with confidential evidence, acknowledgement, appeal, closure, and audit trail", async (t) => {
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
    body: JSON.stringify({ name: "Fashion", code: "FASH-001", status: "active" }),
  });
  assert.equal(departmentResponse.status, 201);
  const department = await departmentResponse.json();

  const employeeResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Theo",
        lastName: "Grant",
        email: "theo.discipline@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-DISC-001",
        jobTitle: "Designer",
        departmentId: department.data.id,
        department: "Fashion",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email: "theo.discipline@example.com",
        initialPassword: "password123",
        role: "employee",
      },
    }),
  });
  assert.equal(employeeResponse.status, 201);
  const employee = await employeeResponse.json();
  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  const employeeCreateResponse = await fetch(`${baseUrl}/api/v1/discipline/cases`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      employeeId: employee.data.id,
      actionType: "WRITTEN_WARNING",
      description: "Attempted self-created case.",
      incidentDate: "2026-07-24",
    }),
  });
  assert.equal(employeeCreateResponse.status, 403);

  const createResponse = await fetch(`${baseUrl}/api/v1/discipline/cases`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      employeeId: employee.data.id,
      caseNumber: "DISC-FRONTEND-FAKE",
      status: "CLOSED",
      actionType: "WRITTEN_WARNING",
      severity: "MEDIUM",
      title: "Weekly report non-compliance",
      description: "Persistent failure to submit weekly reports.",
      incidentDate: "2026-07-24",
      location: "Head office",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.data.caseNumber, /^DISC-\d{4}-\d{4}$/);
  assert.notEqual(created.data.caseNumber, "DISC-FRONTEND-FAKE");
  assert.equal(created.data.status, "OPEN");
  assert.equal(created.data.employeeId, employee.data.id);
  assert.equal(created.data.actions.length, 1);
  assert.equal(created.meta.action.actionType, "WRITTEN_WARNING");

  const evidenceResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/evidence`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      fileName: "weekly-report-thread.pdf",
      fileUrl: "https://secure.example.com/evidence/weekly-report-thread.pdf",
      fileType: "application/pdf",
      fileSize: 2048,
      description: "Email thread showing missed reports.",
    }),
  });
  assert.equal(evidenceResponse.status, 201);
  const evidence = await evidenceResponse.json();

  const noteResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/notes`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ note: "Manager confirmed repeated missed submissions.", visibility: "RESTRICTED" }),
  });
  assert.equal(noteResponse.status, 201);

  const employeeDetailResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}`, { headers: employeeHeaders });
  assert.equal(employeeDetailResponse.status, 200);
  const employeeDetail = await employeeDetailResponse.json();
  assert.equal(employeeDetail.data.evidence.length, 0);
  assert.equal(employeeDetail.data.notes.length, 0);
  assert.equal(employeeDetail.data.actions.length, 1);

  const employeeEvidenceResponse = await fetch(`${baseUrl}/api/v1/discipline/evidence/${evidence.data.id}/download`, { headers: employeeHeaders });
  assert.equal(employeeEvidenceResponse.status, 403);

  const downloadResponse = await fetch(`${baseUrl}/api/v1/discipline/evidence/${evidence.data.id}/download`, { headers: adminHeaders });
  assert.equal(downloadResponse.status, 200);
  const download = await downloadResponse.json();
  assert.equal(download.data.downloadUrl, "https://secure.example.com/evidence/weekly-report-thread.pdf");

  const investigateResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/investigate`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ note: "Investigation opened." }),
  });
  assert.equal(investigateResponse.status, 200);
  const investigating = await investigateResponse.json();
  assert.equal(investigating.data.status, "UNDER_INVESTIGATION");

  const hearingResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/hearings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      scheduledDate: "2026-07-27T10:00:00.000Z",
      location: "HR office",
      chairpersonId: auth.user.id,
      participants: [{ userId: employeeUser.id, participantType: "EMPLOYEE" }],
    }),
  });
  assert.equal(hearingResponse.status, 201);
  const hearing = await hearingResponse.json();
  assert.equal(hearing.data.participants.length, 1);

  const acknowledgeResponse = await fetch(`${baseUrl}/api/v1/discipline/actions/${created.meta.action.id}/acknowledge`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ signature: "Theo Grant", comment: "Acknowledged." }),
  });
  assert.equal(acknowledgeResponse.status, 200);
  const acknowledgement = await acknowledgeResponse.json();
  assert.equal(acknowledgement.data.status, "ACKNOWLEDGED");
  assert.equal(acknowledgement.data.acknowledged, true);

  const appealResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/appeals`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ reason: "I submitted one of the weekly reports by email." }),
  });
  assert.equal(appealResponse.status, 201);
  const appeal = await appealResponse.json();
  assert.equal(appeal.data.status, "SUBMITTED");
  assert.equal(appeal.meta.case.status, "APPEAL_PENDING");

  const reviewAppealResponse = await fetch(`${baseUrl}/api/v1/discipline/appeals/${appeal.data.id}/review`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ decision: "REJECTED", decisionNotes: "Evidence still supports the warning." }),
  });
  assert.equal(reviewAppealResponse.status, 200);
  const reviewedAppeal = await reviewAppealResponse.json();
  assert.equal(reviewedAppeal.data.status, "REJECTED");

  const secondActionResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/actions`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      actionType: "STRIKE",
      severity: "HIGH",
      description: "Escalated after appeal review.",
      effectiveDate: "2026-07-28",
    }),
  });
  assert.equal(secondActionResponse.status, 201);
  const secondAction = await secondActionResponse.json();
  assert.equal(secondAction.data.actionType, "STRIKE");

  const revokeResponse = await fetch(`${baseUrl}/api/v1/discipline/actions/${secondAction.data.id}/revoke`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ reason: "Escalation entered on the wrong case." }),
  });
  assert.equal(revokeResponse.status, 200);
  const revoked = await revokeResponse.json();
  assert.equal(revoked.data.status, "REVOKED");

  const resolveResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/resolve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ resolution: "Written warning remains active for the policy period." }),
  });
  assert.equal(resolveResponse.status, 200);
  const resolved = await resolveResponse.json();
  assert.equal(resolved.data.status, "RESOLVED");

  const closeResponse = await fetch(`${baseUrl}/api/v1/discipline/cases/${created.data.id}/close`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ note: "Case closed after appeal review." }),
  });
  assert.equal(closeResponse.status, 200);
  const closed = await closeResponse.json();
  assert.equal(closed.data.status, "CLOSED");
  assert.ok(closed.data.closedAt);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/discipline/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.openCases, 0);
  assert.equal(dashboard.data.closedThisYear, 1);
  assert.equal(dashboard.data.warnings, 1);
  assert.equal(dashboard.data.strikes, 1);

  const historyResponse = await fetch(`${baseUrl}/api/v1/employees/${employee.data.id}/disciplinary-history`, { headers: adminHeaders });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.data.totalCases, 1);
  assert.equal(history.data.closedCases, 1);
  assert.equal(history.data.cases[0].timeline.some((entry) => entry.action === "APPEAL_SUBMITTED"), true);

  const exportResponse = await fetch(`${baseUrl}/api/v1/discipline/export`, { headers: adminHeaders });
  assert.equal(exportResponse.status, 200);
  const csv = await exportResponse.text();
  assert.match(csv, /DISC-\d{4}-\d{4}/);
  assert.match(csv, /Theo Grant/);

  const auditLogs = readCollection("audit_logs");
  assert.ok(auditLogs.some((entry) => entry.action === "DISCIPLINARY_CASE_CREATED" && entry.module === "discipline"));
  assert.ok(auditLogs.some((entry) => entry.action === "DISCIPLINARY_EVIDENCE_VIEWED" && entry.module === "discipline"));
  assert.ok(auditLogs.some((entry) => entry.action === "DISCIPLINARY_CASE_CLOSED" && entry.module === "discipline"));
});
