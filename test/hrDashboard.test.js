const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-hr-dashboard";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { createApp } = require("../src/app");
const { createUser } = require("../src/auth/userStore");
const { hashPassword } = require("../src/auth/passwords");
const { issueAccessToken } = require("../src/auth/tokens");
const { readCollection, writeCollection } = require("../src/database/jsonStore");
const { getRolePermissions } = require("../src/constants/rbac");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-hr-dashboard-"));
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

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("HR dashboard uses shared people data and exposes HR workflows", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const expiringSoon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  seed("departments", [
    { id: "dept-hr", name: "Human Resources", code: "HR", status: "active", organizationId: "org-1" },
    { id: "dept-ops", name: "Operations", code: "OPS", status: "active", organizationId: "org-1" },
  ]);
  seed("employees", [
    {
      id: "emp-active",
      employeeId: "EMP-001",
      fullName: "Ada Active",
      email: "ada@example.com",
      status: "ACTIVE",
      hireDate: today.toISOString(),
      organizationId: "org-1",
      basicSalary: 500000,
    },
    {
      id: "emp-probation",
      employeeId: "EMP-002",
      fullName: "Ben Probation",
      email: "ben@example.com",
      status: "PROBATION",
      probationEndDate: yesterday,
      organizationId: "org-1",
      basicSalary: 400000,
      createdAt: "2020-01-01T00:00:00.000Z",
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "emp-other-org",
      employeeId: "EMP-003",
      fullName: "Other Org",
      status: "ACTIVE",
      organizationId: "org-2",
    },
  ]);
  seed("employee_documents", [
    {
      id: "doc-contract",
      employeeId: "emp-active",
      documentType: "Employment Contract",
      documentName: "Employment Contract",
      fileUrl: "https://example.com/contract.pdf",
      status: "active",
      organizationId: "org-1",
    },
    {
      id: "doc-id",
      employeeId: "emp-active",
      documentType: "Identification",
      documentName: "National ID",
      fileUrl: "https://example.com/id.pdf",
      expiryDate: expiringSoon,
      status: "active",
      organizationId: "org-1",
    },
  ]);
  seed("leave_requests", [
    { id: "leave-pending", employeeId: "emp-active", employeeName: "Ada Active", status: "PENDING", organizationId: "org-1" },
  ]);
  seed("promotions", [
    { id: "promotion-pending", employeeId: "emp-active", employeeName: "Ada Active", newPositionName: "Lead Designer", status: "PENDING", organizationId: "org-1" },
  ]);
  seed("salary_adjustments", [
    { id: "salary-pending", employeeId: "emp-active", employeeName: "Ada Active", oldSalary: 500000, newSalary: 562500, percentage: 12.5, status: "PENDING", organizationId: "org-1" },
  ]);
  seed("disciplinary_cases", [
    { id: "discipline-open", employeeId: "emp-active", employeeName: "Ada Active", caseNumber: "DISC-1", status: "OPEN", organizationId: "org-1" },
  ]);
  seed("onboarding_records", [
    { id: "onboarding-returned", employeeId: "emp-active", employeeName: "Ada Active", status: "RETURNED", organizationId: "org-1" },
  ]);
  seed("operational_audit_logs", [
    {
      id: "system-role-log",
      action: "ROLE_CREATED",
      module: "System",
      targetType: "Role",
      organizationId: "org-1",
      metadata: { organizationId: "org-1" },
    },
  ]);

  const hr = createUser({
    name: "Helen HR",
    email: "hr@example.com",
    passwordHash: hashPassword("password123"),
    role: "HR",
    status: "active",
    departmentId: "dept-hr",
    organizationId: "org-1",
  });
  seed("notifications", [
    { id: "hr-notification", userId: hr.id, user_id: hr.id, type: "HR_ALERT", title: "Document expiring", message: "One document is expiring soon.", module: "HR", isRead: false, is_read: false, organizationId: "org-1" },
  ]);
  const headers = authHeaders(hr);
  const hrPermissions = getRolePermissions("hr");
  for (const forbiddenPermission of [
    "roles.view",
    "roles.create",
    "roles.update",
    "roles.delete",
    "roles.assign_permissions",
    "permissions.manage",
    "system_management.manage",
    "system.settings.manage",
    "security.manage",
    "integrations.manage",
    "finance.manage",
    "finance.approve",
    "procurement.approve",
    "purchase_request.approve",
    "payroll.view",
    "payroll.create",
    "payroll.approve",
    "attendance.view",
    "attendance.manage",
    "attendance.correct",
    "performance.view",
    "performance.create",
    "performance.review",
    "performance.approve",
    "meetings.create",
    "tasks.create",
    "targets.create",
    "notification_config.update",
    "notifications.view_all",
    "audit:view",
  ]) {
    assert.equal(hrPermissions.includes(forbiddenPermission), false, `${forbiddenPermission} must not be a default HR permission`);
  }
  for (const requiredHrPermission of [
    "employee_exits.view",
    "employee_exits.create",
    "nysc_intern.view",
    "nysc_intern.create",
    "hr_settings.view",
    "help_center.view",
  ]) {
    assert.equal(hrPermissions.includes(requiredHrPermission), true, `${requiredHrPermission} must be a default HR operation permission`);
  }

  const dashboardResponse = await fetch(`${baseUrl}/api/hr/dashboard`, { headers });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.employees.active, 2);
  assert.equal(dashboard.data.employees.recentlyOnboarded, 1);
  assert.equal(dashboard.data.employees.awaitingConfirmation, 1);
  assert.equal(dashboard.data.leave.pending, 1);
  assert.equal(dashboard.data.promotions.pending, 1);
  assert.equal(dashboard.data.salaryIncrements.pending, 1);
  assert.equal(dashboard.data.requests.returned, 1);
  assert.equal(dashboard.data.discipline.open, 1);
  assert.equal(dashboard.data.documents.missing, 2);
  assert.equal(dashboard.data.documents.expiringSoon, 1);
  assert.ok(dashboard.data.queues.recommendations.some((item) => item.type === "SALARY_INCREMENT"));
  assert.deepEqual(dashboard.data.navigation, [
    "Overview",
    "Employees",
    "Onboarding",
    "Leave",
    "Promotions",
    "Salary Increments",
    "Discipline",
    "NYSC & Interns",
    "Employee Exit",
    "Employee Documents",
    "HR Reports",
    "Notifications",
    "Help Center",
    "Settings",
    "Sign Out",
  ]);

  const profileResponse = await fetch(`${baseUrl}/api/hr/profile`, { headers });
  assert.equal(profileResponse.status, 200);
  const hrProfile = await profileResponse.json();
  assert.equal(hrProfile.data.user.fullName, "Helen HR");

  const profileUpdateResponse = await fetch(`${baseUrl}/api/hr/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ phone: "08030001111", preferences: { compactMode: true } }),
  });
  assert.equal(profileUpdateResponse.status, 200);
  const profileUpdate = await profileUpdateResponse.json();
  assert.equal(profileUpdate.data.user.phone, "08030001111");

  const forbiddenProfileUpdateResponse = await fetch(`${baseUrl}/api/hr/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "superadmin", permissions: ["roles.manage"] }),
  });
  assert.equal(forbiddenProfileUpdateResponse.status, 403);

  const settingsResponse = await fetch(`${baseUrl}/api/hr/settings`, { headers });
  assert.equal(settingsResponse.status, 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.data.preferences.compactMode, true);

  const helpResponse = await fetch(`${baseUrl}/api/hr/help-center`, { headers });
  assert.equal(helpResponse.status, 200);
  const help = await helpResponse.json();
  assert.ok(help.data.sections.some((section) => section.key === "exits"));

  const notificationsResponse = await fetch(`${baseUrl}/api/hr/notifications`, { headers });
  assert.equal(notificationsResponse.status, 200);
  const notifications = await notificationsResponse.json();
  assert.equal(notifications.data.unreadCount, 1);

  const notificationReadResponse = await fetch(`${baseUrl}/api/hr/notifications/hr-notification/read`, { method: "PATCH", headers });
  assert.equal(notificationReadResponse.status, 200);
  assert.equal(readCollection("notifications").find((notification) => notification.id === "hr-notification").isRead, true);

  const nyscCreateResponse = await fetch(`${baseUrl}/api/hr/nysc-interns`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fullName: "Chidi Intern",
      type: "INTERN",
      institution: "University of Lagos",
      courseOfStudy: "Business Administration",
      email: "chidi.intern@example.com",
      phone: "08030002222",
      startDate: addDays(-5),
      endDate: addDays(60),
      departmentId: "dept-ops",
      role: "HR Intern",
      workLocation: "Lagos Office",
    }),
  });
  assert.equal(nyscCreateResponse.status, 201);
  const nyscCreate = await nyscCreateResponse.json();
  assert.equal(nyscCreate.data.profile.type, "INTERN");

  const nyscListResponse = await fetch(`${baseUrl}/api/hr/nysc-interns`, { headers });
  assert.equal(nyscListResponse.status, 200);
  const nyscList = await nyscListResponse.json();
  assert.ok(nyscList.data.some((item) => item.profile.id === nyscCreate.data.profile.id));

  const nyscDashboardResponse = await fetch(`${baseUrl}/api/hr/nysc-interns/dashboard`, { headers });
  assert.equal(nyscDashboardResponse.status, 200);
  const nyscDashboard = await nyscDashboardResponse.json();
  assert.equal(nyscDashboard.data.activeInterns, 1);

  const employeeExitResponse = await fetch(`${baseUrl}/api/hr/employee-exits`, {
    method: "POST",
    headers,
    body: JSON.stringify({ employeeId: "emp-active", exitType: "RESIGNATION", exitDate: addDays(14), reason: "Accepted another role" }),
  });
  assert.equal(employeeExitResponse.status, 201);
  const employeeExit = await employeeExitResponse.json();
  assert.equal(employeeExit.data.status, "PENDING");

  const approveExitResponse = await fetch(`${baseUrl}/api/hr/employee-exits/${employeeExit.data.id}/approve`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ notes: "Clearance can begin." }),
  });
  assert.equal(approveExitResponse.status, 200);

  const completeExitResponse = await fetch(`${baseUrl}/api/hr/employee-exits/${employeeExit.data.id}/complete`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ notes: "All assets returned." }),
  });
  assert.equal(completeExitResponse.status, 200);
  assert.equal(readCollection("employees").find((employee) => employee.id === "emp-active").status, "EXITED");

  const missingDocumentsResponse = await fetch(`${baseUrl}/api/hr/documents/missing`, { headers });
  assert.equal(missingDocumentsResponse.status, 200);
  const missingDocuments = await missingDocumentsResponse.json();
  assert.equal(missingDocuments.data.length, 1);

  const leaveDetailsResponse = await fetch(`${baseUrl}/api/hr/leave/leave-pending`, { headers });
  assert.equal(leaveDetailsResponse.status, 200);
  const leaveDetails = await leaveDetailsResponse.json();
  assert.equal(leaveDetails.data.employee.id, "emp-active");

  const createManagerAccessResponse = await fetch(`${baseUrl}/api/hr/employees`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fullName: "Mina Manager",
      email: "mina.manager@example.com",
      systemAccess: { createAccount: true, role: "manager", initialPassword: "Password123" },
    }),
  });
  assert.equal(createManagerAccessResponse.status, 403);
  const createManagerAccess = await createManagerAccessResponse.json();
  assert.equal(createManagerAccess.error.code, "HR_SYSTEM_ACCESS_FORBIDDEN");

  const updateRoleResponse = await fetch(`${baseUrl}/api/hr/employees/emp-active`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ role: "manager", permissions: ["roles.manage"] }),
  });
  assert.equal(updateRoleResponse.status, 403);

  const confirmationsResponse = await fetch(`${baseUrl}/api/hr/confirmations`, { headers });
  assert.equal(confirmationsResponse.status, 200);
  const confirmations = await confirmationsResponse.json();
  assert.ok(confirmations.data.some((item) => item.employeeId === "emp-probation"));

  const approveConfirmationResponse = await fetch(`${baseUrl}/api/hr/confirmations/emp-probation/approve`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ remarks: "Ready for confirmation." }),
  });
  assert.equal(approveConfirmationResponse.status, 200);
  assert.equal(readCollection("employees").find((employee) => employee.id === "emp-probation").status, "CONFIRMED");

  const notConfirmResponse = await fetch(`${baseUrl}/api/hr/confirmations/emp-active/not-confirm`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ reason: "Manager recommendation missing." }),
  });
  assert.equal(notConfirmResponse.status, 200);
  assert.equal(readCollection("employees").find((employee) => employee.id === "emp-active").confirmationStatus, "NOT_CONFIRMED");

  const rejectSalaryResponse = await fetch(`${baseUrl}/api/hr/salary-adjustments/salary-pending/reject`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ reason: "Budget deferred." }),
  });
  assert.equal(rejectSalaryResponse.status, 200);
  assert.equal(readCollection("salary_adjustments").find((adjustment) => adjustment.id === "salary-pending").status, "REJECTED");

  const salaryIncrementResponse = await fetch(`${baseUrl}/api/hr/salary-increments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ employeeId: "emp-active", newSalary: 600000, reason: "Retention adjustment." }),
  });
  assert.equal(salaryIncrementResponse.status, 201);
  const salaryIncrement = await salaryIncrementResponse.json();
  const approveSalaryIncrementResponse = await fetch(`${baseUrl}/api/hr/salary-increments/${salaryIncrement.data.id}/approve`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ reason: "Approved." }),
  });
  assert.equal(approveSalaryIncrementResponse.status, 200);
  assert.equal(readCollection("employees").find((employee) => employee.id === "emp-active").basicSalary, 600000);

  const onboardingResponse = await fetch(`${baseUrl}/api/hr/onboarding`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      employeeId: "emp-active",
      tasks: [{ title: "Collect tax form" }],
      documents: [{ type: "Tax Document", name: "Tax Form" }],
    }),
  });
  assert.equal(onboardingResponse.status, 201);
  const onboarding = await onboardingResponse.json();
  assert.ok(readCollection("onboarding_tasks").some((task) => task.title === "Collect tax form"));

  const onboardingTaskResponse = await fetch(`${baseUrl}/api/hr/onboarding/${onboarding.data.id}/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Policy acknowledgement", dueDate: "2026-09-01" }),
  });
  assert.equal(onboardingTaskResponse.status, 201);
  const onboardingTask = await onboardingTaskResponse.json();
  const completeTaskResponse = await fetch(`${baseUrl}/api/hr/onboarding/tasks/${onboardingTask.data.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "COMPLETED" }),
  });
  assert.equal(completeTaskResponse.status, 200);
  assert.ok(readCollection("onboarding_tasks").find((task) => task.id === onboardingTask.data.id).completedAt);

  const documentResponse = await fetch(`${baseUrl}/api/hr/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({ employeeId: "emp-active", documentType: "Bank Document", documentName: "Bank Details", fileUrl: "https://example.com/bank.pdf" }),
  });
  assert.equal(documentResponse.status, 201);
  const document = await documentResponse.json();
  const verifyDocumentResponse = await fetch(`${baseUrl}/api/hr/documents/${document.data.id}/verify`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ note: "Verified by HR." }),
  });
  assert.equal(verifyDocumentResponse.status, 200);
  assert.equal(readCollection("employee_documents").find((item) => item.id === document.data.id).status, "VERIFIED");

  const expiredDocumentsResponse = await fetch(`${baseUrl}/api/hr/documents/expired`, { headers });
  assert.equal(expiredDocumentsResponse.status, 200);

  const returnPromotionResponse = await fetch(`${baseUrl}/api/hr/requests/promotion/promotion-pending/return`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ reason: "Add manager comments." }),
  });
  assert.equal(returnPromotionResponse.status, 200);
  assert.equal(readCollection("promotions").find((promotion) => promotion.id === "promotion-pending").status, "RETURNED");

  const returnedRequestsResponse = await fetch(`${baseUrl}/api/hr/returned-requests`, { headers });
  assert.equal(returnedRequestsResponse.status, 200);
  const returnedRequests = await returnedRequestsResponse.json();
  assert.ok(returnedRequests.data.some((request) => request.id === "promotion-pending"));

  const disciplineResponse = await fetch(`${baseUrl}/api/hr/discipline`, {
    method: "POST",
    headers,
    body: JSON.stringify({ employeeId: "emp-active", description: "Policy review opened.", incidentDate: yesterday }),
  });
  assert.equal(disciplineResponse.status, 201);
  const discipline = await disciplineResponse.json();
  const resolveDisciplineResponse = await fetch(`${baseUrl}/api/hr/discipline/${discipline.data.id}/resolve`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ resolution: "Coaching completed." }),
  });
  assert.equal(resolveDisciplineResponse.status, 200);
  const closeDisciplineResponse = await fetch(`${baseUrl}/api/hr/discipline/${discipline.data.id}/close`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ note: "Closed by HR." }),
  });
  assert.equal(closeDisciplineResponse.status, 200);

  const employeeProfileResponse = await fetch(`${baseUrl}/api/hr/employees/emp-active`, { headers });
  assert.equal(employeeProfileResponse.status, 200);
  const profile = await employeeProfileResponse.json();
  assert.ok(Array.isArray(profile.data.documents));
  assert.ok(Array.isArray(profile.data.leaveHistory));
  assert.deepEqual(profile.data.performanceSummary, []);
  assert.equal(profile.data.attendanceSummary, null);

  const reportsResponse = await fetch(`${baseUrl}/api/hr/reports`, { headers });
  assert.equal(reportsResponse.status, 200);
  const reports = await reportsResponse.json();
  assert.equal(reports.data.salaryIncrements.approved >= 1, true);
  assert.equal(reports.data.documents.total >= 3, true);
  assert.equal(reports.data.attendance, null);

  const hrAuditResponse = await fetch(`${baseUrl}/api/hr/audit-logs`, { headers });
  assert.equal(hrAuditResponse.status, 200);
  const hrAudit = await hrAuditResponse.json();
  assert.equal(hrAudit.data.some((log) => log.id === "system-role-log"), false);

  for (const forbiddenEndpoint of [
    "/api/v1/roles",
    "/api/v1/permissions",
    "/api/v1/system-management/settings",
    "/api/v1/security/password-policy",
    "/api/v1/payroll/dashboard",
    "/api/v1/purchase-requests",
  ]) {
    const response = await fetch(`${baseUrl}${forbiddenEndpoint}`, { headers });
    assert.notEqual(response.status, 200, `${forbiddenEndpoint} must not be available to HR`);
  }

  for (const removedHrEndpoint of ["/api/hr/meetings", "/api/hr/tasks", "/api/hr/targets", "/api/hr/attendance", "/api/hr/performance"]) {
    const response = await fetch(`${baseUrl}${removedHrEndpoint}`, { headers });
    assert.equal(response.status, 404, `${removedHrEndpoint} must not appear in the HR API`);
  }

  assert.ok(readCollection("operational_audit_logs").some((log) => log.action === "DOCUMENT_VERIFIED"));
  assert.ok(readCollection("notifications").some((notification) => notification.type === "REQUEST_RETURNED"));
});
