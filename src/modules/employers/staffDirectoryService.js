const crypto = require("crypto");
const { hashPassword } = require("../../auth/passwords");
const { revokeUserSessions } = require("../../auth/sessionStore");
const accountStore = require("../../auth/accountStore");
const { getUserById, listUsers } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { getRolePermissions, ROLE_DEFINITIONS } = require("../../constants/rbac");
const { resolveDepartment, resolveEmploymentType } = require("../lookups/catalog");
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
  return accountStore.createUser(payload);
}

function generateLoginEmail(fullName) {
  const slug = String(fullName || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40) || "user";
  return `${slug}.${crypto.randomBytes(2).toString("hex")}@afresh.local`;
}

function generateTemporaryPassword() {
  return `Temp${crypto.randomBytes(4).toString("hex")}A1!`;
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
  if (!id) {
    return null;
  }

  const requested = String(id).trim().toLowerCase();
  for (const [staffType, collection] of Object.entries(STAFF_COLLECTIONS)) {
    const record = readCollection(collection).find((candidate) => {
      if (candidate.deletedAt) {
        return false;
      }
      const email = String(candidate.email || "").toLowerCase();
      const name = String(candidate.fullName || candidate.name || "").toLowerCase();
      return (
        candidate.id === id ||
        candidate.userId === id ||
        candidate.employeeId === id ||
        email === requested ||
        name === requested
      );
    });
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
        fullName: user.fullName || user.name,
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
  const employment = body.employmentInformation || body.employment || {};
  const employmentType = resolveEmploymentType(
    employment.employmentType || body.employmentType || body.employment_type || body.staffType
  );
  const requestedStaffType = body.staffType || body.personType || body.type;
  const staffType = normalizeStaffType(requestedStaffType || employmentType.staffType);
  const personal = body.personalInformation || body.personal || {};
  const financial = body.financialInformation || body.financial || {};
  const emergencyContact = body.emergencyContact || {};
  const systemAccess = body.systemAccess || {};
  const documents = Array.isArray(body.documents) ? body.documents : [];
  const department = resolveDepartment(
    body.departmentId || body.department_id || employment.departmentId || body.department || employment.department
  );

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
      jobTitle: employment.jobTitle || body.jobTitle || body.title || body.position || body.roleTitle,
      position: employment.position || body.position || body.jobTitle || body.title,
      positionId: employment.positionId || body.positionId,
      department: department?.name || employment.department || body.department,
      departmentId: department?.id || employment.departmentId || body.departmentId,
      managerId: employment.managerId || body.managerId,
      supervisorId: employment.supervisorId || body.supervisorId,
      manager: employment.manager || body.manager || body.reportsTo || body.reports_to,
      employmentType: employmentType.label,
      employment_type: employmentType.key,
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
  const generatedPassword = !systemAccess.initialPassword && !systemAccess.password;
  const email = systemAccess.email || record.email || systemAccess.username || generateLoginEmail(record.fullName || record.name);
  const password = systemAccess.initialPassword || systemAccess.password || generateTemporaryPassword();
  const assignedRole = resolveAssignedRole(systemAccess.role || record.role || "employee");
  const permissions =
    Array.isArray(systemAccess.permissions) && systemAccess.permissions.length > 0
      ? systemAccess.permissions
      : assignedRole.permissions;

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

  record.email = record.email || email;

  const user = await createAuthUser({
    name: record.fullName || record.name,
    fullName: record.fullName || record.name,
    email,
    phone: record.phone || null,
    passwordHash: hashPassword(password),
    role: assignedRole.key,
    roleId: assignedRole.key,
    permissions,
    status: record.status || "active",
    accountType: assignedRole.key === "superadmin" ? "SUPER_ADMIN" : assignedRole.key === "admin" ? "ADMIN" : "STAFF",
    mustChangePassword:
      systemAccess.mustChangePassword !== undefined ? Boolean(systemAccess.mustChangePassword) : generatedPassword,
    department: record.department || null,
    departmentId: record.departmentId || null,
    employeeId: record.employeeId || record.id || null,
    jobTitle: record.jobTitle || record.position || null,
  });
  user.temporaryPassword = password;
  user.loginEmail = email;
  return user;
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

  return {
    ...normalizeStaffRecord(staffRecord, staffType),
    loginEmail: user?.loginEmail || staffRecord.email || null,
  };
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

function parseEmploymentDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return iso[0];
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = slash[3];
    if (first > 12) {
      return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
    }
    return `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return raw;
}

function employmentUpdatesFromPayload(payload = {}) {
  const employment = payload.employmentInformation || payload.employment || payload.employmentDetails || {};
  const department = resolveDepartment(
    payload.departmentId || payload.department_id || employment.departmentId || payload.department || employment.department
  );
  const employmentTypeValue = payload.employmentType || payload.employment_type || employment.employmentType;
  const employmentType = employmentTypeValue ? resolveEmploymentType(employmentTypeValue) : null;
  const startDate = parseEmploymentDate(
    payload.startDate || payload.start_date || payload.employmentStartDate || payload.hireDate || employment.startDate
  );
  const maybeJobTitle =
    payload.role && !ROLE_DEFINITIONS[String(payload.role).trim().toLowerCase().replace(/[\s-]+/g, "_")]
      ? payload.role
      : null;
  const jobTitle = payload.jobTitle || payload.job_title || payload.position || payload.roleTitle || employment.jobTitle || maybeJobTitle;
  const reportsTo = payload.reportsTo || payload.reports_to || payload.manager || employment.manager || employment.reportsTo;

  return compactObject({
    jobTitle,
    position: jobTitle || payload.position,
    department: department?.name || payload.department || employment.department,
    departmentId: department?.id || payload.departmentId || employment.departmentId,
    employmentType: employmentType?.label || payload.employmentType,
    employment_type: employmentType?.key || payload.employment_type,
    employmentStartDate: startDate,
    hireDate: startDate,
    startDate,
    manager: reportsTo,
    reportsTo,
    phone: payload.phone,
    fullName: payload.fullName || payload.name || payload.displayName,
    name: payload.fullName || payload.name || payload.displayName,
  });
}

function updateStaff(id, payload, actor, req) {
  let found = findStaffRecord(id);
  if (!found) {
    return null;
  }

  const updates = employmentUpdatesFromPayload(payload);
  if (!found.collection) {
    const collection = getCollectionForStaffType(found.staffType === "admin" || found.staffType === "manager" ? "employee" : found.staffType);
    const timestamp = now();
    const created = {
      id: crypto.randomUUID(),
      ...found.record,
      ...updates,
      userId: found.record.userId || found.record.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const records = readCollection(collection);
    records.push(created);
    writeCollection(collection, records);
    found = { staffType: "employee", collection, record: created };
    id = created.id;
  }

  const oldValue = normalizeStaffRecord(found.record, found.staffType);
  const updated = saveStaffRecord(found.collection, found.record.id, updates);
  const normalized = normalizeStaffRecord(updated, found.staffType);
  createHistoryRecord("employment_history", {
    staffId: found.record.id,
    staffType: found.staffType,
    event: "profile_updated",
    oldValue,
    newValue: normalized,
    actorId: actor?.id || null,
  });
  writeActivity({ staffId: found.record.id, staffType: found.staffType, actor, action: "Profile Updated", oldValue, newValue: normalized, req });
  return { oldValue, record: normalized };
}

async function performStaffAction(id, action, payload = {}, actor, req) {
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
      await accountStore.updateUser(found.record.userId, { status: updates.status === "suspended" ? "suspended" : "inactive" });
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
      await accountStore.updateUser(found.record.userId, compactObject({ role: payload.role, permissions: payload.permissions }));
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

async function resetStaffPassword(id, password, actor, req) {
  const found = findStaffRecord(id);
  if (!found || !found.record.userId) {
    return null;
  }

  const updatedUser = await accountStore.updateUserPassword(found.record.userId, hashPassword(password));
  await accountStore.updateUser(found.record.userId, { forcePasswordReset: true, mustChangePassword: true });
  revokeUserSessions(found.record.userId, actor?.id);
  writeActivity({
    staffId: id,
    staffType: found.staffType,
    actor,
    action: "Password Reset",
    newValue: { userId: found.record.userId },
    req,
  });
  return accountStore.sanitizeUser(updatedUser);
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

async function bulkAction({ ids = [], action, payload = {}, confirmation }, actor, req) {
  if (action === "deactivate" && confirmation !== "BULK DEACTIVATE") {
    const error = new Error("Bulk deactivate requires confirmation.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const results = await Promise.all(ids.map(async (id) => ({ id, result: await performStaffAction(id, action, payload, actor, req) })));
  return results.filter((item) => item.result);
}

function upsertStaffEmploymentForUser(user, payload, req) {
  if (!user?.id) {
    return null;
  }
  const found = findStaffRecord(user.id) || findStaffRecord(user.email);
  return updateStaff(found?.record?.id || user.id, payload, user, req);
}

async function listHodOptions() {
  const seen = new Set();
  const options = [];
  const inactive = new Set(["inactive", "suspended", "terminated", "deleted", "resigned", "retired"]);

  function addCandidate(record) {
    const fullName = record.fullName || record.name || null;
    const status = String(record.status || "active").toLowerCase();
    const keys = [record.id, record.userId, record.email].filter(Boolean).map((value) => String(value).toLowerCase());
    if (!fullName || inactive.has(status) || keys.some((key) => seen.has(key))) {
      return;
    }
    keys.forEach((key) => seen.add(key));
    options.push({
      id: record.id,
      userId: record.userId || record.id || null,
      name: fullName,
      fullName,
      label: fullName,
      email: record.email || null,
      department: record.department || null,
      jobPosition: record.jobPosition || record.jobTitle || null,
      role: record.role || null,
      staffType: record.staffType || null,
    });
  }

  for (const record of listAllStaff()) {
    addCandidate(record);
  }
  for (const user of await accountStore.listUsers()) {
    addCandidate({
      id: user.id,
      userId: user.id,
      fullName: user.fullName || user.name,
      email: user.email,
      department: user.department,
      jobTitle: user.jobTitle,
      role: user.role,
      staffType: user.role,
      status: user.status,
    });
  }

  return options.sort((left, right) => String(left.fullName).localeCompare(String(right.fullName)));
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
  listHodOptions,
  listStaffDirectory,
  performStaffAction,
  resetStaffPassword,
  updateStaff,
  upsertStaffEmploymentForUser,
  writeActivity,
};
