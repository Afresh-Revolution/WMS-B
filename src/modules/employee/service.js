const { getUserById, updateUser } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const expenseService = require("../expenses/expense.service");
const leaveService = require("../leave/leave.service");
const meetingService = require("../meetings/meeting.service");
const targetService = require("../targets/target.service");
const { resolveEmployeeForUser } = require("../employees/employeeProfile");

const EMPLOYEE_NAVIGATION = Object.freeze([
  "Home",
  "My Profile",
  "My Leave",
  "My Tasks",
  "My Meetings",
  "My Expenses",
  "My Performance",
  "My Records",
  "Blog Center",
  "Settings",
  "Sign Out",
]);

const EMPLOYEE_ROLES = new Set(["employee"]);
const FINAL_TASK_STATUSES = new Set(["COMPLETED", "DONE", "CLOSED", "CANCELLED"]);

function now() {
  return new Date().toISOString();
}

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function normalizeStatus(value, fallback = "PENDING") {
  return String(value || fallback).trim().toUpperCase();
}

function statusKey(value, fallback = "pending") {
  return String(value || fallback).trim().toLowerCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt && !record.deleted_at && record.status !== "deleted");
}

function valueOf(record, keys) {
  for (const key of keys) {
    if (record && record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return null;
}

function dateValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value) {
      const timestamp = new Date(value).getTime();
      if (!Number.isNaN(timestamp)) return timestamp;
    }
  }
  return 0;
}

function newestFirst(records, keys = ["updatedAt", "updated_at", "createdAt", "created_at"]) {
  return [...records].sort((left, right) => dateValue(right, keys) - dateValue(left, keys));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => entry !== undefined));
}

function getEmployeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.first_name, employee?.lastName, employee?.last_name].filter(Boolean).join(" ") || employee?.email || null;
}

function employeeSummary(employee) {
  if (!employee) return null;
  return {
    id: employee.id,
    employeeId: employee.employeeId || employee.employee_id || null,
    employee_id: employee.employee_id || employee.employeeId || null,
    fullName: getEmployeeName(employee),
    email: employee.email || null,
    phone: employee.phone || null,
    departmentId: employee.departmentId || employee.department_id || null,
    department_id: employee.department_id || employee.departmentId || null,
    jobTitle: employee.jobTitle || employee.job_title || employee.position || null,
    profilePhoto: employee.profilePhoto || employee.profile_photo || employee.photo || employee.photoUrl || null,
    status: employee.status || employee.employmentStatus || employee.employment_status || "active",
  };
}

function findEmployeeRecord(id) {
  return id ? activeRecords("employees").find((employee) => employee.id === id || employee.employeeId === id || employee.employee_id === id) || null : null;
}

function getActorEmployee(user) {
  return resolveEmployeeForUser(user);
}

function getOrganizationId(user, employee = null) {
  return (
    user?.organizationId ||
    user?.organization_id ||
    user?.employerId ||
    user?.employer_id ||
    employee?.organizationId ||
    employee?.organization_id ||
    employee?.employerId ||
    employee?.employer_id ||
    null
  );
}

function buildScope(user) {
  if (!EMPLOYEE_ROLES.has(normalizeRole(user?.role))) {
    throw createHttpError(403, "Employee access is required.", "EMPLOYEE_ROLE_REQUIRED");
  }

  const employee = getActorEmployee(user);
  if (!employee) {
    throw createHttpError(403, "Authenticated user is not linked to an employee record.", "EMPLOYEE_PROFILE_REQUIRED");
  }

  const identifiers = new Set([
    user.id,
    user.employeeId,
    user.employee_id,
    employee.id,
    employee.employeeId,
    employee.employee_id,
    employee.userId,
    employee.user_id,
  ].filter(Boolean));

  return {
    user,
    employee,
    employeeId: employee.id,
    departmentId: employee.departmentId || employee.department_id || user.departmentId || user.department_id || null,
    organizationId: getOrganizationId(user, employee),
    identifiers,
  };
}

function organizationMatches(record, scope) {
  const recordOrgId = valueOf(record, ["organizationId", "organization_id", "employerId", "employer_id", "companyId", "company_id"]);
  return !scope.organizationId || !recordOrgId || String(recordOrgId) === String(scope.organizationId);
}

function recordMatchesIdentifiers(record, scope, keys) {
  return keys.some((key) => {
    const value = record?.[key];
    if (Array.isArray(value)) {
      return value.some((entry) => scope.identifiers.has(entry));
    }
    return value && scope.identifiers.has(value);
  });
}

function targetInScope(target, scope) {
  if (!organizationMatches(target, scope)) return false;
  if (recordMatchesIdentifiers(target, scope, ["employeeId", "employee_id", "assignedTo", "assigned_to", "assigneeId", "assignee_id"])) return true;
  return activeRecords("target_assignments").some((assignment) =>
    !["UNASSIGNED", "REMOVED"].includes(normalizeStatus(assignment.status, "ASSIGNED")) &&
    assignment.targetId === target.id &&
    (scope.identifiers.has(assignment.employeeId) || (assignment.departmentId && assignment.departmentId === scope.departmentId))
  );
}

function meetingInScope(meeting, scope) {
  if (!organizationMatches(meeting, scope)) return false;
  if (recordMatchesIdentifiers(meeting, scope, ["organizerId", "organizer_id", "createdBy", "created_by", "userId", "user_id", "employeeId", "employee_id", "attendees"])) return true;
  return activeRecords("meeting_participants").some((participant) =>
    (participant.meetingId || participant.meeting_id) === meeting.id &&
    recordMatchesIdentifiers(participant, scope, ["userId", "user_id", "employeeId", "employee_id"])
  );
}

function taskInScope(task, scope) {
  return organizationMatches(task, scope) && recordMatchesIdentifiers(task, scope, [
    "employeeId",
    "employee_id",
    "assignedEmployeeId",
    "assigned_employee_id",
    "assigneeEmployeeId",
    "assignee_employee_id",
    "assignedTo",
    "assigned_to",
    "assigneeId",
    "assignee_id",
    "userId",
    "user_id",
  ]);
}

function expenseInScope(expense, scope) {
  return organizationMatches(expense, scope) && recordMatchesIdentifiers(expense, scope, ["employeeId", "employee_id", "claimantId", "claimant_id", "userId", "user_id", "createdBy", "created_by"]);
}

function leaveInScope(request, scope) {
  return organizationMatches(request, scope) && recordMatchesIdentifiers(request, scope, ["employeeId", "employee_id", "staffId", "staff_id", "requesterId", "requester_id", "createdBy", "created_by"]);
}

function performanceInScope(review, scope) {
  return organizationMatches(review, scope) && recordMatchesIdentifiers(review, scope, ["employeeId", "employee_id", "staffId", "staff_id", "revieweeId", "reviewee_id"]);
}

function scopedRecords(collection, scope) {
  const records = activeRecords(collection);
  if (collection === "tasks") return records.filter((record) => taskInScope(record, scope));
  if (collection === "targets") return records.filter((record) => targetInScope(record, scope));
  if (collection === "meetings") return records.filter((record) => meetingInScope(record, scope));
  if (collection === "expenses") return records.filter((record) => expenseInScope(record, scope));
  if (collection === "leave_requests") return records.filter((record) => leaveInScope(record, scope));
  if (collection === "performance_reviews") return records.filter((record) => performanceInScope(record, scope));
  if (collection === "employee_documents" || collection === "staff_documents") {
    return records.filter((record) => recordMatchesIdentifiers(record, scope, ["employeeId", "employee_id", "staffId", "staff_id", "userId", "user_id"]));
  }
  if (collection === "notifications") {
    return records.filter((record) => recordMatchesIdentifiers(record, scope, ["userId", "user_id", "recipientUserId", "recipient_user_id", "employeeId", "employee_id", "recipientEmployeeId", "recipient_employee_id"]));
  }
  return [];
}

function findScopedRecord(collection, id, scope) {
  return scopedRecords(collection, scope).find((record) => record.id === id) || null;
}

function listCollection(collection, user, query = {}, searchFields = []) {
  const scope = buildScope(user);
  const records = newestFirst(scopedRecords(collection, scope));
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, searchFields), query);
}

function statusCounts(records, fallback = "PENDING") {
  return records.reduce((counts, record) => {
    const key = normalizeStatus(record.status, fallback).toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function targetProgress(targets) {
  const values = targets.map((target) => toNumber(target.progress ?? target.progressPercent ?? target.progress_percent ?? target.achievementPercentage ?? target.achievement_percentage)).filter((value) => value > 0);
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
}

function leaveBalances(scope) {
  return activeRecords("leave_balances").filter((balance) => balance.employeeId === scope.employeeId || balance.employee_id === scope.employeeId);
}

function getDashboard(user, query = {}) {
  const scope = buildScope(user);
  const tasks = scopedRecords("tasks", scope);
  const meetings = scopedRecords("meetings", scope);
  const leaveRequests = scopedRecords("leave_requests", scope);
  const expenses = scopedRecords("expenses", scope);
  const targets = scopedRecords("targets", scope);
  const performance = scopedRecords("performance_reviews", scope);
  const notifications = scopedRecords("notifications", scope);
  const balances = leaveBalances(scope);
  const nowMs = Date.now();
  const limit = Math.max(1, Math.min(25, Number(query.previewLimit || query.limit || 5) || 5));

  return {
    scope: serializeScope(scope),
    profile: getEmploymentRecord(user).overview,
    metrics: {
      leaveDaysRemaining: balances.reduce((total, balance) => total + toNumber(balance.remainingDays ?? balance.remaining_days), 0),
      assignedTasks: tasks.filter((task) => !FINAL_TASK_STATUSES.has(normalizeStatus(task.status, "PENDING"))).length,
      overdueTasks: tasks.filter((task) => dateValue(task, ["dueDate", "due_date"]) < nowMs && dateValue(task, ["dueDate", "due_date"]) > 0 && !FINAL_TASK_STATUSES.has(normalizeStatus(task.status, "PENDING"))).length,
      upcomingMeetings: meetings.filter((meeting) => dateValue(meeting, ["startAt", "start_at", "scheduledAt", "scheduled_at", "date"]) >= nowMs).length,
      pendingLeaveRequests: leaveRequests.filter((request) => normalizeStatus(request.status) === "PENDING").length,
      activeTargets: targets.filter((target) => ["ACTIVE", "IN_PROGRESS", "OVERDUE"].includes(normalizeStatus(target.status, "ACTIVE"))).length,
      targetProgress: targetProgress(targets),
      expenseClaims: expenses.length,
      pendingExpenseClaims: expenses.filter((expense) => ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "PROCESSING"].includes(normalizeStatus(expense.status, "SUBMITTED"))).length,
      reimbursementsWaiting: expenses.filter((expense) => ["PENDING", "PROCESSING"].includes(normalizeStatus(expense.reimbursementStatus || expense.reimbursement_status, "NOT_REQUIRED"))).length,
      unreadNotifications: notifications.filter((notification) => !notification.readAt && !notification.read_at && statusKey(notification.status, "unread") !== "read").length,
      performanceReviews: performance.length,
    },
    myWork: newestFirst(tasks).slice(0, limit),
    upcomingMeetings: newestFirst(
      meetings.filter((meeting) => dateValue(meeting, ["startAt", "start_at", "scheduledAt", "scheduled_at", "date"]) >= nowMs),
      ["startAt", "start_at", "scheduledAt", "scheduled_at", "date"]
    ).slice(0, limit),
    leave: {
      balances,
      recentRequests: newestFirst(leaveRequests).slice(0, limit),
      counts: statusCounts(leaveRequests),
    },
    expenses: {
      recentClaims: newestFirst(expenses).slice(0, limit),
      counts: statusCounts(expenses, "SUBMITTED"),
    },
    targets: {
      items: newestFirst(targets).slice(0, limit),
      averageProgress: targetProgress(targets),
      counts: statusCounts(targets, "ACTIVE"),
    },
    notifications: newestFirst(notifications).slice(0, limit),
    navigation: EMPLOYEE_NAVIGATION,
  };
}

function serializeScope(scope) {
  return {
    organizationId: scope.organizationId,
    departmentId: scope.departmentId,
    employeeId: scope.employeeId,
    userId: scope.user.id,
  };
}

function getScopeSummary(user) {
  return serializeScope(buildScope(user));
}

function getEmploymentRecord(user) {
  const scope = buildScope(user);
  const currentUser = getUserById(user.id) || user;
  const employee = scope.employee;
  const department = scope.departmentId ? activeRecords("departments").find((record) => record.id === scope.departmentId) || null : null;
  const manager = findEmployeeRecord(employee.managerId || employee.manager_id || employee.supervisorId || employee.supervisor_id);

  return {
    overview: {
      ...employeeSummary(employee),
      userId: currentUser.id,
      user_id: currentUser.id,
      avatarUrl: currentUser.avatarUrl || currentUser.avatar_url || employee.profilePhoto || employee.profile_photo || null,
      department: department ? { id: department.id, name: department.name || null, code: department.code || null } : null,
      manager: employeeSummary(manager),
    },
    contact: {
      email: employee.email || currentUser.email || null,
      phone: employee.phone || currentUser.phone || null,
      address: employee.address || null,
      emergencyContact: employee.emergencyContact || employee.emergency_contact || {
        name: employee.emergencyContactName || employee.emergency_contact_name || null,
        phone: employee.emergencyContactPhone || employee.emergency_contact_phone || null,
        relationship: employee.emergencyContactRelationship || employee.emergency_contact_relationship || null,
      },
    },
    employment: {
      employeeId: employee.employeeId || employee.employee_id || employee.id,
      employee_id: employee.employee_id || employee.employeeId || employee.id,
      jobTitle: employee.jobTitle || employee.job_title || employee.position || null,
      departmentId: scope.departmentId,
      department_id: scope.departmentId,
      employmentType: employee.employmentType || employee.employment_type || null,
      employment_type: employee.employment_type || employee.employmentType || null,
      startDate: employee.employmentStartDate || employee.employment_start_date || employee.hireDate || employee.hire_date || employee.startDate || employee.start_date || null,
      start_date: employee.employment_start_date || employee.employmentStartDate || employee.hire_date || employee.hireDate || employee.start_date || employee.startDate || null,
      status: employee.status || currentUser.status || "active",
    },
    documents: [
      ...scopedRecords("employee_documents", scope),
      ...activeRecords("staff_documents").filter((document) => recordMatchesIdentifiers(document, scope, ["staffId", "staff_id", "employeeId", "employee_id"])),
    ],
    leaveHistory: scopedRecords("leave_requests", scope),
    tasks: scopedRecords("tasks", scope),
    targets: scopedRecords("targets", scope),
    meetings: scopedRecords("meetings", scope),
    expenses: scopedRecords("expenses", scope),
    performanceReviews: scopedRecords("performance_reviews", scope),
  };
}

function assertNoSelfPrivilegeMutation(payload = {}) {
  const forbidden = [
    "role",
    "roleId",
    "role_id",
    "permissions",
    "departmentId",
    "department_id",
    "employeeId",
    "employee_id",
    "salary",
    "status",
    "employmentStatus",
    "employment_status",
  ];
  const found = forbidden.find((key) => payload[key] !== undefined);
  if (found) {
    throw createHttpError(403, "Employee profile cannot change access, department, salary, or employment status fields.", "EMPLOYEE_SELF_FIELD_FORBIDDEN", { field: found });
  }
}

function updateEmploymentRecord(payload = {}, req) {
  const scope = buildScope(req.user);
  assertNoSelfPrivilegeMutation(payload);
  const personal = payload.personalInformation || payload.personal || {};
  const emergencyContact = payload.emergencyContact || payload.emergency_contact || personal.emergencyContact || personal.emergency_contact;
  const displayName = payload.fullName || payload.name || payload.displayName || personal.fullName;
  const employeeUpdates = compactObject({
    fullName: displayName,
    name: displayName,
    phone: payload.phone ?? personal.phone,
    address: payload.address ?? personal.address,
    profilePhoto: payload.profilePhoto || payload.profile_photo || payload.avatarUrl || payload.avatar_url,
    profile_photo: payload.profile_photo || payload.profilePhoto || payload.avatar_url || payload.avatarUrl,
    emergencyContact,
    emergency_contact: emergencyContact,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: now(),
    updated_at: now(),
  });
  const employees = readCollection("employees");
  const index = employees.findIndex((employee) => employee.id === scope.employeeId);
  const oldValue = index === -1 ? null : employees[index];
  if (index !== -1) {
    employees[index] = { ...employees[index], ...employeeUpdates, id: employees[index].id };
    writeCollection("employees", employees);
  }
  if (displayName || payload.phone || payload.preferences || payload.avatarUrl || payload.avatar_url) {
    updateUser(req.user.id, compactObject({
      name: displayName,
      fullName: displayName,
      phone: payload.phone ?? personal.phone,
      preferences: payload.preferences,
      avatarUrl: payload.avatarUrl || payload.avatar_url || payload.profilePhoto || payload.profile_photo,
      avatar_url: payload.avatar_url || payload.avatarUrl || payload.profile_photo || payload.profilePhoto,
      updatedBy: req.user.id,
    }));
  }
  audit(req, "EMPLOYEE_PROFILE_UPDATED", "employee_profile", scope.employeeId, oldValue, employeeUpdates, scope);
  return getEmploymentRecord(getUserById(req.user.id) || req.user);
}

function updateTaskProgress(id, payload = {}, req) {
  const scope = buildScope(req.user);
  const records = readCollection("tasks");
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  const oldValue = records[index];
  if (!taskInScope(oldValue, scope)) {
    throw createHttpError(403, "Requested task is outside this employee's scope.", "RESOURCE_OUT_OF_EMPLOYEE_SCOPE", { id });
  }

  const progress = payload.progress ?? payload.progressPercent ?? payload.progress_percent;
  const status = payload.status || (progress !== undefined && toNumber(progress) >= 100 ? "COMPLETED" : oldValue.status);
  const updated = {
    ...oldValue,
    id,
    ...(progress !== undefined ? { progress: Math.max(0, Math.min(100, toNumber(progress))), progressPercent: Math.max(0, Math.min(100, toNumber(progress))), progress_percent: Math.max(0, Math.min(100, toNumber(progress))) } : {}),
    status,
    progressNote: payload.note || payload.progressNote || payload.progress_note || oldValue.progressNote || null,
    progress_note: payload.note || payload.progress_note || payload.progressNote || oldValue.progress_note || null,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: now(),
    updated_at: now(),
  };
  records[index] = updated;
  writeCollection("tasks", records);
  audit(req, "EMPLOYEE_TASK_PROGRESS_UPDATED", "tasks", id, oldValue, updated, scope);
  return { oldValue, record: updated };
}

function updateSettings(payload = {}, req) {
  assertNoSelfPrivilegeMutation(payload);
  const preferences = payload.preferences || payload.employeePreferences || payload.employee_preferences || {};
  if (preferences && typeof preferences !== "object") {
    throw createHttpError(400, "Employee preferences must be an object.", "INVALID_EMPLOYEE_PREFERENCES");
  }
  const current = getUserById(req.user.id) || req.user;
  const updated = updateUser(req.user.id, {
    preferences: { ...(current.preferences || {}), ...preferences },
    updatedBy: req.user.id,
  });
  return { profile: getEmploymentRecord(updated || req.user).overview, preferences: updated?.preferences || {} };
}

function markNotificationRead(id, req) {
  const scope = buildScope(req.user);
  const records = readCollection("notifications");
  const index = records.findIndex((record) => record.id === id && recordMatchesIdentifiers(record, scope, ["userId", "user_id", "recipientUserId", "recipient_user_id", "employeeId", "employee_id", "recipientEmployeeId", "recipient_employee_id"]));
  if (index === -1) return null;
  records[index] = { ...records[index], readAt: now(), read_at: now(), status: "read", updatedAt: now(), updated_at: now() };
  writeCollection("notifications", records);
  return records[index];
}

function audit(req, action, module, recordId, oldValue, newValue, scope) {
  return recordOperationalAudit({
    user: req.user,
    action,
    module: `Employee ${module}`,
    recordId,
    targetType: module,
    oldValue,
    newValue,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    metadata: {
      role: req.user?.role || "employee",
      organizationId: scope.organizationId,
      departmentId: scope.departmentId,
      employeeId: scope.employeeId,
    },
  });
}

module.exports = {
  buildScope,
  getDashboard,
  getEmploymentRecord,
  getScopeSummary,
  listExpenses: (user, query) => listCollection("expenses", user, query, ["reference", "description", "category", "categoryName", "status"]),
  listLeaveBalances: (user, query) => {
    const scope = buildScope(user);
    return paginate(applyBasicFilters(leaveBalances(scope), query, ["leaveTypeName", "leave_type_name"]), query);
  },
  listLeaveRequests: (user, query) => listCollection("leave_requests", user, query, ["leaveTypeName", "leave_type_name", "status", "note", "reason"]),
  listLeaveTypes: (query) => leaveService.listLeaveTypes(query),
  listMeetings: (user, query) => listCollection("meetings", user, query, ["title", "agenda", "location", "status"]),
  listNotifications: (user, query) => listCollection("notifications", user, query, ["title", "body", "message", "type", "status"]),
  listPerformance: (user, query) => listCollection("performance_reviews", user, query, ["reviewPeriod", "rating", "status", "comments"]),
  listTargets: (user, query) => listCollection("targets", user, query, ["title", "description", "metricName", "status"]),
  listTasks: (user, query) => listCollection("tasks", user, query, ["title", "description", "status", "priority"]),
  getExpense: (id, user) => expenseService.getExpenseDetails(id, user),
  getLeaveRequest: (id, user) => leaveService.getLeaveRequest(id, user),
  getMeeting: (id, user) => meetingService.getMeetingDetails(id, user),
  getTarget: (id, user) => targetService.getTargetDetails(id, user),
  createExpense: (payload, user) => expenseService.createExpense(payload, user),
  createLeaveRequest: (payload, user, req) => leaveService.createLeaveRequest(payload, user, req),
  updateExpense: (id, payload, user) => expenseService.updateExpense(id, payload, user),
  submitExpense: (id, payload, user) => expenseService.submitExpense(id, payload, user),
  cancelExpense: (id, payload, user) => expenseService.cancelExpense(id, payload, user),
  updateTargetProgress: (id, payload, user) => targetService.updateProgress(id, payload, user),
  markNotificationRead,
  updateEmploymentRecord,
  updateSettings,
  updateTaskProgress,
};
