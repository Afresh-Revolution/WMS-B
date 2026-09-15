const crypto = require("crypto");
const { hashPassword } = require("../../auth/passwords");
const { revokeUserSessions } = require("../../auth/sessionStore");
const postgresUserStore = require("../../auth/postgresUserStore");
const { createUser, getUserById, listUsers, sanitizeUser, updateUser, updateUserPassword } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { getRolePermissions, ROLE_DEFINITIONS } = require("../../constants/rbac");
const { applyBasicFilters, paginate, sortRecords } = require("../../utils/query");

const ROLE_ALIASES = Object.freeze({
  nysc: "nysc_intern",
  nysc_member: "nysc_intern",
  nysc_interns: "nysc_intern",
  intern_nysc: "nysc_intern",
  head_of_department: "hod",
  head_of_dept: "hod",
  dept_manager: "department_manager",
  departmental_manager: "department_manager",
  teamlead: "team_leader",
  team_lead: "team_leader",
  other_staff: "employee",
});

const STAFF_COLLECTIONS = Object.freeze({
  employee: "employees",
  intern: "interns",
  nysc: "nysc_members",
  admin: "staff_members",
  manager: "staff_members",
  other_staff: "staff_members",
});

const SEARCH_FIELDS = [
  "fullName",
  "name",
  "employeeId",
  "employee_id",
  "internId",
  "nyscId",
  "email",
  "phone",
  "department",
  "departmentName",
  "position",
  "positionName",
  "jobTitle",
  "location",
  "workLocation",
];

function now() {
  return new Date().toISOString();
}

function normalizeStaffType(value) {
  const normalized = String(value || "employee").toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "nysc_member" || normalized === "nysc_intern") {
    return "nysc";
  }

  return STAFF_COLLECTIONS[normalized] ? normalized : "employee";
}

function normalizeRoleKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function resolveAssignedRole(roleValue) {
  const requested = normalizeRoleKey(roleValue) || "employee";
  const aliased = ROLE_ALIASES[requested] || requested;
  if (ROLE_DEFINITIONS[aliased]) {
    return { key: aliased, permissions: getRolePermissions(aliased) };
  }

  const byName = Object.values(ROLE_DEFINITIONS).find(
    (role) => normalizeRoleKey(role.name) === aliased || normalizeRoleKey(role.key) === aliased
  );
  if (byName) {
    return { key: byName.key, permissions: byName.permissions };
  }

  const error = new Error(`Unknown role "${roleValue}".`);
  error.statusCode = 400;
  error.publicMessage = error.message;
  error.code = "INVALID_ROLE";
  throw error;
}

function createAuthUser(payload) {
  return postgresUserStore.isEnabled() ? postgresUserStore.createUser(payload) : createUser(payload);
}

function getCollectionForStaffType(staffType) {
  return STAFF_COLLECTIONS[normalizeStaffType(staffType)];
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function getLookup(collection, id, fallback) {
  if (!id) {
    return fallback || null;
  }

  const record = readCollection(collection).find((item) => item.id === id);
  return record?.name || record?.title || fallback || id;
}

function getUserForStaff(record) {
  return record.userId ? getUserById(record.userId) : null;
}

function getFullName(record) {
  return (
    record.fullName ||
    record.name ||
    [record.firstName, record.middleName, record.lastName].filter(Boolean).join(" ") ||
    record.email ||
    "Unnamed Staff"
  );
}

function getInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function normalizeStaffRecord(record, staffType) {
  const user = getUserForStaff(record);
  const fullName = getFullName(record);
  const departmentId = record.departmentId || record.department_id;
  const positionId = record.positionId || record.position_id;
  const branchId = record.branchId || record.branch_id;
  const managerId = record.managerId || record.manager_id || record.supervisorId || record.supervisor_id;

  return {
    id: record.id,
    staffType,
    userId: record.userId || null,
    profilePhoto: record.profilePhoto || record.photo || record.photoUrl || null,
    avatar: {
      initials: getInitials(fullName),
    },
    fullName,
    employeeId: record.employeeId || record.employee_id || record.internId || record.nyscId || record.staffId || null,
    email: record.email || user?.email || null,
    phone: record.phone || null,
    jobPosition: record.jobTitle || record.position || record.positionName || getLookup("positions", positionId),
    positionId: positionId || null,
    department: record.department || record.departmentName || getLookup("departments", departmentId),
    departmentId: departmentId || null,
    manager: record.manager || record.supervisor || getLookup("employees", managerId),
    managerId: managerId || null,
    location: record.location || record.workLocation || record.ppa || null,
    branch: record.branch || getLookup("branches", branchId),
    branchId: branchId || null,
    employmentType: record.employmentType || record.employment_type || humanize(staffType),
    status: record.status || "active",
    role: record.role || user?.role || null,
    dateJoined: record.employmentStartDate || record.hireDate || record.startDate || record.createdAt || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    raw: record,
  };
}

function listAllStaff() {
  const staff = [];
  for (const [staffType, collection] of Object.entries(STAFF_COLLECTIONS)) {
    const records = readCollection(collection).filter((record) => !record.deletedAt);
    for (const record of records) {
      if (collection === "staff_members" && normalizeStaffType(record.staffType) !== staffType) {
        continue;
      }

      staff.push(normalizeStaffRecord(record, staffType));
    }
  }

  const representedUserIds = new Set(staff.map((record) => record.userId).filter(Boolean));
  for (const user of listUsers()) {
    if (representedUserIds.has(user.id) || user.status === "deleted") {
      continue;
    }

    if (["superadmin", "admin", "manager"].includes(user.role)) {
      staff.push(
        normalizeStaffRecord(
          {
            id: user.id,
            userId: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            staffType: user.role === "admin" || user.role === "superadmin" ? "admin" : "manager",
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          user.role === "admin" || user.role === "superadmin" ? "admin" : "manager"
        )
      );
    }
  }

  return staff;
}

function applyDirectoryFilters(staff, query = {}) {
  const normalizedQuery = {
    ...query,
    q: query.q || query.search,
    staffType: query.staffType || query.staff_type,
    employmentType: query.employmentType || query.employment_type,
  };

  const broadSearchQuery = {
    page: normalizedQuery.page,
    limit: normalizedQuery.limit,
    sortBy: normalizedQuery.sortBy,
    sortDirection: normalizedQuery.sortDirection,
    q: normalizedQuery.q,
    dateFrom: normalizedQuery.dateFrom,
    dateTo: normalizedQuery.dateTo,
  };
  let filtered = applyBasicFilters(staff, broadSearchQuery, SEARCH_FIELDS);
  const exactFilters = [
    "department",
    "departmentId",
    "position",
    "positionId",
    "status",
    "employmentType",
    "location",
    "branch",
    "branchId",
    "manager",
    "managerId",
    "role",
    "staffType",
  ];

  for (const key of exactFilters) {
    const queryValue = normalizedQuery[key];
    if (!queryValue) {
      continue;
    }

    filtered = filtered.filter((record) => String(record[key] || "").toLowerCase() === String(queryValue).toLowerCase());
  }

  return sortRecords(filtered, query.sort || query.sortBy || "fullName", query.order || query.sortDirection || "asc");
}

function buildDynamicFilters(staff) {
  function unique(field) {
    return [...new Set(staff.map((record) => record[field]).filter(Boolean))].sort((left, right) =>
      String(left).localeCompare(String(right))
    );
  }

  return {
    departments: unique("department"),
    positions: unique("jobPosition"),
    statuses: unique("status"),
    employmentTypes: unique("employmentType"),
    locations: unique("location"),
    branches: unique("branch"),
    managers: unique("manager"),
    roles: unique("role"),
    staffTypes: unique("staffType"),
    departmentCategories: [
      ...new Set([
        ...readCollection("departments").map((record) => record.name).filter(Boolean),
        ...readCollection("positions").map((record) => record.title || record.name).filter(Boolean),
        ...readCollection("staff_categories").map((record) => record.name).filter(Boolean),
      ]),
    ].sort((left, right) => String(left).localeCompare(String(right))),
  };
}

function listStaffDirectory(query = {}) {
  const staff = applyDirectoryFilters(listAllStaff(), query);
  const result = paginate(staff, query);
  return {
    data: result.data.map((record) => ({
      id: record.id,
      staffType: record.staffType,
      profilePhoto: record.profilePhoto,
      avatar: record.avatar,
      fullName: record.fullName,
      employeeId: record.employeeId,
      jobPosition: record.jobPosition,
      department: record.department,
      location: record.location,
      email: record.email,
      phone: record.phone,
      employmentType: record.employmentType,
      status: record.status,
      branch: record.branch,
      manager: record.manager,
      role: record.role,
      dateJoined: record.dateJoined,
      actions: ["view", "edit", "suspend", "deactivate", "reset-password"],
    })),
    meta: {
      ...result.meta,
      view: query.view === "list" ? "list" : "grid",
      filters: buildDynamicFilters(staff),
    },
  };
}

function createHistoryRecord(collection, payload) {
  const records = readCollection(collection);
  const timestamp = now();
  const record = {
    id: crypto.randomUUID(),
    ...payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  records.push(record);
  writeCollection(collection, records);
  return record;
}

function writeActivity({ staffId, staffType, actor, action, oldValue, newValue, req }) {
  return createHistoryRecord("employee_activity_logs", {
    staffId,
    staffType,
    actorId: actor?.id || null,
    actorEmail: actor?.email || null,
    action,
    oldValue: oldValue || null,
    newValue: newValue || null,
    ipAddress: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
  });
}

function findStaffRecord(id) {
  for (const [staffType, collection] of Object.entries(STAFF_COLLECTIONS)) {
    const record = readCollection(collection).find((candidate) => candidate.id === id && !candidate.deletedAt);
    if (!record) {
      continue;
    }

    if (collection === "staff_members" && normalizeStaffType(record.staffType) !== staffType) {
      continue;
    }

    return { staffType, collection, record };
  }

  const user = getUserById(id);
  if (user && user.status !== "deleted") {
    return {
      staffType: user.role === "admin" || user.role === "superadmin" ? "admin" : "manager",
      collection: null,
      record: {
        id: user.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  return null;
}

function saveStaffRecord(collection, id, payload) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt);
  if (index === -1) {
    return null;
  }

  records[index] = {
    ...records[index],
    ...payload,
    id: records[index].id,
    updatedAt: now(),
  };
  writeCollection(collection, records);
  return records[index];
}

function normalizeCreatePayload(body = {}) {
  const staffType = normalizeStaffType(body.staffType || body.personType || body.type);
  const personal = body.personalInformation || body.personal || {};
  const employment = body.employmentInformation || body.employment || {};
  const financial = body.financialInformation || body.financial || {};
  const emergencyContact = body.emergencyContact || {};
  const systemAccess = body.systemAccess || {};
  const documents = Array.isArray(body.documents) ? body.documents : [];

  const fullName =
    body.fullName ||
    body.name ||
    personal.fullName ||
    [personal.firstName || body.firstName, personal.middleName || body.middleName, personal.lastName || body.lastName]
      .filter(Boolean)
      .join(" ");

  return {
    staffType,
    systemAccess,
    documents,
    record: compactObject({
      staffType,
      firstName: personal.firstName || body.firstName,
      middleName: personal.middleName || body.middleName,
      lastName: personal.lastName || body.lastName,
      fullName,
      name: fullName,
      profilePhoto: personal.profilePhoto || body.profilePhoto,
      gender: personal.gender || body.gender,
      dateOfBirth: personal.dateOfBirth || body.dateOfBirth,
      phone: personal.phone || body.phone || body.phoneNumber,
      email: personal.email || body.email || body.workEmail,
      address: personal.address || body.address,
      state: personal.state || body.state,
      lga: personal.lga || body.lga,
      country: personal.country || body.country,
      employeeId: employment.employeeId || body.employeeId,
      internId: employment.internId || body.internId,
      nyscId: employment.nyscId || body.nyscId,
      stateCode: employment.stateCode || body.stateCode,
      callUpNumber: employment.callUpNumber || body.callUpNumber,
      institution: employment.institution || body.institution,
      course: employment.course || body.course,
      fieldOfStudy: employment.fieldOfStudy || body.fieldOfStudy,
      jobTitle: employment.jobTitle || body.jobTitle || body.title || body.position,
      position: employment.position || body.position || body.jobTitle || body.title,
      positionId: employment.positionId || body.positionId,
      department: employment.department || body.department,
      departmentId: employment.departmentId || body.departmentId,
      managerId: employment.managerId || body.managerId,
      supervisorId: employment.supervisorId || body.supervisorId,
      employmentType: employment.employmentType || body.employmentType,
      employmentStartDate: employment.employmentStartDate || body.employmentStartDate,
      hireDate: employment.hireDate || body.hireDate,
      startDate: employment.startDate || body.startDate,
      endDate: employment.endDate || body.endDate,
      expectedEndDate: employment.expectedEndDate || body.expectedEndDate,
      duration: employment.duration || body.duration,
      location: employment.location || body.location,
      workLocation: employment.workLocation || body.workLocation,
      branch: employment.branch || body.branch,
      branchId: employment.branchId || body.branchId,
      ppa: employment.ppa || body.ppa,
      status: employment.status || body.status || "active",
      role: systemAccess.role || body.role,
      permissions: systemAccess.permissions || body.permissions,
      dashboardAccess: systemAccess.dashboardAccess || body.dashboardAccess,
      salary: financial.salary || body.salary,
      salaryStructure: financial.salaryStructure || body.salaryStructure,
      bankInformation: compactObject({
        bankName: financial.bankName || body.bankName,
        accountNumber: financial.accountNumber || body.accountNumber,
        accountName: financial.accountName || body.accountName,
      }),
      taxInformation: financial.taxInformation || body.taxInformation,
      pensionInformation: financial.pensionInformation || body.pensionInformation,
      emergencyContact,
    }),
  };
}

async function createSystemUserIfRequested({ record, systemAccess }) {
  const wantsAccess =
    systemAccess.createAccount ||
    systemAccess.dashboardAccess ||
    systemAccess.username ||
    systemAccess.email ||
    systemAccess.initialPassword ||
    systemAccess.password;

  if (!wantsAccess) {
    return null;
  }

  const password = systemAccess.initialPassword || systemAccess.password;
  const email = systemAccess.email || record.email || systemAccess.username;

  if (typeof email !== "string" || !email.trim()) {
    const error = new Error("Email or username is required when creating system access.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  if (typeof password !== "string" || password.length < 8) {
    const error = new Error("Initial password must be at least 8 characters when creating system access.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const assignedRole = resolveAssignedRole(systemAccess.role || record.role || "employee");
  const permissions =
    Array.isArray(systemAccess.permissions) && systemAccess.permissions.length > 0
      ? systemAccess.permissions
      : assignedRole.permissions;

  return createAuthUser({
    name: record.fullName || record.name,
    fullName: record.fullName || record.name,
    email,
    passwordHash: hashPassword(password),
    role: assignedRole.key,
    roleId: assignedRole.key,
    permissions,
    status: "active",
    accountType: assignedRole.key === "superadmin" ? "SUPER_ADMIN" : assignedRole.key === "admin" ? "ADMIN" : "STAFF",
    mustChangePassword: Boolean(systemAccess.mustChangePassword),
    departmentId: record.departmentId || null,
    employeeId: record.employeeId || record.id || null,
  });
}

async function createStaff(body, actor, req) {
  const { staffType, record, systemAccess, documents } = normalizeCreatePayload(body);
  const assignedRole = resolveAssignedRole(systemAccess.role || record.role || body.role || "employee");
  record.role = assignedRole.key;
  record.permissions = Array.isArray(systemAccess.permissions) && systemAccess.permissions.length > 0
    ? systemAccess.permissions
    : assignedRole.permissions;
  const collection = getCollectionForStaffType(staffType);
  const timestamp = now();
  const user = await createSystemUserIfRequested({ record, systemAccess });
  const staffRecord = {
    id: crypto.randomUUID(),
    ...record,
    userId: user?.id || null,
    createdBy: actor?.id || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const records = readCollection(collection);
  records.push(staffRecord);
  writeCollection(collection, records);

  if (Array.isArray(documents)) {
    for (const document of documents) {
      addStaffDocument(staffRecord.id, { ...document, staffType }, actor, req);
    }
  }

  createHistoryRecord("employment_history", {
    staffId: staffRecord.id,
    staffType,
    event: "created",
    newValue: normalizeStaffRecord(staffRecord, staffType),
    actorId: actor?.id || null,
  });
  writeActivity({
    staffId: staffRecord.id,
    staffType,
    actor,
    action: `${humanize(staffType)} Created`,
    newValue: normalizeStaffRecord(staffRecord, staffType),
    req,
  });

  return normalizeStaffRecord(staffRecord, staffType);
}

function getStaffProfile(id) {
  const found = findStaffRecord(id);
  if (!found) {
    return null;
  }

  const normalized = normalizeStaffRecord(found.record, found.staffType);
  const user = found.record.userId ? getUserById(found.record.userId) : null;
  const tasks = readCollection("tasks").filter((task) => task.assignedTo === id || task.assignedTo === found.record.userId);
  const targets = readCollection("targets").filter((target) => target.ownerId === id || target.employeeId === id);
  const leave = readCollection("leave_requests").filter((request) => request.employeeId === id || request.staffId === id);
  const salaryHistory = readCollection("salary_history").filter((history) => history.employeeId === id || history.staffId === id);
  const promotions = readCollection("promotions").filter((promotion) => promotion.employeeId === id || promotion.staffId === id);
  const meetings = readCollection("meetings").filter((meeting) => {
    const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
    return attendees.includes(id) || attendees.includes(found.record.userId);
  });
  const discipline = readCollection("disciplinary_cases").filter((item) => item.employeeId === id || item.staffId === id);
  const documents = getStaffDocuments(id);
  const activity = getStaffActivity(id);
  const loginHistory = user ? readCollection("login_history").filter((event) => event.userId === user.id) : [];
  const sessions = user ? readCollection("sessions").filter((session) => session.userId === user.id && session.status === "active") : [];
  const failedLogins = user ? readCollection("failed_logins").filter((attempt) => attempt.userId === user.id) : [];

  return {
    overview: {
      profilePhoto: normalized.profilePhoto,
      fullName: normalized.fullName,
      employeeId: normalized.employeeId,
      position: normalized.jobPosition,
      department: normalized.department,
      manager: normalized.manager,
      location: normalized.location,
      status: normalized.status,
      email: normalized.email,
      phone: normalized.phone,
      dateJoined: normalized.dateJoined,
      summary: {
        tasksCompleted: tasks.filter((task) => task.status === "completed").length,
        tasksPending: tasks.filter((task) => task.status === "pending").length,
        targetAchievement: targets.reduce((total, target) => total + Number(target.progress || 0), 0),
        leaveBalance: readCollection("leave_balances").find((balance) => balance.employeeId === id) || null,
        attendance: readCollection("attendance").filter((record) => record.staffId === id || record.employeeId === id).length,
        performanceScore: found.record.performanceScore || null,
      },
    },
    personalInformation: found.record,
    employment: {
      current: normalized,
      employmentHistory: readCollection("employment_history").filter((history) => history.staffId === id),
      departmentHistory: readCollection("department_history").filter((history) => history.staffId === id),
      positionHistory: readCollection("position_history").filter((history) => history.staffId === id),
      managerHistory: readCollection("manager_history").filter((history) => history.staffId === id),
    },
    department: normalized.department,
    attendance: readCollection("attendance").filter((record) => record.staffId === id || record.employeeId === id),
    leave,
    salary: found.record.salary || null,
    salaryHistory,
    promotions,
    tasks,
    targets,
    meetings,
    performance: found.record.performance || null,
    documents,
    discipline,
    activity,
    loginSecurity: {
      lastLogin: loginHistory.filter((event) => event.status === "success").slice(-1)[0] || null,
      activeSessions: sessions,
      failedLoginAttempts: failedLogins,
      passwordLastChanged: user?.passwordChangedAt || null,
      twoFactorStatus: user?.twoFactorEnabled ? "enabled" : "disabled",
      accountStatus: user?.status || "no_account",
    },
  };
}

function updateStaff(id, payload, actor, req) {
  const found = findStaffRecord(id);
  if (!found || !found.collection) {
    return null;
  }

  const oldValue = normalizeStaffRecord(found.record, found.staffType);
  const updated = saveStaffRecord(found.collection, id, payload);
  const normalized = normalizeStaffRecord(updated, found.staffType);
  createHistoryRecord("employment_history", {
    staffId: id,
    staffType: found.staffType,
    event: "profile_updated",
    oldValue,
    newValue: normalized,
    actorId: actor?.id || null,
  });
  writeActivity({ staffId: id, staffType: found.staffType, actor, action: "Profile Updated", oldValue, newValue: normalized, req });
  return { oldValue, record: normalized };
}

function performStaffAction(id, action, payload = {}, actor, req) {
  const found = findStaffRecord(id);
  if (!found || !found.collection) {
    return null;
  }

  const oldValue = normalizeStaffRecord(found.record, found.staffType);
  let updates = {};
  let historyCollection = "employment_history";
  let historyEvent = action;

  if (["deactivate", "activate", "suspend", "terminate"].includes(action)) {
    updates.status = action === "activate" ? "active" : action === "deactivate" ? "inactive" : action === "suspend" ? "suspended" : "terminated";
    if (updates.status !== "active" && found.record.userId) {
      updateUser(found.record.userId, { status: updates.status === "suspended" ? "suspended" : "inactive" });
      revokeUserSessions(found.record.userId, actor?.id);
    }
  } else if (action === "transfer" || action === "department") {
    updates = compactObject({
      departmentId: payload.departmentId,
      department: payload.department,
      branchId: payload.branchId,
      branch: payload.branch,
      location: payload.location,
      workLocation: payload.workLocation,
    });
    historyCollection = "department_history";
    historyEvent = "department_changed";
  } else if (action === "manager") {
    updates = compactObject({ managerId: payload.managerId, manager: payload.manager, supervisorId: payload.supervisorId });
    historyCollection = "manager_history";
    historyEvent = "manager_changed";
  } else if (action === "promote") {
    updates = compactObject({
      positionId: payload.positionId,
      position: payload.position,
      jobTitle: payload.jobTitle,
      salary: payload.salary,
    });
    historyCollection = "position_history";
    historyEvent = "promoted";
    createHistoryRecord("promotion_history", {
      staffId: id,
      staffType: found.staffType,
      oldValue,
      newValue: { ...oldValue.raw, ...updates },
      actorId: actor?.id || null,
    });
  } else if (action === "role") {
    updates = compactObject({ role: payload.role, permissions: payload.permissions });
    if (found.record.userId) {
      updateUser(found.record.userId, compactObject({ role: payload.role, permissions: payload.permissions }));
    }
    historyEvent = "role_assigned";
  } else if (action === "change-salary") {
    updates = compactObject({ salary: payload.salary, salaryStructure: payload.salaryStructure });
    historyCollection = "salary_history";
    historyEvent = "salary_changed";
  } else {
    updates = { lastAction: action, lastActionPayload: payload };
  }

  const updated = saveStaffRecord(found.collection, id, updates);
  const normalized = normalizeStaffRecord(updated, found.staffType);
  createHistoryRecord(historyCollection, {
    staffId: id,
    staffType: found.staffType,
    event: historyEvent,
    oldValue,
    newValue: normalized,
    actorId: actor?.id || null,
  });
  writeActivity({ staffId: id, staffType: found.staffType, actor, action: humanize(historyEvent), oldValue, newValue: normalized, req });
  return { oldValue, record: normalized };
}

function resetStaffPassword(id, password, actor, req) {
  const found = findStaffRecord(id);
  if (!found || !found.record.userId) {
    return null;
  }

  const updatedUser = updateUserPassword(found.record.userId, hashPassword(password));
  updateUser(found.record.userId, { forcePasswordReset: true });
  revokeUserSessions(found.record.userId, actor?.id);
  writeActivity({
    staffId: id,
    staffType: found.staffType,
    actor,
    action: "Password Reset",
    newValue: { userId: found.record.userId },
    req,
  });
  return sanitizeUser(updatedUser);
}

function forceStaffLogout(id, actor, req) {
  const found = findStaffRecord(id);
  if (!found || !found.record.userId) {
    return null;
  }

  const revokedSessions = revokeUserSessions(found.record.userId, actor?.id);
  writeActivity({
    staffId: id,
    staffType: found.staffType,
    actor,
    action: "Force Logout",
    newValue: { revokedSessionCount: revokedSessions.length },
    req,
  });
  return revokedSessions;
}

function getStaffDocuments(id) {
  return readCollection("employee_documents").filter((document) => document.staffId === id || document.employeeId === id);
}

function addStaffDocument(id, payload, actor, req) {
  const found = findStaffRecord(id) || { staffType: payload.staffType || "employee" };
  const records = readCollection("employee_documents");
  const timestamp = now();
  const document = {
    id: crypto.randomUUID(),
    documentId: payload.documentId || crypto.randomUUID(),
    staffId: id,
    employeeId: payload.employeeId || (found.staffType === "employee" ? id : null),
    staffType: found.staffType,
    name: payload.name,
    type: payload.type,
    fileUrl: payload.fileUrl || payload.url,
    uploadedBy: actor?.id || null,
    uploadedDate: timestamp,
    expiryDate: payload.expiryDate || null,
    visibility: payload.visibility || "restricted",
    status: payload.status || "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  records.push(document);
  writeCollection("employee_documents", records);
  writeActivity({ staffId: id, staffType: found.staffType, actor, action: "Document Uploaded", newValue: document, req });
  return document;
}

function getStaffActivity(id, query = {}) {
  const activity = applyBasicFilters(readCollection("employee_activity_logs"), { ...query, staffId: id }, ["action", "actorEmail"]);
  return paginate(activity, query);
}

function getStaffLoginHistory(id, query = {}) {
  const found = findStaffRecord(id);
  if (!found || !found.record.userId) {
    return paginate([], query);
  }

  const history = applyBasicFilters(readCollection("login_history"), { ...query, userId: found.record.userId }, ["status", "reason"]);
  return paginate(history, query);
}

function exportStaff(query = {}, actor, req) {
  const staff = applyDirectoryFilters(listAllStaff(), query);
  const fields = [
    "employeeId",
    "fullName",
    "jobPosition",
    "department",
    "location",
    "employmentType",
    "status",
    "email",
    "manager",
    "dateJoined",
    "staffType",
  ];
  const escape = (value) => `"${String(value || "").replace(/"/g, '""')}"`;
  const csv = [fields.join(","), ...staff.map((record) => fields.map((field) => escape(record[field])).join(","))].join("\n");
  writeActivity({
    staffId: null,
    staffType: "directory",
    actor,
    action: "Exported Staff Directory",
    newValue: { filters: query, count: staff.length, format: query.format || "csv" },
    req,
  });
  return { csv, count: staff.length };
}

function previewImport(rows = []) {
  const existing = listAllStaff();
  const existingEmails = new Set(existing.map((record) => String(record.email || "").toLowerCase()).filter(Boolean));
  const existingIds = new Set(existing.map((record) => String(record.employeeId || "").toLowerCase()).filter(Boolean));

  return rows.map((row, index) => {
    const errors = [];
    if (!row.employeeId && !row.internId && !row.nyscId) {
      errors.push("Missing staff ID.");
    }
    if (!row.firstName && !row.lastName && !row.fullName && !row.name) {
      errors.push("Missing name.");
    }
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push("Invalid email.");
    }
    if (row.email && existingEmails.has(String(row.email).toLowerCase())) {
      errors.push("Duplicate email.");
    }
    if (row.employeeId && existingIds.has(String(row.employeeId).toLowerCase())) {
      errors.push("Duplicate employee ID.");
    }

    return { rowNumber: index + 1, row, valid: errors.length === 0, errors };
  });
}

async function bulkImport({ rows = [], confirm }, actor, req) {
  const preview = previewImport(rows);
  if (!confirm) {
    return { preview, imported: [], requiresConfirmation: true };
  }

  const imported = [];
  for (const item of preview.filter((entry) => entry.valid)) {
    imported.push(await createStaff(item.row, actor, req));
  }

  return { preview, imported, requiresConfirmation: false };
}

function bulkAction({ ids = [], action, payload = {}, confirmation }, actor, req) {
  if (action === "deactivate" && confirmation !== "BULK DEACTIVATE") {
    const error = new Error("Bulk deactivate requires confirmation.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return ids.map((id) => ({ id, result: performStaffAction(id, action, payload, actor, req) })).filter((item) => item.result);
}

module.exports = {
  addStaffDocument,
  bulkAction,
  bulkImport,
  createStaff,
  exportStaff,
  forceStaffLogout,
  getStaffActivity,
  getStaffDocuments,
  getStaffLoginHistory,
  getStaffProfile,
  listStaffDirectory,
  performStaffAction,
  resetStaffPassword,
  updateStaff,
  writeActivity,
};
