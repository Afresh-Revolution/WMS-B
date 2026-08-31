const crypto = require("crypto");
const { getUserById, updateUser } = require("../../auth/userStore");
const { hasPermission } = require("../../constants/rbac");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const notificationService = require("../notifications/notification.service");
const nyscInternService = require("../nyscIntern/nyscIntern.service");
const staffService = require("../employers/staffDirectoryService");
const departmentService = require("../departments/departmentService");
const leaveService = require("../leave/leave.service");
const disciplineService = require("../discipline/discipline.service");

const HR_NAVIGATION = Object.freeze([
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

const EMPLOYEE_EXIT_STATUSES = Object.freeze(["PENDING", "UNDER_REVIEW", "APPROVED", "COMPLETED", "CANCELLED", "REJECTED"]);
const EMPLOYEE_EXIT_TYPES = Object.freeze(["RESIGNATION", "TERMINATION", "RETIREMENT", "CONTRACT_END", "TRANSFER", "OTHER"]);
const FORBIDDEN_HR_PROFILE_FIELDS = Object.freeze([
  "role",
  "roleId",
  "role_id",
  "permissions",
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
]);

const REQUIRED_DOCUMENT_TYPES = Object.freeze([
  "Employment Contract",
  "Identification",
  "Bank Document",
]);

const RECENT_ONBOARDING_DAYS = 30;
const DOCUMENT_EXPIRY_DAYS = 30;

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

function assertHrAccess(user, permission) {
  const role = String(user?.role || "").toLowerCase();
  if (role === "hr" && (!permission || hasPermission(user, permission))) return;
  throw createHttpError(403, "Forbidden.", "FORBIDDEN");
}

function assertNoSystemAccessMutation(payload = {}) {
  const systemAccess = payload.systemAccess || payload.system_access || null;
  const forbiddenKeys = [
    "role",
    "roleId",
    "role_id",
    "permissions",
    "dashboardAccess",
    "dashboard_access",
    "accountType",
    "account_type",
  ];
  const hasSystemAccess =
    systemAccess &&
    Object.values(systemAccess).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== false && value !== "";
    });
  if (hasSystemAccess || forbiddenKeys.some((key) => payload[key] !== undefined)) {
    throw createHttpError(403, "HR cannot manage user access, roles, or permissions.", "HR_SYSTEM_ACCESS_FORBIDDEN");
  }
}

function getOrganizationId(user) {
  return user?.organizationId || user?.organization_id || user?.employerId || user?.employer_id || null;
}

function sameOrganization(record, organizationId) {
  if (!organizationId) return true;
  const recordOrgId = record.organizationId || record.organization_id || record.employerId || record.employer_id || null;
  return !recordOrgId || recordOrgId === organizationId;
}

function activeRecords(collection, user = null) {
  const organizationId = getOrganizationId(user);
  return readCollection(collection).filter((record) => !record.deletedAt && !record.deleted_at && sameOrganization(record, organizationId));
}

function getEmployee(id, user = null) {
  return activeRecords("employees", user).find((employee) => employee.id === id) || null;
}

function getEmployeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.middleName, employee?.lastName].filter(Boolean).join(" ") || employee?.email || null;
}

function normalizeHrEmployee(employee) {
  return {
    id: employee.id,
    staffType: "employee",
    fullName: getEmployeeName(employee),
    employeeId: employee.employeeId || employee.employee_id || employee.employeeNumber || employee.employee_number || null,
    email: employee.email || null,
    phone: employee.phone || null,
    departmentId: employee.departmentId || employee.department_id || null,
    positionId: employee.positionId || employee.position_id || null,
    jobPosition: employee.jobTitle || employee.job_title || employee.position || null,
    employmentType: employee.employmentType || employee.employment_type || null,
    status: employee.status || employee.employmentStatus || employee.employment_status || "active",
    dateJoined: employee.hireDate || employee.hire_date || employee.createdAt || employee.created_at || null,
    organizationId: employee.organizationId || employee.organization_id || null,
  };
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase();
}

function normalizeUpperStatus(value, fallback = "PENDING") {
  return String(value || fallback).trim().toUpperCase();
}

function normalizeDocumentType(value) {
  return String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function employeeStatus(employee) {
  return normalizeUpperStatus(employee.status || employee.employmentStatus || employee.employment_status, "ACTIVE");
}

function dateValue(record, fields) {
  for (const field of fields) {
    if (record[field]) return record[field];
  }
  return null;
}

function daysAgo(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function isDateWithinPast(value, days) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) && time >= daysAgo(days);
}

function isDateDue(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) && time <= Date.now();
}

function isDateWithinFuture(value, days) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) && time >= Date.now() && time <= Date.now() + days * 24 * 60 * 60 * 1000;
}

function isActiveEmployee(employee) {
  return ["ACTIVE", "ONBOARDING", "PROBATION", "CONFIRMED", "ON_LEAVE"].includes(employeeStatus(employee));
}

function isAwaitingConfirmation(employee) {
  const status = employeeStatus(employee);
  const confirmationStatus = normalizeUpperStatus(
    employee.confirmationStatus || employee.confirmation_status || employee.probationStatus || employee.probation_status,
    ""
  );
  if (["AWAITING_CONFIRMATION", "PENDING_CONFIRMATION", "READY_FOR_CONFIRMATION"].includes(confirmationStatus)) return true;
  if (status === "AWAITING_CONFIRMATION") return true;
  if (["PROBATION", "ONBOARDING"].includes(status) && isDateDue(employee.probationEndDate || employee.probation_end_date || employee.confirmationDueDate || employee.confirmation_due_date)) {
    return true;
  }
  return false;
}

function employeeDocuments(employee, documents) {
  return documents.filter((document) => {
    const employeeId = document.employeeId || document.employee_id || document.staffId || document.staff_id;
    return employeeId === employee.id;
  });
}

function listMissingDocumentsForEmployees(employees, documents) {
  return employees
    .map((employee) => {
      const uploadedTypes = new Set(
        employeeDocuments(employee, documents)
          .filter((document) => !["deleted", "expired", "rejected"].includes(normalizeStatus(document.status)))
          .map((document) => normalizeDocumentType(document.documentType || document.document_type || document.type || document.name))
      );
      const missingTypes = REQUIRED_DOCUMENT_TYPES.filter((type) => !uploadedTypes.has(normalizeDocumentType(type)));
      return {
        employeeId: employee.id,
        employee_id: employee.id,
        employeeName: getEmployeeName(employee),
        employee_name: getEmployeeName(employee),
        departmentId: employee.departmentId || employee.department_id || null,
        department_id: employee.departmentId || employee.department_id || null,
        missingTypes,
        missing_types: missingTypes,
      };
    })
    .filter((entry) => entry.missingTypes.length > 0);
}

function listExpiringDocumentsForUser(user, days = DOCUMENT_EXPIRY_DAYS) {
  return activeRecords("employee_documents", user)
    .filter((document) => isDateWithinFuture(document.expiryDate || document.expiry_date, days))
    .map((document) => ({
      ...document,
      employeeId: document.employeeId || document.employee_id || document.staffId || document.staff_id || null,
      documentType: document.documentType || document.document_type || document.type || null,
      documentName: document.documentName || document.document_name || document.name || null,
      expiryDate: document.expiryDate || document.expiry_date || null,
    }));
}

function findEmployeeForRecord(record, employees) {
  const employeeId = record.employeeId || record.employee_id || record.staffId || record.staff_id;
  return employees.find((employee) => employee.id === employeeId) || null;
}

function compactQueueItem(type, record, employees) {
  const employee = findEmployeeForRecord(record, employees);
  return {
    id: record.id,
    type,
    employeeId: record.employeeId || record.employee_id || employee?.id || null,
    employee_id: record.employeeId || record.employee_id || employee?.id || null,
    employeeName: record.employeeName || record.employee_name || getEmployeeName(employee),
    employee_name: record.employeeName || record.employee_name || getEmployeeName(employee),
    title: record.title || record.reason || record.documentName || record.document_name || record.name || type,
    status: record.status || "PENDING",
    createdAt: record.createdAt || record.created_at || record.requestedAt || record.requested_at || null,
    created_at: record.createdAt || record.created_at || record.requestedAt || record.requested_at || null,
  };
}

function buildHrRecommendations({ employees, leaveRequests, promotions, salaryAdjustments, discipline, missingDocuments, expiringDocuments }) {
  const recommendations = [];

  for (const promotion of promotions.filter((item) => normalizeUpperStatus(item.status) === "PENDING").slice(0, 5)) {
    recommendations.push({
      type: "PROMOTION",
      title: `Promotion - ${promotion.newPositionName || promotion.new_position_name || promotion.employeeName || promotion.employee_name || "Employee"}`,
      entityType: "promotion",
      entityId: promotion.id,
      entity_id: promotion.id,
      employeeId: promotion.employeeId || promotion.employee_id || null,
    });
  }

  for (const adjustment of salaryAdjustments.filter((item) => normalizeUpperStatus(item.status) === "PENDING").slice(0, 5)) {
    recommendations.push({
      type: "SALARY_INCREMENT",
      title: `Salary Increment - ${adjustment.percentage ? `+${adjustment.percentage}%` : adjustment.employeeName || adjustment.employee_name || "Review"}`,
      entityType: "salary_adjustment",
      entityId: adjustment.id,
      entity_id: adjustment.id,
      employeeId: adjustment.employeeId || adjustment.employee_id || null,
    });
  }

  for (const employee of employees.filter(isAwaitingConfirmation).slice(0, 5)) {
    recommendations.push({
      type: "CONFIRMATION",
      title: "Confirmation - Employee Ready",
      entityType: "employee",
      entityId: employee.id,
      entity_id: employee.id,
      employeeId: employee.id,
    });
  }

  for (const document of expiringDocuments.slice(0, 5)) {
    recommendations.push({
      type: "DOCUMENT_RENEWAL",
      title: "Document Renewal Required",
      entityType: "employee_document",
      entityId: document.id,
      entity_id: document.id,
      employeeId: document.employeeId || document.employee_id || null,
    });
  }

  for (const missing of missingDocuments.slice(0, 5)) {
    recommendations.push({
      type: "MISSING_DOCUMENT",
      title: "Document Upload Required",
      entityType: "employee",
      entityId: missing.employeeId,
      entity_id: missing.employeeId,
      employeeId: missing.employeeId,
      missingTypes: missing.missingTypes,
    });
  }

  for (const employee of employees.filter((item) => employeeStatus(item) === "PROBATION" && isDateDue(item.probationEndDate || item.probation_end_date)).slice(0, 5)) {
    recommendations.push({
      type: "PROBATION_REVIEW",
      title: "Probation Review Required",
      entityType: "employee",
      entityId: employee.id,
      entity_id: employee.id,
      employeeId: employee.id,
    });
  }

  for (const request of leaveRequests.filter((item) => normalizeUpperStatus(item.status) === "PENDING").slice(0, 3)) {
    recommendations.push({
      type: "LEAVE_REVIEW",
      title: "Leave Review Required",
      entityType: "leave_request",
      entityId: request.id,
      entity_id: request.id,
      employeeId: request.employeeId || request.employee_id || null,
    });
  }

  for (const disciplineCase of discipline.filter((item) => ["OPEN", "UNDER_REVIEW", "UNDER_INVESTIGATION", "ACTION_ISSUED"].includes(normalizeUpperStatus(item.status, "OPEN"))).slice(0, 3)) {
    recommendations.push({
      type: "DISCIPLINE",
      title: "Disciplinary Case Requires Review",
      entityType: "disciplinary_case",
      entityId: disciplineCase.id,
      entity_id: disciplineCase.id,
      employeeId: disciplineCase.employeeId || disciplineCase.employee_id || null,
    });
  }

  return recommendations.slice(0, 20);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(records, fields) {
  return records.reduce((total, record) => {
    for (const field of fields) {
      if (record[field] !== undefined && record[field] !== null) return total + toNumber(record[field]);
    }
    return total;
  }, 0);
}

function withOrganization(payload, user) {
  const organizationId = getOrganizationId(user);
  return organizationId ? { ...payload, organizationId, organization_id: organizationId } : payload;
}

function writeCollectionRecord(collection, id, updater) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  const oldValue = records[index];
  records[index] = { ...records[index], ...updater(records[index]), id, updatedAt: now(), updated_at: now() };
  writeCollection(collection, records);
  return { oldValue, record: records[index] };
}

function createRecord(collection, payload, user) {
  const timestamp = now();
  const record = withOrganization({
    id: crypto.randomUUID(),
    ...payload,
    createdBy: payload.createdBy || user?.id || null,
    created_by: payload.created_by || payload.createdBy || user?.id || null,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  }, user);
  appendRecord(collection, record);
  return record;
}

function audit(req, action, entityType, entityId, oldValue, newValue) {
  return recordOperationalAudit({
    user: req.user,
    action,
    module: "HR",
    recordId: entityId || null,
    targetType: entityType,
    oldValue,
    newValue,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    metadata: { organizationId: getOrganizationId(req.user) },
  });
}

function sendHrNotification(type, employee, title, message, data = {}) {
  return notificationService.send({
    userId: employee?.userId || employee?.user_id || null,
    recipientEmployeeId: employee?.id || null,
    type,
    title,
    message,
    module: "HR",
    entityType: data.entityType,
    entityId: data.entityId,
    data,
  });
}

function listCollection(collection, query, user, searchableFields = []) {
  return paginate(applyBasicFilters(activeRecords(collection, user), { ...query, q: query.q || query.search }, searchableFields), query);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function requireDate(value, message, code) {
  const timestamp = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(timestamp)) {
    throw createHttpError(400, message, code);
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function findActorEmployee(user) {
  const employeeId = user?.employeeId || user?.employee_id;
  return activeRecords("employees", user).find((employee) =>
    employee.id === employeeId ||
    employee.employeeId === employeeId ||
    employee.employee_id === employeeId ||
    employee.userId === user?.id ||
    employee.user_id === user?.id
  ) || null;
}

function assertNoHrSelfPrivilegeMutation(payload = {}) {
  const found = FORBIDDEN_HR_PROFILE_FIELDS.find((key) => payload[key] !== undefined);
  if (found) {
    throw createHttpError(403, "HR profile settings cannot change access, reporting, salary, or employment-control fields.", "HR_PROFILE_FIELD_FORBIDDEN");
  }
}

function employeeExitSearchText(record) {
  return [
    record.employeeName,
    record.employee_name,
    record.exitType,
    record.exit_type,
    record.reason,
    record.status,
  ].filter(Boolean).join(" ").toLowerCase();
}

function decorateEmployeeExit(record, user) {
  const employee = getEmployee(employeeIdOf(record), user);
  return {
    ...record,
    employee: employee ? normalizeHrEmployee(employee) : null,
    employeeName: record.employeeName || record.employee_name || getEmployeeName(employee),
    employee_name: record.employee_name || record.employeeName || getEmployeeName(employee),
  };
}

function listEmployeeExits(query = {}, user) {
  assertHrAccess(user, "employee_exits.view");
  let records = activeRecords("employee_exit_records", user);
  if (query.status) {
    records = records.filter((record) => normalizeUpperStatus(record.status) === normalizeUpperStatus(query.status));
  }
  if (query.exitType || query.exit_type) {
    const type = normalizeUpperStatus(query.exitType || query.exit_type);
    records = records.filter((record) => normalizeUpperStatus(record.exitType || record.exit_type) === type);
  }
  if (query.employeeId || query.employee_id) {
    const employeeId = query.employeeId || query.employee_id;
    records = records.filter((record) => employeeIdOf(record) === employeeId);
  }
  if (query.q || query.search) {
    const search = String(query.q || query.search).trim().toLowerCase();
    records = records.filter((record) => employeeExitSearchText(record).includes(search));
  }
  const result = paginate(records, query);
  result.data = result.data.map((record) => decorateEmployeeExit(record, user));
  return result;
}

function getEmployeeExit(id, user) {
  assertHrAccess(user, "employee_exits.view");
  const record = activeRecords("employee_exit_records", user).find((item) => item.id === id);
  return record ? decorateEmployeeExit(record, user) : null;
}

function createEmployeeExit(payload = {}, req) {
  assertHrAccess(req.user, "employee_exits.create");
  const employeeId = payload.employeeId || payload.employee_id;
  const employee = getEmployee(employeeId, req.user);
  if (!employee) throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  const exitType = normalizeEnum(payload.exitType || payload.exit_type, EMPLOYEE_EXIT_TYPES, null);
  if (!exitType) throw createHttpError(400, "Valid employee exit type is required.", "INVALID_EXIT_TYPE");
  const exitDate = requireDate(payload.exitDate || payload.exit_date, "Exit date is required.", "EXIT_DATE_REQUIRED");
  const record = createRecord("employee_exit_records", {
    employeeId: employee.id,
    employee_id: employee.id,
    employeeName: getEmployeeName(employee),
    employee_name: getEmployeeName(employee),
    exitType,
    exit_type: exitType,
    reason: payload.reason || null,
    noticeDate: payload.noticeDate || payload.notice_date || null,
    notice_date: payload.notice_date || payload.noticeDate || null,
    exitDate,
    exit_date: exitDate,
    handoverNotes: payload.handoverNotes || payload.handover_notes || null,
    handover_notes: payload.handover_notes || payload.handoverNotes || null,
    checklist: Array.isArray(payload.checklist) ? payload.checklist : [],
    clearance: payload.clearance || {},
    status: "PENDING",
    requestedBy: req.user.id,
    requested_by: req.user.id,
  }, req.user);
  audit(req, "Employee Exit Created", "EmployeeExit", record.id, null, record);
  sendHrNotification("EMPLOYEE_EXIT_REQUESTED", employee, "Employee exit request created", "An employee exit process has been opened.", { entityType: "employee_exit", entityId: record.id });
  return decorateEmployeeExit(record, req.user);
}

function updateEmployeeExit(id, payload = {}, req) {
  assertHrAccess(req.user, "employee_exits.update");
  const oldValue = activeRecords("employee_exit_records", req.user).find((item) => item.id === id);
  if (!oldValue) return null;
  const status = payload.status ? normalizeEnum(payload.status, EMPLOYEE_EXIT_STATUSES, oldValue.status || "PENDING") : undefined;
  const result = writeCollectionRecord("employee_exit_records", id, () => compactObject({
    exitType: payload.exitType ? normalizeEnum(payload.exitType, EMPLOYEE_EXIT_TYPES, oldValue.exitType) : undefined,
    exit_type: payload.exit_type ? normalizeEnum(payload.exit_type, EMPLOYEE_EXIT_TYPES, oldValue.exit_type) : undefined,
    reason: payload.reason,
    noticeDate: payload.noticeDate || payload.notice_date,
    notice_date: payload.notice_date || payload.noticeDate,
    exitDate: payload.exitDate || payload.exit_date,
    exit_date: payload.exit_date || payload.exitDate,
    handoverNotes: payload.handoverNotes || payload.handover_notes,
    handover_notes: payload.handover_notes || payload.handoverNotes,
    checklist: Array.isArray(payload.checklist) ? payload.checklist : undefined,
    clearance: payload.clearance,
    status,
    reviewedBy: req.user.id,
    reviewed_by: req.user.id,
  }));
  audit(req, "Employee Exit Updated", "EmployeeExit", id, oldValue, result.record);
  return decorateEmployeeExit(result.record, req.user);
}

function approveEmployeeExit(id, payload = {}, req) {
  assertHrAccess(req.user, "employee_exits.approve");
  const oldValue = activeRecords("employee_exit_records", req.user).find((item) => item.id === id);
  if (!oldValue) return null;
  if (!["PENDING", "UNDER_REVIEW"].includes(normalizeUpperStatus(oldValue.status, "PENDING"))) {
    throw createHttpError(409, "Only pending employee exits can be approved.", "EMPLOYEE_EXIT_NOT_PENDING");
  }
  const result = writeCollectionRecord("employee_exit_records", id, () => ({
    status: "APPROVED",
    approvedBy: req.user.id,
    approved_by: req.user.id,
    approvedAt: now(),
    approved_at: now(),
    approvalNotes: payload.notes || payload.approvalNotes || payload.approval_notes || null,
    approval_notes: payload.approval_notes || payload.approvalNotes || payload.notes || null,
  }));
  audit(req, "Employee Exit Approved", "EmployeeExit", id, oldValue, result.record);
  const employee = getEmployee(employeeIdOf(oldValue), req.user);
  if (employee) sendHrNotification("EMPLOYEE_EXIT_APPROVED", employee, "Employee exit approved", "Your employee exit request has been approved.", { entityType: "employee_exit", entityId: id });
  return decorateEmployeeExit(result.record, req.user);
}

function completeEmployeeExit(id, payload = {}, req) {
  assertHrAccess(req.user, "employee_exits.complete");
  const oldValue = activeRecords("employee_exit_records", req.user).find((item) => item.id === id);
  if (!oldValue) return null;
  if (!["APPROVED", "UNDER_REVIEW"].includes(normalizeUpperStatus(oldValue.status, "PENDING"))) {
    throw createHttpError(409, "Only approved employee exits can be completed.", "EMPLOYEE_EXIT_NOT_APPROVED");
  }
  const completedAt = now();
  const result = writeCollectionRecord("employee_exit_records", id, () => ({
    status: "COMPLETED",
    completedBy: req.user.id,
    completed_by: req.user.id,
    completedAt,
    completed_at: completedAt,
    finalNotes: payload.notes || payload.finalNotes || payload.final_notes || null,
    final_notes: payload.final_notes || payload.finalNotes || payload.notes || null,
  }));
  const employee = getEmployee(employeeIdOf(oldValue), req.user);
  if (employee) {
    writeCollectionRecord("employees", employee.id, () => ({
      status: "EXITED",
      employmentStatus: "EXITED",
      employment_status: "EXITED",
      exitDate: result.record.exitDate || result.record.exit_date || completedAt.slice(0, 10),
      exit_date: result.record.exit_date || result.record.exitDate || completedAt.slice(0, 10),
    }));
    sendHrNotification("EMPLOYEE_EXIT_COMPLETED", employee, "Employee exit completed", "Your employee exit process has been completed.", { entityType: "employee_exit", entityId: id });
  }
  audit(req, "Employee Exit Completed", "EmployeeExit", id, oldValue, result.record);
  return decorateEmployeeExit(result.record, req.user);
}

function cancelEmployeeExit(id, payload = {}, req) {
  assertHrAccess(req.user, "employee_exits.cancel");
  const oldValue = activeRecords("employee_exit_records", req.user).find((item) => item.id === id);
  if (!oldValue) return null;
  const status = normalizeUpperStatus(payload.status, "CANCELLED") === "REJECTED" ? "REJECTED" : "CANCELLED";
  const result = writeCollectionRecord("employee_exit_records", id, () => ({
    status,
    cancelledBy: req.user.id,
    cancelled_by: req.user.id,
    cancelledAt: now(),
    cancelled_at: now(),
    cancellationReason: payload.reason || payload.cancellationReason || payload.cancellation_reason || null,
    cancellation_reason: payload.cancellation_reason || payload.cancellationReason || payload.reason || null,
  }));
  audit(req, status === "REJECTED" ? "Employee Exit Rejected" : "Employee Exit Cancelled", "EmployeeExit", id, oldValue, result.record);
  return decorateEmployeeExit(result.record, req.user);
}

function listHrNotifications(query, user) {
  assertHrAccess(user, "notifications.view");
  return notificationService.listUserNotifications(user, query);
}

function markHrNotificationRead(id, user) {
  assertHrAccess(user, "notifications.view");
  return notificationService.markAsRead(id, user);
}

function getHrProfile(user) {
  assertHrAccess(user, "profile.view");
  const currentUser = getUserById(user.id) || user;
  const employee = findActorEmployee(currentUser);
  return {
    user: {
      id: currentUser.id,
      fullName: currentUser.fullName || currentUser.name,
      email: currentUser.email,
      phone: currentUser.phone || null,
      role: currentUser.role,
      departmentId: currentUser.departmentId || currentUser.department_id || null,
      organizationId: getOrganizationId(currentUser),
      status: currentUser.status || "active",
      preferences: currentUser.preferences || {},
    },
    employee: employee ? normalizeHrEmployee(employee) : null,
  };
}

function updateHrProfile(payload = {}, req) {
  assertHrAccess(req.user, "profile.update");
  assertNoHrSelfPrivilegeMutation(payload);
  const personal = payload.personalInformation || payload.personal || {};
  const displayName = payload.displayName || payload.fullName || payload.name || personal.fullName;
  const updates = compactObject({
    name: displayName,
    fullName: displayName,
    phone: payload.phone ?? personal.phone,
    avatarUrl: payload.avatarUrl || payload.avatar_url || payload.profilePhoto || payload.profile_photo,
    avatar_url: payload.avatar_url || payload.avatarUrl || payload.profile_photo || payload.profilePhoto,
    preferences: payload.preferences,
    updatedBy: req.user.id,
  });
  if (Object.keys(updates).length) {
    updateUser(req.user.id, updates);
  }
  const employee = findActorEmployee(req.user);
  if (employee) {
    writeCollectionRecord("employees", employee.id, () => compactObject({
      fullName: displayName,
      name: displayName,
      phone: payload.phone ?? personal.phone,
      address: payload.address ?? personal.address,
      profilePhoto: payload.profilePhoto || payload.profile_photo || payload.avatarUrl || payload.avatar_url,
    }));
  }
  audit(req, "HR Profile Updated", "Profile", req.user.id, req.user, updates);
  return getHrProfile(getUserById(req.user.id) || req.user);
}

function getHrSettings(user) {
  assertHrAccess(user, "hr_settings.view");
  const currentUser = getUserById(user.id) || user;
  return {
    profile: getHrProfile(currentUser),
    preferences: currentUser.preferences || {},
    notificationPreferences: notificationService.getUserPreferences(currentUser.id),
  };
}

function updateHrSettings(payload = {}, req) {
  assertHrAccess(req.user, "hr_settings.update");
  assertNoHrSelfPrivilegeMutation(payload);
  const preferences = payload.preferences || payload.hrPreferences || payload.hr_preferences || {};
  if (preferences && typeof preferences !== "object") {
    throw createHttpError(400, "HR preferences must be an object.", "INVALID_HR_PREFERENCES");
  }
  const updated = updateUser(req.user.id, { preferences: { ...(req.user.preferences || {}), ...preferences }, updatedBy: req.user.id });
  if (payload.notifications || payload.notificationPreferences || payload.notification_preferences) {
    notificationService.updatePreferences(updated, payload.notifications || payload.notificationPreferences || payload.notification_preferences, req);
  }
  audit(req, "HR Settings Updated", "Settings", req.user.id, req.user.preferences || {}, updated.preferences || {});
  return getHrSettings(getUserById(req.user.id) || updated);
}

function getHelpCenter(user) {
  assertHrAccess(user, "help_center.view");
  return {
    sections: [
      { key: "employees", title: "Employees", routes: ["/api/v1/hr/employees", "/api/v1/hr/onboarding", "/api/v1/hr/confirmations"] },
      { key: "requests", title: "HR Requests", routes: ["/api/v1/hr/leave", "/api/v1/hr/promotions", "/api/v1/hr/salary-increments"] },
      { key: "documents", title: "Documents", routes: ["/api/v1/hr/documents", "/api/v1/hr/documents/missing", "/api/v1/hr/documents/expiring"] },
      { key: "placements", title: "NYSC & Interns", routes: ["/api/v1/hr/nysc-interns", "/api/v1/hr/nysc-interns/dashboard"] },
      { key: "exits", title: "Employee Exit", routes: ["/api/v1/hr/employee-exits"] },
    ],
  };
}

function listNyscInternProfiles(query, user) {
  assertHrAccess(user, "nysc_intern.view");
  return nyscInternService.listProfiles(user, query);
}

function getNyscInternDashboard(user) {
  assertHrAccess(user, "nysc_intern.view");
  return nyscInternService.getDashboard(user);
}

function getNyscInternSummary(user) {
  assertHrAccess(user, "nysc_intern.view");
  return nyscInternService.getSummary(user);
}

function getNyscInternProfile(id, user) {
  assertHrAccess(user, "nysc_intern.view");
  return nyscInternService.getDetails(id, user);
}

function createNyscInternProfile(payload, req) {
  assertHrAccess(req.user, "nysc_intern.create");
  const result = nyscInternService.createProfile(payload, req.user);
  audit(req, result.record.profile.type === "NYSC" ? "NYSC Created" : "Intern Created", "NyscIntern", result.record.profile.id, null, result.record);
  return result.record;
}

function updateNyscInternProfile(id, payload, req) {
  assertHrAccess(req.user, "nysc_intern.update");
  const result = nyscInternService.updateProfile(id, payload, req.user);
  if (result) audit(req, "NYSC/Intern Updated", "NyscIntern", id, result.oldValues, result.record);
  return result;
}

function nyscInternAction(id, payload, req, permission, action, handler) {
  assertHrAccess(req.user, permission);
  const result = handler(id, payload, req.user);
  if (result) audit(req, action, "NyscIntern", id, result.oldValues, result.record || result);
  return result;
}

function assignNyscInternSupervisor(id, payload, req) {
  return nyscInternAction(id, payload, req, "nysc_intern.assign_supervisor", "NYSC/Intern Supervisor Assigned", nyscInternService.assignSupervisor);
}

function changeNyscInternDepartment(id, payload, req) {
  return nyscInternAction(id, payload, req, "nysc_intern.manage_placement", "NYSC/Intern Department Changed", nyscInternService.changeDepartment);
}

function extendNyscInternPlacement(id, payload, req) {
  return nyscInternAction(id, payload, req, "nysc_intern.extend", "NYSC/Intern Placement Extended", nyscInternService.extendPlacement);
}

function completeNyscInternPlacement(id, payload, req) {
  return nyscInternAction(id, payload, req, "nysc_intern.complete", "NYSC/Intern Placement Completed", nyscInternService.completePlacement);
}

function terminateNyscInternPlacement(id, payload, req) {
  return nyscInternAction(id, payload, req, "nysc_intern.terminate", "NYSC/Intern Placement Terminated", nyscInternService.terminatePlacement);
}

function processNyscInternExit(id, payload, req) {
  return nyscInternAction(id, payload, req, "nysc_intern.manage_exit", "NYSC/Intern Exit Processed", nyscInternService.processExit);
}

function convertNyscInternToEmployee(id, payload, req) {
  return nyscInternAction(id, payload, req, "nysc_intern.convert_employee", "NYSC/Intern Converted To Employee", nyscInternService.convertToEmployee);
}

function listNyscInternDocuments(id, user) {
  assertHrAccess(user, "nysc_intern.view_documents");
  return nyscInternService.listDocuments(id, user);
}

function addNyscInternDocument(id, payload, req) {
  assertHrAccess(req.user, "nysc_intern.manage_documents");
  const document = nyscInternService.addDocument(id, payload, req.user);
  if (document) audit(req, "NYSC/Intern Document Uploaded", "NyscIntern", id, null, document);
  return document;
}

function listNyscInternReviews(id, user) {
  assertHrAccess(user, "nysc_intern.view_reviews");
  return nyscInternService.listReviews(id, user);
}

function addNyscInternReview(id, payload, req) {
  assertHrAccess(req.user, "nysc_intern.manage_reviews");
  const review = nyscInternService.addReview(id, payload, req.user);
  if (review) audit(req, "NYSC/Intern Review Recorded", "NyscIntern", id, null, review);
  return review;
}

function listNyscInternAttendance(id, user, query = {}) {
  assertHrAccess(user, "nysc_intern.view");
  return nyscInternService.listAttendance(id, user, query);
}

function addNyscInternAttendance(id, payload, req) {
  assertHrAccess(req.user, "nysc_intern.manage_attendance");
  const attendance = nyscInternService.addAttendance(id, payload, req.user);
  if (attendance) audit(req, "NYSC/Intern Attendance Recorded", "NyscIntern", id, null, attendance);
  return attendance;
}

function listNyscInternHistory(id, user) {
  assertHrAccess(user, "nysc_intern.view");
  return nyscInternService.listHistory(id, user);
}

function employeeIdOf(record) {
  return record?.employeeId || record?.employee_id || record?.staffId || record?.staff_id || null;
}

function collectionForReturnType(type) {
  const normalized = String(type || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  return {
    leave: "leave_requests",
    "leave-request": "leave_requests",
    promotion: "promotions",
    promotions: "promotions",
    salary: "salary_adjustments",
    "salary-adjustment": "salary_adjustments",
    "salary-increment": "salary_adjustments",
    onboarding: "onboarding_records",
    confirmation: "employee_confirmations",
    document: "employee_documents",
    discipline: "disciplinary_cases",
  }[normalized] || null;
}

function getDashboard(user, query = {}) {
  assertHrAccess(user, "overview.view");
  const employees = activeRecords("employees", user);
  const leaveRequests = activeRecords("leave_requests", user);
  const promotions = activeRecords("promotions", user);
  const salaryAdjustments = activeRecords("salary_adjustments", user).concat(activeRecords("salary_increments", user));
  const discipline = activeRecords("disciplinary_cases", user);
  const documents = activeRecords("employee_documents", user);
  const onboarding = activeRecords("onboarding_records", user);
  const employeeExits = activeRecords("employee_exit_records", user);
  const approvals = buildApprovalQueue(user);
  const recentDays = Number(query.recentDays || query.recent_days || RECENT_ONBOARDING_DAYS);
  const expiryDays = Number(query.expiryDays || query.expiry_days || DOCUMENT_EXPIRY_DAYS);
  const activeEmployees = employees.filter(isActiveEmployee);
  const recentlyOnboarded = employees.filter((employee) =>
    isDateWithinPast(
      dateValue(employee, ["onboardingDate", "onboarding_date", "hireDate", "hire_date", "employmentStartDate", "employment_start_date", "createdAt", "created_at"]),
      recentDays
    )
  );
  const awaitingConfirmation = employees.filter(isAwaitingConfirmation);
  const pendingLeave = leaveRequests.filter((request) => normalizeUpperStatus(request.status) === "PENDING");
  const pendingPromotions = promotions.filter((promotion) => normalizeUpperStatus(promotion.status) === "PENDING");
  const pendingSalaryAdjustments = salaryAdjustments.filter((adjustment) => normalizeUpperStatus(adjustment.status) === "PENDING");
  const returnedStatuses = new Set(["REJECTED", "RETURNED", "CHANGES_REQUESTED", "NOT_CONFIRMED"]);
  const returnedRequests = [
    ...leaveRequests,
    ...promotions,
    ...salaryAdjustments,
    ...onboarding,
    ...activeRecords("employee_confirmations", user),
    ...activeRecords("approval_requests", user),
  ].filter((record) => returnedStatuses.has(normalizeUpperStatus(record.status, "")));
  const openDisciplineStatuses = new Set(["OPEN", "UNDER_REVIEW", "UNDER_INVESTIGATION", "WARNING_ISSUED", "SUSPENDED", "ACTION_ISSUED", "PENDING_REVIEW", "APPEAL_PENDING"]);
  const openDiscipline = discipline.filter((record) => openDisciplineStatuses.has(normalizeUpperStatus(record.status, "OPEN")));
  const missingDocuments = listMissingDocumentsForEmployees(activeEmployees, documents);
  const expiringDocuments = listExpiringDocumentsForUser(user, expiryDays);
  const recommendations = buildHrRecommendations({
    employees,
    leaveRequests,
    promotions,
    salaryAdjustments,
    discipline,
    missingDocuments,
    expiringDocuments,
  });

  return {
    employees: {
      active: activeEmployees.length,
      recentlyOnboarded: recentlyOnboarded.length,
      recently_onboarded: recentlyOnboarded.length,
      awaitingConfirmation: awaitingConfirmation.length,
      awaiting_confirmation: awaitingConfirmation.length,
      exited: employees.filter((employee) => ["EXITED", "TERMINATED", "RESIGNED", "INACTIVE"].includes(employeeStatus(employee))).length,
    },
    employeeExits: {
      pending: employeeExits.filter((record) => ["PENDING", "UNDER_REVIEW"].includes(normalizeUpperStatus(record.status, "PENDING"))).length,
      approved: employeeExits.filter((record) => normalizeUpperStatus(record.status) === "APPROVED").length,
      completed: employeeExits.filter((record) => normalizeUpperStatus(record.status) === "COMPLETED").length,
    },
    employee_exits: {
      pending: employeeExits.filter((record) => ["PENDING", "UNDER_REVIEW"].includes(normalizeUpperStatus(record.status, "PENDING"))).length,
      approved: employeeExits.filter((record) => normalizeUpperStatus(record.status) === "APPROVED").length,
      completed: employeeExits.filter((record) => normalizeUpperStatus(record.status) === "COMPLETED").length,
    },
    leave: {
      pending: pendingLeave.length,
    },
    promotions: {
      pending: pendingPromotions.length,
    },
    salaryIncrements: {
      pending: pendingSalaryAdjustments.length,
    },
    salary_increments: {
      pending: pendingSalaryAdjustments.length,
    },
    requests: {
      returned: returnedRequests.length,
    },
    discipline: {
      open: openDiscipline.length,
    },
    documents: {
      missing: missingDocuments.length,
      expiringSoon: expiringDocuments.length,
      expiring_soon: expiringDocuments.length,
      expired: documents.filter((document) => {
        const expiry = document.expiryDate || document.expiry_date;
        return expiry && new Date(expiry).getTime() < Date.now();
      }).length,
    },
    queues: {
      leaveReviews: pendingLeave.slice(0, 20).map((record) => compactQueueItem("LEAVE", record, employees)),
      leave_reviews: pendingLeave.slice(0, 20).map((record) => compactQueueItem("LEAVE", record, employees)),
      recommendations,
      disciplinaryCases: openDiscipline.slice(0, 20).map((record) => compactQueueItem("DISCIPLINE", record, employees)),
      disciplinary_cases: openDiscipline.slice(0, 20).map((record) => compactQueueItem("DISCIPLINE", record, employees)),
      missingDocuments: missingDocuments.slice(0, 20),
      missing_documents: missingDocuments.slice(0, 20),
      approvals: approvals.slice(0, 20),
      returnedRequests: returnedRequests.slice(0, 20).map((record) => compactQueueItem("RETURNED", record, employees)),
      returned_requests: returnedRequests.slice(0, 20).map((record) => compactQueueItem("RETURNED", record, employees)),
      employeeExits: employeeExits.slice(0, 20).map((record) => decorateEmployeeExit(record, user)),
      employee_exits: employeeExits.slice(0, 20).map((record) => decorateEmployeeExit(record, user)),
    },
    recentHrActivity: listHrAuditRecords(user).slice(-20).reverse(),
    recent_hr_activity: listHrAuditRecords(user).slice(-20).reverse(),
    navigation: HR_NAVIGATION,
    meta: {
      organizationId: getOrganizationId(user),
      period: query.period || "current",
      recentDays,
      documentExpiryDays: expiryDays,
    },
  };
}

function summarizeAttendance(attendance, employees) {
  const today = new Date().toISOString().slice(0, 10);
  const todayAttendance = attendance.filter((record) => String(record.date || record.createdAt || "").startsWith(today));
  const present = todayAttendance.filter((record) => ["present", "late", "on_leave"].includes(normalizeStatus(record.status))).length;
  return {
    todayTotal: todayAttendance.length,
    present,
    absent: todayAttendance.filter((record) => normalizeStatus(record.status) === "absent").length,
    late: todayAttendance.filter((record) => normalizeStatus(record.status) === "late").length,
    attendanceRate: employees.length ? Math.round((present / employees.length) * 100) : 0,
  };
}

function getStats(user, query = {}) {
  const dashboard = getDashboard(user, query);
  return {
    employees: dashboard.employees,
    leave: dashboard.leave,
    promotions: dashboard.promotions,
    salaryIncrements: dashboard.salaryIncrements,
    employeeExits: dashboard.employeeExits,
    requests: dashboard.requests,
    discipline: dashboard.discipline,
    documents: dashboard.documents,
  };
}

function listEmployees(query, user) {
  assertHrAccess(user, "employees.view");
  if (!getOrganizationId(user)) {
    return staffService.listStaffDirectory({ ...query, staffType: query.staffType || "employee" });
  }
  const result = paginate(
    applyBasicFilters(activeRecords("employees", user), { ...query, q: query.q || query.search }, ["fullName", "name", "employeeId", "employee_id", "email", "phone", "status"]),
    query
  );
  result.data = result.data.map(normalizeHrEmployee);
  return result;
}

function createEmployee(payload, req) {
  assertHrAccess(req.user, "employees.create");
  assertNoSystemAccessMutation(payload);
  const record = staffService.createStaff({ ...payload, staffType: payload.staffType || "employee" }, req.user, req);
  audit(req, "Employee Created", "Employee", record.id, null, record);
  return record;
}

function getEmployeeProfile(id, user) {
  assertHrAccess(user, "employees.view");
  const profile = staffService.getStaffProfile(id);
  if (!profile || !sameOrganization(profile.personalInformation || {}, getOrganizationId(user))) return null;

  const employee = getEmployee(id, user) || profile.personalInformation || {};
  const canViewPerformance = hasPermission(user, "performance.view");
  const canViewAttendance = hasPermission(user, "attendance.view");
  return {
    ...profile,
    employmentHistory: activeRecords("employee_employment_history", user).filter((record) => employeeIdOf(record) === id),
    documents: employeeDocuments(employee, activeRecords("employee_documents", user)),
    leaveHistory: activeRecords("leave_requests", user).filter((record) => employeeIdOf(record) === id),
    promotionHistory: activeRecords("promotions", user).filter((record) => employeeIdOf(record) === id),
    salaryHistory: activeRecords("employee_salary_history", user).filter((record) => employeeIdOf(record) === id),
    performanceSummary: canViewPerformance ? activeRecords("performance_reviews", user).filter((record) => employeeIdOf(record) === id) : [],
    disciplinaryHistory: activeRecords("disciplinary_cases", user).filter((record) => employeeIdOf(record) === id),
    attendanceSummary: canViewAttendance ? summarizeAttendance(activeRecords("attendance", user).filter((record) => employeeIdOf(record) === id), [employee]) : null,
    hrNotes: activeRecords("hr_notes", user).filter((record) => employeeIdOf(record) === id),
  };
}

function updateEmployee(id, payload, req) {
  assertHrAccess(req.user, "employees.update");
  assertNoSystemAccessMutation(payload);
  const result = staffService.updateStaff(id, payload, req.user, req);
  if (result) audit(req, "Employee Updated", "Employee", id, result.oldValue, result.record);
  return result;
}

function patchEmployeeStatus(id, payload, req) {
  assertHrAccess(req.user, "employees.update");
  const action = String(payload.status || "").toLowerCase() === "active" ? "activate" : String(payload.status || "inactive").toLowerCase() === "suspended" ? "suspend" : "deactivate";
  const result = staffService.performStaffAction(id, action, payload, req.user, req);
  if (result) audit(req, "Employee Status Changed", "Employee", id, result.oldValue, result.record);
  return result;
}

function listDepartments(query, user) {
  assertHrAccess(user, "departments.view");
  if (getOrganizationId(user)) {
    return listCollection("departments", query, user, ["name", "code", "description", "status"]);
  }
  return departmentService.listDepartments(query);
}

function createDepartment(payload, req) {
  assertHrAccess(req.user, "departments.create");
  const department = departmentService.createDepartment(withOrganization(payload, req.user), req.user, req);
  audit(req, "Department Created", "Department", department.id, null, department);
  return department;
}

function updateDepartment(id, payload, req) {
  assertHrAccess(req.user, "departments.update");
  const result = departmentService.updateDepartment(id, payload, req.user, req);
  if (result) audit(req, "Department Updated", "Department", id, result.oldValue, result.record);
  return result;
}

function deleteDepartment(id, req) {
  assertHrAccess(req.user, "departments.delete");
  const result = departmentService.softDeleteDepartment(id, req.user, req);
  if (result) audit(req, "Department Deleted", "Department", id, result.oldValue, result.record);
  return result;
}

function listPositions(query, user) {
  assertHrAccess(user, "positions.view");
  return listCollection("positions", query, user, ["title", "code", "description", "status"]);
}

function createPosition(payload, req) {
  assertHrAccess(req.user, "positions.create");
  const position = createRecord("positions", {
    departmentId: payload.departmentId || payload.department_id || null,
    department_id: payload.departmentId || payload.department_id || null,
    title: payload.title,
    code: payload.code || null,
    description: payload.description || null,
    payGradeId: payload.payGradeId || payload.pay_grade_id || null,
    status: payload.status || "active",
  }, req.user);
  audit(req, "Position Created", "Position", position.id, null, position);
  return position;
}

function updatePosition(id, payload, req) {
  assertHrAccess(req.user, "positions.update");
  const result = writeCollectionRecord("positions", id, () => ({
    departmentId: payload.departmentId || payload.department_id,
    department_id: payload.departmentId || payload.department_id,
    title: payload.title,
    code: payload.code,
    description: payload.description,
    payGradeId: payload.payGradeId || payload.pay_grade_id,
    status: payload.status,
  }));
  if (result) audit(req, "Position Updated", "Position", id, result.oldValue, result.record);
  return result;
}

function listLeave(query, user) {
  assertHrAccess(user, "leave.view");
  return leaveService.getVisibleRequests(user, query);
}

function getLeave(id, user) {
  assertHrAccess(user, "leave.view");
  const request = activeRecords("leave_requests", user).find((record) => record.id === id);
  if (!request) return null;
  const employee = getEmployee(employeeIdOf(request), user);
  return {
    ...request,
    employee: employee ? normalizeHrEmployee(employee) : null,
    balances: activeRecords("leave_balances", user).filter((balance) => employeeIdOf(balance) === employeeIdOf(request)),
    history: activeRecords("leave_request_history", user).filter((history) => (history.leaveRequestId || history.leave_request_id) === id),
  };
}

function createLeave(payload, req) {
  assertHrAccess(req.user, "leave.create");
  if (!payload.employeeId && !payload.employee_id) {
    return leaveService.createLeaveRequest(payload, req.user, req);
  }
  const employee = getEmployee(payload.employeeId || payload.employee_id, req.user);
  if (!employee) throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  const request = createRecord("leave_requests", {
    employeeId: employee.id,
    employee_id: employee.id,
    employeeName: getEmployeeName(employee),
    employee_name: getEmployeeName(employee),
    leaveTypeId: payload.leaveTypeId || payload.leave_type_id,
    leave_type_id: payload.leaveTypeId || payload.leave_type_id,
    startDate: payload.startDate || payload.start_date,
    start_date: payload.startDate || payload.start_date,
    endDate: payload.endDate || payload.end_date,
    end_date: payload.endDate || payload.end_date,
    duration: payload.daysRequested || payload.days_requested || payload.duration || 0,
    daysRequested: payload.daysRequested || payload.days_requested || payload.duration || 0,
    reason: payload.reason || payload.note || null,
    status: "PENDING",
    requestedAt: now(),
    requested_at: now(),
  }, req.user);
  audit(req, "Leave Created", "LeaveRequest", request.id, null, request);
  return { request, record: request, oldValue: null };
}

function approveLeave(id, payload, req) {
  assertHrAccess(req.user, "leave.approve");
  const result = leaveService.approveLeaveRequest(id, payload, req.user);
  if (result) audit(req, "Leave Approved", "LeaveRequest", id, result.oldValue, result.record);
  return result;
}

function rejectLeave(id, payload, req) {
  assertHrAccess(req.user, "leave.reject");
  const result = leaveService.rejectLeaveRequest(id, payload, req.user);
  if (result) audit(req, "Leave Rejected", "LeaveRequest", id, result.oldValue, result.record);
  return result;
}

function listPromotions(query, user) {
  assertHrAccess(user, "promotions.view");
  return listCollection("promotions", query, user, ["employeeName", "employeeId", "reason", "status"]);
}

function createPromotion(payload, req) {
  assertHrAccess(req.user, "promotions.create");
  const employee = getEmployee(payload.employeeId || payload.employee_id, req.user);
  if (!employee) throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  const promotion = createRecord("promotions", {
    employeeId: employee.id,
    employee_id: employee.id,
    employeeName: getEmployeeName(employee),
    employee_name: getEmployeeName(employee),
    oldDepartmentId: employee.departmentId || employee.department_id || null,
    old_department_id: employee.departmentId || employee.department_id || null,
    newDepartmentId: payload.newDepartmentId || payload.new_department_id || employee.departmentId || employee.department_id || null,
    new_department_id: payload.newDepartmentId || payload.new_department_id || employee.departmentId || employee.department_id || null,
    oldPositionId: employee.positionId || employee.position_id || null,
    old_position_id: employee.positionId || employee.position_id || null,
    newPositionId: payload.newPositionId || payload.new_position_id || null,
    new_position_id: payload.newPositionId || payload.new_position_id || null,
    oldSalary: toNumber(employee.salary || employee.basicSalary || employee.basic_salary),
    old_salary: toNumber(employee.salary || employee.basicSalary || employee.basic_salary),
    newSalary: payload.newSalary ?? payload.new_salary ?? employee.salary,
    new_salary: payload.newSalary ?? payload.new_salary ?? employee.salary,
    effectiveDate: payload.effectiveDate || payload.effective_date,
    effective_date: payload.effectiveDate || payload.effective_date,
    reason: payload.reason || null,
    status: "PENDING",
    requestedBy: req.user.id,
    requested_by: req.user.id,
  }, req.user);
  audit(req, "Promotion Created", "Promotion", promotion.id, null, promotion);
  return promotion;
}

function approvePromotion(id, payload, req) {
  assertHrAccess(req.user, "promotions.approve");
  const promotion = activeRecords("promotions", req.user).find((item) => item.id === id);
  if (!promotion) return null;
  if (normalizeUpperStatus(promotion.status) !== "PENDING") throw createHttpError(409, "Only pending promotions can be approved.", "PROMOTION_NOT_PENDING");
  const employeeId = promotion.employeeId || promotion.employee_id;
  const employeeUpdate = writeCollectionRecord("employees", employeeId, (employee) => ({
    departmentId: promotion.newDepartmentId || promotion.new_department_id || employee.departmentId,
    department_id: promotion.newDepartmentId || promotion.new_department_id || employee.department_id,
    positionId: promotion.newPositionId || promotion.new_position_id || employee.positionId,
    position_id: promotion.newPositionId || promotion.new_position_id || employee.position_id,
    salary: promotion.newSalary ?? promotion.new_salary ?? employee.salary,
  }));
  const promotionUpdate = writeCollectionRecord("promotions", id, () => ({
    status: "APPROVED",
    approvedBy: req.user.id,
    approved_by: req.user.id,
    approvedAt: now(),
    approved_at: now(),
  }));
  createRecord("employee_salary_history", {
    employeeId,
    employee_id: employeeId,
    salary: promotion.newSalary ?? promotion.new_salary,
    effectiveFrom: promotion.effectiveDate || promotion.effective_date || now().slice(0, 10),
    effective_from: promotion.effectiveDate || promotion.effective_date || now().slice(0, 10),
    changeType: "PROMOTION",
    change_type: "PROMOTION",
    referenceId: id,
    reference_id: id,
    reason: promotion.reason || payload.reason || null,
    createdBy: req.user.id,
    created_by: req.user.id,
  }, req.user);
  audit(req, "Promotion Approved", "Promotion", id, promotion, promotionUpdate.record);
  if (employeeUpdate?.record) sendHrNotification("PROMOTION_APPROVED", employeeUpdate.record, "Promotion approved", "Your promotion has been approved.", { entityType: "promotion", entityId: id });
  return { oldValue: promotion, record: promotionUpdate.record, employee: employeeUpdate?.record };
}

function rejectPromotion(id, payload, req) {
  assertHrAccess(req.user, "promotions.reject");
  const promotion = activeRecords("promotions", req.user).find((item) => item.id === id);
  if (!promotion) return null;
  const result = writeCollectionRecord("promotions", id, () => ({
    status: "REJECTED",
    rejectedBy: req.user.id,
    rejected_by: req.user.id,
    rejectedAt: now(),
    rejected_at: now(),
    rejectionReason: payload.reason || payload.rejectionReason || null,
    rejection_reason: payload.reason || payload.rejectionReason || null,
  }));
  audit(req, "Promotion Rejected", "Promotion", id, promotion, result.record);
  return result;
}

function listSalaryAdjustments(query, user) {
  assertHrAccess(user, "salary_increments.view");
  return listCollection("salary_adjustments", query, user, ["employeeName", "adjustmentType", "reason", "status"]);
}

function createSalaryAdjustment(payload, req) {
  assertHrAccess(req.user, "salary_increments.create");
  const employee = getEmployee(payload.employeeId || payload.employee_id, req.user);
  if (!employee) throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  const oldSalary = toNumber(employee.salary || employee.basicSalary || employee.basic_salary);
  const newSalary = toNumber(payload.newSalary ?? payload.new_salary);
  const adjustment = createRecord("salary_adjustments", {
    employeeId: employee.id,
    employee_id: employee.id,
    employeeName: getEmployeeName(employee),
    employee_name: getEmployeeName(employee),
    adjustmentType: normalizeUpperStatus(payload.adjustmentType || payload.adjustment_type, "INCREMENT"),
    adjustment_type: normalizeUpperStatus(payload.adjustmentType || payload.adjustment_type, "INCREMENT"),
    oldSalary,
    old_salary: oldSalary,
    newSalary,
    new_salary: newSalary,
    difference: newSalary - oldSalary,
    percentage: oldSalary ? Number((((newSalary - oldSalary) / oldSalary) * 100).toFixed(2)) : 0,
    reason: payload.reason || null,
    effectiveDate: payload.effectiveDate || payload.effective_date || now().slice(0, 10),
    effective_date: payload.effectiveDate || payload.effective_date || now().slice(0, 10),
    status: "PENDING",
    requestedBy: req.user.id,
    requested_by: req.user.id,
  }, req.user);
  audit(req, "Salary Adjustment Created", "SalaryAdjustment", adjustment.id, null, adjustment);
  return adjustment;
}

function approveSalaryAdjustment(id, payload, req) {
  assertHrAccess(req.user, "salary_increments.approve");
  const adjustment = activeRecords("salary_adjustments", req.user).find((item) => item.id === id);
  if (!adjustment) return null;
  if (normalizeUpperStatus(adjustment.status) !== "PENDING") throw createHttpError(409, "Only pending salary adjustments can be approved.", "SALARY_ADJUSTMENT_NOT_PENDING");
  const employeeId = adjustment.employeeId || adjustment.employee_id;
  const employeeUpdate = writeCollectionRecord("employees", employeeId, () => ({
    salary: adjustment.newSalary ?? adjustment.new_salary,
    basicSalary: adjustment.newSalary ?? adjustment.new_salary,
    basic_salary: adjustment.newSalary ?? adjustment.new_salary,
  }));
  const result = writeCollectionRecord("salary_adjustments", id, () => ({
    status: "APPROVED",
    approvedBy: req.user.id,
    approved_by: req.user.id,
    approvedAt: now(),
    approved_at: now(),
  }));
  createRecord("employee_salary_history", {
    employeeId,
    employee_id: employeeId,
    salary: adjustment.newSalary ?? adjustment.new_salary,
    effectiveFrom: adjustment.effectiveDate || adjustment.effective_date,
    effective_from: adjustment.effectiveDate || adjustment.effective_date,
    changeType: adjustment.adjustmentType || adjustment.adjustment_type,
    change_type: adjustment.adjustmentType || adjustment.adjustment_type,
    referenceId: id,
    reference_id: id,
    reason: adjustment.reason || payload.reason || null,
    createdBy: req.user.id,
    created_by: req.user.id,
  }, req.user);
  audit(req, "Salary Increment Approved", "SalaryAdjustment", id, adjustment, result.record);
  if (employeeUpdate?.record) sendHrNotification("SALARY_INCREMENT_APPROVED", employeeUpdate.record, "Salary adjustment approved", "Your salary adjustment has been approved.", { entityType: "salary_adjustment", entityId: id });
  return { oldValue: adjustment, record: result.record, employee: employeeUpdate?.record };
}

function rejectSalaryAdjustment(id, payload, req) {
  assertHrAccess(req.user, "salary_increments.reject");
  const adjustment = activeRecords("salary_adjustments", req.user).find((item) => item.id === id);
  if (!adjustment) return null;
  if (normalizeUpperStatus(adjustment.status) !== "PENDING") {
    throw createHttpError(409, "Only pending salary adjustments can be rejected.", "SALARY_ADJUSTMENT_NOT_PENDING");
  }
  const result = writeCollectionRecord("salary_adjustments", id, () => ({
    status: "REJECTED",
    rejectedBy: req.user.id,
    rejected_by: req.user.id,
    rejectedAt: now(),
    rejected_at: now(),
    rejectionReason: payload.reason || payload.rejectionReason || payload.rejection_reason || null,
    rejection_reason: payload.reason || payload.rejectionReason || payload.rejection_reason || null,
  }));
  audit(req, "Salary Increment Rejected", "SalaryAdjustment", id, adjustment, result.record);
  return result;
}

function listOnboarding(query, user) {
  assertHrAccess(user, "onboarding.view");
  const records = listCollection("onboarding_records", query, user, ["employeeName", "status", "stage", "notes"]);
  records.data = records.data.map((record) => ({
    ...record,
    tasks: activeRecords("onboarding_tasks", user).filter((task) => (task.onboardingRecordId || task.onboarding_record_id) === record.id),
    documents: activeRecords("onboarding_documents", user).filter((document) => (document.onboardingRecordId || document.onboarding_record_id) === record.id),
  }));
  return records;
}

function createOnboardingTask(onboardingId, payload, req) {
  assertHrAccess(req.user, "onboarding.update");
  const onboarding = activeRecords("onboarding_records", req.user).find((record) => record.id === onboardingId);
  if (!onboarding) return null;
  const employeeId = employeeIdOf(onboarding);
  const task = createRecord("onboarding_tasks", {
    onboardingRecordId: onboardingId,
    onboarding_record_id: onboardingId,
    employeeId,
    employee_id: employeeId,
    title: payload.title || payload.name,
    description: payload.description || null,
    assignedTo: payload.assignedTo || payload.assigned_to || req.user.id,
    assigned_to: payload.assignedTo || payload.assigned_to || req.user.id,
    status: normalizeUpperStatus(payload.status, "PENDING"),
    dueDate: payload.dueDate || payload.due_date || null,
    due_date: payload.dueDate || payload.due_date || null,
  }, req.user);
  audit(req, "Onboarding Task Created", "OnboardingTask", task.id, null, task);
  return task;
}

function updateOnboardingTask(id, payload, req) {
  assertHrAccess(req.user, "onboarding.update");
  const task = activeRecords("onboarding_tasks", req.user).find((record) => record.id === id);
  if (!task) return null;
  const status = normalizeUpperStatus(payload.status, task.status || "PENDING");
  const result = writeCollectionRecord("onboarding_tasks", id, (record) => compactObject({
    title: payload.title ?? record.title,
    description: payload.description ?? record.description,
    assignedTo: payload.assignedTo || payload.assigned_to || record.assignedTo,
    assigned_to: payload.assignedTo || payload.assigned_to || record.assigned_to,
    status,
    dueDate: payload.dueDate || payload.due_date || record.dueDate,
    due_date: payload.dueDate || payload.due_date || record.due_date,
    completedAt: status === "COMPLETED" ? now() : record.completedAt,
    completed_at: status === "COMPLETED" ? now() : record.completed_at,
  }));
  audit(req, "Onboarding Task Updated", "OnboardingTask", id, task, result.record);
  return result;
}

function getOnboarding(id, user) {
  assertHrAccess(user, "onboarding.view");
  const record = activeRecords("onboarding_records", user).find((item) => item.id === id);
  if (!record) return null;
  return {
    ...record,
    tasks: activeRecords("onboarding_tasks", user).filter((task) => (task.onboardingRecordId || task.onboarding_record_id) === id),
    documents: activeRecords("onboarding_documents", user).filter((document) => (document.onboardingRecordId || document.onboarding_record_id) === id),
  };
}

function createOnboarding(payload, req) {
  assertHrAccess(req.user, "onboarding.create");
  const employee = getEmployee(payload.employeeId || payload.employee_id, req.user);
  if (!employee) throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  const record = createRecord("onboarding_records", {
    employeeId: employee.id,
    employee_id: employee.id,
    employeeName: getEmployeeName(employee),
    employee_name: getEmployeeName(employee),
    status: normalizeUpperStatus(payload.status, "PENDING"),
    stage: payload.stage || "HR_REVIEW",
    startedAt: payload.startedAt || payload.started_at || now(),
    started_at: payload.startedAt || payload.started_at || now(),
    dueDate: payload.dueDate || payload.due_date || null,
    due_date: payload.dueDate || payload.due_date || null,
    notes: payload.notes || payload.note || null,
  }, req.user);

  for (const task of Array.isArray(payload.tasks) ? payload.tasks : []) {
    createRecord("onboarding_tasks", {
      onboardingRecordId: record.id,
      onboarding_record_id: record.id,
      employeeId: employee.id,
      employee_id: employee.id,
      title: task.title || task.name,
      description: task.description || null,
      status: normalizeUpperStatus(task.status, "PENDING"),
      dueDate: task.dueDate || task.due_date || null,
      due_date: task.dueDate || task.due_date || null,
      assignedTo: task.assignedTo || task.assigned_to || req.user.id,
      assigned_to: task.assignedTo || task.assigned_to || req.user.id,
    }, req.user);
  }

  for (const document of Array.isArray(payload.documents) ? payload.documents : []) {
    createRecord("onboarding_documents", {
      onboardingRecordId: record.id,
      onboarding_record_id: record.id,
      employeeId: employee.id,
      employee_id: employee.id,
      documentType: document.documentType || document.document_type || document.type,
      document_type: document.documentType || document.document_type || document.type,
      documentName: document.documentName || document.document_name || document.name,
      document_name: document.documentName || document.document_name || document.name,
      fileUrl: document.fileUrl || document.file_url || document.url || null,
      file_url: document.fileUrl || document.file_url || document.url || null,
      status: normalizeUpperStatus(document.status, "PENDING"),
    }, req.user);
  }

  writeCollectionRecord("employees", employee.id, (current) => ({
    status: employeeStatus(current) === "ACTIVE" ? "ONBOARDING" : current.status,
    employmentStatus: current.employmentStatus || current.employment_status || "ONBOARDING",
    employment_status: current.employmentStatus || current.employment_status || "ONBOARDING",
    onboardingDate: current.onboardingDate || current.onboarding_date || now().slice(0, 10),
    onboarding_date: current.onboardingDate || current.onboarding_date || now().slice(0, 10),
  }));
  audit(req, "Onboarding Created", "Onboarding", record.id, null, record);
  return getOnboarding(record.id, req.user);
}

function updateOnboarding(id, payload, req) {
  assertHrAccess(req.user, "onboarding.update");
  const oldValue = activeRecords("onboarding_records", req.user).find((item) => item.id === id);
  if (!oldValue) return null;
  const status = payload.status ? normalizeUpperStatus(payload.status, oldValue.status) : oldValue.status;
  const result = writeCollectionRecord("onboarding_records", id, (record) => ({
    status,
    stage: payload.stage ?? record.stage,
    notes: payload.notes ?? payload.note ?? record.notes,
    completedAt: ["COMPLETED", "CONFIRMED"].includes(status) ? now() : record.completedAt,
    completed_at: ["COMPLETED", "CONFIRMED"].includes(status) ? now() : record.completed_at,
    reviewedBy: ["REVIEW", "COMPLETED", "CONFIRMED", "CANCELLED"].includes(status) ? req.user.id : record.reviewedBy,
    reviewed_by: ["REVIEW", "COMPLETED", "CONFIRMED", "CANCELLED"].includes(status) ? req.user.id : record.reviewed_by,
  }));
  if (["COMPLETED", "CONFIRMED"].includes(status)) {
    const employeeId = result.record.employeeId || result.record.employee_id;
    writeCollectionRecord("employees", employeeId, (employee) => ({
      status: status === "CONFIRMED" ? "CONFIRMED" : "AWAITING_CONFIRMATION",
      employmentStatus: status === "CONFIRMED" ? "CONFIRMED" : "AWAITING_CONFIRMATION",
      employment_status: status === "CONFIRMED" ? "CONFIRMED" : "AWAITING_CONFIRMATION",
      confirmationDate: status === "CONFIRMED" ? now().slice(0, 10) : employee.confirmationDate,
      confirmation_date: status === "CONFIRMED" ? now().slice(0, 10) : employee.confirmation_date,
    }));
  }
  audit(req, "Onboarding Updated", "Onboarding", id, oldValue, result.record);
  return { oldValue, record: getOnboarding(id, req.user) };
}

function listAttendance(query, user) {
  assertHrAccess(user, "attendance.view");
  return listCollection("attendance", query, user, ["employeeName", "status", "source", "notes"]);
}

function correctAttendance(id, payload, req) {
  assertHrAccess(req.user, "attendance.correct");
  const result = writeCollectionRecord("attendance", id, (record) => ({
    checkIn: payload.checkIn || payload.check_in || record.checkIn,
    check_in: payload.checkIn || payload.check_in || record.check_in,
    checkOut: payload.checkOut || payload.check_out || record.checkOut,
    check_out: payload.checkOut || payload.check_out || record.check_out,
    status: payload.status || record.status,
    lateMinutes: payload.lateMinutes ?? payload.late_minutes ?? record.lateMinutes,
    late_minutes: payload.lateMinutes ?? payload.late_minutes ?? record.late_minutes,
    overtimeMinutes: payload.overtimeMinutes ?? payload.overtime_minutes ?? record.overtimeMinutes,
    overtime_minutes: payload.overtimeMinutes ?? payload.overtime_minutes ?? record.overtime_minutes,
    notes: payload.notes ?? record.notes,
    correctedBy: req.user.id,
    corrected_by: req.user.id,
    correctionReason: payload.reason || payload.correctionReason || null,
    correction_reason: payload.reason || payload.correctionReason || null,
  }));
  if (result) audit(req, "Attendance Corrected", "Attendance", id, result.oldValue, result.record);
  return result;
}

function listApprovalQueue(user, query = {}) {
  assertHrAccess(user, "overview.view");
  return paginate(applyBasicFilters(buildApprovalQueue(user), { ...query, q: query.q || query.search }, ["requestType", "entityType", "status"]), query);
}

function buildApprovalQueue(user) {
  const organizationId = getOrganizationId(user);
  const hrApprovalTypes = new Set([
    "leave",
    "leave_request",
    "promotion",
    "salary",
    "salary_adjustment",
    "salary_increment",
    "onboarding",
    "confirmation",
    "employee_confirmation",
    "document",
    "employee_document",
    "discipline",
    "disciplinary_case",
  ]);
  const queue = [
    ...activeRecords("approval_requests", user).filter((item) => {
      const type = String(item.requestType || item.request_type || item.entityType || item.entity_type || "").trim().toLowerCase();
      return hrApprovalTypes.has(type);
    }),
    ...activeRecords("leave_requests", user).filter((item) => normalizeUpperStatus(item.status) === "PENDING").map((item) => approvalItem("LEAVE", "leave_request", item, item.createdBy || item.created_by, organizationId)),
    ...activeRecords("promotions", user).filter((item) => normalizeUpperStatus(item.status) === "PENDING").map((item) => approvalItem("PROMOTION", "promotion", item, item.requestedBy || item.requested_by, organizationId)),
    ...activeRecords("salary_adjustments", user).filter((item) => normalizeUpperStatus(item.status) === "PENDING").map((item) => approvalItem("SALARY_INCREMENT", "salary_adjustment", item, item.requestedBy || item.requested_by, organizationId)),
  ];
  return queue.filter((item) => !item.assignedTo || item.assignedTo === user.id || item.assigned_to === user.id);
}

function approvalItem(requestType, entityType, item, requestedBy, organizationId) {
  return {
    id: `${requestType}-${item.id}`,
    organizationId: item.organizationId || item.organization_id || organizationId || null,
    requestType,
    request_type: requestType,
    entityType,
    entity_type: entityType,
    entityId: item.id,
    entity_id: item.id,
    requestedBy: requestedBy || null,
    requested_by: requestedBy || null,
    assignedTo: item.assignedTo || item.assigned_to || null,
    assigned_to: item.assignedTo || item.assigned_to || null,
    status: "PENDING",
    createdAt: item.createdAt || item.created_at,
    created_at: item.createdAt || item.created_at,
  };
}

function listDocuments(query, user) {
  assertHrAccess(user, "employees.documents.view");
  return listCollection("employee_documents", query, user, ["documentName", "document_name", "name", "documentType", "document_type", "type", "status"]);
}

function listExpiringDocuments(query, user) {
  assertHrAccess(user, "employees.documents.view");
  return paginate(applyBasicFilters(listExpiringDocumentsForUser(user, Number(query.days || query.expiryDays || DOCUMENT_EXPIRY_DAYS)), { ...query, q: query.q || query.search }, ["documentName", "documentType", "status"]), query);
}

function listMissingDocuments(query, user) {
  assertHrAccess(user, "employees.documents.view");
  const employees = activeRecords("employees", user).filter(isActiveEmployee);
  const documents = activeRecords("employee_documents", user);
  return paginate(applyBasicFilters(listMissingDocumentsForEmployees(employees, documents), { ...query, q: query.q || query.search }, ["employeeName", "missingTypes"]), query);
}

function listConfirmations(query, user) {
  assertHrAccess(user, "confirmation.view");
  const explicitRequests = activeRecords("employee_confirmations", user);
  const explicitEmployeeIds = new Set(explicitRequests.map((request) => request.employeeId || request.employee_id).filter(Boolean));
  const computedRequests = activeRecords("employees", user)
    .filter((employee) => isAwaitingConfirmation(employee) && !explicitEmployeeIds.has(employee.id))
    .map((employee) => ({
      id: employee.id,
      employeeId: employee.id,
      employee_id: employee.id,
      employeeName: getEmployeeName(employee),
      employee_name: getEmployeeName(employee),
      status: "AWAITING_CONFIRMATION",
      probationEndDate: employee.probationEndDate || employee.probation_end_date || employee.confirmationDueDate || employee.confirmation_due_date || null,
      probation_end_date: employee.probationEndDate || employee.probation_end_date || employee.confirmationDueDate || employee.confirmation_due_date || null,
      source: "employee",
      createdAt: employee.createdAt || employee.created_at,
      created_at: employee.createdAt || employee.created_at,
    }));
  return paginate(applyBasicFilters([...explicitRequests, ...computedRequests], { ...query, q: query.q || query.search }, ["employeeName", "status", "remarks"]), query);
}

function resolveConfirmationTarget(id, user) {
  const request = activeRecords("employee_confirmations", user).find((item) => item.id === id);
  if (request) {
    return { request, employeeId: request.employeeId || request.employee_id };
  }
  const employee = activeRecords("employees", user).find((item) => item.id === id);
  return employee ? { request: null, employeeId: employee.id } : null;
}

function approveConfirmation(id, payload, req) {
  assertHrAccess(req.user, "confirmation.approve");
  const target = resolveConfirmationTarget(id, req.user);
  if (!target) return null;
  const oldRequest = target.request;
  const request = oldRequest
    ? writeCollectionRecord("employee_confirmations", oldRequest.id, () => ({
        status: "CONFIRMED",
        decision: "CONFIRMED",
        remarks: payload.remarks || payload.note || null,
        approvedBy: req.user.id,
        approved_by: req.user.id,
        approvedAt: now(),
        approved_at: now(),
      })).record
    : createRecord("employee_confirmations", {
        employeeId: target.employeeId,
        employee_id: target.employeeId,
        status: "CONFIRMED",
        decision: "CONFIRMED",
        remarks: payload.remarks || payload.note || null,
        approvedBy: req.user.id,
        approved_by: req.user.id,
        approvedAt: now(),
        approved_at: now(),
      }, req.user);
  const employeeUpdate = writeCollectionRecord("employees", target.employeeId, () => ({
    status: "CONFIRMED",
    employmentStatus: "CONFIRMED",
    employment_status: "CONFIRMED",
    confirmationStatus: "CONFIRMED",
    confirmation_status: "CONFIRMED",
    confirmationDate: payload.confirmationDate || payload.confirmation_date || now().slice(0, 10),
    confirmation_date: payload.confirmationDate || payload.confirmation_date || now().slice(0, 10),
  }));
  audit(req, "Employee Confirmed", "EmployeeConfirmation", request.id, oldRequest, request);
  if (employeeUpdate?.record) sendHrNotification("EMPLOYEE_CONFIRMED", employeeUpdate.record, "Employment confirmed", "Your employment confirmation has been approved.", { entityType: "employee_confirmation", entityId: request.id });
  return { oldValue: oldRequest, record: request, employee: employeeUpdate?.record };
}

function extendConfirmation(id, payload, req) {
  assertHrAccess(req.user, "confirmation.review");
  const target = resolveConfirmationTarget(id, req.user);
  if (!target) return null;
  const extensionDate = payload.extendedUntil || payload.extended_until || payload.probationEndDate || payload.probation_end_date;
  if (!extensionDate) {
    throw createHttpError(400, "Extended probation end date is required.", "EXTENSION_DATE_REQUIRED");
  }
  const oldRequest = target.request;
  const request = oldRequest
    ? writeCollectionRecord("employee_confirmations", oldRequest.id, () => ({
        status: "EXTENDED",
        decision: "EXTENDED",
        remarks: payload.remarks || payload.reason || null,
        extendedUntil: extensionDate,
        extended_until: extensionDate,
        reviewedBy: req.user.id,
        reviewed_by: req.user.id,
        reviewedAt: now(),
        reviewed_at: now(),
      })).record
    : createRecord("employee_confirmations", {
        employeeId: target.employeeId,
        employee_id: target.employeeId,
        status: "EXTENDED",
        decision: "EXTENDED",
        remarks: payload.remarks || payload.reason || null,
        extendedUntil: extensionDate,
        extended_until: extensionDate,
        reviewedBy: req.user.id,
        reviewed_by: req.user.id,
        reviewedAt: now(),
        reviewed_at: now(),
      }, req.user);
  const employeeUpdate = writeCollectionRecord("employees", target.employeeId, () => ({
    status: "PROBATION",
    employmentStatus: "PROBATION",
    employment_status: "PROBATION",
    confirmationStatus: "EXTENDED",
    confirmation_status: "EXTENDED",
    probationEndDate: extensionDate,
    probation_end_date: extensionDate,
  }));
  audit(req, "Employee Confirmation Extended", "EmployeeConfirmation", request.id, oldRequest, request);
  return { oldValue: oldRequest, record: request, employee: employeeUpdate?.record };
}

function notConfirmEmployee(id, payload, req) {
  assertHrAccess(req.user, "confirmation.review");
  const target = resolveConfirmationTarget(id, req.user);
  if (!target) return null;
  const oldRequest = target.request;
  const request = oldRequest
    ? writeCollectionRecord("employee_confirmations", oldRequest.id, () => ({
        status: "NOT_CONFIRMED",
        decision: "NOT_CONFIRMED",
        remarks: payload.remarks || payload.reason || null,
        reviewedBy: req.user.id,
        reviewed_by: req.user.id,
        reviewedAt: now(),
        reviewed_at: now(),
      })).record
    : createRecord("employee_confirmations", {
        employeeId: target.employeeId,
        employee_id: target.employeeId,
        status: "NOT_CONFIRMED",
        decision: "NOT_CONFIRMED",
        remarks: payload.remarks || payload.reason || null,
        reviewedBy: req.user.id,
        reviewed_by: req.user.id,
        reviewedAt: now(),
        reviewed_at: now(),
      }, req.user);
  const employeeUpdate = writeCollectionRecord("employees", target.employeeId, () => ({
    status: "AWAITING_CONFIRMATION",
    employmentStatus: "AWAITING_CONFIRMATION",
    employment_status: "AWAITING_CONFIRMATION",
    confirmationStatus: "NOT_CONFIRMED",
    confirmation_status: "NOT_CONFIRMED",
  }));
  audit(req, "Employee Not Confirmed", "EmployeeConfirmation", request.id, oldRequest, request);
  if (employeeUpdate?.record) sendHrNotification("EMPLOYEE_NOT_CONFIRMED", employeeUpdate.record, "Confirmation review completed", "Your confirmation review has been returned.", { entityType: "employee_confirmation", entityId: request.id });
  return { oldValue: oldRequest, record: request, employee: employeeUpdate?.record };
}

function listDiscipline(query, user) {
  assertHrAccess(user, "discipline.view");
  return listCollection("disciplinary_cases", query, user, ["caseNumber", "case_number", "category", "status", "severity", "employeeName", "employee_name"]);
}

function createDisciplineCase(payload, req) {
  assertHrAccess(req.user, "discipline.create");
  const result = disciplineService.createCase({
    ...payload,
    actionType: payload.actionType || payload.action_type || "OTHER",
    incidentDate: payload.incidentDate || payload.incident_date || now().slice(0, 10),
    description: payload.description || payload.summary || payload.actionTaken || payload.action_taken || "HR disciplinary case opened.",
  }, req.user);
  audit(req, "Disciplinary Case Created", "DisciplinaryCase", result.record.id, null, result.record);
  return result;
}

function updateDisciplineCase(id, payload, req) {
  assertHrAccess(req.user, "discipline.update");
  const result = disciplineService.updateCase(id, payload, req.user);
  if (result) audit(req, "Disciplinary Case Updated", "DisciplinaryCase", id, result.oldValues, result.record);
  return result;
}

function resolveDisciplineCase(id, payload, req) {
  assertHrAccess(req.user, "discipline.resolve");
  const result = disciplineService.resolveCase(id, payload, req.user);
  if (result) {
    audit(req, "Disciplinary Case Resolved", "DisciplinaryCase", id, result.oldValues, result.record);
    const employee = getEmployee(employeeIdOf(result.record), req.user);
    if (employee) sendHrNotification("DISCIPLINARY_CASE_RESOLVED", employee, "Disciplinary case resolved", "A disciplinary case has been resolved.", { entityType: "disciplinary_case", entityId: id });
  }
  return result;
}

function closeDisciplineCase(id, payload, req) {
  assertHrAccess(req.user, "discipline.close");
  const result = disciplineService.closeCase(id, payload, req.user);
  if (result) audit(req, "Disciplinary Case Closed", "DisciplinaryCase", id, result.oldValues, result.record);
  return result;
}

function createDocument(payload, req) {
  assertHrAccess(req.user, "employees.documents.create");
  const employee = getEmployee(payload.employeeId || payload.employee_id || payload.staffId || payload.staff_id, req.user);
  if (!employee) throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  const document = createRecord("employee_documents", {
    employeeId: employee.id,
    employee_id: employee.id,
    documentType: payload.documentType || payload.document_type || payload.type,
    document_type: payload.documentType || payload.document_type || payload.type,
    documentName: payload.documentName || payload.document_name || payload.name,
    document_name: payload.documentName || payload.document_name || payload.name,
    fileUrl: payload.fileUrl || payload.file_url || payload.url || null,
    file_url: payload.fileUrl || payload.file_url || payload.url || null,
    fileReference: payload.fileReference || payload.file_reference || payload.fileId || null,
    file_reference: payload.fileReference || payload.file_reference || payload.fileId || null,
    issueDate: payload.issueDate || payload.issue_date || null,
    issue_date: payload.issueDate || payload.issue_date || null,
    expiryDate: payload.expiryDate || payload.expiry_date || null,
    expiry_date: payload.expiryDate || payload.expiry_date || null,
    uploadedBy: req.user.id,
    uploaded_by: req.user.id,
    status: normalizeUpperStatus(payload.status, "PENDING_VERIFICATION"),
  }, req.user);
  audit(req, "Document Uploaded", "EmployeeDocument", document.id, null, document);
  return document;
}

function verifyDocument(id, payload, req) {
  assertHrAccess(req.user, "employees.documents.update");
  const document = activeRecords("employee_documents", req.user).find((record) => record.id === id);
  if (!document) return null;
  const verified = payload.verified ?? true;
  const status = verified ? "VERIFIED" : normalizeUpperStatus(payload.status, "REJECTED");
  const result = writeCollectionRecord("employee_documents", id, () => ({
    status,
    verified: Boolean(verified),
    verifiedBy: req.user.id,
    verified_by: req.user.id,
    verifiedAt: now(),
    verified_at: now(),
    verificationNote: payload.note || payload.reason || null,
    verification_note: payload.note || payload.reason || null,
  }));
  audit(req, verified ? "Document Verified" : "Document Rejected", "EmployeeDocument", id, document, result.record);
  return result;
}

function deleteDocument(id, req) {
  assertHrAccess(req.user, "employees.documents.delete");
  const document = activeRecords("employee_documents", req.user).find((record) => record.id === id);
  if (!document) return null;
  const result = writeCollectionRecord("employee_documents", id, () => ({
    status: "DELETED",
    deletedAt: now(),
    deleted_at: now(),
    deletedBy: req.user.id,
    deleted_by: req.user.id,
  }));
  audit(req, "Document Deleted", "EmployeeDocument", id, document, result.record);
  return result;
}

function listExpiredDocuments(query, user) {
  assertHrAccess(user, "employees.documents.view");
  const expired = activeRecords("employee_documents", user).filter((document) => {
    const expiry = document.expiryDate || document.expiry_date;
    return expiry && new Date(expiry).getTime() < Date.now();
  });
  return paginate(applyBasicFilters(expired, { ...query, q: query.q || query.search }, ["documentName", "document_name", "documentType", "document_type", "status"]), query);
}

function returnRequest(entityType, id, payload, req) {
  assertHrAccess(req.user, "overview.view");
  const collection = collectionForReturnType(entityType);
  if (!collection) throw createHttpError(400, "Unsupported HR request type.", "UNSUPPORTED_REQUEST_TYPE", { entityType });
  const record = activeRecords(collection, req.user).find((item) => item.id === id);
  if (!record) return null;
  const result = writeCollectionRecord(collection, id, () => ({
    status: "RETURNED",
    returnedBy: req.user.id,
    returned_by: req.user.id,
    returnedAt: now(),
    returned_at: now(),
    returnReason: payload.reason || payload.returnReason || payload.return_reason || null,
    return_reason: payload.reason || payload.returnReason || payload.return_reason || null,
    requestType: entityType,
    request_type: entityType,
    entityId: id,
    entity_id: id,
  }));
  audit(req, "Request Returned", entityType, id, record, result.record);
  const employee = getEmployee(employeeIdOf(result.record), req.user);
  if (employee) sendHrNotification("REQUEST_RETURNED", employee, "Request returned", "An HR request was returned for updates.", { entityType, entityId: id });
  return result;
}

function listReturnedRequests(query, user) {
  assertHrAccess(user, "overview.view");
  const returnedStatuses = new Set(["RETURNED", "CHANGES_REQUESTED", "NOT_CONFIRMED"]);
  const records = [
    ...activeRecords("leave_requests", user).map((record) => ({ ...record, requestType: "LEAVE" })),
    ...activeRecords("promotions", user).map((record) => ({ ...record, requestType: "PROMOTION" })),
    ...activeRecords("salary_adjustments", user).map((record) => ({ ...record, requestType: "SALARY_INCREMENT" })),
    ...activeRecords("onboarding_records", user).map((record) => ({ ...record, requestType: "ONBOARDING" })),
    ...activeRecords("employee_confirmations", user).map((record) => ({ ...record, requestType: "CONFIRMATION" })),
    ...activeRecords("employee_documents", user).map((record) => ({ ...record, requestType: "DOCUMENT" })),
  ].filter((record) => returnedStatuses.has(normalizeUpperStatus(record.status, "")));
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["requestType", "employeeName", "status", "returnReason"]), query);
}

function listReports(query, user) {
  assertHrAccess(user, "reports.view");
  const employees = activeRecords("employees", user);
  const onboarding = activeRecords("onboarding_records", user);
  const promotions = activeRecords("promotions", user);
  const salaryAdjustments = activeRecords("salary_adjustments", user);
  const discipline = activeRecords("disciplinary_cases", user);
  const documents = activeRecords("employee_documents", user);
  const employeeExits = activeRecords("employee_exit_records", user);
  const missingDocuments = listMissingDocumentsForEmployees(employees.filter(isActiveEmployee), documents);
  const expiringDocuments = listExpiringDocumentsForUser(user, Number(query.expiryDays || query.expiry_days || DOCUMENT_EXPIRY_DAYS));
  return {
    employees: getStats(user, query),
    employeeReport: listEmployees(query, user),
    onboarding: {
      total: onboarding.length,
      pending: onboarding.filter((record) => normalizeUpperStatus(record.status) === "PENDING").length,
      completed: onboarding.filter((record) => ["COMPLETED", "CONFIRMED"].includes(normalizeUpperStatus(record.status))).length,
      returned: onboarding.filter((record) => normalizeUpperStatus(record.status) === "RETURNED").length,
    },
    leave: leaveService.getReports(user, query),
    promotions: {
      total: promotions.length,
      pending: promotions.filter((record) => normalizeUpperStatus(record.status) === "PENDING").length,
      approved: promotions.filter((record) => normalizeUpperStatus(record.status) === "APPROVED").length,
      rejected: promotions.filter((record) => normalizeUpperStatus(record.status) === "REJECTED").length,
    },
    salaryIncrements: {
      total: salaryAdjustments.length,
      pending: salaryAdjustments.filter((record) => normalizeUpperStatus(record.status) === "PENDING").length,
      approved: salaryAdjustments.filter((record) => normalizeUpperStatus(record.status) === "APPROVED").length,
      rejected: salaryAdjustments.filter((record) => normalizeUpperStatus(record.status) === "REJECTED").length,
    },
    salaryHistory: listCollection("employee_salary_history", query, user, ["changeType", "reason"]),
    discipline: {
      total: discipline.length,
      open: discipline.filter((record) => ["OPEN", "UNDER_REVIEW", "UNDER_INVESTIGATION"].includes(normalizeUpperStatus(record.status, "OPEN"))).length,
      resolved: discipline.filter((record) => ["RESOLVED", "CLOSED"].includes(normalizeUpperStatus(record.status, "OPEN"))).length,
    },
    documents: {
      total: documents.length,
      missing: missingDocuments.length,
      expiringSoon: expiringDocuments.length,
      expired: documents.filter((document) => {
        const expiry = document.expiryDate || document.expiry_date;
        return expiry && new Date(expiry).getTime() < Date.now();
      }).length,
    },
    employeeExits: {
      total: employeeExits.length,
      pending: employeeExits.filter((record) => ["PENDING", "UNDER_REVIEW"].includes(normalizeUpperStatus(record.status, "PENDING"))).length,
      approved: employeeExits.filter((record) => normalizeUpperStatus(record.status) === "APPROVED").length,
      completed: employeeExits.filter((record) => normalizeUpperStatus(record.status) === "COMPLETED").length,
      cancelled: employeeExits.filter((record) => ["CANCELLED", "REJECTED"].includes(normalizeUpperStatus(record.status, ""))).length,
    },
    confirmations: {
      awaiting: activeRecords("employees", user).filter(isAwaitingConfirmation).length,
      confirmed: activeRecords("employee_confirmations", user).filter((record) => normalizeUpperStatus(record.status) === "CONFIRMED").length,
      extended: activeRecords("employee_confirmations", user).filter((record) => normalizeUpperStatus(record.status) === "EXTENDED").length,
    },
    attendance: hasPermission(user, "attendance.view") ? summarizeAttendance(activeRecords("attendance", user), activeRecords("employees", user)) : null,
    activity: listAuditLogs({ ...query, limit: query.limit || 25 }, user),
  };
}

function listAuditLogs(query, user) {
  assertHrAccess(user, "audit_logs.view");
  return paginate(applyBasicFilters(listHrAuditRecords(user), { ...query, q: query.q || query.search }, ["action", "module", "actorName", "targetType"]), query);
}

function listHrAuditRecords(user) {
  const organizationId = getOrganizationId(user);
  const hrTargetTypes = new Set([
    "Employee",
    "Department",
    "Position",
    "LeaveRequest",
    "Promotion",
    "SalaryAdjustment",
    "Onboarding",
    "OnboardingTask",
    "EmployeeConfirmation",
    "DisciplinaryCase",
    "EmployeeDocument",
  ]);
  return readCollection("operational_audit_logs").filter((record) => {
    if (record.deletedAt || record.deleted_at) return false;
    const recordOrgId = record.metadata?.organizationId || record.metadata?.organization_id || record.organizationId || record.organization_id;
    if (organizationId && String(recordOrgId || "") !== String(organizationId)) return false;
    if (String(record.module || "").toUpperCase() === "HR") return true;
    return hrTargetTypes.has(record.targetType || record.target_type);
  });
}

module.exports = {
  addNyscInternAttendance,
  addNyscInternDocument,
  addNyscInternReview,
  approveEmployeeExit,
  approveLeave,
  approveConfirmation,
  approvePromotion,
  approveSalaryAdjustment,
  assignNyscInternSupervisor,
  cancelEmployeeExit,
  changeNyscInternDepartment,
  closeDisciplineCase,
  completeEmployeeExit,
  completeNyscInternPlacement,
  correctAttendance,
  convertNyscInternToEmployee,
  createDepartment,
  createDocument,
  createDisciplineCase,
  createEmployee,
  createEmployeeExit,
  createLeave,
  createNyscInternProfile,
  createOnboarding,
  createOnboardingTask,
  createPosition,
  createPromotion,
  createSalaryAdjustment,
  deleteDepartment,
  deleteDocument,
  extendConfirmation,
  extendNyscInternPlacement,
  getDashboard,
  getEmployeeExit,
  getEmployeeProfile,
  getHelpCenter,
  getHrProfile,
  getHrSettings,
  getLeave,
  getNyscInternDashboard,
  getNyscInternProfile,
  getNyscInternSummary,
  getOnboarding,
  getStats,
  listApprovalQueue,
  listAttendance,
  listAuditLogs,
  listCollection,
  listConfirmations,
  listDepartments,
  listDiscipline,
  listDocuments,
  listEmployeeExits,
  listEmployees,
  listExpiredDocuments,
  listExpiringDocuments,
  listHrNotifications,
  listLeave,
  listMissingDocuments,
  listNyscInternAttendance,
  listNyscInternDocuments,
  listNyscInternHistory,
  listNyscInternProfiles,
  listNyscInternReviews,
  listOnboarding,
  listPositions,
  listPromotions,
  listReports,
  listSalaryAdjustments,
  listReturnedRequests,
  markHrNotificationRead,
  notConfirmEmployee,
  patchEmployeeStatus,
  processNyscInternExit,
  rejectLeave,
  rejectPromotion,
  rejectSalaryAdjustment,
  resolveDisciplineCase,
  returnRequest,
  terminateNyscInternPlacement,
  updateDisciplineCase,
  updateOnboardingTask,
  updateDepartment,
  updateEmployee,
  updateEmployeeExit,
  updateHrProfile,
  updateHrSettings,
  updateNyscInternProfile,
  updateOnboarding,
  updatePosition,
  verifyDocument,
  assertHrAccess,
  createRecord,
};
