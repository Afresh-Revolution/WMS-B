const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-secretary-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { readCollection, writeCollection } = require("../src/database/jsonStore");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-secretary-dashboard-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

function seed(collection, records) {
  const timestamp = new Date().toISOString();
  writeCollection(
    collection,
    records.map((record, index) => ({
      id: record.id || `${collection}-${index + 1}`,
      createdAt: record.createdAt || record.created_at || timestamp,
      created_at: record.created_at || record.createdAt || timestamp,
      updatedAt: record.updatedAt || record.updated_at || timestamp,
      updated_at: record.updated_at || record.updatedAt || timestamp,
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

function isoOffset(ms) {
  return new Date(Date.now() + ms).toISOString();
}

test("secretary dashboard uses real scoped data and supports email, calendar, meeting, task, and reminder workflows", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const secretary = createUser({
    name: "Sam Secretary",
    email: "secretary@example.com",
    passwordHash: hashPassword("password123"),
    role: "secretary",
    roleId: "secretary",
    status: "active",
    departmentId: "dept-admin",
    employeeId: "emp-secretary",
    organizationId: "org-1",
  });
  const manager = createUser({
    name: "Morgan Manager",
    email: "manager-secretary-test@example.com",
    passwordHash: hashPassword("password123"),
    role: "manager",
    roleId: "manager",
    status: "active",
    departmentId: "dept-ops",
    employeeId: "emp-manager",
    organizationId: "org-1",
  });
  const attendee = createUser({
    name: "Avery Attendee",
    email: "attendee@example.com",
    passwordHash: hashPassword("password123"),
    role: "employee",
    roleId: "employee",
    status: "active",
    departmentId: "dept-ops",
    employeeId: "emp-attendee",
    organizationId: "org-1",
  });
  const headers = authHeaders(secretary);

  const todayMeetingTime = isoOffset(60 * 60 * 1000);
  const futureMeetingTime = isoOffset(3 * 24 * 60 * 60 * 1000);
  const overdueTaskTime = isoOffset(-24 * 60 * 60 * 1000);
  const futureReminderTime = isoOffset(2 * 60 * 60 * 1000);

  seed("departments", [
    { id: "dept-admin", name: "Administration", organizationId: "org-1", organization_id: "org-1" },
    { id: "dept-ops", name: "Operations", organizationId: "org-1", organization_id: "org-1" },
    { id: "dept-other", name: "Other Org", organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("employers", [
    { id: "org-1", companyName: "Afresh", company_name: "Afresh", companyEmail: "hello@afresh.test", company_email: "hello@afresh.test" },
    { id: "org-2", companyName: "Other", company_name: "Other", companyEmail: "hello@other.test", company_email: "hello@other.test" },
  ]);
  seed("employees", [
    {
      id: "emp-secretary",
      fullName: "Sam Secretary",
      email: "secretary@example.com",
      phone: "08030000000",
      userId: secretary.id,
      departmentId: "dept-admin",
      organizationId: "org-1",
      organization_id: "org-1",
      jobTitle: "Executive Secretary",
      employmentType: "Full-time",
      emergencyContact: { name: "Taylor Secretary", phone: "08031111111", relationship: "Sibling" },
      emergency_contact: { name: "Taylor Secretary", phone: "08031111111", relationship: "Sibling" },
    },
    { id: "emp-manager", fullName: "Morgan Manager", email: "manager@example.com", userId: manager.id, departmentId: "dept-ops", organizationId: "org-1", organization_id: "org-1" },
    { id: "emp-attendee", fullName: "Avery Attendee", email: "attendee@example.com", userId: attendee.id, departmentId: "dept-ops", organizationId: "org-1", organization_id: "org-1" },
    { id: "emp-other", fullName: "Outside Org", email: "outside@example.com", departmentId: "dept-other", organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("company_email_accounts", [
    { id: "mailbox-secretary", employeeId: "emp-secretary", employee_id: "emp-secretary", emailAddress: "sam.secretary@afresh.test", email_address: "sam.secretary@afresh.test", status: "ACTIVE", provider: "internal", organizationId: "org-1", organization_id: "org-1" },
    { id: "mailbox-existing", employeeId: "emp-manager", employee_id: "emp-manager", emailAddress: "existing@afresh.test", email_address: "existing@afresh.test", status: "ACTIVE", provider: "internal", organizationId: "org-1", organization_id: "org-1" },
    { id: "mailbox-suspended", employeeId: "emp-attendee", employee_id: "emp-attendee", emailAddress: "suspended@afresh.test", email_address: "suspended@afresh.test", status: "SUSPENDED", provider: "internal", organizationId: "org-1", organization_id: "org-1" },
    { id: "mailbox-other", employeeId: "emp-other", employee_id: "emp-other", emailAddress: "outside@other.test", email_address: "outside@other.test", status: "ACTIVE", provider: "internal", organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("employee_documents", [
    { id: "secretary-contract", employeeId: "emp-secretary", employee_id: "emp-secretary", documentType: "Employment Contract", document_type: "Employment Contract", documentName: "Employment Contract", document_name: "Employment Contract", status: "VERIFIED", organizationId: "org-1", organization_id: "org-1" },
    { id: "other-contract", employeeId: "emp-other", employee_id: "emp-other", documentType: "Employment Contract", document_type: "Employment Contract", documentName: "Outside Contract", document_name: "Outside Contract", status: "VERIFIED", organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("leave_requests", [
    { id: "secretary-leave", employeeId: "emp-secretary", employee_id: "emp-secretary", type: "ANNUAL", status: "APPROVED", organizationId: "org-1", organization_id: "org-1" },
    { id: "other-leave", employeeId: "emp-other", employee_id: "emp-other", type: "ANNUAL", status: "APPROVED", organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("email_requests", [
    { id: "email-pending", requesterId: manager.id, requester_id: manager.id, employeeId: "emp-attendee", employee_id: "emp-attendee", requestedEmailName: "avery@afresh.test", requested_email_name: "avery@afresh.test", departmentId: "dept-ops", department_id: "dept-ops", purpose: "New staff account", status: "PENDING", organizationId: "org-1", organization_id: "org-1" },
    { id: "email-failed", requesterId: manager.id, requester_id: manager.id, employeeId: "emp-attendee", employee_id: "emp-attendee", requestedEmailName: "failed@afresh.test", requested_email_name: "failed@afresh.test", departmentId: "dept-ops", department_id: "dept-ops", purpose: "Retry test", status: "FAILED", failureReason: "Provider rejected alias", failure_reason: "Provider rejected alias", retryCount: 1, retry_count: 1, organizationId: "org-1", organization_id: "org-1" },
    { id: "email-other", employeeId: "emp-other", employee_id: "emp-other", requestedEmailName: "other@afresh.test", requested_email_name: "other@afresh.test", status: "PENDING", organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("meetings", [
    { id: "meeting-today", title: "Today standup", organizerId: manager.id, organizer_id: manager.id, startAt: todayMeetingTime, start_at: todayMeetingTime, endAt: isoOffset(2 * 60 * 60 * 1000), end_at: isoOffset(2 * 60 * 60 * 1000), status: "SCHEDULED", organizationId: "org-1", organization_id: "org-1", attendees: [attendee.id] },
    { id: "meeting-upcoming", title: "Board prep", organizerId: manager.id, organizer_id: manager.id, startAt: futureMeetingTime, start_at: futureMeetingTime, endAt: isoOffset(3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000), end_at: isoOffset(3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000), status: "SCHEDULED", organizationId: "org-1", organization_id: "org-1" },
    { id: "meeting-other", title: "Other org", organizerId: "other-user", organizer_id: "other-user", startAt: todayMeetingTime, start_at: todayMeetingTime, status: "SCHEDULED", organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("meeting_attendees", [
    { id: "meeting-attendee-1", meetingId: "meeting-today", meeting_id: "meeting-today", userId: attendee.id, user_id: attendee.id, attendanceStatus: "INVITED", attendance_status: "INVITED", organizationId: "org-1", organization_id: "org-1" },
  ]);
  seed("tasks", [
    { id: "task-overdue", title: "Follow up with vendor", createdBy: manager.id, created_by: manager.id, assignedTo: secretary.id, assigned_to: secretary.id, status: "IN_PROGRESS", dueDate: overdueTaskTime, due_date: overdueTaskTime, organizationId: "org-1", organization_id: "org-1" },
    { id: "task-other", title: "Outside task", createdBy: "other-user", created_by: "other-user", assignedTo: "other-user", assigned_to: "other-user", status: "IN_PROGRESS", dueDate: overdueTaskTime, due_date: overdueTaskTime, organizationId: "org-2", organization_id: "org-2" },
  ]);
  seed("reminders", [
    { id: "reminder-upcoming", title: "Send agenda", remindAt: futureReminderTime, remind_at: futureReminderTime, relatedType: "MEETING", related_type: "MEETING", relatedId: "meeting-today", related_id: "meeting-today", assignedTo: secretary.id, assigned_to: secretary.id, status: "PENDING", organizationId: "org-1", organization_id: "org-1" },
    { id: "reminder-other", title: "Other reminder", remindAt: futureReminderTime, remind_at: futureReminderTime, assignedTo: "other-user", assigned_to: "other-user", status: "PENDING", organizationId: "org-2", organization_id: "org-2" },
  ]);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/secretary/dashboard`, { headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.stats.pendingEmailRequests, 1);
  assert.equal(dashboard.data.stats.failedEmailCreations, 1);
  assert.equal(dashboard.data.stats.meetingsToday, 1);
  assert.equal(dashboard.data.stats.upcomingEmailRequests, 1);
  assert.equal(dashboard.data.stats.awaitingReview, 1);
  assert.deepEqual(dashboard.data.pendingEmailRequests.map((request) => request.id), ["email-pending"]);
  assert.deepEqual(dashboard.data.failedEmailCreations.map((request) => request.id), ["email-failed"]);
  assert.deepEqual(dashboard.data.todaysMeetings.map((meeting) => meeting.id), ["meeting-today"]);
  assert.deepEqual(dashboard.data.upcomingMeetings.map((meeting) => meeting.id), ["meeting-upcoming"]);
  assert.deepEqual(dashboard.data.overdueManagementTasks.map((task) => task.id), ["task-overdue"]);
  assert.deepEqual(dashboard.data.upcomingReminders.map((reminder) => reminder.id), ["reminder-upcoming"]);
  assert.equal(dashboard.data.pendingEmailRequests[0].employeeName, "Avery Attendee");

  const employmentRecordResponse = await fetch(`${baseUrl}/api/v1/secretary/employment-record`, { headers });
  assert.equal(employmentRecordResponse.status, 200);
  const employmentRecord = await employmentRecordResponse.json();
  assert.equal(employmentRecord.data.overview.fullName, "Sam Secretary");
  assert.equal(employmentRecord.data.overview.companyEmail.emailAddress, "sam.secretary@afresh.test");
  assert.equal(employmentRecord.data.personalInformation.emergencyContact.name, "Taylor Secretary");
  assert.deepEqual(employmentRecord.data.documents.map((document) => document.id), ["secretary-contract"]);
  assert.deepEqual(employmentRecord.data.leaveHistory.map((request) => request.id), ["secretary-leave"]);

  const employmentDocumentsResponse = await fetch(`${baseUrl}/api/v1/secretary/employment-record/documents`, { headers });
  assert.equal(employmentDocumentsResponse.status, 200);
  const employmentDocuments = await employmentDocumentsResponse.json();
  assert.deepEqual(employmentDocuments.data.map((document) => document.id), ["secretary-contract"]);

  const employmentUpdateResponse = await fetch(`${baseUrl}/api/v1/secretary/employment-record`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ phone: "08032222222", emergencyContact: { name: "Jordan Secretary", phone: "08033333333", relationship: "Parent" } }),
  });
  assert.equal(employmentUpdateResponse.status, 200);
  const employmentUpdate = await employmentUpdateResponse.json();
  assert.equal(employmentUpdate.data.personalInformation.phone, "08032222222");
  assert.equal(employmentUpdate.data.personalInformation.emergencyContact.name, "Jordan Secretary");
  assert.equal(readCollection("employees").find((employee) => employee.id === "emp-secretary").phone, "08032222222");

  const forbiddenEmploymentUpdateResponse = await fetch(`${baseUrl}/api/v1/secretary/employment-record`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "superadmin", permissions: ["roles.manage"] }),
  });
  assert.equal(forbiddenEmploymentUpdateResponse.status, 403);

  const managerForbiddenResponse = await fetch(`${baseUrl}/api/v1/secretary/dashboard`, { headers: authHeaders(manager) });
  assert.equal(managerForbiddenResponse.status, 403);
  const managerForbidden = await managerForbiddenResponse.json();
  assert.equal(managerForbidden.error.code, "SECRETARY_ROLE_REQUIRED");

  const otherOrgResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests?organizationId=org-2`, { headers });
  assert.equal(otherOrgResponse.status, 403);

  const queueResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests?status=PENDING&search=Avery`, { headers });
  assert.equal(queueResponse.status, 200);
  const queue = await queueResponse.json();
  assert.equal(queue.data.stats.pendingRequests, 1);
  assert.deepEqual(queue.data.requests.map((request) => request.id), ["email-pending"]);

  const unavailableResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/check-availability`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "existing@afresh.test", employeeId: "emp-attendee" }),
  });
  assert.equal(unavailableResponse.status, 200);
  const unavailable = await unavailableResponse.json();
  assert.equal(unavailable.data.available, false);
  assert.equal(unavailable.data.reason, "EMAIL_ALREADY_EXISTS");
  assert.ok(unavailable.data.suggestedAlternatives.length > 0);

  const blockedDomainResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/check-availability`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "avery@outside.test" }),
  });
  assert.equal(blockedDomainResponse.status, 400);

  const reviewResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/email-pending/review`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ notes: "Checking employee record" }),
  });
  assert.equal(reviewResponse.status, 200);
  const reviewed = await reviewResponse.json();
  assert.equal(reviewed.data.status, "UNDER_REVIEW");

  const approveResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/email-pending/approve`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ notes: "Looks good" }),
  });
  assert.equal(approveResponse.status, 200);

  const createEmailResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/email-pending/create-email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "avery.company@afresh.test" }),
  });
  assert.equal(createEmailResponse.status, 200);
  const createdEmail = await createEmailResponse.json();
  assert.equal(createdEmail.data.request.status, "CREATED");
  assert.equal(createdEmail.data.account.emailAddress, "avery.company@afresh.test");
  assert.ok(readCollection("employees").some((employee) => employee.id === "emp-attendee" && employee.companyEmail === "avery.company@afresh.test"));

  const invalidTransitionResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/email-pending/review`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ notes: "Cannot return created request" }),
  });
  assert.equal(invalidTransitionResponse.status, 409);

  const retryResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/email-failed/retry`, {
    method: "POST",
    headers,
    body: JSON.stringify({ notes: "Retry provider job" }),
  });
  assert.equal(retryResponse.status, 200);
  const retried = await retryResponse.json();
  assert.equal(retried.data.status, "CREATING");
  assert.equal(retried.data.retryCount, 2);
  assert.ok(readCollection("email_request_retries").some((record) => record.emailRequestId === "email-failed" && record.retryCount === 2));

  const cancelResponse = await fetch(`${baseUrl}/api/v1/secretary/email-requests/email-failed/cancel`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ reason: "Requester withdrew" }),
  });
  assert.equal(cancelResponse.status, 200);
  const cancelled = await cancelResponse.json();
  assert.equal(cancelled.data.status, "CANCELLED");

  const directoryResponse = await fetch(`${baseUrl}/api/v1/secretary/company-emails?status=ACTIVE&search=existing`, { headers });
  assert.equal(directoryResponse.status, 200);
  const directory = await directoryResponse.json();
  assert.equal(directory.data.stats.activeMailboxes, 3);
  assert.equal(directory.data.stats.suspended, 1);
  assert.equal(directory.data.stats.totalMailboxes, 4);
  assert.deepEqual(directory.data.emails.map((account) => account.id), ["mailbox-existing"]);

  const duplicateAddressResponse = await fetch(`${baseUrl}/api/v1/secretary/company-emails/${createdEmail.data.account.id}/address`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ emailAddress: "existing@afresh.test" }),
  });
  assert.equal(duplicateAddressResponse.status, 409);

  const addressResponse = await fetch(`${baseUrl}/api/v1/secretary/company-emails/${createdEmail.data.account.id}/address`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ emailAddress: "avery.updated@afresh.test", reason: "Preferred alias" }),
  });
  assert.equal(addressResponse.status, 200);
  const address = await addressResponse.json();
  assert.equal(address.data.emailAddress, "avery.updated@afresh.test");
  assert.ok(readCollection("company_email_address_history").some((record) => record.companyEmailAccountId === createdEmail.data.account.id && record.oldEmailAddress === "avery.company@afresh.test"));

  const suspendResponse = await fetch(`${baseUrl}/api/v1/secretary/company-emails/${createdEmail.data.account.id}/suspend`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason: "Temporary hold" }),
  });
  assert.equal(suspendResponse.status, 200);
  const suspended = await suspendResponse.json();
  assert.equal(suspended.data.status, "SUSPENDED");

  const reactivateResponse = await fetch(`${baseUrl}/api/v1/secretary/company-emails/${createdEmail.data.account.id}/reactivate`, {
    method: "POST",
    headers,
  });
  assert.equal(reactivateResponse.status, 200);
  const reactivated = await reactivateResponse.json();
  assert.equal(reactivated.data.status, "ACTIVE");

  const deactivationResponse = await fetch(`${baseUrl}/api/v1/secretary/company-emails/${createdEmail.data.account.id}/request-deactivation`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason: "Employee transferred" }),
  });
  assert.equal(deactivationResponse.status, 200);
  const deactivation = await deactivationResponse.json();
  assert.equal(deactivation.data.status, "DEACTIVATION_PENDING");

  const calendarCreateResponse = await fetch(`${baseUrl}/api/v1/secretary/calendar/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Management deadline", type: "DEADLINE", startAt: futureMeetingTime, endAt: futureMeetingTime, departmentId: "dept-admin" }),
  });
  assert.equal(calendarCreateResponse.status, 201);
  const calendarCreate = await calendarCreateResponse.json();
  assert.equal(calendarCreate.data.organizationId, "org-1");

  const calendarResponse = await fetch(`${baseUrl}/api/v1/secretary/calendar?type=DEADLINE`, { headers });
  assert.equal(calendarResponse.status, 200);
  const calendar = await calendarResponse.json();
  assert.ok(calendar.data.events.some((item) => item.sourceId === calendarCreate.data.id && item.type === "TASK_DEADLINE"));
  assert.ok(calendar.data.items.some((item) => item.sourceId === calendarCreate.data.id));

  const taskDeadlineCalendarResponse = await fetch(`${baseUrl}/api/v1/secretary/calendar?eventType=TASK_DEADLINE&start=${encodeURIComponent(isoOffset(-2 * 24 * 60 * 60 * 1000))}&end=${encodeURIComponent(isoOffset(24 * 60 * 60 * 1000))}`, { headers });
  assert.equal(taskDeadlineCalendarResponse.status, 200);
  const taskDeadlineCalendar = await taskDeadlineCalendarResponse.json();
  assert.ok(taskDeadlineCalendar.data.events.some((item) => item.sourceId === "task-overdue" && item.sourceType === "TASK_DEADLINE"));
  assert.equal(taskDeadlineCalendar.data.events.some((item) => item.sourceId === "task-other"), false);

  const meetingCreateResponse = await fetch(`${baseUrl}/api/v1/secretary/meetings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Secretary coordinated meeting",
      organizerId: manager.id,
      startAt: futureMeetingTime,
      endAt: isoOffset(3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      attendeeIds: [attendee.id],
      reminders: [15, 60],
      location: "Conference Room A",
    }),
  });
  assert.equal(meetingCreateResponse.status, 201);
  const meetingCreate = await meetingCreateResponse.json();
  assert.equal(meetingCreate.data.organizationId, "org-1");
  assert.ok(readCollection("meeting_attendees").some((attendeeRecord) => attendeeRecord.meetingId === meetingCreate.data.id && attendeeRecord.userId === attendee.id));
  assert.ok(readCollection("meeting_reminders").some((reminderRecord) => reminderRecord.meetingId === meetingCreate.data.id && reminderRecord.minutesBefore === 15));

  const overdueResponse = await fetch(`${baseUrl}/api/v1/secretary/tasks/overdue`, { headers });
  assert.equal(overdueResponse.status, 200);
  const overdue = await overdueResponse.json();
  assert.deepEqual(overdue.data.map((task) => task.id), ["task-overdue"]);

  const reminderCreateResponse = await fetch(`${baseUrl}/api/v1/secretary/reminders`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Call attendee", remindAt: futureReminderTime, relatedType: "TASK", relatedId: "task-overdue" }),
  });
  assert.equal(reminderCreateResponse.status, 201);
  const reminderCreate = await reminderCreateResponse.json();
  assert.equal(reminderCreate.data.organizationId, "org-1");

  const legacyDashboardResponse = await fetch(`${baseUrl}/api/secretary/dashboard`, { headers });
  assert.equal(legacyDashboardResponse.status, 200);

  const auditActions = readCollection("operational_audit_logs").map((record) => record.action);
  assert.ok(auditActions.includes("SECRETARY_EMAIL_REQUEST_REVIEWED"));
  assert.ok(auditActions.includes("SECRETARY_EMAIL_AVAILABILITY_CHECKED"));
  assert.ok(auditActions.includes("SECRETARY_EMAIL_SUCCESSFULLY_CREATED"));
  assert.ok(auditActions.includes("SECRETARY_EMAIL_ASSIGNED_TO_EMPLOYEE"));
  assert.ok(auditActions.includes("SECRETARY_EMPLOYMENT_RECORD_UPDATED"));
  assert.ok(auditActions.includes("SECRETARY_EMAIL_REQUEST_CANCELLED"));
  assert.ok(auditActions.includes("SECRETARY_EMAIL_ADDRESS_CHANGED"));
  assert.ok(auditActions.includes("SECRETARY_MAILBOX_SUSPENDED"));
  assert.ok(auditActions.includes("SECRETARY_MAILBOX_REACTIVATED"));
  assert.ok(auditActions.includes("SECRETARY_DEACTIVATION_REQUESTED"));
  assert.ok(auditActions.includes("SECRETARY_EMAIL_CREATION_RETRIED"));
  assert.ok(auditActions.includes("SECRETARY_CALENDAR_EVENT_CREATED"));
  assert.ok(auditActions.includes("SECRETARY_MEETING_CREATED"));
  assert.ok(auditActions.includes("SECRETARY_REMINDER_CREATED"));
  assert.ok(readCollection("notifications").some((notification) => notification.type === "MEETING_CREATED" && notification.recipientUserId === attendee.id));
  assert.ok(readCollection("notifications").some((notification) => notification.type === "UPCOMING_REMINDER" && notification.recipientUserId === secretary.id));
});
