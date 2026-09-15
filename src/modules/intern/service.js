const crypto = require("crypto");
const { getUserById, updateUser } = require("../../auth/userStore");
const { PERMISSIONS, hasPermission } = require("../../constants/rbac");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");

const INTERN_NAVIGATION = Object.freeze([
  "Home",
  "My Placement",
  "Assigned To Me",
  "My Schedule",
  "Placement Progress",
  "Company News",
  "Settings",
  "Sign Out",
]);

const INTERN_ROLES = new Set(["intern", "nysc_intern"]);
const FINAL_TASK_STATUSES = new Set(["COMPLETED", "DONE", "CLOSED", "CANCELLED"]);
const FINAL_PLACEMENT_STATUSES = new Set(["COMPLETED", "EXITED", "TERMINATED", "CANCELLED"]);

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt && !record.deleted_at && statusKey(record.status, "") !== "deleted");
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

function recordMatchesIdentifiers(record, scope, keys) {
  return keys.some((key) => {
    const value = record?.[key];
    if (Array.isArray(value)) {
      return value.some((entry) => scope.identifiers.has(entry));
    }
    return value && scope.identifiers.has(value);
  });
}

function findProfileForUser(user) {
  const email = String(user?.email || "").toLowerCase();
  return (
    activeRecords("nysc_intern_profiles").find((profile) =>
      profile.userId === user?.id ||
      profile.user_id === user?.id ||
      (email && String(profile.email || "").toLowerCase() === email)
    ) || null
  );
}

function findPlacementForProfile(profile) {
  return profile ? activeRecords("placements").find((placement) => placement.profileId === profile.id || placement.profile_id === profile.id) || null : null;
}

function findDepartment(id) {
  return id ? activeRecords("departments").find((department) => department.id === id) || null : null;
}

function findSupervisor(placement) {
  if (!placement) return null;
  const activeSupervisor = activeRecords("placement_supervisors").find(
    (supervisor) => (supervisor.placementId || supervisor.placement_id) === placement.id && supervisor.isActive !== false && !supervisor.removedAt
  );
  const employeeId = activeSupervisor?.employeeId || activeSupervisor?.employee_id || placement.supervisorEmployeeId || placement.supervisor_employee_id;
  return employeeId ? activeRecords("employees").find((employee) => employee.id === employeeId) || null : null;
}

function calculatePlacementProgress(placement) {
  const startDate = placement.startDate || placement.start_date;
  const endDate = placement.expectedEndDate || placement.expected_end_date || placement.endDate || placement.end_date;
  const startMs = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00.000Z`).getTime();
  const todayMs = new Date(`${today()}T00:00:00.000Z`).getTime();
  if (!startDate || !endDate || Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { startDate, endDate, daysElapsed: 0, daysRemaining: 0, totalDays: 0, progressPercentage: 0, completionProgress: toNumber(placement.placementProgress ?? placement.placement_progress) };
  }
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / 86400000) + 1);
  const daysElapsed = Math.max(0, Math.min(totalDays, Math.ceil((todayMs - startMs) / 86400000) + 1));
  const daysRemaining = Math.max(0, Math.ceil((endMs - todayMs) / 86400000));
  const timeProgress = Number(((daysElapsed / totalDays) * 100).toFixed(2));
  const manualProgress = placement.manualProgress ?? placement.manual_progress ?? placement.placementProgress ?? placement.placement_progress;
  return {
    startDate,
    endDate,
    daysElapsed,
    daysRemaining,
    totalDays,
    progressPercentage: timeProgress,
    manualProgress: manualProgress ?? null,
    completionProgress: manualProgress === undefined || manualProgress === null ? timeProgress : toNumber(manualProgress),
  };
}

function derivePlacementStatus(placement) {
  const status = normalizeStatus(placement.placementStatus || placement.placement_status || placement.status, "ACTIVE");
  if (FINAL_PLACEMENT_STATUSES.has(status)) return status;
  const progress = calculatePlacementProgress(placement);
  if (progress.startDate && today() < progress.startDate) return "PENDING";
  if (progress.daysRemaining <= Number(process.env.PLACEMENT_ENDING_SOON_DAYS || 30)) return "ENDING_SOON";
  return "ACTIVE";
}

function buildScope(user) {
  if (!INTERN_ROLES.has(normalizeRole(user?.role)) && !hasPermission(user, PERMISSIONS.NYSC_INTERN_VIEW)) {
    throw createHttpError(403, "NYSC/intern access is required.", "INTERN_ROLE_REQUIRED");
  }
  const profile = findProfileForUser(user);
  if (!profile) {
    throw createHttpError(403, "Authenticated user is not linked to an NYSC/intern profile.", "INTERN_PROFILE_REQUIRED");
  }
  const placement = findPlacementForProfile(profile);
  if (!placement) {
    throw createHttpError(403, "NYSC/intern profile is not linked to a placement.", "INTERN_PLACEMENT_REQUIRED");
  }
  const departmentId = placement.departmentId || placement.department_id || profile.departmentId || profile.department_id || user.departmentId || user.department_id || null;
  const identifiers = new Set([
    user.id,
    user.email,
    profile.id,
    profile.profileNumber,
    profile.profile_number,
    profile.email,
    placement.id,
  ].filter(Boolean));
  return {
    user,
    profile,
    placement,
    profileId: profile.id,
    placementId: placement.id,
    departmentId,
    organizationId: placement.organizationId || placement.organization_id || profile.organizationId || profile.organization_id || user.organizationId || user.organization_id || null,
    identifiers,
  };
}

function serializeScope(scope) {
  return {
    userId: scope.user.id,
    profileId: scope.profileId,
    placementId: scope.placementId,
    departmentId: scope.departmentId,
    organizationId: scope.organizationId,
    type: scope.profile.type || "INTERN",
  };
}

function organizationMatches(record, scope) {
  const recordOrgId = valueOf(record, ["organizationId", "organization_id", "employerId", "employer_id", "companyId", "company_id"]);
  return !scope.organizationId || !recordOrgId || String(recordOrgId) === String(scope.organizationId);
}

function taskInScope(task, scope) {
  return organizationMatches(task, scope) && recordMatchesIdentifiers(task, scope, [
    "profileId",
    "profile_id",
    "nyscInternProfileId",
    "nysc_intern_profile_id",
    "assignedToProfileId",
    "assigned_to_profile_id",
    "placementId",
    "placement_id",
    "assignedTo",
    "assigned_to",
    "assigneeId",
    "assignee_id",
    "userId",
    "user_id",
  ]);
}

function targetInScope(target, scope) {
  if (!organizationMatches(target, scope)) return false;
  if (recordMatchesIdentifiers(target, scope, ["profileId", "profile_id", "placementId", "placement_id", "assignedToProfileId", "assigned_to_profile_id", "userId", "user_id"])) return true;
  return activeRecords("target_assignments").some((assignment) =>
    (assignment.targetId || assignment.target_id) === target.id &&
    !["UNASSIGNED", "REMOVED"].includes(normalizeStatus(assignment.status, "ASSIGNED")) &&
    recordMatchesIdentifiers(assignment, scope, ["profileId", "profile_id", "placementId", "placement_id", "userId", "user_id"])
  );
}

function meetingInScope(meeting, scope) {
  if (!organizationMatches(meeting, scope)) return false;
  if (recordMatchesIdentifiers(meeting, scope, ["profileId", "profile_id", "placementId", "placement_id", "userId", "user_id", "attendees"])) return true;
  return activeRecords("meeting_participants").some((participant) =>
    (participant.meetingId || participant.meeting_id) === meeting.id &&
    recordMatchesIdentifiers(participant, scope, ["profileId", "profile_id", "placementId", "placement_id", "userId", "user_id"])
  );
}

function announcementVisible(announcement, scope) {
  if (normalizeStatus(announcement.status, "draft") !== "PUBLISHED") return false;
  if (!organizationMatches(announcement, scope)) return false;
  if (recordMatchesIdentifiers(announcement, scope, ["profileId", "profile_id", "placementId", "placement_id", "userId", "user_id"])) return true;
  const inlineAudience = statusKey(announcement.audienceType || announcement.audience_type || announcement.audience, "all_staff");
  if (["all_staff", "all", "company", "everyone", "all_nysc_interns", "nysc_interns", "interns"].includes(inlineAudience)) return true;
  if (inlineAudience.includes("department") && (announcement.departmentId || announcement.department_id) === scope.departmentId) return true;
  return activeRecords("announcement_audiences").some((audience) => {
    if ((audience.announcementId || audience.announcement_id) !== announcement.id) return false;
    const type = statusKey(audience.audienceType || audience.audience_type, "all_staff");
    if (["all_staff", "all", "company", "everyone", "all_nysc_interns", "nysc_interns", "interns"].includes(type)) return true;
    if (type.includes("department") && (audience.departmentId || audience.department_id) === scope.departmentId) return true;
    return recordMatchesIdentifiers(audience, scope, ["profileId", "profile_id", "placementId", "placement_id", "userId", "user_id"]);
  });
}

function scopedRecords(collection, scope) {
  const records = activeRecords(collection);
  if (collection === "tasks") return records.filter((record) => taskInScope(record, scope));
  if (collection === "targets") return records.filter((record) => targetInScope(record, scope));
  if (collection === "meetings") return records.filter((record) => meetingInScope(record, scope));
  if (collection === "placement_attendance") return records.filter((record) => (record.placementId || record.placement_id) === scope.placementId);
  if (collection === "placement_reviews") return records.filter((record) => (record.placementId || record.placement_id) === scope.placementId);
  if (collection === "placement_documents") return records.filter((record) => (record.placementId || record.placement_id) === scope.placementId || (record.profileId || record.profile_id) === scope.profileId);
  if (collection === "placement_history") return records.filter((record) => (record.placementId || record.placement_id) === scope.placementId);
  if (collection === "notifications") {
    return records.filter((record) => recordMatchesIdentifiers(record, scope, ["userId", "user_id", "recipientUserId", "recipient_user_id", "profileId", "profile_id", "placementId", "placement_id"]));
  }
  if (collection === "announcements") return records.filter((record) => announcementVisible(record, scope));
  return [];
}

function listCollection(collection, user, query = {}, searchFields = []) {
  const scope = buildScope(user);
  return paginate(applyBasicFilters(newestFirst(scopedRecords(collection, scope)), { ...query, q: query.q || query.search }, searchFields), query);
}

function getPlacementRecord(user) {
  const scope = buildScope(user);
  const currentUser = getUserById(user.id) || user;
  const department = findDepartment(scope.departmentId);
  const supervisor = findSupervisor(scope.placement);
  const placementProgress = calculatePlacementProgress(scope.placement);
  const placement = {
    ...scope.placement,
    placementStatus: derivePlacementStatus(scope.placement),
    placement_status: derivePlacementStatus(scope.placement),
    progress: placementProgress,
    placementProgress: placementProgress.completionProgress,
    placement_progress: placementProgress.completionProgress,
  };

  return {
    overview: {
      id: scope.profile.id,
      profileId: scope.profile.id,
      profile_id: scope.profile.id,
      profileNumber: scope.profile.profileNumber || scope.profile.profile_number || null,
      profile_number: scope.profile.profile_number || scope.profile.profileNumber || null,
      fullName: scope.profile.fullName || scope.profile.full_name || currentUser.name || null,
      email: scope.profile.email || currentUser.email || null,
      phone: scope.profile.phone || currentUser.phone || null,
      type: scope.profile.type || "INTERN",
      avatarUrl: currentUser.avatarUrl || currentUser.avatar_url || scope.profile.profilePhoto || scope.profile.profile_photo || null,
      department: department ? { id: department.id, name: department.name || null, code: department.code || null } : null,
      supervisor: supervisor ? { id: supervisor.id, fullName: supervisor.fullName || supervisor.name || null, email: supervisor.email || null } : null,
    },
    profile: scope.profile,
    placement,
    contact: {
      email: scope.profile.email || currentUser.email || null,
      phone: scope.profile.phone || currentUser.phone || null,
      address: scope.profile.address || null,
      emergencyContact: {
        name: scope.profile.emergencyContactName || scope.profile.emergency_contact_name || null,
        phone: scope.profile.emergencyContactPhone || scope.profile.emergency_contact_phone || null,
      },
    },
    education: {
      institution: scope.profile.institution || null,
      courseOfStudy: scope.profile.courseOfStudy || scope.profile.course_of_study || null,
      matricNumber: scope.profile.matricNumber || scope.profile.matric_number || null,
      stateCode: scope.profile.stateCode || scope.profile.state_code || null,
      callUpNumber: scope.profile.callUpNumber || scope.profile.call_up_number || null,
    },
    documents: scopedRecords("placement_documents", scope),
    attendance: scopedRecords("placement_attendance", scope),
    reviews: scopedRecords("placement_reviews", scope),
    tasks: scopedRecords("tasks", scope),
    targets: scopedRecords("targets", scope),
    meetings: scopedRecords("meetings", scope),
    news: scopedRecords("announcements", scope),
    history: scopedRecords("placement_history", scope),
  };
}

function countStatuses(records, fallback = "PENDING") {
  return records.reduce((counts, record) => {
    const key = normalizeStatus(record.status, fallback).toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function averageTargetProgress(targets) {
  const values = targets.map((target) => toNumber(target.progress ?? target.progressPercent ?? target.progress_percent ?? target.achievementPercentage ?? target.achievement_percentage, NaN)).filter(Number.isFinite);
  return values.length ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2)) : 0;
}

function attendanceSummary(attendance) {
  const counts = countStatuses(attendance, "PRESENT");
  return {
    total: attendance.length,
    present: counts.present || 0,
    absent: counts.absent || 0,
    late: counts.late || 0,
    remote: counts.remote || 0,
    excused: counts.excused || 0,
  };
}

function getDashboard(user, query = {}) {
  const scope = buildScope(user);
  const record = getPlacementRecord(user);
  const limit = Math.max(1, Math.min(25, Number(query.previewLimit || query.limit || 5) || 5));
  const nowMs = Date.now();
  const activeTasks = record.tasks.filter((task) => !FINAL_TASK_STATUSES.has(normalizeStatus(task.status, "PENDING")));
  const upcomingMeetings = record.meetings.filter((meeting) => dateValue(meeting, ["startAt", "start_at", "scheduledAt", "scheduled_at", "date"]) >= nowMs);

  return {
    scope: serializeScope(scope),
    profile: record.overview,
    placement: record.placement,
    metrics: {
      assignedTasks: activeTasks.length,
      completedTasks: record.tasks.filter((task) => FINAL_TASK_STATUSES.has(normalizeStatus(task.status, "PENDING"))).length,
      overdueTasks: activeTasks.filter((task) => {
        const due = dateValue(task, ["dueDate", "due_date"]);
        return due > 0 && due < nowMs;
      }).length,
      upcomingMeetings: upcomingMeetings.length,
      placementProgress: record.placement.progress.completionProgress,
      daysRemaining: record.placement.progress.daysRemaining,
      attendanceDays: record.attendance.length,
      reviews: record.reviews.length,
      documents: record.documents.length,
      unreadNotifications: scopedRecords("notifications", scope).filter((notification) => !notification.readAt && !notification.read_at && statusKey(notification.status, "unread") !== "read").length,
      news: record.news.length,
      targetProgress: averageTargetProgress(record.targets),
    },
    assignedToMe: newestFirst(record.tasks).slice(0, limit),
    schedule: newestFirst(upcomingMeetings, ["startAt", "start_at", "scheduledAt", "scheduled_at", "date"]).slice(0, limit),
    progress: {
      placement: record.placement.progress,
      targets: newestFirst(record.targets).slice(0, limit),
      reviews: newestFirst(record.reviews).slice(0, limit),
      attendance: attendanceSummary(record.attendance),
    },
    news: newestFirst(record.news, ["publishedAt", "published_at", "createdAt", "created_at"]).slice(0, limit),
    notifications: newestFirst(scopedRecords("notifications", scope)).slice(0, limit),
    navigation: INTERN_NAVIGATION,
  };
}

function assertNoSelfPrivilegeMutation(payload = {}) {
  const forbidden = [
    "role",
    "roleId",
    "role_id",
    "permissions",
    "type",
    "profileNumber",
    "profile_number",
    "departmentId",
    "department_id",
    "placementStatus",
    "placement_status",
    "startDate",
    "start_date",
    "endDate",
    "end_date",
    "expectedEndDate",
    "expected_end_date",
    "supervisorId",
    "supervisor_id",
  ];
  const found = forbidden.find((key) => payload[key] !== undefined);
  if (found) {
    throw createHttpError(403, "NYSC/intern profile cannot change access, placement, department, or supervisor fields.", "INTERN_SELF_FIELD_FORBIDDEN", { field: found });
  }
}

function updatePlacementRecord(payload = {}, req) {
  const scope = buildScope(req.user);
  assertNoSelfPrivilegeMutation(payload);
  const personal = payload.personalInformation || payload.personal || {};
  const currentUser = getUserById(req.user.id) || req.user;
  const displayName = payload.fullName || payload.full_name || payload.name || personal.fullName;
  const updates = compactObject({
    fullName: displayName,
    full_name: displayName,
    phone: payload.phone ?? personal.phone,
    address: payload.address ?? personal.address,
    emergencyContactName: payload.emergencyContactName || payload.emergency_contact_name || personal.emergencyContactName,
    emergency_contact_name: payload.emergency_contact_name || payload.emergencyContactName || personal.emergency_contact_name,
    emergencyContactPhone: payload.emergencyContactPhone || payload.emergency_contact_phone || personal.emergencyContactPhone,
    emergency_contact_phone: payload.emergency_contact_phone || payload.emergencyContactPhone || personal.emergency_contact_phone,
  });
  const profiles = readCollection("nysc_intern_profiles");
  const index = profiles.findIndex((profile) => profile.id === scope.profileId && !profile.deletedAt && !profile.deleted_at);
  const oldValue = index === -1 ? null : profiles[index];
  if (index !== -1) {
    profiles[index] = { ...profiles[index], ...updates, id: profiles[index].id, updatedAt: now(), updated_at: now() };
    writeCollection("nysc_intern_profiles", profiles);
  }
  if (displayName || payload.phone || payload.preferences || payload.avatarUrl || payload.avatar_url) {
    updateUser(req.user.id, compactObject({
      name: displayName,
      fullName: displayName,
      phone: payload.phone ?? personal.phone,
      preferences: payload.preferences,
      avatarUrl: payload.avatarUrl || payload.avatar_url,
      avatar_url: payload.avatar_url || payload.avatarUrl,
      updatedBy: req.user.id,
    }));
  }
  audit(req, "INTERN_PROFILE_UPDATED", "intern_profile", scope.profileId, oldValue, updates, scope);
  return getPlacementRecord(getUserById(req.user.id) || currentUser);
}

function updateTaskProgress(id, payload = {}, req) {
  const scope = buildScope(req.user);
  const records = readCollection("tasks");
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  const oldValue = records[index];
  if (!taskInScope(oldValue, scope)) {
    throw createHttpError(403, "Requested task is outside this NYSC/intern placement.", "RESOURCE_OUT_OF_INTERN_SCOPE", { id });
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
  audit(req, "INTERN_TASK_PROGRESS_UPDATED", "tasks", id, oldValue, updated, scope);
  return { oldValue, record: updated };
}

function calculateTargetProgress(target, currentValue) {
  const targetValue = toNumber(target.targetValue ?? target.target_value);
  if (targetValue <= 0) return 0;
  return Math.max(0, Math.min(100, Number(((toNumber(currentValue) / targetValue) * 100).toFixed(2))));
}

function updateTargetProgress(id, payload = {}, req) {
  const scope = buildScope(req.user);
  const records = readCollection("targets");
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  const oldValue = records[index];
  if (!targetInScope(oldValue, scope)) {
    throw createHttpError(403, "Requested target is outside this NYSC/intern placement.", "RESOURCE_OUT_OF_INTERN_SCOPE", { id });
  }
  if (["DRAFT", "PAUSED", "CANCELLED", "COMPLETED"].includes(normalizeStatus(oldValue.status, "ACTIVE"))) {
    throw createHttpError(409, "Only active or overdue targets can receive progress updates.", "TARGET_NOT_ACTIVE");
  }
  const value = payload.value ?? payload.currentValue ?? payload.current_value;
  if (!Number.isFinite(toNumber(value, NaN)) || toNumber(value) < 0) {
    throw createHttpError(400, "Progress value must be a non-negative number.", "INVALID_PROGRESS_VALUE");
  }
  const progress = calculateTargetProgress(oldValue, value);
  const updated = {
    ...oldValue,
    id,
    currentValue: toNumber(value),
    current_value: toNumber(value),
    progress,
    achievementPercentage: progress,
    achievement_percentage: progress,
    status: progress >= 100 ? "COMPLETED" : normalizeStatus(oldValue.status, "ACTIVE") === "OVERDUE" ? "OVERDUE" : "ACTIVE",
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: now(),
    updated_at: now(),
  };
  records[index] = updated;
  writeCollection("targets", records);
  appendRecord("target_progress", {
    id: crypto.randomUUID(),
    targetId: id,
    target_id: id,
    value: toNumber(value),
    progress,
    note: payload.note || payload.progressNote || payload.progress_note || null,
    recordedBy: req.user.id,
    recorded_by: req.user.id,
    recordedAt: now(),
    recorded_at: now(),
  });
  audit(req, "INTERN_TARGET_PROGRESS_UPDATED", "targets", id, oldValue, updated, scope);
  return { oldValue, record: updated, progress };
}

function appendRecord(collection, payload) {
  const records = readCollection(collection);
  const record = { createdAt: now(), created_at: now(), updatedAt: now(), updated_at: now(), ...payload };
  records.push(record);
  writeCollection(collection, records);
  return record;
}

function recordAttendance(payload = {}, req) {
  const scope = buildScope(req.user);
  const date = payload.date || today();
  const records = readCollection("placement_attendance");
  const existingIndex = records.findIndex((record) => (record.placementId || record.placement_id) === scope.placementId && record.date === date && !record.deletedAt && !record.deleted_at);
  const nextValues = compactObject({
    placementId: scope.placementId,
    placement_id: scope.placementId,
    date,
    checkIn: payload.checkIn || payload.check_in,
    check_in: payload.check_in || payload.checkIn,
    checkOut: payload.checkOut || payload.check_out,
    check_out: payload.check_out || payload.checkOut,
    status: normalizeStatus(payload.status, "PRESENT"),
    notes: payload.notes || payload.note || null,
    recordedBy: req.user.id,
    recorded_by: req.user.id,
    source: "self_service",
    updatedAt: now(),
    updated_at: now(),
  });
  if (existingIndex === -1) {
    const record = { id: crypto.randomUUID(), createdAt: now(), created_at: now(), ...nextValues };
    records.push(record);
    writeCollection("placement_attendance", records);
    audit(req, "INTERN_ATTENDANCE_RECORDED", "placement_attendance", record.id, null, record, scope);
    return { record, created: true };
  }
  const oldValue = records[existingIndex];
  records[existingIndex] = { ...oldValue, ...nextValues, id: oldValue.id };
  writeCollection("placement_attendance", records);
  audit(req, "INTERN_ATTENDANCE_UPDATED", "placement_attendance", oldValue.id, oldValue, records[existingIndex], scope);
  return { oldValue, record: records[existingIndex], created: false };
}

function updateSettings(payload = {}, req) {
  assertNoSelfPrivilegeMutation(payload);
  const preferences = payload.preferences || payload.internPreferences || payload.intern_preferences || {};
  if (preferences && typeof preferences !== "object") {
    throw createHttpError(400, "NYSC/intern preferences must be an object.", "INVALID_INTERN_PREFERENCES");
  }
  const current = getUserById(req.user.id) || req.user;
  const updated = updateUser(req.user.id, {
    preferences: { ...(current.preferences || {}), ...preferences },
    updatedBy: req.user.id,
  });
  return { profile: getPlacementRecord(updated || req.user).overview, preferences: updated?.preferences || {} };
}

function markNotificationRead(id, req) {
  const scope = buildScope(req.user);
  const records = readCollection("notifications");
  const index = records.findIndex((record) => record.id === id && recordMatchesIdentifiers(record, scope, ["userId", "user_id", "recipientUserId", "recipient_user_id", "profileId", "profile_id", "placementId", "placement_id"]));
  if (index === -1) return null;
  records[index] = { ...records[index], readAt: now(), read_at: now(), status: "read", updatedAt: now(), updated_at: now() };
  writeCollection("notifications", records);
  return records[index];
}

function audit(req, action, module, recordId, oldValue, newValue, scope) {
  return recordOperationalAudit({
    user: req.user,
    action,
    module: `Intern ${module}`,
    recordId,
    targetType: module,
    oldValue,
    newValue,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    metadata: {
      role: req.user?.role || "nysc_intern",
      profileId: scope.profileId,
      placementId: scope.placementId,
      departmentId: scope.departmentId,
      organizationId: scope.organizationId,
    },
  });
}

module.exports = {
  buildScope,
  getDashboard,
  getPlacementRecord,
  getScopeSummary: (user) => serializeScope(buildScope(user)),
  listAttendance: (user, query) => listCollection("placement_attendance", user, query, ["status", "notes", "source"]),
  listDocuments: (user, query) => listCollection("placement_documents", user, query, ["documentType", "fileName", "fileType"]),
  listMeetings: (user, query) => listCollection("meetings", user, query, ["title", "agenda", "location", "status"]),
  listNews: (user, query) => listCollection("announcements", user, query, ["title", "message", "body", "summary"]),
  listNotifications: (user, query) => listCollection("notifications", user, query, ["title", "body", "message", "type", "status"]),
  listReviews: (user, query) => listCollection("placement_reviews", user, query, ["reviewPeriod", "recommendation", "comments"]),
  listTargets: (user, query) => listCollection("targets", user, query, ["title", "description", "metricName", "status"]),
  listTasks: (user, query) => listCollection("tasks", user, query, ["title", "description", "status", "priority"]),
  markNotificationRead,
  recordAttendance,
  updatePlacementRecord,
  updateSettings,
  updateTargetProgress,
  updateTaskProgress,
};
