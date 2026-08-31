const crypto = require("crypto");
const { getUserById, listUsers, updateUser } = require("../../auth/userStore");
const { hasPermission } = require("../../constants/rbac");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate, sortRecords } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const { queueNotification } = require("../_shared/notificationService");

const EMAIL_STATUSES = Object.freeze(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "CREATING", "CREATED", "FAILED", "CANCELLED"]);
const EMAIL_TRANSITIONS = Object.freeze({
  PENDING: ["UNDER_REVIEW", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED", "PENDING"],
  APPROVED: ["CREATING", "CANCELLED"],
  REJECTED: ["CANCELLED"],
  CREATING: ["CREATED", "FAILED", "CANCELLED"],
  FAILED: ["CREATING", "CANCELLED"],
  CREATED: [],
  CANCELLED: [],
});
const COMPANY_EMAIL_STATUSES = Object.freeze(["PROVISIONING", "ACTIVE", "SUSPENDED", "DEACTIVATION_PENDING", "DEACTIVATED", "FAILED"]);
const COMPANY_EMAIL_TRANSITIONS = Object.freeze({
  PROVISIONING: ["ACTIVE", "FAILED"],
  ACTIVE: ["SUSPENDED", "DEACTIVATION_PENDING"],
  SUSPENDED: ["ACTIVE", "DEACTIVATION_PENDING"],
  DEACTIVATION_PENDING: ["DEACTIVATED"],
  DEACTIVATED: [],
  FAILED: ["PROVISIONING"],
});
const CALENDAR_TYPES = Object.freeze(["MEETING", "REMINDER", "TASK_DEADLINE", "MANAGEMENT_EVENT", "CUSTOM_EVENT", "EVENT", "DEADLINE"]);
const MEETING_STATUSES = Object.freeze(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "RESCHEDULED"]);
const TASK_STATUSES = Object.freeze(["TODO", "PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE", "CANCELLED"]);
const REMINDER_STATUSES = Object.freeze(["PENDING", "SENT", "CANCELLED", "FAILED"]);
const FINAL_TASK_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
const MANAGEMENT_ROLES = new Set(["superadmin", "admin", "manager", "department_manager", "hr"]);

const SEARCH_FIELDS = Object.freeze({
  email_requests: ["requestedEmailName", "requested_email_name", "requestedEmail", "requested_email", "purpose", "status", "failureReason", "failure_reason"],
  company_email_accounts: ["emailAddress", "email_address", "status", "provider"],
  calendar_events: ["title", "description", "type", "location", "status"],
  meetings: ["title", "description", "location", "status", "organizerName", "organizer_name"],
  tasks: ["title", "description", "priority", "status", "notes"],
  reminders: ["title", "description", "relatedType", "related_type", "status"],
  notifications: ["title", "message", "body", "type", "status"],
});

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

function field(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return null;
}

function normalizeStatus(value, fallback = "PENDING") {
  return String(value || fallback).trim().toUpperCase();
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => entry !== undefined));
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt && !record.deleted_at && String(record.status || "").toLowerCase() !== "deleted");
}

function saveCollection(collection, records) {
  writeCollection(collection, records);
}

function getOrganizationId(value) {
  return field(value, ["organizationId", "organization_id", "employerId", "employer_id", "companyId", "company_id"]);
}

function getDepartmentId(value) {
  return field(value, ["departmentId", "department_id", "assignedDepartmentId", "assigned_department_id"]);
}

function getEmployeeId(value) {
  return field(value, ["employeeId", "employee_id", "assignedEmployeeId", "assigned_employee_id", "recipientEmployeeId", "recipient_employee_id"]);
}

function getAssignedTo(value) {
  return field(value, ["assignedTo", "assigned_to", "assigneeId", "assignee_id", "assignedUserId", "assigned_user_id"]);
}

function getCreatedBy(value) {
  return field(value, ["createdBy", "created_by", "requesterId", "requester_id", "organizerId", "organizer_id"]);
}

function getActorEmployee(user) {
  const userEmployeeId = user?.employeeId || user?.employee_id;
  return activeRecords("employees").find((employee) =>
    employee.id === userEmployeeId ||
    employee.employeeId === userEmployeeId ||
    employee.employee_id === userEmployeeId ||
    employee.userId === user?.id ||
    employee.user_id === user?.id
  ) || null;
}

function actorIdentifiers(user, employee = null) {
  return new Set([
    user?.id,
    user?.employeeId,
    user?.employee_id,
    employee?.id,
    employee?.employeeId,
    employee?.employee_id,
    employee?.userId,
    employee?.user_id,
  ].filter(Boolean));
}

function buildScope(user) {
  if (normalizeRole(user?.role) !== "secretary") {
    throw createHttpError(403, "Secretary access is required.", "SECRETARY_ROLE_REQUIRED");
  }

  const employee = getActorEmployee(user);
  const organizationId = getOrganizationId(user) || getOrganizationId(employee);
  if (!organizationId) {
    throw createHttpError(403, "Secretary organization scope is required.", "SECRETARY_ORGANIZATION_REQUIRED");
  }

  const departmentIds = new Set([
    user.departmentId,
    user.department_id,
    employee?.departmentId,
    employee?.department_id,
    ...asArray(user.departmentIds),
    ...asArray(user.department_ids),
  ].filter(Boolean));

  return {
    user,
    employee,
    employeeId: employee?.id || user.employeeId || user.employee_id || null,
    organizationId,
    departmentIds,
    identifiers: actorIdentifiers(user, employee),
  };
}

function assertPermission(user, permission) {
  if (permission && !hasPermission(user, permission)) {
    throw createHttpError(403, "You do not have permission to perform this Secretary action.", "FORBIDDEN", { permission });
  }
}

function organizationMatches(record, scope) {
  return String(getOrganizationId(record) || "") === String(scope.organizationId);
}

function assertQueryScope(query = {}, scope) {
  const organizationId = query.organizationId || query.organization_id;
  if (organizationId && String(organizationId) !== String(scope.organizationId)) {
    throw createHttpError(403, "Requested organization is outside this Secretary's scope.", "RESOURCE_OUT_OF_SECRETARY_SCOPE", { organizationId });
  }
}

function assertPayloadScope(payload = {}, scope) {
  const organizationId = getOrganizationId(payload);
  if (organizationId && String(organizationId) !== String(scope.organizationId)) {
    throw createHttpError(403, "Requested resource is outside this Secretary's organization.", "RESOURCE_OUT_OF_SECRETARY_SCOPE", { organizationId });
  }
}

function createRecord(collection, payload) {
  const timestamp = now();
  return appendRecord(collection, {
    id: crypto.randomUUID(),
    ...payload,
    createdAt: payload.createdAt || payload.created_at || timestamp,
    created_at: payload.created_at || payload.createdAt || timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  });
}

function updateRecord(collection, id, updates) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  const timestamp = now();
  records[index] = {
    ...records[index],
    ...updates,
    id,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  saveCollection(collection, records);
  return records[index];
}

function findScopedRecord(collection, id, scope) {
  const record = activeRecords(collection).find((item) => item.id === id);
  if (!record) return null;
  if (!organizationMatches(record, scope)) {
    throw createHttpError(403, "Requested resource is outside this Secretary's scope.", "RESOURCE_OUT_OF_SECRETARY_SCOPE", { collection, id });
  }
  return record;
}

function audit(req, action, module, recordId, oldValue, newValue, metadata = {}) {
  return recordOperationalAudit({
    user: req.user,
    action,
    module: `Secretary ${module}`,
    recordId,
    targetType: module,
    oldValue,
    newValue,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    metadata: {
      role: "secretary",
      organizationId: getOrganizationId(req.user),
      ...metadata,
    },
  });
}

function getEmployee(id) {
  if (!id) return null;
  return activeRecords("employees").find((employee) =>
    employee.id === id ||
    employee.employeeId === id ||
    employee.employee_id === id ||
    employee.userId === id ||
    employee.user_id === id
  ) || null;
}

function getDepartment(id) {
  if (!id) return null;
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function getUser(id) {
  return id ? getUserById(id) : null;
}

function personName(person) {
  return person?.fullName || person?.name || [person?.firstName, person?.first_name, person?.lastName, person?.last_name].filter(Boolean).join(" ") || person?.email || null;
}

function getPosition(id) {
  if (!id) return null;
  return activeRecords("positions").find((position) => position.id === id) || null;
}

function employeePosition(employee) {
  const position = getPosition(employee?.positionId || employee?.position_id);
  return position?.title || employee?.position || employee?.jobTitle || employee?.job_title || null;
}

function employeeSummary(employee) {
  if (!employee) return null;
  const department = getDepartment(getDepartmentId(employee));
  return {
    id: employee.id,
    employeeId: employee.employeeId || employee.employee_id || null,
    employee_id: employee.employee_id || employee.employeeId || null,
    name: personName(employee),
    email: employee.email || null,
    companyEmail: employee.companyEmail || employee.company_email || null,
    company_email: employee.company_email || employee.companyEmail || null,
    department: department?.name || null,
    departmentId: department?.id || null,
    department_id: department?.id || null,
    position: employeePosition(employee),
  };
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

function profileName(user, employee) {
  return personName(employee) || user?.fullName || user?.name || user?.email || null;
}

function getSelfCompanyEmail(scope) {
  const employee = scope.employee;
  const configuredAddress = employee?.companyEmail || employee?.company_email;
  const account = activeRecords("company_email_accounts").find((record) =>
    organizationMatches(record, scope) &&
    (
      actorMatchesRecord(record, scope, ["employeeId", "employee_id", "assignedEmployeeId", "assigned_employee_id", "userId", "user_id"]) ||
      (configuredAddress && emailMatches(record.emailAddress || record.email_address, configuredAddress))
    )
  );
  return account ? enrichCompanyEmailAccount(account) : configuredAddress ? { emailAddress: configuredAddress, email_address: configuredAddress, status: "ACTIVE" } : null;
}

function getSelfEmploymentRecord(user) {
  const scope = buildScope(user);
  assertPermission(user, "profile.view");
  const currentUser = getUserById(user.id) || user;
  const employee = scope.employee || {};
  const department = getDepartment(getDepartmentId(employee) || currentUser.departmentId || currentUser.department_id);
  const position = getPosition(employee.positionId || employee.position_id);
  const manager = getEmployee(employee.managerId || employee.manager_id || employee.supervisorId || employee.supervisor_id);
  const documents = [
    ...selfRecords("employee_documents", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
    ...selfRecords("staff_documents", scope, ["staffId", "staff_id", "employeeId", "employee_id"]),
  ];
  const leaveHistory = selfRecords("leave_requests", scope, ["employeeId", "employee_id", "staffId", "staff_id", "requesterId", "requester_id"]);
  const tasks = selfRecords("tasks", scope, ["assignedTo", "assigned_to", "assigneeId", "assignee_id", "employeeId", "employee_id"]);
  const attendeeMeetingIds = new Set(selfRecords("meeting_attendees", scope, ["userId", "user_id", "employeeId", "employee_id"]).map((attendee) => attendee.meetingId || attendee.meeting_id));
  const meetings = activeRecords("meetings").filter((meeting) =>
    organizationMatches(meeting, scope) &&
    (
      attendeeMeetingIds.has(meeting.id) ||
      actorMatchesRecord(meeting, scope, ["organizerId", "organizer_id", "createdBy", "created_by", "attendees"])
    )
  );
  const reminders = selfRecords("reminders", scope, ["assignedTo", "assigned_to", "userId", "user_id", "employeeId", "employee_id"]);
  const employmentHistory = [
    ...selfRecords("employee_employment_history", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
    ...selfRecords("employment_history", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
  ];

  return {
    overview: {
      id: employee.id || currentUser.id,
      userId: currentUser.id,
      user_id: currentUser.id,
      employeeId: employee.employeeId || employee.employee_id || employee.id || currentUser.employeeId || null,
      employee_id: employee.employee_id || employee.employeeId || employee.id || currentUser.employeeId || null,
      fullName: profileName(currentUser, employee),
      email: employee.email || currentUser.email || null,
      phone: employee.phone || currentUser.phone || null,
      profilePhoto: employee.profilePhoto || employee.photo || employee.photoUrl || currentUser.avatarUrl || currentUser.avatar_url || null,
      status: employee.status || currentUser.status || "active",
      department: department ? { id: department.id, name: department.name, code: department.code || null } : null,
      position: position ? { id: position.id, title: position.title || position.name || null } : { id: employee.positionId || employee.position_id || null, title: employeePosition(employee) },
      manager: employeeSummary(manager),
      companyEmail: getSelfCompanyEmail(scope),
    },
    personalInformation: {
      firstName: employee.firstName || employee.first_name || null,
      middleName: employee.middleName || employee.middle_name || null,
      lastName: employee.lastName || employee.last_name || null,
      fullName: profileName(currentUser, employee),
      gender: employee.gender || null,
      dateOfBirth: employee.dateOfBirth || employee.date_of_birth || null,
      phone: employee.phone || currentUser.phone || null,
      email: employee.email || currentUser.email || null,
      address: employee.address || null,
      state: employee.state || null,
      lga: employee.lga || null,
      country: employee.country || null,
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
      branch: employee.branch || null,
      status: employee.status || currentUser.status || "active",
      history: employmentHistory,
      departmentHistory: selfRecords("department_history", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
      positionHistory: selfRecords("position_history", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
      managerHistory: selfRecords("manager_history", scope, ["employeeId", "employee_id", "staffId", "staff_id"]),
    },
    documents,
    companyEmail: getSelfCompanyEmail(scope),
    leaveHistory,
    tasks,
    meetings: meetings.map(enrichMeeting),
    reminders: reminders.map(enrichReminder),
    stats: {
      documents: documents.length,
      leaveRequests: leaveHistory.length,
      pendingTasks: tasks.filter((task) => !FINAL_TASK_STATUSES.has(normalizeStatus(task.status, "TODO"))).length,
      upcomingMeetings: meetings.filter(isUpcoming).length,
      upcomingReminders: reminders.filter((reminder) => normalizeStatus(reminder.status) === "PENDING" && isUpcoming({ ...reminder, remindAt: reminder.remindAt || reminder.remind_at })).length,
    },
  };
}

function assertNoSelfEmploymentPrivilegeMutation(payload = {}) {
  const forbiddenKeys = [
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
  ];
  const found = forbiddenKeys.find((key) => payload[key] !== undefined);
  if (found) {
    throw createHttpError(403, "Secretary employment record cannot change access, reporting, salary, or employment-control fields.", "SECRETARY_SELF_RECORD_FIELD_FORBIDDEN", { field: found });
  }
}

function updateSelfEmploymentRecord(payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "profile.update");
  assertPayloadScope(payload, scope);
  assertNoSelfEmploymentPrivilegeMutation(payload);
  const employee = scope.employee;
  const oldEmployee = employee ? { ...employee } : null;
  const personal = payload.personalInformation || payload.personal || {};
  const emergencyContact = payload.emergencyContact || payload.emergency_contact || personal.emergencyContact || personal.emergency_contact;
  const displayName = payload.fullName || payload.name || payload.displayName || personal.fullName;
  const employeeUpdates = compactObject({
    fullName: displayName,
    name: displayName,
    phone: payload.phone ?? personal.phone,
    address: payload.address ?? personal.address,
    state: payload.state ?? personal.state,
    lga: payload.lga ?? personal.lga,
    country: payload.country ?? personal.country,
    profilePhoto: payload.profilePhoto || payload.profile_photo || payload.avatarUrl || payload.avatar_url,
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
  audit(req, "SECRETARY_EMPLOYMENT_RECORD_UPDATED", "employment_record", employee?.id || req.user.id, oldEmployee, { employeeUpdates, userUpdates });
  return getSelfEmploymentRecord(getUserById(req.user.id) || req.user);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createHttpError(400, "Email address is invalid.", "INVALID_EMAIL");
  }
  return email;
}

function emailDomain(email) {
  return String(email || "").split("@")[1]?.toLowerCase() || "";
}

function configuredCompanyDomains(scope) {
  const domains = new Set();
  for (const collection of ["employers", "organizations"]) {
    for (const record of activeRecords(collection)) {
      if (String(record.id) !== String(scope.organizationId) && String(getOrganizationId(record) || "") !== String(scope.organizationId)) continue;
      for (const key of ["companyEmail", "company_email", "email", "website", "domain"]) {
        const value = record[key];
        if (!value) continue;
        const candidate = String(value).includes("@") ? emailDomain(value) : String(value).replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
        if (candidate.includes(".")) domains.add(candidate.toLowerCase());
      }
      for (const item of asArray(record.emailDomains || record.email_domains || record.domains)) {
        if (item) domains.add(String(item).toLowerCase().replace(/^@/, ""));
      }
    }
  }
  return [...domains];
}

function assertCompanyDomain(email, scope) {
  const domains = configuredCompanyDomains(scope);
  if (domains.length === 0) return true;
  const domain = emailDomain(email);
  if (!domains.includes(domain)) {
    throw createHttpError(400, "Email domain is not approved for this organization.", "EMAIL_DOMAIN_NOT_ALLOWED", { allowedDomains: domains });
  }
  return true;
}

function reservedEmailAddresses(scope) {
  const configured = activeRecords("reserved_email_addresses")
    .filter((record) => !getOrganizationId(record) || organizationMatches(record, scope))
    .map((record) => normalizeEmail(record.email || record.emailAddress || record.email_address));
  return new Set([
    "admin",
    "administrator",
    "root",
    "support",
    "security",
    "abuse",
    "postmaster",
    "hostmaster",
    "webmaster",
    ...configured,
  ]);
}

function isReservedEmail(email, scope) {
  const reserved = reservedEmailAddresses(scope);
  const local = String(email).split("@")[0];
  return reserved.has(email) || reserved.has(local);
}

function emailMatches(value, email) {
  return String(value || "").trim().toLowerCase() === email;
}

function findEmailConflict(email, scope, ignore = {}) {
  if (isReservedEmail(email, scope)) return { reason: "EMAIL_RESERVED" };
  const account = activeRecords("company_email_accounts").find((record) =>
    organizationMatches(record, scope) &&
    record.id !== ignore.accountId &&
    normalizeStatus(record.status, "ACTIVE") !== "DEACTIVATED" &&
    emailMatches(record.emailAddress || record.email_address, email)
  );
  if (account) return { reason: "EMAIL_ALREADY_EXISTS", accountId: account.id };

  const user = listUsers().find((record) => record.id !== ignore.userId && String(getOrganizationId(record) || "") === String(scope.organizationId) && emailMatches(record.email, email));
  if (user) return { reason: "EMAIL_ALREADY_EXISTS", userId: user.id };

  const employee = activeRecords("employees").find((record) =>
    record.id !== ignore.employeeId &&
    organizationMatches(record, scope) &&
    [record.email, record.companyEmail, record.company_email].some((value) => emailMatches(value, email))
  );
  if (employee) return { reason: "EMAIL_ALREADY_EXISTS", employeeId: employee.id };

  const request = activeRecords("email_requests").find((record) =>
    organizationMatches(record, scope) &&
    record.id !== ignore.requestId &&
    ["PENDING", "UNDER_REVIEW", "APPROVED", "CREATING", "CREATED"].includes(normalizeStatus(record.status)) &&
    [record.requestedEmail, record.requested_email, record.requestedEmailName, record.requested_email_name, record.assignedEmail, record.assigned_email].some((value) => emailMatches(value, email))
  );
  if (request) return { reason: "EMAIL_PENDING_PROVISIONING", requestId: request.id };
  return null;
}

function baseNameCandidates(employee, requestedEmail) {
  const requestedLocal = String(requestedEmail || "").split("@")[0];
  const name = personName(employee) || requestedLocal || "employee";
  const parts = name.toLowerCase().replace(/[^a-z0-9\s.]+/g, " ").split(/[\s.]+/).filter(Boolean);
  const first = parts[0] || requestedLocal || "employee";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const department = (getDepartment(getDepartmentId(employee))?.name || "team").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [
    last ? `${first}.${last}` : first,
    last ? `${first}.${last}2` : `${first}2`,
    last ? `${first[0]}.${last}` : `${first[0] || "e"}.${first}`,
    `${first}.${department}`,
    last ? `${first}.${last}.${department}` : `${first}.${department}2`,
  ];
}

function suggestedAlternatives(email, scope, employee = null) {
  const domain = emailDomain(email) || configuredCompanyDomains(scope)[0];
  if (!domain) return [];
  const alternatives = [];
  for (const local of baseNameCandidates(employee, email)) {
    const candidate = normalizeEmail(`${local}@${domain}`);
    if (!findEmailConflict(candidate, scope) && !alternatives.includes(candidate)) {
      alternatives.push(candidate);
    }
    if (alternatives.length >= 5) break;
  }
  return alternatives;
}

function checkEmailAvailability(payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "email_requests.check_availability");
  const email = normalizeEmail(payload.email || payload.emailAddress || payload.email_address);
  assertCompanyDomain(email, scope);
  const employee = getEmployee(payload.employeeId || payload.employee_id);
  const conflict = findEmailConflict(email, scope, { requestId: payload.requestId || payload.request_id, accountId: payload.accountId || payload.account_id });
  const result = {
    email,
    available: !conflict,
    reason: conflict?.reason || null,
    suggestedAlternatives: conflict ? suggestedAlternatives(email, scope, employee) : [],
    suggested_alternatives: conflict ? suggestedAlternatives(email, scope, employee) : [],
  };
  audit(req, "SECRETARY_EMAIL_AVAILABILITY_CHECKED", "email_requests", payload.requestId || payload.request_id || null, null, result);
  return result;
}

function assertTransition(current, next, transitions, label) {
  const from = normalizeStatus(current);
  const to = normalizeStatus(next);
  if (from === to) return;
  if (!(transitions[from] || []).includes(to)) {
    throw createHttpError(409, `${label} transition is not allowed.`, "INVALID_STATUS_TRANSITION", { from, to });
  }
}

function enrichEmailRequest(request) {
  const employee = getEmployee(getEmployeeId(request));
  const requester = getUser(request.requesterId || request.requester_id) || getEmployee(request.requesterId || request.requester_id);
  const department = getDepartment(getDepartmentId(request) || getDepartmentId(employee));
  const requestedEmail = request.requestedEmail || request.requested_email || request.requestedEmailName || request.requested_email_name || null;
  const employeeData = employeeSummary(employee);
  return {
    ...request,
    employee: employeeData,
    requestedBy: requester ? {
      id: requester.id,
      name: personName(requester),
      email: requester.email || null,
      role: requester.role || null,
    } : null,
    requested_by_user: requester ? {
      id: requester.id,
      name: personName(requester),
      email: requester.email || null,
      role: requester.role || null,
    } : null,
    requesterName: personName(requester),
    requester_name: personName(requester),
    employeeName: personName(employee),
    employee_name: personName(employee),
    employeeEmail: employee?.email || null,
    employee_email: employee?.email || null,
    departmentName: department?.name || null,
    department_name: department?.name || null,
    position: employeePosition(employee),
    requestedEmail,
    requested_email: requestedEmail,
    assignedEmail: request.assignedEmail || request.assigned_email || null,
    assigned_email: request.assigned_email || request.assignedEmail || null,
    requestDate: request.createdAt || request.created_at || null,
    request_date: request.created_at || request.createdAt || null,
    failureReason: request.failureReason || request.failure_reason || null,
    failure_reason: request.failure_reason || request.failureReason || null,
    retryCount: Number(request.retryCount ?? request.retry_count ?? 0),
    retry_count: Number(request.retry_count ?? request.retryCount ?? 0),
  };
}

function emailRequestSearchText(record) {
  const enriched = enrichEmailRequest(record);
  return [
    enriched.employee?.name,
    enriched.employee?.employeeId,
    enriched.employee?.employee_id,
    enriched.employee?.department,
    enriched.employee?.position,
    enriched.requestedEmail,
    enriched.assignedEmail,
    enriched.status,
    enriched.purpose,
  ].filter(Boolean).join(" ").toLowerCase();
}

function getEmailQueue(user, query = {}) {
  const scope = buildScope(user);
  assertPermission(user, "email_requests.view");
  if (query.search || query.q) assertPermission(user, "email_requests.view");
  assertQueryScope(query, scope);
  let records = activeRecords("email_requests").filter((record) => organizationMatches(record, scope));
  const statsSource = records;
  const status = normalizeStatus(query.status, "ALL");
  if (status !== "ALL") {
    if (!EMAIL_STATUSES.includes(status)) throw createHttpError(400, "Email request status is invalid.", "INVALID_EMAIL_REQUEST_STATUS", { allowed: [...EMAIL_STATUSES, "ALL"] });
    records = records.filter((record) => normalizeStatus(record.status) === status);
  }
  const search = String(query.search || query.q || "").trim().toLowerCase();
  if (search) {
    records = records.filter((record) => emailRequestSearchText(record).includes(search));
  }
  const result = paginate(sortRecords(records, query.sortBy || "createdAt", query.sortDirection || "desc"), query);
  return {
    stats: {
      pendingRequests: statsSource.filter((record) => normalizeStatus(record.status) === "PENDING").length,
      failedCreations: statsSource.filter((record) => normalizeStatus(record.status) === "FAILED").length,
      createdEmails: statsSource.filter((record) => normalizeStatus(record.status) === "CREATED").length,
      totalRequests: statsSource.length,
    },
    requests: result.data.map(enrichEmailRequest),
    pagination: result.meta,
  };
}

function enrichMeeting(meeting) {
  const organizer = getUser(meeting.organizerId || meeting.organizer_id) || getEmployee(meeting.organizerId || meeting.organizer_id);
  const attendees = activeRecords("meeting_attendees")
    .filter((attendee) => (attendee.meetingId || attendee.meeting_id) === meeting.id)
    .map((attendee) => {
      const user = getUser(attendee.userId || attendee.user_id);
      const employee = getEmployee(attendee.employeeId || attendee.employee_id || attendee.userId || attendee.user_id);
      return {
        ...attendee,
        name: personName(user) || personName(employee),
        email: user?.email || employee?.email || null,
      };
    });
  return {
    ...meeting,
    organizerName: meeting.organizerName || meeting.organizer_name || personName(organizer),
    organizer_name: meeting.organizer_name || meeting.organizerName || personName(organizer),
    attendees,
  };
}

function enrichReminder(reminder) {
  const related = findRelatedItem(reminder.relatedType || reminder.related_type, reminder.relatedId || reminder.related_id);
  return {
    ...reminder,
    relatedItem: related,
    related_item: related,
  };
}

function findRelatedItem(type, id) {
  if (!type || !id) return null;
  const normalizedType = normalizeStatus(type, "OTHER");
  const collectionByType = {
    MEETING: "meetings",
    TASK: "tasks",
    EMAIL_REQUEST: "email_requests",
    EVENT: "calendar_events",
  };
  const collection = collectionByType[normalizedType];
  if (!collection) return null;
  const record = activeRecords(collection).find((item) => item.id === id);
  return record ? { id: record.id, type: normalizedType, title: record.title || record.requestedEmailName || record.requested_email_name || record.purpose || null } : null;
}

function dateValue(record) {
  return field(record, ["start", "startAt", "start_at", "startTime", "start_time", "scheduledAt", "scheduled_at", "date", "dueDate", "due_date", "remindAt", "remind_at"]);
}

function timestampOf(record) {
  const value = dateValue(record);
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isSameDay(record, date = new Date()) {
  const value = dateValue(record);
  return Boolean(value) && String(value).slice(0, 10) === date.toISOString().slice(0, 10);
}

function isAfterToday(record) {
  const timestamp = timestampOf(record);
  if (timestamp === null) return false;
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  return timestamp >= tomorrow.getTime();
}

function isUpcoming(record) {
  const timestamp = timestampOf(record);
  return timestamp !== null && timestamp >= Date.now();
}

function isOverdueTask(task) {
  const due = new Date(task.dueDate || task.due_date || 0).getTime();
  return !Number.isNaN(due) && due < Date.now() && !FINAL_TASK_STATUSES.has(normalizeStatus(task.status, "TODO"));
}

function endDateValue(record) {
  return field(record, ["end", "endAt", "end_at", "endTime", "end_time", "dueDate", "due_date", "remindAt", "remind_at"]);
}

function normalizeCalendarType(type, source) {
  const normalized = normalizeStatus(type || source, "CUSTOM_EVENT");
  if (normalized === "EVENT" || normalized === "DEADLINE") return normalized === "DEADLINE" ? "TASK_DEADLINE" : "CUSTOM_EVENT";
  if (normalized === "TASK" || normalized === "TASKS") return "TASK_DEADLINE";
  return CALENDAR_TYPES.includes(normalized) ? normalized : "CUSTOM_EVENT";
}

function calendarUserSummary(userId) {
  const user = getUser(userId) || getEmployee(userId);
  return user ? { id: user.id, name: personName(user), email: user.email || null } : null;
}

function calendarDepartmentSummary(departmentId) {
  const department = getDepartment(departmentId);
  return department ? { id: department.id, name: department.name || null } : null;
}

function normalizeCalendarEvent(record, sourceType) {
  const type = normalizeCalendarType(record.type || sourceType, sourceType);
  const start = dateValue(record);
  const end = endDateValue(record) || start;
  const sourceId = record.sourceId || record.source_id || record.id;
  return {
    id: `${type}:${sourceId}`,
    sourceId,
    source_id: sourceId,
    sourceType: type,
    source_type: type,
    type,
    title: record.title || record.name || (type === "TASK_DEADLINE" ? "Task deadline" : "Calendar event"),
    description: record.description || record.notes || null,
    start,
    end,
    allDay: Boolean(record.allDay ?? record.all_day),
    all_day: Boolean(record.allDay ?? record.all_day),
    status: normalizeStatus(record.status, type === "REMINDER" ? "PENDING" : "SCHEDULED"),
    department: calendarDepartmentSummary(getDepartmentId(record)),
    createdBy: calendarUserSummary(getCreatedBy(record)),
    created_by: calendarUserSummary(getCreatedBy(record)),
    location: record.location || null,
    meetingLink: record.meetingLink || record.meeting_link || record.virtualLink || record.virtual_link || null,
    meeting_link: record.meeting_link || record.meetingLink || record.virtual_link || record.virtualLink || null,
    source: record.source || null,
  };
}

function validateEnum(value, allowed, label, fallback) {
  const normalized = normalizeStatus(value, fallback);
  if (!allowed.includes(normalized)) {
    throw createHttpError(400, `${label} is invalid.`, `INVALID_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, { allowed });
  }
  return normalized;
}

function listScoped(collection, user, query = {}, permission, options = {}) {
  const scope = buildScope(user);
  assertPermission(user, permission);
  assertQueryScope(query, scope);
  let records = activeRecords(collection).filter((record) => organizationMatches(record, scope));

  if (options.filter) {
    records = records.filter((record) => options.filter(record, scope));
  }

  const searchQuery = { ...query, q: query.q || query.search };
  delete searchQuery.organizationId;
  delete searchQuery.organization_id;
  const result = paginate(applyBasicFilters(records, searchQuery, SEARCH_FIELDS[collection] || []), query);
  return {
    data: options.enrich ? result.data.map(options.enrich) : result.data,
    meta: result.meta,
  };
}

function getScopeSummary(user) {
  const scope = buildScope(user);
  return {
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    departmentIds: [...scope.departmentIds],
    department_ids: [...scope.departmentIds],
    employeeId: scope.employeeId,
    employee_id: scope.employeeId,
  };
}

function getEmailRequest(user, id) {
  const scope = buildScope(user);
  assertPermission(user, "email_requests.view");
  const record = findScopedRecord("email_requests", id, scope);
  return record ? enrichEmailRequest(record) : null;
}

function getDashboard(user, query = {}) {
  const scope = buildScope(user);
  assertPermission(user, "secretary.dashboard.view");
  const limit = Math.min(25, Math.max(1, Number(query.limit || 5)));

  const emailRequests = activeRecords("email_requests").filter((record) => organizationMatches(record, scope));
  const meetings = activeRecords("meetings").filter((record) => organizationMatches(record, scope) && normalizeStatus(record.status, "SCHEDULED") !== "CANCELLED");
  const tasks = activeRecords("tasks").filter((record) => organizationMatches(record, scope) && managementTaskInScope(record, scope));
  const reminders = activeRecords("reminders").filter((record) => organizationMatches(record, scope));
  const pendingEmailRequests = emailRequests.filter((record) => normalizeStatus(record.status) === "PENDING");
  const failedEmailCreations = emailRequests.filter((record) => normalizeStatus(record.status) === "FAILED");
  const todaysMeetings = sortRecords(meetings.filter((record) => isSameDay(record)), "startAt", "asc");
  const upcomingMeetings = sortRecords(meetings.filter((record) => isAfterToday(record)), "startAt", "asc");
  const overdueManagementTasks = sortRecords(tasks.filter(isOverdueTask), "dueDate", "asc");
  const upcomingReminders = sortRecords(
    reminders.filter((record) => normalizeStatus(record.status) === "PENDING" && isUpcoming({ ...record, remindAt: record.remindAt || record.remind_at })),
    "remindAt",
    "asc"
  );

  return {
    stats: {
      pendingEmailRequests: pendingEmailRequests.length,
      failedEmailCreations: failedEmailCreations.length,
      meetingsToday: todaysMeetings.length,
      upcomingEmailRequests: emailRequests.filter((record) => ["PENDING", "UNDER_REVIEW", "APPROVED", "CREATING"].includes(normalizeStatus(record.status))).length,
      awaitingReview: emailRequests.filter((record) => ["PENDING", "UNDER_REVIEW"].includes(normalizeStatus(record.status))).length,
    },
    pendingEmailRequests: pendingEmailRequests.slice(0, limit).map(enrichEmailRequest),
    failedEmailCreations: failedEmailCreations.slice(0, limit).map(enrichEmailRequest),
    todaysMeetings: todaysMeetings.slice(0, limit).map(enrichMeeting),
    upcomingMeetings: upcomingMeetings.slice(0, limit).map(enrichMeeting),
    overdueManagementTasks: overdueManagementTasks.slice(0, limit),
    upcomingReminders: upcomingReminders.slice(0, limit).map(enrichReminder),
  };
}

function createEmailRequest(payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "email_requests.create");
  assertPayloadScope(payload, scope);
  const status = validateEnum(payload.status, EMAIL_STATUSES, "email request status", "PENDING");
  const employeeId = payload.employeeId || payload.employee_id || null;
  const employee = getEmployee(employeeId);
  const departmentId = payload.departmentId || payload.department_id || getDepartmentId(employee) || null;
  const requestedEmailName = payload.requestedEmailName || payload.requested_email_name || payload.requestedEmail || payload.requested_email;
  if (!requestedEmailName) {
    throw createHttpError(400, "Requested email name is required.", "REQUESTED_EMAIL_REQUIRED");
  }
  const requestedEmail = normalizeEmail(requestedEmailName);
  assertCompanyDomain(requestedEmail, scope);

  const record = createRecord("email_requests", {
    requesterId: payload.requesterId || payload.requester_id || req.user.id,
    requester_id: payload.requester_id || payload.requesterId || req.user.id,
    employeeId,
    employee_id: employeeId,
    requestedEmailName: requestedEmail,
    requested_email_name: requestedEmail,
    requestedEmail: requestedEmail,
    requested_email: requestedEmail,
    departmentId,
    department_id: departmentId,
    purpose: payload.purpose || null,
    status,
    reviewedBy: null,
    reviewed_by: null,
    reviewedAt: null,
    reviewed_at: null,
    failureReason: payload.failureReason || payload.failure_reason || null,
    failure_reason: payload.failure_reason || payload.failureReason || null,
    retryCount: Number(payload.retryCount || payload.retry_count || 0),
    retry_count: Number(payload.retry_count || payload.retryCount || 0),
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    createdBy: req.user.id,
    created_by: req.user.id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "SECRETARY_EMAIL_REQUEST_CREATED", "email_requests", record.id, null, record);
  notifySecretaries(scope, "NEW_EMAIL_REQUEST", "New company email request", "A company email request is awaiting review.", { emailRequestId: record.id }, req.user.id);
  return enrichEmailRequest(record);
}

function updateEmailRequestStatus(id, status, req, action, extra = {}) {
  const scope = buildScope(req.user);
  assertPermission(req.user, extra.permission || "email_requests.update");
  const record = findScopedRecord("email_requests", id, scope);
  if (!record) return null;
  const oldValue = record;
  const timestamp = now();
  assertTransition(record.status, status, EMAIL_TRANSITIONS, "Email request");
  const updates = {
    status: validateEnum(status, EMAIL_STATUSES, "email request status", status),
    reviewedBy: req.user.id,
    reviewed_by: req.user.id,
    reviewedAt: timestamp,
    reviewed_at: timestamp,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    ...(extra.updates || {}),
  };
  const updated = updateRecord("email_requests", id, updates);
  audit(req, action, "email_requests", id, oldValue, updated);
  notifyEmailRequestSubject(updated, action);
  return enrichEmailRequest(updated);
}

function reviewEmailRequest(id, payload = {}, req) {
  return updateEmailRequestStatus(id, "UNDER_REVIEW", req, "SECRETARY_EMAIL_REQUEST_REVIEWED", {
    permission: "email_requests.review",
    updates: {
      reviewNotes: payload.notes || payload.reviewNotes || payload.review_notes || null,
      review_notes: payload.review_notes || payload.reviewNotes || payload.notes || null,
    },
  });
}

function approveEmailRequest(id, payload = {}, req) {
  return updateEmailRequestStatus(id, "APPROVED", req, "SECRETARY_EMAIL_REQUEST_APPROVED", {
    permission: "email_requests.approve",
    updates: {
      approvalNotes: payload.notes || payload.approvalNotes || payload.approval_notes || null,
      approval_notes: payload.approval_notes || payload.approvalNotes || payload.notes || null,
    },
  });
}

function rejectEmailRequest(id, payload = {}, req) {
  return updateEmailRequestStatus(id, "REJECTED", req, "SECRETARY_EMAIL_REQUEST_REJECTED", {
    permission: "email_requests.reject",
    updates: {
      rejectionReason: payload.reason || payload.rejectionReason || payload.rejection_reason || null,
      rejection_reason: payload.rejection_reason || payload.rejectionReason || payload.reason || null,
    },
  });
}

function returnEmailRequest(id, payload = {}, req) {
  return updateEmailRequestStatus(id, "PENDING", req, "SECRETARY_EMAIL_REQUEST_RETURNED", {
    permission: "email_requests.review",
    updates: {
      returnedAt: now(),
      returned_at: now(),
      returnReason: payload.reason || payload.returnReason || payload.return_reason || null,
      return_reason: payload.return_reason || payload.returnReason || payload.reason || null,
    },
  });
}

function cancelEmailRequest(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "email_requests.cancel");
  const record = findScopedRecord("email_requests", id, scope);
  if (!record) return null;
  if (!["PENDING", "UNDER_REVIEW", "APPROVED", "CREATING", "FAILED", "REJECTED"].includes(normalizeStatus(record.status))) {
    throw createHttpError(409, "This email request can no longer be cancelled.", "EMAIL_REQUEST_CANCELLATION_NOT_ALLOWED");
  }
  return updateEmailRequestStatus(id, "CANCELLED", req, "SECRETARY_EMAIL_REQUEST_CANCELLED", {
    permission: "email_requests.cancel",
    updates: {
      cancelledAt: now(),
      cancelled_at: now(),
      cancelledBy: req.user.id,
      cancelled_by: req.user.id,
      cancellationReason: payload.reason || payload.cancellationReason || payload.cancellation_reason || null,
      cancellation_reason: payload.cancellation_reason || payload.cancellationReason || payload.reason || null,
    },
  });
}

function retryEmailCreation(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "email_requests.retry");
  const record = findScopedRecord("email_requests", id, scope);
  if (!record) return null;
  if (normalizeStatus(record.status) !== "FAILED") {
    throw createHttpError(409, "Only failed email requests can be retried.", "EMAIL_REQUEST_NOT_FAILED");
  }
  const email = normalizeEmail(payload.email || payload.emailAddress || payload.email_address || record.assignedEmail || record.assigned_email || record.requestedEmail || record.requested_email || record.requestedEmailName || record.requested_email_name);
  assertCompanyDomain(email, scope);
  const conflict = findEmailConflict(email, scope, { requestId: id });
  if (conflict) {
    throw createHttpError(409, "Email address is not available.", conflict.reason, { email, conflict });
  }
  const retryCount = Number(record.retryCount ?? record.retry_count ?? 0) + 1;
  assertTransition(record.status, "CREATING", EMAIL_TRANSITIONS, "Email request");
  const updated = updateRecord("email_requests", id, {
    status: "CREATING",
    failureReason: null,
    failure_reason: null,
    retryCount,
    retry_count: retryCount,
    lastRetryAt: now(),
    last_retry_at: now(),
    lastRetryBy: req.user.id,
    last_retry_by: req.user.id,
    followUpNotes: payload.notes || payload.followUpNotes || payload.follow_up_notes || null,
    follow_up_notes: payload.follow_up_notes || payload.followUpNotes || payload.notes || null,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "SECRETARY_EMAIL_CREATION_RETRIED", "email_requests", id, record, updated, { retryCount });
  appendRecord("email_request_retries", {
    id: crypto.randomUUID(),
    emailRequestId: id,
    email_request_id: id,
    retryCount,
    retry_count: retryCount,
    notes: payload.notes || null,
    createdBy: req.user.id,
    created_by: req.user.id,
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    createdAt: now(),
    created_at: now(),
  });
  return enrichEmailRequest(updated);
}

function resolveEmailCreation(id, payload = {}, req) {
  return updateEmailRequestStatus(id, payload.status || "CREATED", req, "SECRETARY_EMAIL_CREATION_RESOLVED", {
    permission: "email_requests.follow_up",
    updates: {
      resolvedAt: now(),
      resolved_at: now(),
      resolvedBy: req.user.id,
      resolved_by: req.user.id,
      resolvedEmail: payload.resolvedEmail || payload.resolved_email || null,
      resolved_email: payload.resolved_email || payload.resolvedEmail || null,
      resolutionNotes: payload.notes || payload.resolutionNotes || payload.resolution_notes || null,
      resolution_notes: payload.resolution_notes || payload.resolutionNotes || payload.notes || null,
    },
  });
}

function updateEmployeeCompanyEmail(employeeId, emailAddress, actorId) {
  const records = readCollection("employees");
  const index = records.findIndex((employee) => employee.id === employeeId && !employee.deletedAt && !employee.deleted_at);
  if (index === -1) return null;
  records[index] = {
    ...records[index],
    companyEmail: emailAddress,
    company_email: emailAddress,
    updatedBy: actorId,
    updated_by: actorId,
    updatedAt: now(),
    updated_at: now(),
  };
  saveCollection("employees", records);
  return records[index];
}

function createAndAssignCompanyEmail(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "email_requests.create_company_email");
  const request = findScopedRecord("email_requests", id, scope);
  if (!request) return null;
  if (!["APPROVED", "CREATING"].includes(normalizeStatus(request.status))) {
    throw createHttpError(409, "Only approved email requests can create company emails.", "EMAIL_REQUEST_NOT_APPROVED");
  }
  const employeeId = getEmployeeId(request);
  const employee = getEmployee(employeeId);
  if (!employee || !organizationMatches(employee, scope)) {
    throw createHttpError(404, "Employee for this email request was not found.", "EMPLOYEE_NOT_FOUND");
  }
  const emailAddress = normalizeEmail(payload.email || payload.emailAddress || payload.email_address || request.assignedEmail || request.assigned_email || request.requestedEmail || request.requested_email);
  assertCompanyDomain(emailAddress, scope);
  const conflict = findEmailConflict(emailAddress, scope, { requestId: id, employeeId });
  if (conflict) {
    throw createHttpError(409, "Email address is not available.", conflict.reason, { email: emailAddress, conflict });
  }

  const creating = updateRecord("email_requests", id, {
    status: "CREATING",
    assignedEmail: emailAddress,
    assigned_email: emailAddress,
    provisioningStartedAt: now(),
    provisioning_started_at: now(),
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "SECRETARY_EMAIL_CREATION_STARTED", "email_requests", id, request, creating);

  if (payload.forceFailure || payload.force_failure || payload.failureReason || payload.failure_reason) {
    const failed = updateRecord("email_requests", id, {
      status: "FAILED",
      failureReason: payload.failureReason || payload.failure_reason || "Email provider provisioning failed.",
      failure_reason: payload.failure_reason || payload.failureReason || "Email provider provisioning failed.",
      failureCode: payload.failureCode || payload.failure_code || "PROVIDER_FAILURE",
      failure_code: payload.failure_code || payload.failureCode || "PROVIDER_FAILURE",
      failedAt: now(),
      failed_at: now(),
    });
    appendRecord("email_creation_failures", {
      id: crypto.randomUUID(),
      emailRequestId: id,
      email_request_id: id,
      failureReason: failed.failureReason,
      failure_reason: failed.failure_reason,
      failureCode: failed.failureCode,
      failure_code: failed.failure_code,
      retryCount: Number(failed.retryCount || failed.retry_count || 0),
      retry_count: Number(failed.retry_count || failed.retryCount || 0),
      failedAt: failed.failedAt,
      failed_at: failed.failed_at,
      organizationId: scope.organizationId,
      organization_id: scope.organizationId,
      createdAt: now(),
      created_at: now(),
    });
    audit(req, "SECRETARY_EMAIL_CREATION_FAILED", "email_requests", id, creating, failed);
    notifySecretaries(scope, "FAILED_EMAIL_CREATION", "Company email creation failed", `${emailAddress} could not be provisioned.`, { emailRequestId: id });
    return { request: enrichEmailRequest(failed), account: null };
  }

  const account = createRecord("company_email_accounts", {
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    employeeId,
    employee_id: employeeId,
    emailAddress,
    email_address: emailAddress,
    status: "ACTIVE",
    provider: payload.provider || "internal",
    createdFromRequestId: id,
    created_from_request_id: id,
    createdBy: req.user.id,
    created_by: req.user.id,
    suspendedAt: null,
    suspended_at: null,
    suspendedBy: null,
    suspended_by: null,
    deactivationRequestedAt: null,
    deactivation_requested_at: null,
    deactivationRequestedBy: null,
    deactivation_requested_by: null,
    deactivatedAt: null,
    deactivated_at: null,
    deactivatedBy: null,
    deactivated_by: null,
  });
  updateEmployeeCompanyEmail(employeeId, emailAddress, req.user.id);
  const created = updateRecord("email_requests", id, {
    status: "CREATED",
    assignedEmail: emailAddress,
    assigned_email: emailAddress,
    createdEmailAccountId: account.id,
    created_email_account_id: account.id,
    completedAt: now(),
    completed_at: now(),
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "SECRETARY_EMAIL_SUCCESSFULLY_CREATED", "company_email_accounts", account.id, null, account);
  audit(req, "SECRETARY_EMAIL_ASSIGNED_TO_EMPLOYEE", "employees", employeeId, employee, { ...employee, companyEmail: emailAddress, company_email: emailAddress });
  notifyEmailRequestSubject(created, "SECRETARY_EMAIL_SUCCESSFULLY_CREATED");
  return { request: enrichEmailRequest(created), account: enrichCompanyEmailAccount(account) };
}

function enrichCompanyEmailAccount(account) {
  const employee = getEmployee(getEmployeeId(account));
  const department = getDepartment(getDepartmentId(account) || getDepartmentId(employee));
  return {
    ...account,
    employee: employeeSummary(employee),
    employeeName: personName(employee),
    employee_name: personName(employee),
    departmentName: department?.name || null,
    department_name: department?.name || null,
    position: employeePosition(employee),
    emailAddress: account.emailAddress || account.email_address,
    email_address: account.email_address || account.emailAddress,
    createdFromRequestId: account.createdFromRequestId || account.created_from_request_id || null,
    created_from_request_id: account.created_from_request_id || account.createdFromRequestId || null,
  };
}

function companyEmailSearchText(account) {
  const enriched = enrichCompanyEmailAccount(account);
  return [
    enriched.emailAddress,
    enriched.status,
    enriched.provider,
    enriched.employee?.name,
    enriched.employee?.employeeId,
    enriched.employee?.employee_id,
    enriched.employee?.department,
    enriched.employee?.position,
  ].filter(Boolean).join(" ").toLowerCase();
}

function getCompanyEmailDirectory(user, query = {}) {
  const scope = buildScope(user);
  assertPermission(user, "company_email.view");
  assertQueryScope(query, scope);
  let records = activeRecords("company_email_accounts").filter((record) => organizationMatches(record, scope));
  const statsSource = records;
  const status = normalizeStatus(query.status, "ALL");
  if (status !== "ALL") {
    if (!COMPANY_EMAIL_STATUSES.includes(status)) {
      throw createHttpError(400, "Company email status is invalid.", "INVALID_COMPANY_EMAIL_STATUS", { allowed: [...COMPANY_EMAIL_STATUSES, "ALL"] });
    }
    records = records.filter((record) => normalizeStatus(record.status, "ACTIVE") === status);
  }
  const departmentId = query.department || query.departmentId || query.department_id;
  if (departmentId) {
    records = records.filter((record) => {
      const employee = getEmployee(getEmployeeId(record));
      return String(getDepartmentId(record) || getDepartmentId(employee) || "") === String(departmentId);
    });
  }
  const search = String(query.search || query.q || "").trim().toLowerCase();
  if (search) {
    records = records.filter((record) => companyEmailSearchText(record).includes(search));
  }
  const result = paginate(sortRecords(records, query.sortBy || "createdAt", query.sortDirection || "desc"), query);
  return {
    stats: {
      activeMailboxes: statsSource.filter((record) => normalizeStatus(record.status, "ACTIVE") === "ACTIVE").length,
      suspended: statsSource.filter((record) => normalizeStatus(record.status, "ACTIVE") === "SUSPENDED").length,
      deactivationPending: statsSource.filter((record) => normalizeStatus(record.status, "ACTIVE") === "DEACTIVATION_PENDING").length,
      totalMailboxes: statsSource.length,
    },
    emails: result.data.map(enrichCompanyEmailAccount),
    pagination: result.meta,
  };
}

function getCompanyEmail(user, id) {
  const scope = buildScope(user);
  assertPermission(user, "company_email.view");
  const account = findScopedRecord("company_email_accounts", id, scope);
  return account ? enrichCompanyEmailAccount(account) : null;
}

function updateCompanyEmailStatus(id, nextStatus, req, action, updates = {}) {
  const scope = buildScope(req.user);
  const account = findScopedRecord("company_email_accounts", id, scope);
  if (!account) return null;
  assertTransition(account.status || "ACTIVE", nextStatus, COMPANY_EMAIL_TRANSITIONS, "Company email");
  const updated = updateRecord("company_email_accounts", id, {
    ...updates,
    status: nextStatus,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, action, "company_email_accounts", id, account, updated);
  notifyMailboxEmployee(updated, action);
  return enrichCompanyEmailAccount(updated);
}

function changeCompanyEmailAddress(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "company_email.edit_address");
  const account = findScopedRecord("company_email_accounts", id, scope);
  if (!account) return null;
  if (!["ACTIVE", "SUSPENDED"].includes(normalizeStatus(account.status, "ACTIVE"))) {
    throw createHttpError(409, "Only active or suspended mailboxes can change address.", "EMAIL_ADDRESS_CHANGE_NOT_ALLOWED");
  }
  const emailAddress = normalizeEmail(payload.emailAddress || payload.email_address || payload.email);
  assertCompanyDomain(emailAddress, scope);
  const employeeId = getEmployeeId(account);
  const conflict = findEmailConflict(emailAddress, scope, { accountId: id, employeeId });
  if (conflict) {
    throw createHttpError(409, "Email address is not available.", conflict.reason, { email: emailAddress, conflict });
  }
  const oldEmail = account.emailAddress || account.email_address;
  const updated = updateRecord("company_email_accounts", id, {
    emailAddress,
    email_address: emailAddress,
    addressChangedAt: now(),
    address_changed_at: now(),
    addressChangedBy: req.user.id,
    address_changed_by: req.user.id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  appendRecord("company_email_address_history", {
    id: crypto.randomUUID(),
    companyEmailAccountId: id,
    company_email_account_id: id,
    oldEmailAddress: oldEmail,
    old_email_address: oldEmail,
    newEmailAddress: emailAddress,
    new_email_address: emailAddress,
    changedBy: req.user.id,
    changed_by: req.user.id,
    changedAt: now(),
    changed_at: now(),
    reason: payload.reason || null,
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    createdAt: now(),
    created_at: now(),
  });
  if (employeeId) updateEmployeeCompanyEmail(employeeId, emailAddress, req.user.id);
  audit(req, "SECRETARY_EMAIL_ADDRESS_CHANGED", "company_email_accounts", id, account, updated, { oldEmailAddress: oldEmail, newEmailAddress: emailAddress });
  notifyMailboxEmployee(updated, "SECRETARY_EMAIL_ADDRESS_CHANGED");
  return enrichCompanyEmailAccount(updated);
}

function suspendCompanyEmail(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "company_email.suspend");
  const account = findScopedRecord("company_email_accounts", id, scope);
  if (!account) return null;
  if (normalizeStatus(account.status, "ACTIVE") !== "ACTIVE") {
    throw createHttpError(409, "Only active mailboxes can be suspended.", "MAILBOX_NOT_ACTIVE");
  }
  return updateCompanyEmailStatus(id, "SUSPENDED", req, "SECRETARY_MAILBOX_SUSPENDED", {
    suspendedAt: now(),
    suspended_at: now(),
    suspendedBy: req.user.id,
    suspended_by: req.user.id,
    suspensionReason: payload.reason || payload.suspensionReason || payload.suspension_reason || null,
    suspension_reason: payload.suspension_reason || payload.suspensionReason || payload.reason || null,
  });
}

function reactivateCompanyEmail(id, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "company_email.reactivate");
  const account = findScopedRecord("company_email_accounts", id, scope);
  if (!account) return null;
  if (normalizeStatus(account.status, "ACTIVE") !== "SUSPENDED") {
    throw createHttpError(409, "Only suspended mailboxes can be reactivated.", "MAILBOX_NOT_SUSPENDED");
  }
  return updateCompanyEmailStatus(id, "ACTIVE", req, "SECRETARY_MAILBOX_REACTIVATED", {
    reactivatedAt: now(),
    reactivated_at: now(),
    reactivatedBy: req.user.id,
    reactivated_by: req.user.id,
  });
}

function requestCompanyEmailDeactivation(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "company_email.request_deactivation");
  const account = findScopedRecord("company_email_accounts", id, scope);
  if (!account) return null;
  const status = normalizeStatus(account.status, "ACTIVE");
  if (!["ACTIVE", "SUSPENDED"].includes(status)) {
    throw createHttpError(409, "Only active or suspended mailboxes can request deactivation.", "MAILBOX_DEACTIVATION_NOT_ALLOWED");
  }
  const updated = updateCompanyEmailStatus(id, "DEACTIVATION_PENDING", req, "SECRETARY_DEACTIVATION_REQUESTED", {
    deactivationRequestedAt: now(),
    deactivation_requested_at: now(),
    deactivationRequestedBy: req.user.id,
    deactivation_requested_by: req.user.id,
    deactivationReason: payload.reason || payload.deactivationReason || payload.deactivation_reason || null,
    deactivation_reason: payload.deactivation_reason || payload.deactivationReason || payload.reason || null,
  });
  notifySecretaries(scope, "EMAIL_DEACTIVATION_REQUEST", "Email deactivation requested", `${updated.emailAddress} is pending deactivation.`, { companyEmailId: id }, req.user.id);
  return updated;
}

function notifyMailboxEmployee(account, action) {
  const employeeId = getEmployeeId(account);
  if (!employeeId) return null;
  const titleByAction = {
    SECRETARY_EMAIL_ADDRESS_CHANGED: "Company email address changed",
    SECRETARY_MAILBOX_SUSPENDED: "Company email suspended",
    SECRETARY_MAILBOX_REACTIVATED: "Company email reactivated",
    SECRETARY_DEACTIVATION_REQUESTED: "Company email deactivation requested",
  };
  return queueNotification({
    recipientEmployeeId: employeeId,
    type: action.replace(/^SECRETARY_/, ""),
    title: titleByAction[action] || "Company email updated",
    body: account.emailAddress || account.email_address,
    data: { companyEmailId: account.id, status: account.status },
  });
}

function buildDateTime(payload, start = true) {
  const direct = payload[start ? "startAt" : "endAt"] || payload[start ? "start_at" : "end_at"];
  if (direct) return new Date(direct).toISOString();
  const date = payload.date || payload.startDate || payload.start_date || new Date().toISOString().slice(0, 10);
  const time = payload[start ? "startTime" : "endTime"] || payload[start ? "start_time" : "end_time"] || (start ? "09:00" : "10:00");
  const parsed = new Date(`${String(date).slice(0, 10)}T${time.length === 5 ? `${time}:00` : time}`);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, "Schedule date or time is invalid.", "INVALID_SCHEDULE");
  }
  return parsed.toISOString();
}

function buildCalendarEventPayload(payload, scope, user) {
  const startAt = buildDateTime(payload, true);
  const endAt = buildDateTime(payload, false);
  const type = validateEnum(payload.type, CALENDAR_TYPES, "calendar event type", "EVENT");
  return {
    title: payload.title,
    description: payload.description || null,
    type,
    startTime: startAt,
    start_time: startAt,
    startAt,
    start_at: startAt,
    endTime: endAt,
    end_time: endAt,
    endAt,
    end_at: endAt,
    allDay: Boolean(payload.allDay ?? payload.all_day),
    all_day: Boolean(payload.allDay ?? payload.all_day),
    location: payload.location || null,
    meetingLink: payload.meetingLink || payload.meeting_link || null,
    meeting_link: payload.meeting_link || payload.meetingLink || null,
    createdBy: user.id,
    created_by: user.id,
    assignedTo: payload.assignedTo || payload.assigned_to || null,
    assigned_to: payload.assigned_to || payload.assignedTo || null,
    departmentId: payload.departmentId || payload.department_id || null,
    department_id: payload.department_id || payload.departmentId || null,
    status: normalizeStatus(payload.status, "SCHEDULED"),
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    updatedBy: user.id,
    updated_by: user.id,
  };
}

function filterCalendarRange(items, query = {}) {
  let records = items;
  const type = query.type || query.eventType || query.event_type;
  if (type) records = records.filter((record) => normalizeCalendarType(record.type || record.sourceType || record.source_type, "") === normalizeCalendarType(type, ""));
  const departmentId = query.department || query.departmentId || query.department_id;
  if (departmentId) records = records.filter((record) => String(getDepartmentId(record) || "") === String(departmentId));
  const userId = query.userId || query.user_id || query.assignedTo || query.assigned_to;
  if (userId) records = records.filter((record) => {
    const attendees = Array.isArray(record.attendees) ? record.attendees : [];
    return [record.createdBy, record.created_by, record.assignedTo, record.assigned_to, record.organizerId, record.organizer_id, ...attendees].some((value) => String(value || "") === String(userId));
  });

  if (query.date) {
    records = records.filter((record) => String(dateValue(record) || "").slice(0, 10) === String(query.date).slice(0, 10));
  }

  const from = query.start || query.dateFrom || query.from || query.startDate || query.start_date;
  const to = query.end || query.dateTo || query.to || query.endDate || query.end_date;
  if (from || to) {
    const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = to ? new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY;
    records = records.filter((record) => {
      const time = timestampOf(record);
      return time !== null && time >= fromTime && time <= toTime;
    });
  }

  if (query.week || query.month) {
    const anchor = new Date(query.week || `${query.month}-01`);
    if (!Number.isNaN(anchor.getTime())) {
      const start = new Date(anchor);
      if (query.week) start.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      if (query.week) end.setUTCDate(start.getUTCDate() + 7);
      else end.setUTCMonth(start.getUTCMonth() + 1);
      records = records.filter((record) => {
        const time = timestampOf(record);
        return time !== null && time >= start.getTime() && time < end.getTime();
      });
    }
  }

  return sortRecords(records, "startAt", "asc");
}

function getCalendar(user, query = {}) {
  const scope = buildScope(user);
  assertPermission(user, "calendar.view");
  assertQueryScope(query, scope);
  const events = activeRecords("calendar_events")
    .filter((record) => organizationMatches(record, scope))
    .map((record) => ({ ...record, source: "calendar_events" }));
  const meetings = activeRecords("meetings")
    .filter((record) => organizationMatches(record, scope))
    .map((record) => ({
      ...record,
      type: "MEETING",
      source: "meetings",
      startAt: record.startAt || record.start_at || record.startTime || record.start_time,
      start_at: record.start_at || record.startAt || record.start_time || record.startTime,
      endAt: record.endAt || record.end_at || record.endTime || record.end_time,
      end_at: record.end_at || record.endAt || record.end_time || record.endTime,
    }));
  const reminders = [
    ...activeRecords("reminders")
      .filter((record) => organizationMatches(record, scope))
      .map((record) => ({
        ...record,
        type: "REMINDER",
        source: "reminders",
        startAt: record.remindAt || record.remind_at,
        start_at: record.remind_at || record.remindAt,
        endAt: record.remindAt || record.remind_at,
        end_at: record.remind_at || record.remindAt,
      })),
    ...activeRecords("meeting_reminders")
      .filter((record) => {
        const meeting = activeRecords("meetings").find((item) => item.id === (record.meetingId || record.meeting_id));
        return organizationMatches(record, scope) || (meeting && organizationMatches(meeting, scope));
      })
      .map((record) => {
        const meeting = activeRecords("meetings").find((item) => item.id === (record.meetingId || record.meeting_id)) || {};
        return {
          ...record,
          id: record.id,
          title: `Reminder: ${meeting.title || "Meeting"}`,
          description: meeting.description || null,
          type: "REMINDER",
          source: "meeting_reminders",
          relatedType: "MEETING",
          related_type: "MEETING",
          relatedId: meeting.id || record.meetingId || record.meeting_id,
          related_id: meeting.id || record.meeting_id || record.meetingId,
          departmentId: meeting.departmentId || meeting.department_id || null,
          department_id: meeting.department_id || meeting.departmentId || null,
          createdBy: meeting.createdBy || meeting.created_by || meeting.organizerId || meeting.organizer_id || null,
          created_by: meeting.created_by || meeting.createdBy || meeting.organizer_id || meeting.organizerId || null,
          startAt: record.remindAt || record.remind_at,
          start_at: record.remind_at || record.remindAt,
          endAt: record.remindAt || record.remind_at,
          end_at: record.remind_at || record.remindAt,
          organizationId: getOrganizationId(record) || getOrganizationId(meeting),
          organization_id: getOrganizationId(record) || getOrganizationId(meeting),
        };
      }),
  ];
  const taskDeadlines = activeRecords("tasks")
    .filter((record) => organizationMatches(record, scope) && managementTaskInScope(record, scope))
    .map((record) => ({
      ...record,
      type: "TASK_DEADLINE",
      source: "tasks",
      startAt: record.dueDate || record.due_date,
      start_at: record.due_date || record.dueDate,
      endAt: record.dueDate || record.due_date,
      end_at: record.due_date || record.dueDate,
    }));
  const items = filterCalendarRange([...events, ...meetings, ...reminders, ...taskDeadlines], query);
  const normalizedEvents = items.map((item) => normalizeCalendarEvent(item, item.type || item.source));
  return {
    events: normalizedEvents,
    items: normalizedEvents,
    stats: {
      total: normalizedEvents.length,
      meetings: normalizedEvents.filter((item) => item.type === "MEETING").length,
      reminders: normalizedEvents.filter((item) => item.type === "REMINDER").length,
      taskDeadlines: normalizedEvents.filter((item) => item.type === "TASK_DEADLINE").length,
      managementEvents: normalizedEvents.filter((item) => item.type === "MANAGEMENT_EVENT").length,
      customEvents: normalizedEvents.filter((item) => item.type === "CUSTOM_EVENT").length,
    },
  };
}

function createCalendarEvent(payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "calendar.create");
  assertPayloadScope(payload, scope);
  if (!payload.title) throw createHttpError(400, "Calendar event title is required.", "CALENDAR_TITLE_REQUIRED");
  const record = createRecord("calendar_events", buildCalendarEventPayload(payload, scope, req.user));
  audit(req, "SECRETARY_CALENDAR_EVENT_CREATED", "calendar_events", record.id, null, record);
  return record;
}

function updateCalendarEvent(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "calendar.update");
  assertPayloadScope(payload, scope);
  const oldValue = findScopedRecord("calendar_events", id, scope);
  if (!oldValue) return null;
  const updates = compactObject({
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    ...(payload.type !== undefined ? { type: validateEnum(payload.type, CALENDAR_TYPES, "calendar event type", oldValue.type || "EVENT") } : {}),
    ...(payload.startAt || payload.start_at || payload.date || payload.startTime || payload.start_time ? { startAt: buildDateTime({ ...oldValue, ...payload }, true), start_at: buildDateTime({ ...oldValue, ...payload }, true), startTime: buildDateTime({ ...oldValue, ...payload }, true), start_time: buildDateTime({ ...oldValue, ...payload }, true) } : {}),
    ...(payload.endAt || payload.end_at || payload.date || payload.endTime || payload.end_time ? { endAt: buildDateTime({ ...oldValue, ...payload }, false), end_at: buildDateTime({ ...oldValue, ...payload }, false), endTime: buildDateTime({ ...oldValue, ...payload }, false), end_time: buildDateTime({ ...oldValue, ...payload }, false) } : {}),
    allDay: payload.allDay ?? payload.all_day,
    all_day: payload.all_day ?? payload.allDay,
    location: payload.location,
    meetingLink: payload.meetingLink || payload.meeting_link,
    meeting_link: payload.meeting_link || payload.meetingLink,
    assignedTo: payload.assignedTo || payload.assigned_to,
    assigned_to: payload.assigned_to || payload.assignedTo,
    departmentId: payload.departmentId || payload.department_id,
    department_id: payload.department_id || payload.departmentId,
    status: payload.status ? normalizeStatus(payload.status) : undefined,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  const updated = updateRecord("calendar_events", id, updates);
  audit(req, "SECRETARY_CALENDAR_EVENT_UPDATED", "calendar_events", id, oldValue, updated);
  return updated;
}

function deleteCalendarEvent(id, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "calendar.delete");
  const oldValue = findScopedRecord("calendar_events", id, scope);
  if (!oldValue) return null;
  const updated = updateRecord("calendar_events", id, { deletedAt: now(), deleted_at: now(), deletedBy: req.user.id, deleted_by: req.user.id, status: "DELETED" });
  audit(req, "SECRETARY_CALENDAR_EVENT_DELETED", "calendar_events", id, oldValue, updated);
  return updated;
}

function getCalendarEvent(user, id) {
  const scope = buildScope(user);
  assertPermission(user, "calendar.view");
  return findScopedRecord("calendar_events", id, scope);
}

function buildMeetingPayload(payload, scope, user, existing = {}) {
  const startAt = buildDateTime({ ...existing, ...payload }, true);
  const endAt = buildDateTime({ ...existing, ...payload }, false);
  const organizerId = payload.organizerId || payload.organizer_id || existing.organizerId || existing.organizer_id || user.id;
  const organizer = getUser(organizerId) || getEmployee(organizerId);
  return {
    title: payload.title ?? existing.title,
    description: payload.description ?? existing.description ?? null,
    organizerId,
    organizer_id: organizerId,
    organizerName: personName(organizer),
    organizer_name: personName(organizer),
    createdBy: existing.createdBy || existing.created_by || user.id,
    created_by: existing.created_by || existing.createdBy || user.id,
    date: startAt.slice(0, 10),
    startAt,
    start_at: startAt,
    startTime: startAt,
    start_time: startAt,
    endAt,
    end_at: endAt,
    endTime: endAt,
    end_time: endAt,
    location: payload.location ?? existing.location ?? null,
    meetingLink: payload.meetingLink || payload.meeting_link || existing.meetingLink || existing.meeting_link || null,
    meeting_link: payload.meeting_link || payload.meetingLink || existing.meeting_link || existing.meetingLink || null,
    status: validateEnum(payload.status || existing.status, MEETING_STATUSES, "meeting status", "SCHEDULED"),
    departmentId: payload.departmentId || payload.department_id || existing.departmentId || existing.department_id || null,
    department_id: payload.department_id || payload.departmentId || existing.department_id || existing.departmentId || null,
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    updatedBy: user.id,
    updated_by: user.id,
  };
}

function attendeeIdsFrom(payload = {}) {
  return [
    ...asArray(payload.attendeeIds),
    ...asArray(payload.attendee_ids),
    ...asArray(payload.userIds),
    ...asArray(payload.user_ids),
    ...asArray(payload.attendees).map((attendee) => typeof attendee === "string" ? attendee : attendee.userId || attendee.user_id || attendee.id),
  ].filter(Boolean);
}

function addMeetingAttendees(meeting, attendeeIds, req) {
  const records = readCollection("meeting_attendees");
  const existing = new Set(records.filter((item) => !item.deletedAt && !item.deleted_at && (item.meetingId || item.meeting_id) === meeting.id).map((item) => item.userId || item.user_id));
  const created = [];
  for (const userId of [...new Set(attendeeIds.filter(Boolean))]) {
    if (existing.has(userId)) continue;
    const timestamp = now();
    const attendee = {
      id: crypto.randomUUID(),
      meetingId: meeting.id,
      meeting_id: meeting.id,
      userId,
      user_id: userId,
      attendanceStatus: "INVITED",
      attendance_status: "INVITED",
      reminderSent: false,
      reminder_sent: false,
      reminderSentAt: null,
      reminder_sent_at: null,
      createdBy: req.user.id,
      created_by: req.user.id,
      organizationId: meeting.organizationId || meeting.organization_id,
      organization_id: meeting.organization_id || meeting.organizationId,
      createdAt: timestamp,
      created_at: timestamp,
      updatedAt: timestamp,
      updated_at: timestamp,
    };
    records.push(attendee);
    created.push(attendee);
  }
  saveCollection("meeting_attendees", records);
  for (const attendee of created) {
    queueNotification({
      recipientUserId: attendee.userId,
      type: "MEETING_CREATED",
      title: "Meeting invitation",
      body: `${meeting.title} has been scheduled.`,
      data: { meetingId: meeting.id },
    });
  }
  return created;
}

function createMeetingReminders(meeting, payload = {}, req) {
  const minutes = asArray(payload.reminders || payload.reminderMinutes || payload.reminder_minutes);
  const reminderMinutes = minutes.length ? minutes.map(Number).filter((value) => Number.isFinite(value) && value > 0) : [1440, 60, 30, 15];
  const recipients = new Set([meeting.organizerId || meeting.organizer_id, ...activeRecords("meeting_attendees").filter((attendee) => (attendee.meetingId || attendee.meeting_id) === meeting.id).map((attendee) => attendee.userId || attendee.user_id)].filter(Boolean));
  const records = readCollection("meeting_reminders");
  const created = [];
  for (const userId of recipients) {
    for (const minutesBefore of reminderMinutes) {
      const duplicate = records.some((record) => !record.deletedAt && !record.deleted_at && (record.meetingId || record.meeting_id) === meeting.id && (record.userId || record.user_id) === userId && Number(record.minutesBefore || record.minutes_before) === minutesBefore);
      if (duplicate) continue;
      const reminderAt = new Date(new Date(meeting.startAt || meeting.start_at).getTime() - minutesBefore * 60 * 1000).toISOString();
      const timestamp = now();
      const reminder = {
        id: crypto.randomUUID(),
        meetingId: meeting.id,
        meeting_id: meeting.id,
        userId,
        user_id: userId,
        minutesBefore,
        minutes_before: minutesBefore,
        remindAt: reminderAt,
        remind_at: reminderAt,
        status: "PENDING",
        reminderSent: false,
        reminder_sent: false,
        reminderSentAt: null,
        reminder_sent_at: null,
        organizationId: meeting.organizationId || meeting.organization_id,
        organization_id: meeting.organization_id || meeting.organizationId,
        createdBy: req.user.id,
        created_by: req.user.id,
        createdAt: timestamp,
        created_at: timestamp,
        updatedAt: timestamp,
        updated_at: timestamp,
      };
      records.push(reminder);
      created.push(reminder);
    }
  }
  saveCollection("meeting_reminders", records);
  return created;
}

function createMeeting(payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "meetings.create");
  assertPayloadScope(payload, scope);
  if (!payload.title) throw createHttpError(400, "Meeting title is required.", "MEETING_TITLE_REQUIRED");
  const record = createRecord("meetings", buildMeetingPayload(payload, scope, req.user));
  const attendees = addMeetingAttendees(record, [record.organizerId, ...attendeeIdsFrom(payload)], req);
  const reminders = createMeetingReminders(record, payload, req);
  const updated = updateRecord("meetings", record.id, { attendees: [...new Set(attendees.map((attendee) => attendee.userId || attendee.user_id))] });
  audit(req, "SECRETARY_MEETING_CREATED", "meetings", record.id, null, updated, { attendees: attendees.length, reminders: reminders.length });
  return enrichMeeting(updated);
}

function updateMeeting(id, payload = {}, req, action = "SECRETARY_MEETING_UPDATED") {
  const scope = buildScope(req.user);
  assertPermission(req.user, "meetings.update");
  assertPayloadScope(payload, scope);
  const oldValue = findScopedRecord("meetings", id, scope);
  if (!oldValue) return null;
  const updated = updateRecord("meetings", id, buildMeetingPayload(payload, scope, req.user, oldValue));
  if (attendeeIdsFrom(payload).length) {
    const attendees = addMeetingAttendees(updated, attendeeIdsFrom(payload), req);
    updateRecord("meetings", id, { attendees: [...new Set([...(oldValue.attendees || []), ...attendees.map((attendee) => attendee.userId || attendee.user_id)])] });
  }
  audit(req, action, "meetings", id, oldValue, updated);
  notifyMeetingParticipants(updated, action === "SECRETARY_MEETING_RESCHEDULED" ? "MEETING_UPDATED" : "MEETING_UPDATED", "Meeting updated", `${updated.title} has been updated.`);
  return enrichMeeting(activeRecords("meetings").find((meeting) => meeting.id === id));
}

function cancelMeeting(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "meetings.cancel");
  const oldValue = findScopedRecord("meetings", id, scope);
  if (!oldValue) return null;
  const updated = updateRecord("meetings", id, {
    status: "CANCELLED",
    cancelledAt: now(),
    cancelled_at: now(),
    cancelledBy: req.user.id,
    cancelled_by: req.user.id,
    cancellationReason: payload.reason || payload.cancellationReason || payload.cancellation_reason || null,
    cancellation_reason: payload.cancellation_reason || payload.cancellationReason || payload.reason || null,
  });
  audit(req, "SECRETARY_MEETING_CANCELLED", "meetings", id, oldValue, updated);
  notifyMeetingParticipants(updated, "MEETING_CANCELLED", "Meeting cancelled", `${updated.title} has been cancelled.`);
  return enrichMeeting(updated);
}

function notifyMeetingParticipants(meeting, type, title, body) {
  const recipients = new Set([meeting.organizerId || meeting.organizer_id, ...(meeting.attendees || [])]);
  for (const attendee of activeRecords("meeting_attendees").filter((item) => (item.meetingId || item.meeting_id) === meeting.id)) {
    recipients.add(attendee.userId || attendee.user_id);
  }
  for (const userId of recipients) {
    if (!userId) continue;
    queueNotification({ recipientUserId: userId, type, title, body, data: { meetingId: meeting.id } });
  }
}

function removeMeetingAttendee(meetingId, userId, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "meetings.update");
  const meeting = findScopedRecord("meetings", meetingId, scope);
  if (!meeting) return null;
  const attendee = activeRecords("meeting_attendees").find((item) => (item.meetingId || item.meeting_id) === meetingId && String(item.userId || item.user_id) === String(userId));
  if (!attendee) return null;
  const updatedAttendee = updateRecord("meeting_attendees", attendee.id, { deletedAt: now(), deleted_at: now(), deletedBy: req.user.id, deleted_by: req.user.id });
  const updatedMeeting = updateRecord("meetings", meetingId, { attendees: (meeting.attendees || []).filter((id) => String(id) !== String(userId)) });
  audit(req, "SECRETARY_MEETING_ATTENDEE_REMOVED", "meetings", meetingId, attendee, updatedAttendee);
  return { meeting: enrichMeeting(updatedMeeting), attendee: updatedAttendee };
}

function listMeetings(user, query = {}, filter) {
  return listScoped("meetings", user, query, "meetings.view", {
    filter,
    enrich: enrichMeeting,
  });
}

function getMeeting(user, id) {
  const scope = buildScope(user);
  assertPermission(user, "meetings.view");
  const record = findScopedRecord("meetings", id, scope);
  return record ? enrichMeeting(record) : null;
}

function managementTaskInScope(task, scope) {
  const assignedTo = getAssignedTo(task);
  const createdBy = getCreatedBy(task);
  if (assignedTo && scope.identifiers.has(assignedTo)) return true;
  if (createdBy && scope.identifiers.has(createdBy)) return true;
  if (normalizeStatus(task.type || task.taskType || task.task_type || task.category, "") === "MANAGEMENT") return true;
  const creator = getUser(createdBy);
  return Boolean(creator && MANAGEMENT_ROLES.has(normalizeRole(creator.role)));
}

function createTask(payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "management_tasks.create");
  assertPayloadScope(payload, scope);
  if (!payload.title) throw createHttpError(400, "Task title is required.", "TASK_TITLE_REQUIRED");
  const status = validateEnum(payload.status, TASK_STATUSES, "task status", "TODO");
  const assignedTo = payload.assignedTo || payload.assigned_to || payload.employeeId || payload.employee_id || req.user.id;
  const record = createRecord("tasks", {
    title: payload.title,
    description: payload.description || null,
    createdBy: req.user.id,
    created_by: req.user.id,
    assignedTo,
    assigned_to: assignedTo,
    employeeId: payload.employeeId || payload.employee_id || null,
    employee_id: payload.employee_id || payload.employeeId || null,
    departmentId: payload.departmentId || payload.department_id || null,
    department_id: payload.department_id || payload.departmentId || null,
    priority: normalizeStatus(payload.priority, "NORMAL"),
    status,
    dueDate: payload.dueDate || payload.due_date || null,
    due_date: payload.due_date || payload.dueDate || null,
    notes: payload.notes || null,
    taskType: "MANAGEMENT",
    task_type: "MANAGEMENT",
    completedAt: null,
    completed_at: null,
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "SECRETARY_TASK_CREATED", "tasks", record.id, null, record);
  queueNotification({ recipientUserId: assignedTo, recipientEmployeeId: payload.employeeId || payload.employee_id || null, type: "TASK_ASSIGNED", title: "Management task assigned", body: record.title, data: { taskId: record.id } });
  return record;
}

function updateTask(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "management_tasks.update");
  assertPayloadScope(payload, scope);
  const oldValue = findScopedRecord("tasks", id, scope);
  if (!oldValue) return null;
  if (!managementTaskInScope(oldValue, scope)) {
    throw createHttpError(403, "Requested task is outside this Secretary's task scope.", "RESOURCE_OUT_OF_SECRETARY_SCOPE", { id });
  }
  const status = payload.status ? validateEnum(payload.status, TASK_STATUSES, "task status", oldValue.status || "TODO") : undefined;
  const updates = compactObject({
    title: payload.title,
    description: payload.description,
    assignedTo: payload.assignedTo || payload.assigned_to,
    assigned_to: payload.assigned_to || payload.assignedTo,
    employeeId: payload.employeeId || payload.employee_id,
    employee_id: payload.employee_id || payload.employeeId,
    departmentId: payload.departmentId || payload.department_id,
    department_id: payload.department_id || payload.departmentId,
    priority: payload.priority ? normalizeStatus(payload.priority, "NORMAL") : undefined,
    status,
    dueDate: payload.dueDate || payload.due_date,
    due_date: payload.due_date || payload.dueDate,
    notes: payload.notes,
    completedAt: status === "COMPLETED" ? now() : payload.completedAt || payload.completed_at,
    completed_at: status === "COMPLETED" ? now() : payload.completed_at || payload.completedAt,
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  const updated = updateRecord("tasks", id, updates);
  audit(req, status === "COMPLETED" ? "SECRETARY_TASK_COMPLETED" : "SECRETARY_TASK_UPDATED", "tasks", id, oldValue, updated);
  queueNotification({ recipientUserId: getAssignedTo(updated), recipientEmployeeId: getEmployeeId(updated), type: "TASK_UPDATED", title: "Management task updated", body: updated.title, data: { taskId: id } });
  return updated;
}

function completeTask(id, payload = {}, req) {
  const scope = buildScope(req.user);
  const task = findScopedRecord("tasks", id, scope);
  if (!task) return null;
  const assignedTo = getAssignedTo(task);
  if (assignedTo && !scope.identifiers.has(assignedTo) && !hasPermission(req.user, "management_tasks.assign")) {
    throw createHttpError(403, "Only the assignee can complete this task.", "TASK_ASSIGNEE_REQUIRED");
  }
  return updateTask(id, { ...payload, status: "COMPLETED" }, req);
}

function listTasks(user, query = {}, filter) {
  return listScoped("tasks", user, query, "management_tasks.view", {
    filter: (task, scope) => managementTaskInScope(task, scope) && (!filter || filter(task, scope)),
  });
}

function getTask(user, id) {
  const scope = buildScope(user);
  assertPermission(user, "management_tasks.view");
  const record = findScopedRecord("tasks", id, scope);
  if (!record) return null;
  if (!managementTaskInScope(record, scope)) {
    throw createHttpError(403, "Requested task is outside this Secretary's task scope.", "RESOURCE_OUT_OF_SECRETARY_SCOPE", { id });
  }
  return record;
}

function buildReminderPayload(payload, scope, user, existing = {}) {
  const remindAt = payload.remindAt || payload.remind_at || existing.remindAt || existing.remind_at;
  if (!remindAt || Number.isNaN(new Date(remindAt).getTime())) {
    throw createHttpError(400, "Reminder time is required and must be valid.", "INVALID_REMINDER_TIME");
  }
  const status = validateEnum(payload.status || existing.status, REMINDER_STATUSES, "reminder status", "PENDING");
  return {
    title: payload.title ?? existing.title,
    description: payload.description ?? existing.description ?? null,
    remindAt: new Date(remindAt).toISOString(),
    remind_at: new Date(remindAt).toISOString(),
    relatedType: validateEnum(payload.relatedType || payload.related_type || existing.relatedType || existing.related_type, ["MEETING", "TASK", "EMAIL_REQUEST", "EVENT", "OTHER"], "reminder related type", "OTHER"),
    related_type: validateEnum(payload.relatedType || payload.related_type || existing.relatedType || existing.related_type, ["MEETING", "TASK", "EMAIL_REQUEST", "EVENT", "OTHER"], "reminder related type", "OTHER"),
    relatedId: payload.relatedId || payload.related_id || existing.relatedId || existing.related_id || null,
    related_id: payload.related_id || payload.relatedId || existing.related_id || existing.relatedId || null,
    createdBy: existing.createdBy || existing.created_by || user.id,
    created_by: existing.created_by || existing.createdBy || user.id,
    assignedTo: payload.assignedTo || payload.assigned_to || existing.assignedTo || existing.assigned_to || user.id,
    assigned_to: payload.assigned_to || payload.assignedTo || existing.assigned_to || existing.assignedTo || user.id,
    status,
    sentAt: status === "SENT" ? now() : existing.sentAt || existing.sent_at || null,
    sent_at: status === "SENT" ? now() : existing.sent_at || existing.sentAt || null,
    organizationId: scope.organizationId,
    organization_id: scope.organizationId,
    updatedBy: user.id,
    updated_by: user.id,
  };
}

function createReminder(payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "reminders.create");
  assertPayloadScope(payload, scope);
  if (!payload.title) throw createHttpError(400, "Reminder title is required.", "REMINDER_TITLE_REQUIRED");
  const record = createRecord("reminders", buildReminderPayload(payload, scope, req.user));
  audit(req, "SECRETARY_REMINDER_CREATED", "reminders", record.id, null, record);
  queueNotification({ recipientUserId: record.assignedTo || record.assigned_to, type: "UPCOMING_REMINDER", title: "Reminder scheduled", body: record.title, data: { reminderId: record.id } });
  return enrichReminder(record);
}

function updateReminder(id, payload = {}, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "reminders.update");
  assertPayloadScope(payload, scope);
  const oldValue = findScopedRecord("reminders", id, scope);
  if (!oldValue) return null;
  const updated = updateRecord("reminders", id, buildReminderPayload(payload, scope, req.user, oldValue));
  audit(req, normalizeStatus(updated.status) === "CANCELLED" ? "SECRETARY_REMINDER_CANCELLED" : "SECRETARY_REMINDER_UPDATED", "reminders", id, oldValue, updated);
  return enrichReminder(updated);
}

function cancelReminder(id, req) {
  return updateReminder(id, { status: "CANCELLED" }, req);
}

function getReminder(user, id) {
  const scope = buildScope(user);
  assertPermission(user, "reminders.view");
  const record = findScopedRecord("reminders", id, scope);
  return record ? enrichReminder(record) : null;
}

function listNotifications(user, query = {}) {
  const scope = buildScope(user);
  assertPermission(user, "notifications.view");
  const records = activeRecords("notifications").filter((record) => {
    const orgId = getOrganizationId(record);
    const addressedToSecretary = [record.recipientUserId, record.recipient_user_id, record.userId, record.user_id].some((id) => id && scope.identifiers.has(id));
    return (orgId ? String(orgId) === String(scope.organizationId) : addressedToSecretary) && addressedToSecretary;
  });
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, SEARCH_FIELDS.notifications), query);
}

function markNotificationRead(id, req) {
  const scope = buildScope(req.user);
  assertPermission(req.user, "notifications.view");
  const record = activeRecords("notifications").find((item) => item.id === id);
  if (!record) return null;
  const addressedToSecretary = [record.recipientUserId, record.recipient_user_id, record.userId, record.user_id].some((value) => value && scope.identifiers.has(value));
  if (!addressedToSecretary) {
    throw createHttpError(403, "Requested notification is outside this Secretary's scope.", "RESOURCE_OUT_OF_SECRETARY_SCOPE", { id });
  }
  return updateRecord("notifications", id, { readAt: now(), read_at: now(), status: "READ" });
}

function listAuditLogs(user, query = {}) {
  const scope = buildScope(user);
  assertPermission(user, "audit_logs.view");
  const records = activeRecords("operational_audit_logs").filter((record) => {
    const metadataOrg = record.metadata?.organizationId || record.metadata?.organization_id;
    return String(metadataOrg || "") === String(scope.organizationId) && String(record.module || "").startsWith("Secretary ");
  });
  return paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["action", "module", "actorName", "actor_name", "targetType", "target_type"]), query);
}

function notifySecretaries(scope, type, title, body, data = {}, exceptUserId = null) {
  for (const user of listUsers()) {
    if (normalizeRole(user.role) !== "secretary" || user.id === exceptUserId) continue;
    if (String(getOrganizationId(user) || "") !== String(scope.organizationId)) continue;
    queueNotification({ recipientUserId: user.id, type, title, body, data });
  }
}

function notifyEmailRequestSubject(record, action) {
  const status = normalizeStatus(record.status);
  const employeeId = getEmployeeId(record);
  const requesterId = record.requesterId || record.requester_id;
  queueNotification({
    recipientUserId: requesterId || null,
    recipientEmployeeId: employeeId || null,
    type: action.replace(/^SECRETARY_/, ""),
    title: "Company email request updated",
    body: `Company email request is now ${status}.`,
    data: { emailRequestId: record.id, status },
  });
}

module.exports = {
  approveEmailRequest,
  buildScope,
  cancelEmailRequest,
  cancelMeeting,
  cancelReminder,
  changeCompanyEmailAddress,
  checkEmailAvailability,
  completeTask,
  createCalendarEvent,
  createAndAssignCompanyEmail,
  createEmailRequest,
  createMeeting,
  createMeetingReminders,
  createReminder,
  createTask,
  deleteCalendarEvent,
  getCalendar,
  getCalendarEvent,
  getCompanyEmail,
  getCompanyEmailDirectory,
  getDashboard,
  getEmailQueue,
  getEmailRequest,
  getMeeting,
  getReminder,
  getScopeSummary,
  getSelfEmploymentRecord,
  getTask,
  listAuditLogs,
  listMeetings,
  listNotifications,
  listScoped,
  listTasks,
  markNotificationRead,
  rejectEmailRequest,
  removeMeetingAttendee,
  requestCompanyEmailDeactivation,
  reactivateCompanyEmail,
  resolveEmailCreation,
  retryEmailCreation,
  returnEmailRequest,
  reviewEmailRequest,
  updateCalendarEvent,
  updateEmailRequestStatus,
  updateMeeting,
  updateReminder,
  updateSelfEmploymentRecord,
  updateTask,
  suspendCompanyEmail,
};
