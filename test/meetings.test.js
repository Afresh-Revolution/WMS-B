const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-meetings";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { readCollection } = require("../src/database/jsonStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-meetings-"));
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

async function createEmployee(baseUrl, headers, email, employeeId) {
  const response = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: email.split(".")[0],
        lastName: "Meeting",
        email,
      },
      employmentInformation: {
        employeeId,
        jobTitle: "Coordinator",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email,
        initialPassword: "password123",
        role: "employee",
      },
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("manages meetings with participants, room conflicts, minutes, action items, attendance, and reports", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const participant = await createEmployee(baseUrl, adminHeaders, "participant.meeting@example.com", "EMP-MEET-001");
  const participantUser = getUserById(participant.data.userId);
  const participantHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(participantUser)}`,
  };

  const typesResponse = await fetch(`${baseUrl}/api/v1/meeting-types`, { headers: adminHeaders });
  assert.equal(typesResponse.status, 200);
  const types = await typesResponse.json();
  const inPerson = types.data.find((type) => type.code === "IN_PERSON");
  assert.ok(inPerson);

  const roomResponse = await fetch(`${baseUrl}/api/v1/meeting-rooms`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Boardroom A",
      building: "HQ",
      capacity: 20,
      location: "First floor",
      equipment: ["screen"],
    }),
  });
  assert.equal(roomResponse.status, 201);
  const room = await roomResponse.json();

  const createResponse = await fetch(`${baseUrl}/api/v1/meetings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Q3 Planning Session",
      date: "2026-08-20",
      startTime: "10:00",
      endTime: "10:30",
      durationMinutes: 999,
      meetingTypeId: inPerson.id,
      meetingRoomId: room.data.id,
      participantIds: [participant.data.userId, participant.data.userId],
      agenda: [
        { title: "Q2 review", description: "Review Q2 performance", orderNumber: 1 },
        { title: "Q3 objectives", description: "Set objectives", orderNumber: 2 },
      ],
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.data.durationMinutes, 30);
  assert.equal(created.data.status, "SCHEDULED");
  assert.equal(created.data.participants.length, 2);
  assert.equal(created.data.agenda.length, 2);

  const conflictResponse = await fetch(`${baseUrl}/api/v1/meetings`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Overlapping Room Booking",
      date: "2026-08-20",
      startTime: "10:15",
      endTime: "10:45",
      meetingTypeId: inPerson.id,
      meetingRoomId: room.data.id,
    }),
  });
  assert.equal(conflictResponse.status, 409);

  const respondResponse = await fetch(`${baseUrl}/api/v1/meetings/${created.data.id}/respond`, {
    method: "POST",
    headers: participantHeaders,
    body: JSON.stringify({ status: "ACCEPTED" }),
  });
  assert.equal(respondResponse.status, 200);

  const minutesResponse = await fetch(`${baseUrl}/api/v1/meetings/${created.data.id}/minutes`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ content: "Q3 priorities were agreed." }),
  });
  assert.equal(minutesResponse.status, 201);

  const actionItemResponse = await fetch(`${baseUrl}/api/v1/meetings/${created.data.id}/action-items`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      title: "Prepare Q3 roadmap",
      assignedTo: participant.data.userId,
      dueDate: "2026-08-25",
    }),
  });
  assert.equal(actionItemResponse.status, 201);
  const actionItem = await actionItemResponse.json();
  assert.ok(actionItem.data.taskId);
  assert.equal(readCollection("tasks").find((task) => task.id === actionItem.data.taskId).meetingId, created.data.id);

  const attendanceResponse = await fetch(`${baseUrl}/api/v1/meetings/${created.data.id}/attendance`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      records: [{ userId: participant.data.userId, status: "PRESENT", attendanceMinutes: 30 }],
    }),
  });
  assert.equal(attendanceResponse.status, 200);

  const detailsResponse = await fetch(`${baseUrl}/api/v1/meetings/${created.data.id}`, { headers: adminHeaders });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.minutes.length, 1);
  assert.equal(details.data.actionItems.length, 1);
  assert.equal(details.data.attendance.length, 1);
  assert.ok(details.data.history.some((entry) => entry.action === "ACTION_ITEM_CREATED"));

  const reportResponse = await fetch(`${baseUrl}/api/v1/meetings/reports`, { headers: adminHeaders });
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.data.totalMeetings, 1);
  assert.equal(report.data.outstandingActionItems, 1);
});
