const crypto = require("crypto");
const { getUserById, updateUser } = require("../../auth/userStore");
const { hasPermission } = require("../../constants/rbac");
const { readCollection, writeCollection, appendRecord } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const { queueNotification } = require("../_shared/notificationService");

const MANAGER_NAVIGATION = Object.freeze([
  "Overview",
  "My Team",
  "Attendance",
  "Leave",
  "Tasks",
  "Targets / KPIs",
  "Performance",
  "Meetings",
  "Discipline",
  "Promotions",
  "Salary Recommendations",
  "Finance / Expenses",
  "Procurement",
  "Reports",
  "Notifications",
  "Help Center",
  "Settings",
  "Sign Out",
]);

const HOD_NAVIGATION = Object.freeze([
  "Dashboard",
  "Team Members",
  "Department Tasks",
  "Targets & KPIs",
  "Department Meeting",
  "Reports",
  "Notifications",
  "Settings",
  "Sign Out",
]);

const DEPARTMENT_LEAD_ROLES = new Set(["manager", "hod"]);

const SEARCH_FIELDS = Object.freeze({
  employees: ["fullName", "name", "employeeId", "employee_id", "email", "phone", "status"],
  departments: ["name", "code", "description", "status"],
  attendance: ["employeeName", "employee_name", "status", "source", "notes"],
  leave_requests: ["employeeName", "employee_name", "leaveTypeName", "leave_type_name", "status", "reason"],
  performance_reviews: ["employeeName", "employee_name", "rating", "status", "reviewPeriod", "review_period", "comments"],
  promotions: ["employeeName", "employee_name", "status", "reason"],
  salary_adjustments: ["employeeName", "employee_name", "adjustmentType", "adjustment_type", "status", "reason"],
  meetings: ["title", "agenda", "location", "status"],
  tasks: ["title", "description", "status", "priority"],
  targets: ["title", "description", "status", "priority"],
  expenses: ["title", "employeeName", "employee_name", "category", "status"],
  bills: ["billNumber", "bill_number", "vendorName", "vendor_name", "description", "status"],
  purchase_requests: ["title", "requestNumber", "request_number", "vendorName", "vendor_name", "status"],
  events: ["title", "location", "status", "description"],
  disciplinary_cases: ["caseNumber", "case_number", "employeeName", "employee_name", "status", "severity"],
  notifications: ["title", "body", "type", "status"],
  operational_audit_logs: ["action", "module", "actorName", "actor_name", "targetType", "target_type"],
});

const FINAL_TASK_STATUSES = new Set(["COMPLETED", "DONE", "CLOSED", "CANCELLED"]);
const FORBIDDEN_MANAGER_PROFILE_FIELDS = Object.freeze([
  "role",
  "roleId",
  "role_id",
  "permissions",
  "permissionIds",
  "permission_ids",
  "systemAccess",
  "system_access",
  "dashboardAccess",
  "dashboard_access",
  "accountType",
  "account_type",
  "departmentId",
  "department_id",
  "positionId",
  "position_id",
  "managerId",
  "manager_id",
  "salary",
  "salaryStructure",
  "salary_structure",
  "status",
  "employmentStatus",
  "employment_status",
  "security",
  "auth",
  "systemSettings",
  "system_settings",
]);

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

function accessLabel(user) {
  return normalizeRole(user?.role) === "hod" ? "HOD" : "Manager";
}

function normalizeStatus(value, fallback = "PENDING") {
  return String(value || fallback).trim().toUpperCase();
}

function statusKey(value, fallback = "") {
  return String(value || fallback).trim().toLowerCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function valueOf(record, keys) {
  for (const key of keys) {
    if (record && record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return null;
}

function arrayValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt && !record.deleted_at && record.status !== "deleted");
}

function updateRecord(collection, id, updates) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  records[index] = {
    ...records[index],
    ...updates,
    id: records[index].id,
    updatedAt: now(),
    updated_at: now(),
  };
  writeCollection(collection, records);
  return records[index];
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
    departmentId: employee.departmentId || employee.department_id || null,
    department_id: employee.department_id || employee.departmentId || null,
    status: employee.status || employee.employmentStatus || employee.employment_status || "active",
  };
}

function findEmployeeRecord(id) {
  return id ? activeRecords("employees").find((employee) => employee.id === id || employee.employeeId === id || employee.employee_id === id) || null : null;
}

function findDepartmentRecord(id) {
  return id ? activeRecords("departments").find((department) => department.id === id) || null : null;
}

function findPositionRecord(id) {
  return id ? activeRecords("positions").find((position) => position.id === id) || null : null;
}

function actorMatchesRecord(record, scope, keys) {
  return keys.some((key) => {
    const value = record?.[key];
    if (Array.isArray(value)) {
      return value.some((entry) => scope.identifiers.has(entry));
    }
    return value && scope.identifiers.has(value);
  });
}

function selfRecords(collection, scope, keys) {
  return activeRecords(collection).filter((record) => organizationMatches(record, scope) && actorMatchesRecord(record, scope, keys));
}

function getActorEmployee(user) {
  const { resolveEmployeeForUser } = require("../employees/employeeProfile");
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

function getRecordOrganizationId(record) {
  return valueOf(record, ["organizationId", "organization_id", "employerId", "employer_id", "companyId", "company_id"]);
}

function managerIdentifiers(user, employee = null) {
  return new Set(
    [
      user?.id,
      user?.employeeId,
      user?.employee_id,
      employee?.id,
      employee?.employeeId,
      employee?.employee_id,
      employee?.userId,
      employee?.user_id,
    ].filter(Boolean)
  );
}

function organizationMatches(record, scope) {
  const recordOrgId = getRecordOrganizationId(record);
  return !scope.organizationId || !recordOrgId || String(recordOrgId) === String(scope.organizationId);
}

function buildScope(user) {
  if (!DEPARTMENT_LEAD_ROLES.has(normalizeRole(user?.role))) {
    throw createHttpError(403, "Manager access is required.", "MANAGER_ROLE_REQUIRED");
  }

  const managerEmployee = getActorEmployee(user);
  const identifiers = managerIdentifiers(user, managerEmployee);
  const departmentIds = new Set([
    user.departmentId,
    user.department_id,
    managerEmployee?.departmentId,
    managerEmployee?.department_id,
    ...arrayValue(user.departmentIds),
    ...arrayValue(user.department_ids),
  ].filter(Boolean));

  for (const assignment of activeRecords("user_departments")) {
    if ((assignment.userId || assignment.user_id) === user.id) {
      departmentIds.add(assignment.departmentId || assignment.department_id);
    }
  }

  for (const department of activeRecords("departments")) {
    const departmentManagers = [
      department.managerId,
      department.manager_id,
      department.managerUserId,
      department.manager_user_id,
      department.hodId,
      department.hod_id,
      department.headId,
      department.head_id,
      department.headEmployeeId,
      department.head_employee_id,
      department.assistantHodId,
      department.assistant_hod_id,
    ];
    if (departmentManagers.some((id) => identifiers.has(id))) {
      departmentIds.add(department.id);
    }
  }

  const organizationId = getOrganizationId(user, managerEmployee);
  const scopedDepartments = activeRecords("departments").filter(
    (department) => departmentIds.has(department.id) && organizationMatches(department, { organizationId })
  );

  const teamEmployees = activeRecords("employees").filter((employee) => employeeInManagerScope(employee, {
    user,
    managerEmployee,
    identifiers,
    departmentIds,
    organizationId,
  }));

  return {
    user,
    organizationId,
    managerEmployee,
    managerEmployeeId: managerEmployee?.id || user.employeeId || user.employee_id || null,
    identifiers,
    departmentIds,
    employeeIds: new Set(teamEmployees.map((employee) => employee.id)),
    departments: scopedDepartments,
    employees: teamEmployees,
  };
}

function employeeInManagerScope(employee, scope) {
  if (!employee || !organizationMatches(employee, scope)) return false;

  const employeeDepartmentId = valueOf(employee, ["departmentId", "department_id"]);
  if (employeeDepartmentId && scope.departmentIds.has(employeeDepartmentId)) return true;

  const reportingIds = [
    employee.managerId,
    employee.manager_id,
    employee.managerEmployeeId,
    employee.manager_employee_id,
    employee.supervisorId,
    employee.supervisor_id,
    employee.reportsTo,
    employee.reports_to,
  ];
  if (reportingIds.some((id) => scope.identifiers.has(id))) return true;

  return Boolean(scope.managerEmployee && employee.id === scope.managerEmployee.id);
}

function hasManagerPermission(user, permission) {
  return !permission || hasPermission(user, permission);
}

function assertManagerPermission(user, permission) {
  if (!hasManagerPermission(user, permission)) {
    throw createHttpError(403, "You do not have permission to perform this Manager action.", "FORBIDDEN", { permission });
  }
}

function getRecordDepartmentId(record) {
  return valueOf(record, [
    "departmentId",
    "department_id",
    "requestedDepartmentId",
    "requested_department_id",
    "assignedDepartmentId",
    "assigned_department_id",
    "newDepartmentId",
    "new_department_id",
  ]);
}

function getRecordEmployeeId(record) {
  return valueOf(record, [
    "employeeId",
    "employee_id",
    "staffId",
    "staff_id",
    "assignedEmployeeId",
    "assigned_employee_id",
    "assigneeEmployeeId",
    "assignee_employee_id",
    "recipientEmployeeId",
    "recipient_employee_id",
  ]);
}

function recordCreatedByManager(record, scope) {
  const creator = valueOf(record, ["createdBy", "created_by", "requestedBy", "requested_by", "assignedBy", "assigned_by", "organizerId", "organizer_id"]);
  return creator && scope.identifiers.has(creator);
}

function recordInScope(record, scope, options = {}) {
  if (!record || !organizationMatches(record, scope)) return false;

  if (options.collection === "departments") {
    return scope.departmentIds.has(record.id);
  }

  if (options.collection === "employees") {
    return employeeInManagerScope(record, scope);
  }

  const departmentId = getRecordDepartmentId(record);
  if (departmentId && scope.departmentIds.has(departmentId)) return true;

  const employeeId = getRecordEmployeeId(record);
  if (employeeId && scope.employeeIds.has(employeeId)) return true;

  if (Array.isArray(record.employeeIds) && record.employeeIds.some((id) => scope.employeeIds.has(id))) return true;
  if (Array.isArray(record.employee_ids) && record.employee_ids.some((id) => scope.employeeIds.has(id))) return true;
  if (Array.isArray(record.departmentIds) && record.departmentIds.some((id) => scope.departmentIds.has(id))) return true;
  if (Array.isArray(record.department_ids) && record.department_ids.some((id) => scope.departmentIds.has(id))) return true;

  if (options.allowCreatedBy && recordCreatedByManager(record, scope)) return true;

  return false;
}

function isToday(value) {
  return Boolean(value) && String(value).slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function dateInRange(start, end, date = new Date()) {
  if (!start && !end) return false;
  const timestamp = date.getTime();
  const startTime = start ? new Date(start).getTime() : Number.NEGATIVE_INFINITY;
  const endTime = end ? new Date(`${String(end).slice(0, 10)}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY;
  return !Number.isNaN(startTime) && !Number.isNaN(endTime) && timestamp >= startTime && timestamp <= endTime;
}

function summarizeAttendance(attendance, employees) {
  const todayAttendance = attendance.filter((record) => isToday(record.date || record.createdAt || record.created_at));
  const presentStatuses = new Set(["present", "late", "remote"]);
  const present = todayAttendance.filter((record) => presentStatuses.has(statusKey(record.status))).length;

  return {
    todayTotal: todayAttendance.length,
    present,
    absent: todayAttendance.filter((record) => statusKey(record.status) === "absent").length,
    late: todayAttendance.filter((record) => statusKey(record.status) === "late").length,
    onLeave: todayAttendance.filter((record) => ["on_leave", "leave"].includes(statusKey(record.status))).length,
    halfDay: todayAttendance.filter((record) => ["half_day", "half-day"].includes(statusKey(record.status))).length,
    attendanceRate: employees.length ? Math.round((present / employees.length) * 100) : 0,
  };
}

function targetProgress(targets) {
  const values = targets
    .map((target) => {
      const explicitProgress = target.progress ?? target.progressPercent ?? target.progress_percent;
      if (explicitProgress !== undefined && explicitProgress !== null && explicitProgress !== "") {
        return Math.max(0, Math.min(100, toNumber(explicitProgress)));
      }

      const current = toNumber(target.currentValue ?? target.current_value ?? target.actualValue ?? target.actual_value);
      const targetValue = toNumber(target.targetValue ?? target.target_value ?? target.value);
      return targetValue > 0 ? Math.max(0, Math.min(100, (current / targetValue) * 100)) : null;
    })
    .filter((value) => value !== null);

  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
}

function activeLeaveCount(leaveRequests) {
  return leaveRequests.filter((record) =>
    normalizeStatus(record.status) === "APPROVED" &&
    dateInRange(record.startDate || record.start_date, record.endDate || record.end_date)
  ).length;
}

function notifyEmployee(record, type, title, body, data = {}) {
  const employeeId = getRecordEmployeeId(record);
  if (!employeeId) return null;
  return queueNotification({
    recipientEmployeeId: employeeId,
    type,
    title,
    body,
    data,
  });
}

function assertDepartmentInScope(departmentId, scope) {
  if (departmentId && !scope.departmentIds.has(departmentId)) {
    throw createHttpError(403, "Requested department is outside this Manager's scope.", "RESOURCE_OUT_OF_MANAGER_SCOPE", { departmentId });
  }
}

function assertEmployeeInScope(employeeId, scope) {
  if (employeeId && !scope.employeeIds.has(employeeId)) {
    throw createHttpError(403, "Requested employee is outside this Manager's scope.", "RESOURCE_OUT_OF_MANAGER_SCOPE", { employeeId });
  }
}

function assertPayloadInScope(payload, scope) {
  const departmentId = getRecordDepartmentId(payload);
  const employeeId = getRecordEmployeeId(payload);
  assertDepartmentInScope(departmentId, scope);
  assertEmployeeInScope(employeeId, scope);
}

function withScopeDefaults(payload, scope, fallback = {}) {
  const employeeId = getRecordEmployeeId(payload);
  const employee = employeeId ? scope.employees.find((item) => item.id === employeeId) : null;
  const departmentId = getRecordDepartmentId(payload) || employee?.departmentId || employee?.department_id || [...scope.departmentIds][0] || null;

  return {
    ...fallback,
    ...payload,
    ...(departmentId ? { departmentId, department_id: departmentId } : {}),
    ...(scope.organizationId ? { organizationId: scope.organizationId, organization_id: scope.organizationId } : {}),
  };
}

function findScopedRecord(collection, id, scope, options = {}) {
  const record = activeRecords(collection).find((item) => item.id === id);
  if (!record) return null;
  if (!recordInScope(record, scope, { ...options, collection })) {
    throw createHttpError(403, "Requested resource is outside this Manager's scope.", "RESOURCE_OUT_OF_MANAGER_SCOPE", { collection, id });
  }
  return record;
}

function listScoped(collection, query, scope, options = {}) {
  assertDepartmentInScope(query.departmentId || query.department_id, scope);
  assertEmployeeInScope(query.employeeId || query.employee_id, scope);
  const records = activeRecords(collection).filter((record) => recordInScope(record, scope, { ...options, collection }));
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, options.searchFields || SEARCH_FIELDS[collection] || []), query);
}

function writeScopedRecord(collection, id, updates, req, options = {}) {
  const scope = buildScope(req.user);
  assertManagerPermission(req.user, options.permission);
  assertPayloadInScope(updates, scope);
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;

  const oldValue = records[index];
  if (!recordInScope(oldValue, scope, { ...options, collection })) {
    throw createHttpError(403, "Requested resource is outside this Manager's scope.", "RESOURCE_OUT_OF_MANAGER_SCOPE", { collection, id });
  }

  const record = {
    ...oldValue,
    ...updates,
    id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: now(),
    updated_at: now(),
  };
  records[index] = record;
  writeCollection(collection, records);
  audit(req, options.auditAction || "MANAGER_RECORD_UPDATED", collection, id, oldValue, record, scope);
  return { oldValue, record };
}

function createScopedRecord(collection, payload, req, options = {}) {
  const scope = buildScope(req.user);
  assertManagerPermission(req.user, options.permission);
  assertPayloadInScope(payload || {}, scope);
  const timestamp = now();
  const record = {
    id: crypto.randomUUID(),
    ...withScopeDefaults(payload || {}, scope, options.defaults || {}),
    createdBy: req.user.id,
    created_by: req.user.id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  appendRecord(collection, record);
  audit(req, options.auditAction || "MANAGER_RECORD_CREATED", collection, record.id, null, record, scope);
  if (options.notification) {
    notifyEmployee(record, options.notification.type, options.notification.title, options.notification.body, { collection, recordId: record.id });
  }
  return record;
}

function audit(req, action, module, recordId, oldValue, newValue, scope) {
  const label = accessLabel(req.user);
  return recordOperationalAudit({
    user: req.user,
    action,
    module: `${label} ${module}`,
    recordId,
    targetType: module,
    oldValue,
    newValue,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    metadata: {
      role: req.user?.role || "manager",
      organizationId: scope.organizationId,
      departmentIds: [...scope.departmentIds],
      managerEmployeeId: scope.managerEmployeeId,
    },
  });
}

function getDashboard(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "overview.view");

  const employees = scope.employees;
  const attendance = activeRecords("attendance").filter((record) => recordInScope(record, scope, { collection: "attendance" }));
  const leaveRequests = activeRecords("leave_requests").filter((record) => recordInScope(record, scope, { collection: "leave_requests" }));
  const tasks = activeRecords("tasks").filter((record) => recordInScope(record, scope, { collection: "tasks", allowCreatedBy: true }));
  const targets = activeRecords("targets").filter((record) => recordInScope(record, scope, { collection: "targets", allowCreatedBy: true }));
  const performanceReviews = activeRecords("performance_reviews").filter((record) => recordInScope(record, scope, { collection: "performance_reviews", allowCreatedBy: true }));
  const meetings = activeRecords("meetings").filter((record) => recordInScope(record, scope, { collection: "meetings", allowCreatedBy: true }));
  const expenses = activeRecords("expenses").filter((record) => recordInScope(record, scope, { collection: "expenses", allowCreatedBy: true }));
  const purchases = activeRecords("purchase_requests").filter((record) => recordInScope(record, scope, { collection: "purchase_requests", allowCreatedBy: true }));
  const events = activeRecords("events").filter((record) => recordInScope(record, scope, { collection: "events", allowCreatedBy: true }));
  const discipline = activeRecords("disciplinary_cases").filter((record) => recordInScope(record, scope, { collection: "disciplinary_cases" }));
  const attendanceSummary = summarizeAttendance(attendance, employees);

  return {
    scope: serializeScope(scope),
    metrics: {
      teamEmployees: employees.length,
      activeEmployees: employees.filter((employee) => String(employee.status || employee.employmentStatus || employee.employment_status || "active").toLowerCase() === "active").length,
      departments: scope.departments.length,
      presentToday: attendanceSummary.present,
      absentToday: attendanceSummary.absent,
      lateToday: attendanceSummary.late,
      employeesOnLeave: activeLeaveCount(leaveRequests),
      pendingLeave: leaveRequests.filter((record) => normalizeStatus(record.status) === "PENDING").length,
      pendingTasks: tasks.filter((record) => normalizeStatus(record.status) === "PENDING").length,
      overdueTasks: tasks.filter((record) => record.dueDate && new Date(record.dueDate).getTime() < Date.now() && normalizeStatus(record.status) !== "COMPLETED").length,
      activeTargets: targets.filter((record) => ["ACTIVE", "IN_PROGRESS"].includes(normalizeStatus(record.status, "ACTIVE"))).length,
      targetProgress: targetProgress(targets),
      pendingPerformanceReviews: performanceReviews.filter((record) => ["PENDING", "DRAFT", "REVIEW"].includes(normalizeStatus(record.status, "PENDING"))).length,
      upcomingMeetings: meetings.filter((record) => new Date(record.startAt || record.start_at || record.scheduledAt || record.scheduled_at || record.date || 0).getTime() >= Date.now()).length,
      financeRequests: expenses.length + purchases.length,
      pendingRequests: [...leaveRequests, ...expenses, ...purchases, ...performanceReviews].filter((record) => ["PENDING", "SUBMITTED", "UNDER_REVIEW", "REVIEW"].includes(normalizeStatus(record.status, "PENDING"))).length,
      upcomingEvents: events.filter((record) => new Date(record.startDate || record.start_date || record.date || 0).getTime() >= Date.now()).length,
      openDisciplineCases: discipline.filter((record) => !["CLOSED", "RESOLVED"].includes(normalizeStatus(record.status, "OPEN"))).length,
    },
    approvals: buildApprovalQueue(scope, query).data,
    departments: scope.departments.map((department) => ({
      id: department.id,
      name: department.name || department.departmentName || department.department_name,
      code: department.code || department.departmentCode || department.department_code || null,
      employees: employees.filter((employee) => (employee.departmentId || employee.department_id) === department.id).length,
      status: department.status || "active",
    })),
    recentActivity: listAuditLogs(user, { limit: 10 }).data,
    attendance: attendanceSummary,
    navigation: MANAGER_NAVIGATION,
    meta: {
      period: query.period || "current",
      access: "department_team_scoped",
    },
  };
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

function statusCounts(records, fallback = "PENDING") {
  return records.reduce((counts, record) => {
    const key = normalizeStatus(record.status, fallback).toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function percentValue(record) {
  const explicitProgress = record.progress ?? record.progressPercent ?? record.progress_percent;
  if (explicitProgress !== undefined && explicitProgress !== null && explicitProgress !== "") {
    return Math.max(0, Math.min(100, Math.round(toNumber(explicitProgress))));
  }

  const current = toNumber(record.currentValue ?? record.current_value ?? record.actualValue ?? record.actual_value);
  const target = toNumber(record.targetValue ?? record.target_value ?? record.value);
  return target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;
}

function getPrimaryDepartment(scope) {
  const department = scope.departments[0] || findDepartmentRecord([...scope.departmentIds][0]);
  if (!department) return null;
  const employees = scope.employees.filter((employee) => (employee.departmentId || employee.department_id) === department.id);

  return {
    id: department.id,
    name: department.name || department.departmentName || department.department_name || null,
    code: department.code || department.departmentCode || department.department_code || null,
    description: department.description || null,
    status: department.status || "active",
    organizationId: department.organizationId || department.organization_id || scope.organizationId || null,
    organization_id: department.organization_id || department.organizationId || scope.organizationId || null,
    hod: employeeSummary(scope.managerEmployee),
    headcount: employees.length,
    activeMembers: employees.filter((employee) => statusKey(employee.status || employee.employmentStatus || employee.employment_status, "active") === "active").length,
  };
}

function getHodWorkspace(user, query = {}) {
  const scope = buildScope(user);
  const dashboard = getDashboard(user, query);
  const limit = Math.max(1, Math.min(25, Number(query.previewLimit || query.limit || 6) || 6));
  const tasks = activeRecords("tasks").filter((record) => recordInScope(record, scope, { collection: "tasks", allowCreatedBy: true }));
  const targets = activeRecords("targets").filter((record) => recordInScope(record, scope, { collection: "targets", allowCreatedBy: true }));
  const meetings = activeRecords("meetings").filter((record) => recordInScope(record, scope, { collection: "meetings", allowCreatedBy: true }));
  const leaveRequests = activeRecords("leave_requests").filter((record) => recordInScope(record, scope, { collection: "leave_requests" }));

  return {
    scope: dashboard.scope,
    department: getPrimaryDepartment(scope),
    metrics: dashboard.metrics,
    teamMembers: {
      total: scope.employees.length,
      active: scope.employees.filter((employee) => statusKey(employee.status || employee.employmentStatus || employee.employment_status, "active") === "active").length,
      onLeave: activeLeaveCount(leaveRequests),
      items: scope.employees.slice(0, limit).map(employeeSummary),
      tabs: [
        { key: "all", label: "All", count: scope.employees.length },
        { key: "active", label: "Active", count: scope.employees.filter((employee) => statusKey(employee.status || employee.employmentStatus || employee.employment_status, "active") === "active").length },
        { key: "inactive", label: "Inactive", count: scope.employees.filter((employee) => statusKey(employee.status || employee.employmentStatus || employee.employment_status, "active") !== "active").length },
        { key: "on_leave", label: "On Leave", count: activeLeaveCount(leaveRequests) },
      ],
    },
    tasks: {
      total: tasks.length,
      counts: statusCounts(tasks),
      items: newestFirst(tasks).slice(0, limit),
    },
    targets: {
      total: targets.length,
      averageProgress: targetProgress(targets),
      counts: statusCounts(targets, "ACTIVE"),
      items: newestFirst(targets).slice(0, limit).map((target) => ({ ...target, progress: percentValue(target) })),
    },
    meetings: {
      total: meetings.length,
      upcoming: meetings.filter((meeting) => dateValue(meeting, ["startAt", "start_at", "scheduledAt", "scheduled_at", "date"]) >= Date.now()).length,
      counts: statusCounts(meetings, "SCHEDULED"),
      items: newestFirst(meetings, ["startAt", "start_at", "scheduledAt", "scheduled_at", "date", "createdAt", "created_at"]).slice(0, limit),
    },
    approvals: dashboard.approvals,
    navigation: HOD_NAVIGATION,
    meta: {
      period: query.period || "current",
      access: "hod_department_scoped",
    },
  };
}

function serializeScope(scope) {
  return {
    organizationId: scope.organizationId,
    managerEmployeeId: scope.managerEmployeeId,
    departmentIds: [...scope.departmentIds],
    employeeIds: [...scope.employeeIds],
  };
}

function getScopeSummary(user) {
  return serializeScope(buildScope(user));
}

function getStats(user, query = {}) {
  const dashboard = getDashboard(user, query);
  return dashboard.metrics;
}

function listEmployees(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "employees.view");
  return listScoped("employees", query, scope, { searchFields: SEARCH_FIELDS.employees });
}

function getEmployee(user, id) {
  const scope = buildScope(user);
  assertManagerPermission(user, "employees.view");
  return findScopedRecord("employees", id, scope);
}

function listDepartments(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "departments.view");
  return listScoped("departments", query, scope, { searchFields: SEARCH_FIELDS.departments });
}

function getDepartment(user, id) {
  const scope = buildScope(user);
  assertManagerPermission(user, "departments.view");
  return findScopedRecord("departments", id, scope);
}

function listAttendance(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "attendance.view");
  return listScoped("attendance", query, scope, { searchFields: SEARCH_FIELDS.attendance });
}

function correctAttendance(id, payload, req) {
  return writeScopedRecord("attendance", id, compactObject({
    checkIn: payload.checkIn || payload.check_in,
    check_in: payload.checkIn || payload.check_in,
    checkOut: payload.checkOut || payload.check_out,
    check_out: payload.checkOut || payload.check_out,
    status: payload.status,
    lateMinutes: payload.lateMinutes ?? payload.late_minutes,
    late_minutes: payload.lateMinutes ?? payload.late_minutes,
    overtimeMinutes: payload.overtimeMinutes ?? payload.overtime_minutes,
    overtime_minutes: payload.overtimeMinutes ?? payload.overtime_minutes,
    notes: payload.notes,
    correctedBy: req.user.id,
    corrected_by: req.user.id,
    correctionReason: payload.reason || payload.correctionReason || payload.correction_reason || null,
    correction_reason: payload.reason || payload.correctionReason || payload.correction_reason || null,
  }), req, { permission: "attendance.correct", auditAction: "MANAGER_ATTENDANCE_CORRECTED" });
}

function listPerformance(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "performance.view");
  return listScoped("performance_reviews", query, scope, { allowCreatedBy: true, searchFields: SEARCH_FIELDS.performance_reviews });
}

function createPerformanceReview(payload, req) {
  const record = createScopedRecord("performance_reviews", {
    ...payload,
    status: payload.status || "DRAFT",
    reviewerId: req.user.id,
    reviewer_id: req.user.id,
  }, req, { permission: "performance.create", auditAction: "MANAGER_PERFORMANCE_REVIEW_CREATED" });
  notifyEmployee(record, "performance_review_created", "Performance review created", "A performance review was created for you.", { performanceReviewId: record.id });
  return record;
}

function updatePerformanceReview(id, payload, req) {
  const result = writeScopedRecord("performance_reviews", id, payload, req, {
    permission: "performance.review",
    allowCreatedBy: true,
    auditAction: "MANAGER_PERFORMANCE_REVIEW_UPDATED",
  });
  if (result) {
    notifyEmployee(result.record, "performance_review_updated", "Performance review updated", "Your performance review was updated.", { performanceReviewId: id });
  }
  return result;
}

function createLeave(payload, req) {
  const scope = buildScope(req.user);
  assertManagerPermission(req.user, "leave.create");
  const employeeId = payload.employeeId || payload.employee_id || scope.managerEmployeeId;
  assertEmployeeInScope(employeeId, scope);
  const employee = scope.employees.find((item) => item.id === employeeId);
  return createScopedRecord("leave_requests", {
    ...payload,
    employeeId,
    employee_id: employeeId,
    employeeName: payload.employeeName || payload.employee_name || getEmployeeName(employee),
    employee_name: payload.employeeName || payload.employee_name || getEmployeeName(employee),
    status: "PENDING",
    requestedAt: now(),
    requested_at: now(),
  }, req, { permission: "leave.create", auditAction: "MANAGER_LEAVE_REQUEST_CREATED" });
}

function updateStatus(collection, id, status, req, options) {
  const scope = buildScope(req.user);
  assertManagerPermission(req.user, options.permission);
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  const oldValue = records[index];

  if (!recordInScope(oldValue, scope, { ...options, collection })) {
    throw createHttpError(403, "Requested resource is outside this Manager's scope.", "RESOURCE_OUT_OF_MANAGER_SCOPE", { collection, id });
  }

  if (options.requirePending && normalizeStatus(oldValue.status) !== "PENDING") {
    throw createHttpError(409, "Only pending records can be approved or rejected.", "MANAGER_STATUS_NOT_PENDING", { collection, id });
  }

  assertPayloadInScope(req.body || {}, scope);
  const timestamp = now();
  const record = {
    ...oldValue,
    ...(req.body || {}),
    status,
    [`${String(status).toLowerCase()}By`]: req.user.id,
    [`${String(status).toLowerCase()}_by`]: req.user.id,
    [`${String(status).toLowerCase()}At`]: timestamp,
    [`${String(status).toLowerCase()}_at`]: timestamp,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  records[index] = record;
  writeCollection(collection, records);
  audit(req, options.auditAction || "MANAGER_RECORD_STATUS_UPDATED", collection, id, oldValue, record, scope);

  if (collection === "leave_requests") {
    notifyEmployee(record, `leave_request_${String(status).toLowerCase()}`, `Leave request ${String(status).toLowerCase()}`, `Your leave request was ${String(status).toLowerCase()}.`, { leaveRequestId: id });
  }

  return { oldValue, record };
}

function createPromotion(payload, req) {
  return createScopedRecord("promotions", {
    ...payload,
    status: "PENDING",
    requestedBy: req.user.id,
    requested_by: req.user.id,
  }, req, {
    permission: "promotions.create",
    auditAction: "MANAGER_PROMOTION_RECOMMENDED",
    notification: {
      type: "promotion_recommendation_created",
      title: "Promotion recommendation created",
      body: "A promotion recommendation was created for you.",
    },
  });
}

function createSalaryRecommendation(payload, req) {
  return createScopedRecord("salary_adjustments", {
    ...payload,
    status: "PENDING",
    requestType: payload.requestType || payload.request_type || "MANAGER_RECOMMENDATION",
    request_type: payload.requestType || payload.request_type || "MANAGER_RECOMMENDATION",
    requestedBy: req.user.id,
    requested_by: req.user.id,
  }, req, {
    permission: "salary_increments.create",
    auditAction: "MANAGER_SALARY_RECOMMENDED",
    notification: {
      type: "salary_recommendation_created",
      title: "Salary recommendation created",
      body: "A salary recommendation was created for you.",
    },
  });
}

function assertNoManagerSelfPrivilegeMutation(payload = {}) {
  const personal = payload.personalInformation || payload.personal || {};
  const preferences = payload.preferences || {};
  const candidates = { ...payload, ...personal, ...preferences };
  const found = FORBIDDEN_MANAGER_PROFILE_FIELDS.find((key) => candidates[key] !== undefined);
  if (found) {
    throw createHttpError(403, "Manager profile cannot change access, reporting, salary, status, or system-control fields.", "MANAGER_SELF_FIELD_FORBIDDEN", { field: found });
  }
}

function getSelfEmploymentRecord(user) {
  const scope = buildScope(user);
  assertManagerPermission(user, "profile.view");
  const currentUser = getUserById(user.id) || user;
  const employee = scope.managerEmployee || getActorEmployee(currentUser) || {};
  const department = findDepartmentRecord(employee.departmentId || employee.department_id || currentUser.departmentId || currentUser.department_id);
  const position = findPositionRecord(employee.positionId || employee.position_id);
  const directManager = findEmployeeRecord(employee.managerId || employee.manager_id || employee.supervisorId || employee.supervisor_id);
  const documents = [
    ...selfRecords("employee_documents", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
    ...selfRecords("staff_documents", scope, ["staffId", "staff_id", "employeeId", "employee_id"]),
  ];
  const leaveHistory = selfRecords("leave_requests", scope, ["employeeId", "employee_id", "staffId", "staff_id", "requesterId", "requester_id"]);
  const tasks = selfRecords("tasks", scope, ["assignedTo", "assigned_to", "assigneeId", "assignee_id", "employeeId", "employee_id"]);
  const targets = selfRecords("targets", scope, ["assignedTo", "assigned_to", "assigneeId", "assignee_id", "employeeId", "employee_id"]);
  const performanceReviews = selfRecords("performance_reviews", scope, ["employeeId", "employee_id", "reviewerId", "reviewer_id"]);
  const attendeeMeetingIds = new Set(selfRecords("meeting_attendees", scope, ["userId", "user_id", "employeeId", "employee_id"]).map((attendee) => attendee.meetingId || attendee.meeting_id));
  const meetings = activeRecords("meetings").filter((meeting) =>
    organizationMatches(meeting, scope) &&
    (
      attendeeMeetingIds.has(meeting.id) ||
      actorMatchesRecord(meeting, scope, ["organizerId", "organizer_id", "createdBy", "created_by", "attendees"])
    )
  );

  return {
    overview: {
      id: employee.id || currentUser.id,
      userId: currentUser.id,
      user_id: currentUser.id,
      employeeId: employee.employeeId || employee.employee_id || employee.id || currentUser.employeeId || null,
      employee_id: employee.employee_id || employee.employeeId || employee.id || currentUser.employeeId || null,
      fullName: getEmployeeName(employee) || currentUser.fullName || currentUser.name || currentUser.email,
      email: employee.email || currentUser.email || null,
      phone: employee.phone || currentUser.phone || null,
      profilePhoto: employee.profilePhoto || employee.profile_photo || employee.photo || employee.photoUrl || currentUser.avatarUrl || currentUser.avatar_url || null,
      status: employee.status || currentUser.status || "active",
      department: department ? { id: department.id, name: department.name, code: department.code || null } : null,
      position: position ? { id: position.id, title: position.title || position.name || null } : { id: employee.positionId || employee.position_id || null, title: employee.jobTitle || employee.job_title || employee.position || null },
      manager: employeeSummary(directManager),
    },
    personalInformation: {
      firstName: employee.firstName || employee.first_name || null,
      middleName: employee.middleName || employee.middle_name || null,
      lastName: employee.lastName || employee.last_name || null,
      fullName: getEmployeeName(employee) || currentUser.fullName || currentUser.name || null,
      gender: employee.gender || null,
      dateOfBirth: employee.dateOfBirth || employee.date_of_birth || null,
      phone: employee.phone || currentUser.phone || null,
      email: employee.email || currentUser.email || null,
      address: employee.address || null,
      emergencyContact: employee.emergencyContact || employee.emergency_contact || {
        name: employee.emergencyContactName || employee.emergency_contact_name || null,
        phone: employee.emergencyContactPhone || employee.emergency_contact_phone || null,
        relationship: employee.emergencyContactRelationship || employee.emergency_contact_relationship || null,
      },
    },
    employment: {
      jobTitle: employee.jobTitle || employee.job_title || employee.position || position?.title || position?.name || null,
      departmentId: department?.id || null,
      department_id: department?.id || null,
      departmentName: department?.name || employee.department || employee.departmentName || null,
      department_name: department?.name || employee.department || employee.departmentName || null,
      positionId: employee.positionId || employee.position_id || null,
      position_id: employee.position_id || employee.positionId || null,
      managerId: employee.managerId || employee.manager_id || employee.supervisorId || employee.supervisor_id || null,
      manager_id: employee.manager_id || employee.managerId || employee.supervisor_id || employee.supervisorId || null,
      employmentType: employee.employmentType || employee.employment_type || null,
      employment_type: employee.employment_type || employee.employmentType || null,
      startDate: employee.employmentStartDate || employee.employment_start_date || employee.hireDate || employee.hire_date || employee.startDate || employee.start_date || null,
      start_date: employee.employment_start_date || employee.employmentStartDate || employee.hire_date || employee.hireDate || employee.start_date || employee.startDate || null,
      workLocation: employee.workLocation || employee.work_location || employee.location || null,
      work_location: employee.work_location || employee.workLocation || employee.location || null,
      status: employee.status || currentUser.status || "active",
      history: [
        ...selfRecords("employee_employment_history", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
        ...selfRecords("employment_history", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
      ],
    },
    documents,
    leaveHistory,
    tasks,
    targets,
    meetings,
    performanceReviews,
    stats: {
      documents: documents.length,
      leaveRequests: leaveHistory.length,
      pendingTasks: tasks.filter((task) => !FINAL_TASK_STATUSES.has(normalizeStatus(task.status, "PENDING"))).length,
      activeTargets: targets.filter((target) => ["ACTIVE", "IN_PROGRESS"].includes(normalizeStatus(target.status, "ACTIVE"))).length,
      upcomingMeetings: meetings.filter((meeting) => new Date(meeting.startAt || meeting.start_at || meeting.scheduledAt || meeting.scheduled_at || meeting.date || 0).getTime() >= Date.now()).length,
    },
  };
}

function updateSelfEmploymentRecord(payload = {}, req) {
  const scope = buildScope(req.user);
  assertManagerPermission(req.user, "profile.update");
  assertNoManagerSelfPrivilegeMutation(payload);
  const employee = scope.managerEmployee || getActorEmployee(req.user);
  const oldEmployee = employee ? { ...employee } : null;
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
    emergencyContactName: payload.emergencyContactName || payload.emergency_contact_name || emergencyContact?.name,
    emergency_contact_name: payload.emergency_contact_name || payload.emergencyContactName || emergencyContact?.name,
    emergencyContactPhone: payload.emergencyContactPhone || payload.emergency_contact_phone || emergencyContact?.phone,
    emergency_contact_phone: payload.emergency_contact_phone || payload.emergencyContactPhone || emergencyContact?.phone,
    emergencyContactRelationship: payload.emergencyContactRelationship || payload.emergency_contact_relationship || emergencyContact?.relationship,
    emergency_contact_relationship: payload.emergency_contact_relationship || payload.emergencyContactRelationship || emergencyContact?.relationship,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  if (employee && Object.keys(employeeUpdates).length) {
    updateRecord("employees", employee.id, employeeUpdates);
  }
  const userUpdates = compactObject({
    name: displayName,
    fullName: displayName,
    phone: payload.phone ?? personal.phone,
    avatarUrl: payload.avatarUrl || payload.avatar_url || payload.profilePhoto || payload.profile_photo,
    avatar_url: payload.avatar_url || payload.avatarUrl || payload.profile_photo || payload.profilePhoto,
    preferences: payload.preferences,
    updatedBy: req.user.id,
  });
  if (Object.keys(userUpdates).length) {
    updateUser(req.user.id, userUpdates);
  }
  audit(req, "MANAGER_EMPLOYMENT_RECORD_UPDATED", "employment_record", employee?.id || req.user.id, oldEmployee, { employeeUpdates, userUpdates }, scope);
  return getSelfEmploymentRecord(getUserById(req.user.id) || req.user);
}

function getManagerProfile(user) {
  assertManagerPermission(user, "profile.view");
  const currentUser = getUserById(user.id) || user;
  const scope = buildScope(currentUser);
  return {
    user: {
      id: currentUser.id,
      fullName: currentUser.fullName || currentUser.name,
      email: currentUser.email,
      phone: currentUser.phone || null,
      role: currentUser.role,
      departmentId: currentUser.departmentId || currentUser.department_id || null,
      organizationId: getOrganizationId(currentUser, scope.managerEmployee),
      status: currentUser.status || "active",
      preferences: currentUser.preferences || {},
    },
    employee: employeeSummary(scope.managerEmployee),
  };
}

function updateManagerProfile(payload = {}, req) {
  updateSelfEmploymentRecord(payload, req);
  return getManagerProfile(getUserById(req.user.id) || req.user);
}

function getManagerSettings(user) {
  assertManagerPermission(user, "settings.view");
  const currentUser = getUserById(user.id) || user;
  return {
    profile: getManagerProfile(currentUser),
    preferences: currentUser.preferences || {},
  };
}

function updateManagerSettings(payload = {}, req) {
  assertManagerPermission(req.user, "settings.update");
  assertNoManagerSelfPrivilegeMutation(payload);
  const preferences = payload.preferences || payload.managerPreferences || payload.manager_preferences || {};
  if (preferences && typeof preferences !== "object") {
    throw createHttpError(400, "Manager preferences must be an object.", "INVALID_MANAGER_PREFERENCES");
  }
  const oldPreferences = req.user.preferences || {};
  const updated = updateUser(req.user.id, { preferences: { ...oldPreferences, ...preferences }, updatedBy: req.user.id });
  audit(req, "MANAGER_SETTINGS_UPDATED", "settings", req.user.id, oldPreferences, updated?.preferences || {}, buildScope(updated || req.user));
  return getManagerSettings(getUserById(req.user.id) || updated || req.user);
}

function getHelpCenter(user) {
  assertManagerPermission(user, "help_center.view");
  return {
    sections: [
      { key: "team", title: "My Team", routes: ["/api/v1/manager/team", "/api/v1/manager/attendance", "/api/v1/manager/performance"] },
      { key: "work", title: "Team Work", routes: ["/api/v1/manager/tasks", "/api/v1/manager/targets", "/api/v1/manager/meetings"] },
      { key: "requests", title: "Approvals", routes: ["/api/v1/manager/approvals", "/api/v1/manager/leave", "/api/v1/manager/promotions", "/api/v1/manager/salary-recommendations"] },
      { key: "finance", title: "Finance", routes: ["/api/v1/manager/finance", "/api/v1/manager/expenses", "/api/v1/manager/procurement-requests"] },
      { key: "records", title: "Records", routes: ["/api/v1/manager/reports", "/api/v1/manager/audit-logs", "/api/v1/manager/employment-record"] },
    ],
  };
}

function getScopedRecord(collection, id, user, options = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, options.permission);
  return findScopedRecord(collection, id, scope, options);
}

function listOverdueTasks(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "tasks.view");
  const records = activeRecords("tasks").filter((record) =>
    recordInScope(record, scope, { collection: "tasks", allowCreatedBy: true }) &&
    record.dueDate &&
    new Date(record.dueDate).getTime() < Date.now() &&
    !FINAL_TASK_STATUSES.has(normalizeStatus(record.status, "PENDING"))
  );
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, SEARCH_FIELDS.tasks), query);
}

function completeTask(id, payload = {}, req) {
  const timestamp = now();
  return writeScopedRecord("tasks", id, compactObject({
    ...payload,
    status: "COMPLETED",
    completedBy: req.user.id,
    completed_by: req.user.id,
    completedAt: timestamp,
    completed_at: timestamp,
  }), req, { permission: "tasks.update", allowCreatedBy: true, auditAction: "MANAGER_TASK_COMPLETED" });
}

function updateTargetProgress(id, payload = {}, req) {
  const progress = payload.progress ?? payload.progressPercent ?? payload.progress_percent;
  const updates = compactObject({
    ...payload,
    ...(progress !== undefined ? { progress: Math.max(0, Math.min(100, toNumber(progress))), progressPercent: Math.max(0, Math.min(100, toNumber(progress))), progress_percent: Math.max(0, Math.min(100, toNumber(progress))) } : {}),
    currentValue: payload.currentValue ?? payload.current_value ?? payload.actualValue ?? payload.actual_value,
    current_value: payload.current_value ?? payload.currentValue ?? payload.actual_value ?? payload.actualValue,
    status: progress !== undefined && toNumber(progress) >= 100 ? "COMPLETED" : payload.status,
  });
  return writeScopedRecord("targets", id, updates, req, { permission: "targets.update", allowCreatedBy: true, auditAction: "MANAGER_TARGET_PROGRESS_UPDATED" });
}

function completeTarget(id, payload = {}, req) {
  const timestamp = now();
  return writeScopedRecord("targets", id, compactObject({
    ...payload,
    status: "COMPLETED",
    progress: 100,
    progressPercent: 100,
    progress_percent: 100,
    completedBy: req.user.id,
    completed_by: req.user.id,
    completedAt: timestamp,
    completed_at: timestamp,
  }), req, { permission: "targets.update", allowCreatedBy: true, auditAction: "MANAGER_TARGET_COMPLETED" });
}

function cancelMeeting(id, payload = {}, req) {
  const timestamp = now();
  return writeScopedRecord("meetings", id, compactObject({
    ...payload,
    status: "CANCELLED",
    cancelledBy: req.user.id,
    cancelled_by: req.user.id,
    cancelledAt: timestamp,
    cancelled_at: timestamp,
    cancellationReason: payload.reason || payload.cancellationReason || payload.cancellation_reason || null,
    cancellation_reason: payload.cancellation_reason || payload.cancellationReason || payload.reason || null,
  }), req, { permission: "meetings.update", allowCreatedBy: true, auditAction: "MANAGER_MEETING_CANCELLED" });
}

function rescheduleMeeting(id, payload = {}, req) {
  const startAt = payload.startAt || payload.start_at || payload.scheduledAt || payload.scheduled_at || payload.date;
  const endAt = payload.endAt || payload.end_at;
  return writeScopedRecord("meetings", id, compactObject({
    ...payload,
    startAt,
    start_at: startAt,
    scheduledAt: payload.scheduledAt || payload.scheduled_at || startAt,
    scheduled_at: payload.scheduled_at || payload.scheduledAt || startAt,
    endAt,
    end_at: endAt,
    status: payload.status || "SCHEDULED",
    rescheduledBy: req.user.id,
    rescheduled_by: req.user.id,
    rescheduledAt: now(),
    rescheduled_at: now(),
  }), req, { permission: "meetings.update", allowCreatedBy: true, auditAction: "MANAGER_MEETING_RESCHEDULED" });
}

function buildApprovalQueue(scope, query = {}) {
  const approvals = [
    ...activeRecords("leave_requests").filter((record) => recordInScope(record, scope, { collection: "leave_requests" }) && normalizeStatus(record.status) === "PENDING").map((record) => approvalItem("LEAVE", record)),
    ...activeRecords("promotions").filter((record) => recordInScope(record, scope, { collection: "promotions" }) && normalizeStatus(record.status) === "PENDING").map((record) => approvalItem("PROMOTION", record)),
    ...activeRecords("salary_adjustments").filter((record) => recordInScope(record, scope, { collection: "salary_adjustments" }) && normalizeStatus(record.status) === "PENDING").map((record) => approvalItem("SALARY_RECOMMENDATION", record)),
    ...activeRecords("purchase_requests").filter((record) => recordInScope(record, scope, { collection: "purchase_requests", allowCreatedBy: true }) && ["PENDING", "SUBMITTED"].includes(normalizeStatus(record.status))).map((record) => approvalItem("PROCUREMENT", record)),
    ...activeRecords("expenses").filter((record) => recordInScope(record, scope, { collection: "expenses", allowCreatedBy: true }) && ["PENDING", "SUBMITTED"].includes(normalizeStatus(record.status))).map((record) => approvalItem("EXPENSE", record)),
  ];
  return paginate(applyBasicFilters(approvals, { ...query, q: query.q || query.search }, ["type", "status", "title", "employeeName"]), query);
}

function approvalItem(type, record) {
  return {
    id: `${type}-${record.id}`,
    type,
    entityId: record.id,
    entity_id: record.id,
    title: record.title || record.employeeName || record.employee_name || record.reason || type,
    employeeId: getRecordEmployeeId(record),
    employee_id: getRecordEmployeeId(record),
    departmentId: getRecordDepartmentId(record),
    department_id: getRecordDepartmentId(record),
    status: record.status || "PENDING",
    createdAt: record.createdAt || record.created_at,
    created_at: record.createdAt || record.created_at,
  };
}

function listFinance(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "finance.view");
  const expenses = listScoped("expenses", { ...query, limit: 100 }, scope, { allowCreatedBy: true }).data.map((record) => ({ ...record, financeType: "expense" }));
  const bills = listScoped("bills", { ...query, limit: 100 }, scope, { allowCreatedBy: true }).data.map((record) => ({ ...record, financeType: "bill" }));
  const purchases = listScoped("purchase_requests", { ...query, limit: 100 }, scope, { allowCreatedBy: true }).data.map((record) => ({ ...record, financeType: "purchase_request" }));
  return paginate([...expenses, ...bills, ...purchases].sort((left, right) => String(right.createdAt || right.created_at || "").localeCompare(String(left.createdAt || left.created_at || ""))), query);
}

function getReports(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "reports.view");
  const employees = scope.employees;
  const attendance = activeRecords("attendance").filter((record) => recordInScope(record, scope, { collection: "attendance" }));
  const expenses = activeRecords("expenses").filter((record) => recordInScope(record, scope, { collection: "expenses", allowCreatedBy: true }));
  const purchases = activeRecords("purchase_requests").filter((record) => recordInScope(record, scope, { collection: "purchase_requests", allowCreatedBy: true }));
  const leave = activeRecords("leave_requests").filter((record) => recordInScope(record, scope, { collection: "leave_requests" }));
  const tasks = activeRecords("tasks").filter((record) => recordInScope(record, scope, { collection: "tasks", allowCreatedBy: true }));
  const targets = activeRecords("targets").filter((record) => recordInScope(record, scope, { collection: "targets", allowCreatedBy: true }));
  const performance = activeRecords("performance_reviews").filter((record) => recordInScope(record, scope, { collection: "performance_reviews", allowCreatedBy: true }));
  const discipline = activeRecords("disciplinary_cases").filter((record) => recordInScope(record, scope, { collection: "disciplinary_cases" }));
  return {
    scope: serializeScope(scope),
    headcount: {
      total: employees.length,
      active: employees.filter((employee) => String(employee.status || employee.employmentStatus || employee.employment_status || "active").toLowerCase() === "active").length,
    },
    attendance: summarizeAttendance(attendance, employees),
    leave: {
      pending: leave.filter((record) => normalizeStatus(record.status) === "PENDING").length,
      approved: leave.filter((record) => normalizeStatus(record.status) === "APPROVED").length,
      rejected: leave.filter((record) => normalizeStatus(record.status) === "REJECTED").length,
      onLeave: activeLeaveCount(leave),
    },
    tasks: {
      total: tasks.length,
      pending: tasks.filter((record) => normalizeStatus(record.status) === "PENDING").length,
      completed: tasks.filter((record) => normalizeStatus(record.status) === "COMPLETED").length,
      overdue: tasks.filter((record) => record.dueDate && new Date(record.dueDate).getTime() < Date.now() && normalizeStatus(record.status) !== "COMPLETED").length,
    },
    targets: {
      total: targets.length,
      active: targets.filter((record) => ["ACTIVE", "IN_PROGRESS"].includes(normalizeStatus(record.status, "ACTIVE"))).length,
      completed: targets.filter((record) => normalizeStatus(record.status) === "COMPLETED").length,
      progress: targetProgress(targets),
    },
    performance: {
      total: performance.length,
      pending: performance.filter((record) => ["PENDING", "DRAFT", "REVIEW"].includes(normalizeStatus(record.status, "PENDING"))).length,
      completed: performance.filter((record) => ["COMPLETED", "APPROVED", "SUBMITTED"].includes(normalizeStatus(record.status, "PENDING"))).length,
    },
    discipline: {
      total: discipline.length,
      open: discipline.filter((record) => !["CLOSED", "RESOLVED"].includes(normalizeStatus(record.status, "OPEN"))).length,
    },
    finance: {
      expenses: expenses.length,
      expenseTotal: expenses.reduce((total, record) => total + toNumber(record.amount), 0),
      purchases: purchases.length,
      purchaseTotal: purchases.reduce((total, record) => total + toNumber(record.amount || record.totalAmount || record.total_amount), 0),
    },
    period: query.period || "current",
  };
}

function listNotifications(user, query = {}) {
  const records = activeRecords("notifications").filter((record) => (record.userId || record.user_id || record.recipientUserId || record.recipient_user_id) === user.id);
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, SEARCH_FIELDS.notifications), query);
}

function markNotificationRead(id, req) {
  const records = readCollection("notifications");
  const index = records.findIndex((record) => record.id === id && (record.userId || record.user_id || record.recipientUserId || record.recipient_user_id) === req.user.id);
  if (index === -1) return null;
  records[index] = { ...records[index], readAt: now(), read_at: now(), status: "read", updatedAt: now(), updated_at: now() };
  writeCollection("notifications", records);
  return records[index];
}

function listAuditLogs(user, query = {}) {
  const scope = buildScope(user);
  assertManagerPermission(user, "audit_logs.view");
  const records = activeRecords("operational_audit_logs").filter((record) => {
    if ((record.actorId || record.actor_id || record.userId || record.user_id) === user.id) return true;
    const metadataDepartments = arrayValue(record.metadata?.departmentIds || record.metadata?.department_ids);
    if (metadataDepartments.some((id) => scope.departmentIds.has(id))) return true;
    const recordId = record.recordId || record.record_id || record.targetId || record.target_id;
    return [...scope.employeeIds, ...scope.departmentIds].includes(recordId);
  });
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, SEARCH_FIELDS.operational_audit_logs), query);
}

module.exports = {
  buildScope,
  buildApprovalQueue,
  correctAttendance,
  createLeave,
  createPerformanceReview,
  createPromotion,
  createSalaryRecommendation,
  createScopedRecord,
  cancelMeeting,
  completeTarget,
  completeTask,
  findScopedRecord,
  getDashboard,
  getDepartment,
  getEmployee,
  getHelpCenter,
  getHodWorkspace,
  getManagerProfile,
  getManagerSettings,
  getScopeSummary,
  getReports,
  getScopedRecord,
  getSelfEmploymentRecord,
  getStats,
  listAuditLogs,
  listAttendance,
  listDepartments,
  listEmployees,
  listFinance,
  listNotifications,
  listOverdueTasks,
  listPerformance,
  listScoped,
  markNotificationRead,
  rescheduleMeeting,
  updateManagerProfile,
  updateManagerSettings,
  updateSelfEmploymentRecord,
  updateTargetProgress,
  updateStatus,
  updatePerformanceReview,
  writeScopedRecord,
};
