const crypto = require("crypto");
const { hasPermission } = require("../../constants/rbac");
const { paginate } = require("../../utils/query");
const {
  ATTENDANCE_STATUS,
  EXIT_TYPE,
  NYSC_INTERN_PERMISSIONS,
  PLACEMENT_STATUS,
  PROFILE_TYPE,
  REVIEW_PERIOD,
  REVIEW_RECOMMENDATION,
} = require("./constants");
const repository = require("./nyscIntern.repository");

const ENDING_SOON_DAYS = Number(process.env.PLACEMENT_ENDING_SOON_DAYS || 30);

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function assertPermission(user, permission) {
  if (!can(user, permission)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return new Date().toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : raw;
  }
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const iso = `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : iso;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function assertDate(value, code, message) {
  const iso = parseDateInput(value);
  if (!iso) {
    throw createHttpError(400, message, code);
  }
  return iso;
}

function dateDiffDays(start, end) {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.ceil((endMs - startMs) / 86400000);
}

function calculateProgress(placement) {
  const startDate = placement.startDate;
  const endDate = placement.expectedEndDate || placement.endDate;
  const totalDays = Math.max(1, dateDiffDays(startDate, endDate) + 1);
  const elapsedRaw = dateDiffDays(startDate, today()) + 1;
  const daysElapsed = Math.min(totalDays, Math.max(0, elapsedRaw));
  const daysRemaining = Math.max(0, dateDiffDays(today(), endDate));
  return {
    startDate,
    endDate,
    daysElapsed,
    daysRemaining,
    totalDays,
    progressPercentage: Number(((daysElapsed / totalDays) * 100).toFixed(2)),
    manualProgress: placement.manualProgress ?? null,
    completionProgress: placement.manualProgress ?? Number(((daysElapsed / totalDays) * 100).toFixed(2)),
  };
}

function derivePlacementStatus(placement) {
  if ([PLACEMENT_STATUS.COMPLETED, PLACEMENT_STATUS.EXITED, PLACEMENT_STATUS.TERMINATED, PLACEMENT_STATUS.CANCELLED].includes(placement.placementStatus)) {
    return placement.placementStatus;
  }
  const start = placement.startDate;
  const end = placement.expectedEndDate || placement.endDate;
  if (today() < start) {
    return PLACEMENT_STATUS.PENDING;
  }
  const remaining = dateDiffDays(today(), end);
  if (remaining <= ENDING_SOON_DAYS) {
    return PLACEMENT_STATUS.ENDING_SOON;
  }
  return PLACEMENT_STATUS.ACTIVE;
}

function buildProfileNumber(type) {
  const year = new Date().getUTCFullYear();
  const prefix = type === PROFILE_TYPE.NYSC ? "NYSC" : "INT";
  const count = repository.listAllProfiles({ type }).filter((profile) => String(profile.profileNumber || "").startsWith(`${prefix}-${year}-`)).length + 1;
  return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
}

function recordHistory({ placementId, actor, eventType, description, oldStatus, newStatus, metadata }) {
  return repository.createHistory({
    placementId,
    actorId: actor?.id || null,
    eventType,
    description: description || null,
    oldStatus: oldStatus || null,
    newStatus: newStatus || null,
    metadata: metadata || {},
  });
}

function notify({ profile, placement, type, title, body }) {
  return repository.createNotification({
    recipientUserId: profile.userId || null,
    recipientEmployeeId: null,
    type,
    title,
    body,
    entityType: "PLACEMENT",
    entityId: placement.id,
    status: "queued",
    isRead: false,
    data: { profileId: profile.id, placementId: placement.id, profileNumber: profile.profileNumber },
  });
}

function validateDepartment(idOrName) {
  const { resolveDepartment } = require("../lookups/catalog");
  const department = resolveDepartment(idOrName) || repository.findDepartment(idOrName);
  if (!department || !["active", "ACTIVE"].includes(String(department.status || "active"))) {
    throw createHttpError(404, "Department was not found or is inactive. Choose a department from the list.", "DEPARTMENT_NOT_FOUND");
  }
  return department;
}

function assertPlacementAccess(user, profile, placement) {
  if (can(user, NYSC_INTERN_PERMISSIONS.VIEW_ALL)) {
    return;
  }
  if (profile.userId && profile.userId === user?.id) {
    return;
  }
  const supervisor = repository.currentSupervisor(placement.id);
  const actorEmployee = repository.findEmployeeByUserId(user?.id);
  if (actorEmployee && supervisor?.employeeId === actorEmployee.id) {
    return;
  }
  throw createHttpError(403, "Forbidden.", "FORBIDDEN");
}

function decorateProfile(profile, user, detail = false) {
  const placement = repository.findPlacementByProfile(profile.id);
  const derivedPlacement = placement
    ? {
        ...placement,
        placementStatus: derivePlacementStatus(placement),
        placementProgress: calculateProgress(placement).progressPercentage,
        progress: calculateProgress(placement),
      }
    : null;
  const department = derivedPlacement?.departmentId ? repository.findDepartment(derivedPlacement.departmentId) : null;
  const supervisorLink = derivedPlacement ? repository.currentSupervisor(derivedPlacement.id) : null;
  const supervisor = supervisorLink ? repository.findEmployee(supervisorLink.employeeId) : null;
  const base = {
    profile,
    placement: derivedPlacement,
    department,
    supervisor: supervisor ? { ...supervisor, assignment: supervisorLink } : null,
  };
  if (!detail || !derivedPlacement) {
    return base;
  }
  return {
    ...base,
    attendance: repository.listAttendance(derivedPlacement.id),
    tasks: repository.listTasks(profile.id, derivedPlacement.id),
    targets: repository.listTargets(profile.id, derivedPlacement.id),
    reviews: repository.listReviews(derivedPlacement.id),
    documents: repository.listDocuments(profile.id, derivedPlacement.id),
    history: repository.listHistory(derivedPlacement.id),
    exit: repository.findExitRecord(derivedPlacement.id),
  };
}

function ensureNoActiveDuplicate({ fullName, email, type }) {
  const duplicate = repository.listAllProfiles({ type }).find((profile) => {
    const samePerson =
      String(profile.email || "").toLowerCase() === String(email || "").toLowerCase() ||
      String(profile.fullName || "").toLowerCase() === String(fullName || "").toLowerCase();
    if (!samePerson) {
      return false;
    }
    const placement = repository.findPlacementByProfile(profile.id);
    return placement && ![PLACEMENT_STATUS.COMPLETED, PLACEMENT_STATUS.EXITED, PLACEMENT_STATUS.TERMINATED, PLACEMENT_STATUS.CANCELLED].includes(placement.placementStatus);
  });
  if (duplicate) {
    throw createHttpError(409, "This person already has an active placement.", "ACTIVE_PLACEMENT_EXISTS");
  }
}

function createLegacyMirror(profile, placement) {
  const collection = profile.type === PROFILE_TYPE.NYSC ? "nysc_members" : "interns";
  const payload = {
    id: profile.id,
    name: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    institution: profile.institution,
    course: profile.courseOfStudy,
    departmentId: placement.departmentId,
    supervisorId: placement.supervisorEmployeeId || null,
    startDate: placement.startDate,
    endDate: placement.expectedEndDate,
    status: placement.placementStatus.toLowerCase(),
    profileId: profile.id,
    placementId: placement.id,
  };
  if (profile.type === PROFILE_TYPE.NYSC) {
    payload.nyscId = profile.profileNumber;
    payload.nysc_id = profile.profileNumber;
    payload.stateCode = profile.stateCode || null;
    payload.callUpNumber = profile.callUpNumber || null;
  } else {
    payload.internId = profile.profileNumber;
    payload.intern_id = profile.profileNumber;
  }
  return repository.createLegacyMember(collection, payload);
}

function generateLoginEmail(fullName) {
  const slug = String(fullName || "intern")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40) || "intern";
  return `${slug}.${crypto.randomBytes(2).toString("hex")}@afresh.local`;
}

async function provisionPlacementLogin(profile, payload, user) {
  const { generateFirstNameTemporaryPassword, hashPassword } = require("../../auth/passwords");
  const accountStore = require("../../auth/accountStore");
  const { ROLE_DEFINITIONS } = require("../../constants/rbac");
  const email = String(payload.email || profile.email || "").trim().toLowerCase() || generateLoginEmail(profile.fullName);
  const existing = await accountStore.getUserByEmail(email);
  if (existing) {
    if (!profile.userId) {
      repository.updateProfile(profile.id, { userId: existing.id, email: profile.email || email });
    }
    return {
      profile: repository.findProfile(profile.id) || profile,
      temporaryPassword: null,
      loginEmail: email,
    };
  }

  const roleKey = profile.type === PROFILE_TYPE.INTERN ? "intern" : "nysc_intern";
  const role = ROLE_DEFINITIONS[roleKey] || ROLE_DEFINITIONS.intern;
  const temporaryPassword = generateFirstNameTemporaryPassword({
    firstName: payload.firstName || payload.first_name,
    fullName: profile.fullName,
    name: profile.fullName,
  });
  const created = await accountStore.createUser({
    name: profile.fullName,
    fullName: profile.fullName,
    email,
    phone: profile.phone,
    passwordHash: hashPassword(temporaryPassword),
    role: role.key,
    roleId: role.key,
    permissions: role.permissions,
    status: "active",
    accountType: "STAFF",
    departmentId: payload.departmentId || payload.department_id || null,
    createdBy: user?.id || null,
    mustChangePassword: true,
  });
  const updated = repository.updateProfile(profile.id, {
    userId: created.id,
    email: profile.email || email,
  });
  return {
    profile: updated || profile,
    temporaryPassword,
    loginEmail: email,
  };
}

function credentialsFor(result) {
  return {
    data: {
      ...result.record,
      temporaryPassword: result.temporaryPassword || null,
      loginEmail: result.loginEmail || null,
    },
    meta: {
      temporaryPassword: result.temporaryPassword || null,
      loginEmail: result.loginEmail || null,
      mustChangePassword: Boolean(result.temporaryPassword),
    },
  };
}

async function createProfile(payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.CREATE);
  const fullName = payload.fullName || payload.full_name || payload.name;
  const type = normalizeEnum(payload.type || payload.staffType || payload.staff_type, Object.values(PROFILE_TYPE), PROFILE_TYPE.NYSC);
  if (!fullName) {
    throw createHttpError(400, "Full name is required.", "FULL_NAME_REQUIRED");
  }
  if (!type) {
    throw createHttpError(400, "Type must be NYSC or INTERN.", "INVALID_PROFILE_TYPE");
  }
  const institution = payload.institution || (type === PROFILE_TYPE.NYSC ? "NYSC" : "Internship");
  const courseOfStudy = payload.courseOfStudy || payload.course_of_study || payload.course || "Not specified";
  const startDate = assertDate(payload.startDate || payload.start_date, "START_DATE_REQUIRED", "Start date is required.");
  const endDate = assertDate(payload.endDate || payload.end_date, "END_DATE_REQUIRED", "End date is required.");
  if (endDate <= startDate) {
    throw createHttpError(400, "End date must be after start date.", "INVALID_PLACEMENT_DATES");
  }
  const actorEmployee = repository.findEmployeeByUserId(user?.id);
  const departmentCandidates = [
    payload.departmentId,
    payload.department_id,
    payload.department,
    actorEmployee?.departmentId,
    actorEmployee?.department_id,
    actorEmployee?.department,
    user?.departmentId,
    user?.department_id,
    user?.department,
    "Administration",
  ].filter(Boolean);
  let department = null;
  for (const candidate of departmentCandidates) {
    try {
      department = validateDepartment(candidate);
      break;
    } catch (error) {
      if (error.code !== "DEPARTMENT_NOT_FOUND") {
        throw error;
      }
    }
  }
  if (!department) {
    const { listDepartmentOptions } = require("../lookups/catalog");
    const firstDepartment = listDepartmentOptions()[0];
    department = firstDepartment ? validateDepartment(firstDepartment.id) : null;
  }
  if (!department) {
    throw createHttpError(404, "Department was not found or is inactive. Choose a department from the list.", "DEPARTMENT_NOT_FOUND");
  }
  const supervisorValue =
    payload.supervisorEmployeeId ||
    payload.supervisor_employee_id ||
    payload.supervisorId ||
    payload.supervisor_id ||
    payload.supervisor;
  const supervisor =
    supervisorValue && typeof supervisorValue === "object"
      ? repository.findEmployee(supervisorValue.id || supervisorValue.employeeId || supervisorValue.employee_id || supervisorValue.name || supervisorValue.fullName)
      : supervisorValue
        ? repository.findEmployee(supervisorValue)
        : null;
  if (supervisorValue && (!supervisor || !["active", "ACTIVE"].includes(String(supervisor.status || "active")))) {
    throw createHttpError(404, "Supervisor employee was not found or is inactive. Use a real employee ID from the directory.", "SUPERVISOR_NOT_FOUND");
  }
  const supervisorId = supervisor?.id || null;
  ensureNoActiveDuplicate({ fullName, email: payload.email, type });
  const profile = repository.createProfile({
    profileNumber: buildProfileNumber(type),
    profile_number: null,
    userId: payload.userId || payload.user_id || null,
    fullName,
    full_name: fullName,
    type,
    email: payload.email || null,
    phone: payload.phone || null,
    gender: payload.gender || null,
    dateOfBirth: payload.dateOfBirth || payload.date_of_birth || null,
    institution,
    courseOfStudy,
    course_of_study: courseOfStudy,
    matricNumber: payload.matricNumber || payload.matric_number || null,
    stateOfOrigin: payload.stateOfOrigin || payload.state_of_origin || null,
    stateOfResidence: payload.stateOfResidence || payload.state_of_residence || null,
    address: payload.address || null,
    emergencyContactName: payload.emergencyContactName || payload.emergency_contact_name || null,
    emergencyContactPhone: payload.emergencyContactPhone || payload.emergency_contact_phone || null,
    status: "ACTIVE",
    createdBy: user.id,
  });
  const placement = repository.createPlacement({
    profileId: profile.id,
    departmentId: department.id,
    departmentName: department.name,
    supervisorId: null,
    supervisorEmployeeId: null,
    startDate,
    expectedEndDate: endDate,
    actualEndDate: null,
    placementStatus: derivePlacementStatus({ startDate, expectedEndDate: endDate, placementStatus: null }),
    placementProgress: 0,
    role: payload.role || (type === PROFILE_TYPE.NYSC ? "NYSC Member" : "Intern"),
    description: payload.description || null,
    workLocation: payload.workLocation || payload.work_location || payload.location || null,
    createdBy: user.id,
  });
  createLegacyMirror(profile, placement);
  recordHistory({ placementId: placement.id, actor: user, eventType: "PLACEMENT_CREATED", oldStatus: null, newStatus: placement.placementStatus });
  notify({ profile, placement, type: "PLACEMENT_CREATED", title: "Placement created", body: `${profile.fullName}'s placement has been created.` });
  if (supervisorId) {
    assignSupervisor(profile.id, { employeeId: supervisorId }, user);
  }
  let provisioned = {
    profile,
    temporaryPassword: null,
    loginEmail: payload.email || profile.email || null,
  };
  try {
    provisioned = await provisionPlacementLogin(profile, payload, user);
  } catch {
    /* Keep the placement even if login provisioning fails. */
  }
  return {
    record: decorateProfile(provisioned.profile, user, true),
    temporaryPassword: provisioned.temporaryPassword,
    loginEmail: provisioned.loginEmail,
  };
}

function listProfiles(user, query = {}) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW);
  let profiles = repository.listAllProfiles(query);
  if (!can(user, NYSC_INTERN_PERMISSIONS.VIEW_ALL)) {
    const actorEmployee = repository.findEmployeeByUserId(user.id);
    const departmentId = actorEmployee?.departmentId || actorEmployee?.department_id || user.departmentId || user.department_id;
    profiles = profiles.filter((profile) => {
      if (profile.userId === user.id || profile.createdBy === user.id) {
        return true;
      }
      const placement = repository.findPlacementByProfile(profile.id);
      const supervisor = placement ? repository.currentSupervisor(placement.id) : null;
      if (actorEmployee && supervisor?.employeeId === actorEmployee.id) {
        return true;
      }
      return Boolean(departmentId && placement && String(placement.departmentId) === String(departmentId));
    });
  }
  return paginate(profiles.map((profile) => decorateProfile(profile, user)), query);
}

function getDetails(id, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW);
  const profile = repository.findProfile(id);
  if (!profile) {
    throw createHttpError(404, "NYSC/intern profile was not found.", "PROFILE_NOT_FOUND");
  }
  const placement = repository.findPlacementByProfile(profile.id);
  assertPlacementAccess(user, profile, placement);
  return decorateProfile(profile, user, true);
}

function updateProfile(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.UPDATE);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  assertPlacementAccess(user, profile, placement);
  const updated = repository.updateProfile(id, {
    fullName: payload.fullName || payload.full_name || profile.fullName,
    full_name: payload.fullName || payload.full_name || profile.fullName,
    email: payload.email ?? profile.email,
    phone: payload.phone ?? profile.phone,
    institution: payload.institution ?? profile.institution,
    courseOfStudy: payload.courseOfStudy || payload.course_of_study || profile.courseOfStudy,
    course_of_study: payload.courseOfStudy || payload.course_of_study || profile.courseOfStudy,
    address: payload.address ?? profile.address,
  });
  recordHistory({ placementId: placement.id, actor: user, eventType: "PROFILE_UPDATED", oldStatus: placement.placementStatus, newStatus: placement.placementStatus, metadata: { payload } });
  return { oldValues: profile, record: decorateProfile(updated, user, true) };
}

function assignSupervisor(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.ASSIGN_SUPERVISOR);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const employee = repository.findEmployee(payload.employeeId || payload.employee_id);
  if (!employee || !["active", "ACTIVE"].includes(String(employee.status || "active"))) {
    throw createHttpError(404, "Supervisor employee was not found or is inactive.", "SUPERVISOR_NOT_FOUND");
  }
  const current = repository.currentSupervisor(placement.id);
  if (current) {
    repository.updateSupervisor(current.id, { isActive: false, removedAt: now() });
  }
  const supervisor = repository.createSupervisor({
    placementId: placement.id,
    employeeId: employee.id,
    assignedBy: user.id,
    assignedAt: now(),
    removedAt: null,
    isActive: true,
  });
  const updatedPlacement = repository.updatePlacement(placement.id, {
    supervisorId: employee.userId || employee.user_id || null,
    supervisorEmployeeId: employee.id,
    supervisorName: employee.fullName || employee.name,
  });
  recordHistory({ placementId: placement.id, actor: user, eventType: current ? "SUPERVISOR_CHANGED" : "SUPERVISOR_ASSIGNED", oldStatus: placement.placementStatus, newStatus: updatedPlacement.placementStatus, metadata: { supervisorId: employee.id } });
  notify({ profile, placement: updatedPlacement, type: "SUPERVISOR_ASSIGNED", title: "Supervisor assigned", body: `${employee.fullName || employee.name} has been assigned as supervisor.` });
  return { oldValues: current, record: { ...supervisor, placement: updatedPlacement } };
}

function changeDepartment(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.MANAGE_PLACEMENT);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const department = validateDepartment(payload.departmentId || payload.department_id);
  const updated = repository.updatePlacement(placement.id, { departmentId: department.id, departmentName: department.name });
  recordHistory({ placementId: placement.id, actor: user, eventType: "DEPARTMENT_CHANGED", oldStatus: placement.placementStatus, newStatus: updated.placementStatus, metadata: { oldDepartmentId: placement.departmentId, departmentId: department.id } });
  return { oldValues: placement, record: decorateProfile(profile, user, true) };
}

function extendPlacement(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.EXTEND);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const newEndDate = assertDate(payload.newEndDate || payload.new_end_date, "NEW_END_DATE_REQUIRED", "New end date is required.");
  if (newEndDate <= placement.expectedEndDate) {
    throw createHttpError(400, "New end date must be after the current end date.", "INVALID_EXTENSION_DATE");
  }
  const updated = repository.updatePlacement(placement.id, { expectedEndDate: newEndDate, extensionReason: payload.reason || null, placementStatus: derivePlacementStatus({ ...placement, expectedEndDate: newEndDate }) });
  recordHistory({ placementId: placement.id, actor: user, eventType: "PLACEMENT_EXTENDED", description: payload.reason, oldStatus: placement.placementStatus, newStatus: updated.placementStatus, metadata: { oldEndDate: placement.expectedEndDate, newEndDate } });
  notify({ profile, placement: updated, type: "PLACEMENT_EXTENDED", title: "Placement extended", body: `${profile.fullName}'s placement has been extended.` });
  return { oldValues: placement, record: decorateProfile(profile, user, true) };
}

function processExit(id, payload, user, forcedType) {
  assertPermission(user, forcedType === EXIT_TYPE.TERMINATED ? NYSC_INTERN_PERMISSIONS.TERMINATE : NYSC_INTERN_PERMISSIONS.MANAGE_EXIT);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const exitType = forcedType || normalizeEnum(payload.exitType || payload.exit_type, Object.values(EXIT_TYPE), null);
  if (!exitType) {
    throw createHttpError(400, "Valid exit type is required.", "INVALID_EXIT_TYPE");
  }
  const exitDate = assertDate(payload.exitDate || payload.exit_date || today(), "EXIT_DATE_REQUIRED", "Exit date is required.");
  const status = exitType === EXIT_TYPE.COMPLETED ? PLACEMENT_STATUS.COMPLETED : exitType === EXIT_TYPE.TERMINATED ? PLACEMENT_STATUS.TERMINATED : PLACEMENT_STATUS.EXITED;
  const exit = repository.createExitRecord({
    placementId: placement.id,
    exitType,
    exitDate,
    reason: payload.reason || null,
    finalReviewId: payload.finalReviewId || payload.final_review_id || null,
    exitInterview: payload.exitInterview || payload.exit_interview || null,
    certificateIssued: Boolean(payload.certificateIssued || payload.certificate_issued),
    certificateNumber: payload.certificateIssued || payload.certificate_issued ? `CERT-${new Date().getUTCFullYear()}-${String(repository.listPlacements({}).length).padStart(4, "0")}` : null,
    certificateUrl: payload.certificateUrl || payload.certificate_url || null,
    eligibleForEmployment: Boolean(payload.eligibleForEmployment || payload.eligible_for_employment),
    processedBy: user.id,
  });
  const updated = repository.updatePlacement(placement.id, { placementStatus: status, actualEndDate: exitDate, placementProgress: 100 });
  repository.updateProfile(profile.id, { status });
  recordHistory({ placementId: placement.id, actor: user, eventType: status === PLACEMENT_STATUS.COMPLETED ? "PLACEMENT_COMPLETED" : status === PLACEMENT_STATUS.TERMINATED ? "PLACEMENT_TERMINATED" : "PLACEMENT_ENDED", description: payload.reason, oldStatus: placement.placementStatus, newStatus: status, metadata: { exitId: exit.id } });
  return { oldValues: placement, record: { ...exit, placement: updated } };
}

function completePlacement(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.COMPLETE);
  return processExit(id, { ...payload, exitType: EXIT_TYPE.COMPLETED }, user, EXIT_TYPE.COMPLETED);
}

function terminatePlacement(id, payload, user) {
  return processExit(id, { ...payload, exitType: EXIT_TYPE.TERMINATED }, user, EXIT_TYPE.TERMINATED);
}

function addDocument(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.MANAGE_DOCUMENTS);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  if (!payload.fileName && !payload.name) {
    throw createHttpError(400, "Document file name is required.", "DOCUMENT_NAME_REQUIRED");
  }
  if (!payload.fileUrl && !payload.url) {
    throw createHttpError(400, "Document URL is required.", "DOCUMENT_URL_REQUIRED");
  }
  const document = repository.createDocument({
    profileId: profile.id,
    placementId: placement.id,
    documentType: payload.documentType || payload.document_type || "OTHER",
    fileName: payload.fileName || payload.name,
    fileUrl: payload.fileUrl || payload.url,
    fileType: payload.fileType || payload.type || null,
    fileSize: Number(payload.fileSize || payload.size || 0),
    uploadedBy: user.id,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
  });
  recordHistory({ placementId: placement.id, actor: user, eventType: "DOCUMENT_ADDED", oldStatus: placement.placementStatus, newStatus: placement.placementStatus, metadata: { documentId: document.id } });
  return document;
}

function listDocuments(id, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW_DOCUMENTS);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  assertPlacementAccess(user, profile, placement);
  return repository.listDocuments(profile.id, placement.id);
}

function downloadDocument(documentId, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW_DOCUMENTS);
  const document = repository.findDocument(documentId);
  if (!document) {
    return null;
  }
  const profile = repository.findProfile(document.profileId);
  const placement = repository.findPlacement(document.placementId);
  assertPlacementAccess(user, profile, placement);
  repository.updateDocument(documentId, { lastViewedBy: user.id, lastViewedAt: now() });
  recordHistory({ placementId: placement.id, actor: user, eventType: "DOCUMENT_VIEWED", oldStatus: placement.placementStatus, newStatus: placement.placementStatus, metadata: { documentId } });
  return { ...document, downloadUrl: document.fileUrl };
}

function addAttendance(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.MANAGE_ATTENDANCE);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const date = assertDate(payload.date || today(), "ATTENDANCE_DATE_REQUIRED", "Attendance date is required.");
  if (repository.findAttendanceByDate(placement.id, date)) {
    throw createHttpError(409, "Attendance has already been recorded for this placement and date.", "DUPLICATE_ATTENDANCE");
  }
  const attendance = repository.createAttendance({
    placementId: placement.id,
    date,
    checkIn: payload.checkIn || payload.check_in || null,
    checkOut: payload.checkOut || payload.check_out || null,
    status: normalizeEnum(payload.status, Object.values(ATTENDANCE_STATUS), ATTENDANCE_STATUS.PRESENT),
    notes: payload.notes || null,
    approvedBy: payload.approvedBy || payload.approved_by || user.id,
  });
  recordHistory({ placementId: placement.id, actor: user, eventType: "ATTENDANCE_UPDATED", oldStatus: placement.placementStatus, newStatus: placement.placementStatus, metadata: { attendanceId: attendance.id } });
  return attendance;
}

function updateAttendance(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.MANAGE_ATTENDANCE);
  const attendance = repository.findAttendance(id);
  if (!attendance) {
    return null;
  }
  const updated = repository.updateAttendance(id, {
    checkIn: payload.checkIn || payload.check_in || attendance.checkIn,
    checkOut: payload.checkOut || payload.check_out || attendance.checkOut,
    status: payload.status ? normalizeEnum(payload.status, Object.values(ATTENDANCE_STATUS), attendance.status) : attendance.status,
    notes: payload.notes ?? attendance.notes,
    approvedBy: user.id,
  });
  recordHistory({ placementId: attendance.placementId, actor: user, eventType: "ATTENDANCE_UPDATED", oldStatus: null, newStatus: null, metadata: { attendanceId: id } });
  return { oldValues: attendance, record: updated };
}

function listAttendance(id, user, query = {}) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  assertPlacementAccess(user, profile, placement);
  return paginate(repository.listAttendance(placement.id, query), query);
}

function addReview(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.MANAGE_REVIEWS);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const scores = ["attendanceScore", "performanceScore", "teamworkScore", "communicationScore", "technicalScore"].reduce((result, key) => {
    result[key] = Number(payload[key] || payload[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] || 0);
    return result;
  }, {});
  const overallScore = Number((Object.values(scores).reduce((total, score) => total + score, 0) / 5).toFixed(2));
  const review = repository.createReview({
    placementId: placement.id,
    reviewerId: user.id,
    reviewPeriod: normalizeEnum(payload.reviewPeriod || payload.review_period, Object.values(REVIEW_PERIOD), REVIEW_PERIOD.MONTHLY),
    ...scores,
    overallScore,
    strengths: payload.strengths || null,
    weaknesses: payload.weaknesses || null,
    comments: payload.comments || null,
    recommendation: normalizeEnum(payload.recommendation, Object.values(REVIEW_RECOMMENDATION), REVIEW_RECOMMENDATION.CONTINUE),
  });
  recordHistory({ placementId: placement.id, actor: user, eventType: "REVIEW_COMPLETED", oldStatus: placement.placementStatus, newStatus: placement.placementStatus, metadata: { reviewId: review.id, overallScore } });
  return review;
}

function listReviews(id, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW_REVIEWS);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  assertPlacementAccess(user, profile, placement);
  return repository.listReviews(placement.id);
}

function listTasks(id, user) {
  const details = getDetails(id, user);
  return details.tasks;
}

function listTargets(id, user) {
  const details = getDetails(id, user);
  return details.targets;
}

function listHistory(id, user) {
  const details = getDetails(id, user);
  return details.history;
}

function convertToEmployee(id, payload, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.CONVERT_EMPLOYEE);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const employee = repository.createEmployee({
    employeeId: payload.employeeId || `EMP-${String(repository.listAllProfiles({}).length).padStart(4, "0")}`,
    fullName: profile.fullName,
    name: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    departmentId: placement.departmentId,
    department: placement.departmentName,
    jobTitle: payload.jobTitle || payload.job_title || placement.role,
    employmentType: payload.employmentType || "Full-time",
    status: "active",
    convertedFromProfileId: profile.id,
    convertedFromPlacementId: placement.id,
    createdBy: user.id,
  });
  const updated = repository.updatePlacement(placement.id, { convertedEmployeeId: employee.id, placementStatus: PLACEMENT_STATUS.COMPLETED, actualEndDate: payload.conversionDate || today() });
  repository.updateProfile(profile.id, { status: PLACEMENT_STATUS.COMPLETED });
  recordHistory({ placementId: placement.id, actor: user, eventType: "EMPLOYEE_CONVERSION", oldStatus: placement.placementStatus, newStatus: updated.placementStatus, metadata: { employeeId: employee.id } });
  return { oldValues: placement, record: employee, meta: { placement: updated } };
}

function removeProfile(id, user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.DELETE);
  const profile = repository.findProfile(id);
  if (!profile) {
    return null;
  }
  const placement = repository.findPlacementByProfile(id);
  const updated = repository.updatePlacement(placement.id, { placementStatus: PLACEMENT_STATUS.CANCELLED, deletedAt: now() });
  repository.updateProfile(id, { status: PLACEMENT_STATUS.CANCELLED, deletedAt: now() });
  recordHistory({ placementId: placement.id, actor: user, eventType: "PLACEMENT_CANCELLED", oldStatus: placement.placementStatus, newStatus: PLACEMENT_STATUS.CANCELLED });
  return { oldValues: profile, record: { ...profile, status: PLACEMENT_STATUS.CANCELLED, placement: updated } };
}

function getDashboard(user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW);
  const profiles = repository.listAllProfiles({});
  const decorated = profiles.map((profile) => decorateProfile(profile, user));
  const active = decorated.filter((item) => [PLACEMENT_STATUS.ACTIVE, PLACEMENT_STATUS.ENDING_SOON].includes(item.placement?.placementStatus));
  const completed = decorated.filter((item) => item.placement?.placementStatus === PLACEMENT_STATUS.COMPLETED);
  const exited = decorated.filter((item) => [PLACEMENT_STATUS.EXITED, PLACEMENT_STATUS.TERMINATED].includes(item.placement?.placementStatus));
  return {
    activeMembers: active.length,
    activeNYSC: active.filter((item) => item.profile.type === PROFILE_TYPE.NYSC).length,
    activeInterns: active.filter((item) => item.profile.type === PROFILE_TYPE.INTERN).length,
    endingSoon: decorated.filter((item) => item.placement?.placementStatus === PLACEMENT_STATUS.ENDING_SOON).length,
    completed: completed.length,
    exited: exited.length,
    totalPlacements: decorated.length,
  };
}

function getSummary(user) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.VIEW);
  const items = repository.listAllProfiles({}).map((profile) => decorateProfile(profile, user));
  const departments = new Map();
  const institutions = new Map();
  const courses = new Map();
  let progressTotal = 0;
  let performanceTotal = 0;
  let performanceCount = 0;
  for (const item of items) {
    const departmentKey = item.department?.id || "unassigned";
    const department = departments.get(departmentKey) || { id: item.department?.id || null, name: item.department?.name || "Unassigned", nysc: 0, interns: 0, total: 0 };
    department[item.profile.type === PROFILE_TYPE.NYSC ? "nysc" : "interns"] += 1;
    department.total += 1;
    departments.set(departmentKey, department);
    institutions.set(item.profile.institution, (institutions.get(item.profile.institution) || 0) + 1);
    courses.set(item.profile.courseOfStudy, (courses.get(item.profile.courseOfStudy) || 0) + 1);
    progressTotal += Number(item.placement?.progress?.progressPercentage || 0);
    const reviews = item.placement ? repository.listReviews(item.placement.id) : [];
    for (const review of reviews) {
      performanceTotal += Number(review.overallScore || 0);
      performanceCount += 1;
    }
  }
  return {
    ...getDashboard(user),
    departments: [...departments.values()],
    membersByInstitution: Object.fromEntries(institutions),
    membersByCourse: Object.fromEntries(courses),
    averagePlacementProgress: items.length ? Number((progressTotal / items.length).toFixed(2)) : 0,
    averagePerformance: performanceCount ? Number((performanceTotal / performanceCount).toFixed(2)) : 0,
  };
}

function exportProfiles(user, query = {}) {
  assertPermission(user, NYSC_INTERN_PERMISSIONS.EXPORT);
  const items = repository.listAllProfiles(query).map((profile) => decorateProfile(profile, user));
  const headers = ["profileNumber", "fullName", "type", "institution", "courseOfStudy", "department", "status", "startDate", "endDate", "progress"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...items.map((item) =>
      [
        item.profile.profileNumber,
        item.profile.fullName,
        item.profile.type,
        item.profile.institution,
        item.profile.courseOfStudy,
        item.department?.name,
        item.placement?.placementStatus,
        item.placement?.startDate,
        item.placement?.expectedEndDate,
        item.placement?.progress?.progressPercentage,
      ].map(escape).join(",")
    ),
  ].join("\n");
}

module.exports = {
  addAttendance,
  addDocument,
  addReview,
  assignSupervisor,
  changeDepartment,
  completePlacement,
  convertToEmployee,
  createProfile,
  credentialsFor,
  downloadDocument,
  exportProfiles,
  extendPlacement,
  getDashboard,
  getDetails,
  getSummary,
  listAttendance,
  listDocuments,
  listHistory,
  listProfiles,
  listReviews,
  listTargets,
  listTasks,
  processExit,
  removeProfile,
  terminatePlacement,
  updateAttendance,
  updateProfile,
};
