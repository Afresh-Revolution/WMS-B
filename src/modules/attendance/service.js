const crypto = require("crypto");
const { getUserById } = require("../../auth/userStore");
const { hasPermission } = require("../../constants/rbac");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordOperationalAudit } = require("../_shared/auditService");
const notificationService = require("../notifications/notification.service");
const { haversineDistanceMeters, toCoordinate } = require("./geo");
const { assessCheckInRisk } = require("./risk");

const LOCATION_COLLECTION = "attendance_locations";
const SCHEDULE_COLLECTION = "attendance_schedules";
const ATTENDANCE_COLLECTION = "attendance";

const DEFAULT_RADIUS_METERS = Number(process.env.ATTENDANCE_DEFAULT_RADIUS_METERS || 3000);
const MIN_RADIUS_METERS = Number(process.env.ATTENDANCE_MIN_RADIUS_METERS || 10);
const MAX_RADIUS_METERS = Number(process.env.ATTENDANCE_MAX_RADIUS_METERS || 5000);
const MAX_GPS_ACCURACY_METERS = Number(process.env.ATTENDANCE_MAX_GPS_ACCURACY_METERS || 100);
const MAX_LOCATION_AGE_SECONDS = Number(process.env.ATTENDANCE_MAX_LOCATION_AGE_SECONDS || 300);
const DEFAULT_OPENING_TIME = process.env.ATTENDANCE_DEFAULT_OPENING_TIME || "08:50";
const DEFAULT_LATE_AFTER_TIME = process.env.ATTENDANCE_DEFAULT_LATE_AFTER_TIME || "09:30";
const DEFAULT_CLOSING_TIME = process.env.ATTENDANCE_DEFAULT_CLOSING_TIME || "17:00";
const LOCATION_RETENTION_DAYS = Number(process.env.ATTENDANCE_LOCATION_RETENTION_DAYS || 365);
const checkInLocks = new Set();

const CHECK_IN_ROLES = new Set(["employee", "accountant", "intern", "nysc_intern"]);
const ATTENDANCE_MONITOR_ROLES = new Set(["superadmin", "hr", "manager"]);
const ATTENDANCE_MANAGE_ROLES = new Set(["superadmin", "manager"]);
const MANAGER_ROLES = new Set(["manager"]);
const HR_VIEW_ROLES = new Set(["hr"]);
const ACTIVE_STATUSES = new Set(["active", "confirmed", "probation", "ending_soon"]);
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => entry !== undefined));
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt && !record.deleted_at && String(record.status || "").toLowerCase() !== "deleted");
}

function isActive(record) {
  if (record.active !== undefined) return Boolean(record.active);
  if (record.isActive !== undefined) return Boolean(record.isActive);
  if (record.is_active !== undefined) return Boolean(record.is_active);
  return !["inactive", "disabled", "deleted"].includes(String(record.status || "active").toLowerCase());
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function recordMatchesUser(record, user) {
  const userIds = [user?.id, user?.employeeId, user?.employee_id]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String);
  const recordIds = [record.id, record.employeeId, record.employee_id, record.userId, record.user_id]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String);
  if (recordIds.some((id) => userIds.includes(id))) return true;
  const email = String(user?.email || "").toLowerCase();
  return Boolean(email && String(record.email || "").toLowerCase() === email);
}

function findPlacementForProfile(profile) {
  if (!profile) return null;
  return activeRecords("placements").find((placement) => (placement.profileId || placement.profile_id) === profile.id) || null;
}

function normalizeActorProfile(record, extras = {}) {
  if (!record) return null;
  return {
    ...record,
    id: record.id,
    fullName: record.fullName || record.name || extras.fullName || null,
    departmentId: extras.departmentId || record.departmentId || record.department_id || null,
    department_id: extras.departmentId || record.department_id || record.departmentId || null,
    branchId: extras.branchId || record.branchId || record.branch_id || null,
    branch_id: extras.branchId || record.branch_id || record.branchId || null,
    organizationId: extras.organizationId || record.organizationId || record.organization_id || record.employerId || record.employer_id || null,
    status: extras.status || record.status || record.employmentStatus || record.employment_status || record.placementStatus || record.placement_status || "active",
  };
}

function getActorEmployee(user) {
  const role = normalizeRole(user?.role);
  if (role === "intern" || role === "nysc_intern") {
    for (const collection of ["nysc_intern_profiles", "interns", "nysc_members"]) {
      const record = activeRecords(collection).find((item) => recordMatchesUser(item, user));
      if (!record) continue;
      const placement = collection === "nysc_intern_profiles" ? findPlacementForProfile(record) : null;
      return normalizeActorProfile(record, {
        departmentId: record.departmentId || record.department_id || placement?.departmentId || placement?.department_id || user?.departmentId || user?.department_id || null,
        branchId: record.branchId || record.branch_id || placement?.branchId || placement?.branch_id || user?.branchId || user?.branch_id || null,
        organizationId: record.organizationId || record.organization_id || placement?.organizationId || placement?.organization_id || user?.organizationId || user?.organization_id || null,
        status: record.status || placement?.placementStatus || placement?.placement_status || placement?.status || "active",
      });
    }
  }

  const { resolveEmployeeForUser } = require("../employees/employeeProfile");
  const linked = resolveEmployeeForUser(user);
  if (linked) {
    return normalizeActorProfile(linked);
  }
  return null;
}

function checkInDestination(role) {
  const normalized = normalizeRole(role);
  if (normalized === "accountant") return "/accountant/attendance";
  if (normalized === "intern" || normalized === "nysc_intern") return "/intern/attendance";
  return "/employee/attendance";
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

function sameOrganization(record, organizationId) {
  const recordOrganizationId = getRecordOrganizationId(record);
  return !organizationId || !recordOrganizationId || String(recordOrganizationId) === String(organizationId);
}

function normalizeIdentifier(value) {
  return value === undefined || value === null ? null : String(value);
}

function getEmployeeIdentifiers(user, employee) {
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
    ]
      .map(normalizeIdentifier)
      .filter(Boolean)
  );
}

function buildEmployeeScope(user) {
  if (!CHECK_IN_ROLES.has(normalizeRole(user?.role))) {
    throw createHttpError(403, "Check-in is only available to employees, accountants, NYSC members, and interns.", "EMPLOYEE_CHECK_IN_ROLE_REQUIRED");
  }
  if (!hasPermission(user, "attendance.check_in")) {
    throw createHttpError(403, "You do not have permission to check in.", "ATTENDANCE_CHECK_IN_FORBIDDEN");
  }

  const employee = getActorEmployee(user);
  if (!employee) {
    throw createHttpError(403, "Authenticated user is not linked to an employee, NYSC, or intern record.", "EMPLOYEE_PROFILE_REQUIRED");
  }

  return {
    user,
    employee,
    employeeId: employee.id,
    userId: user.id,
    organizationId: getOrganizationId(user, employee),
    departmentId: employee.departmentId || employee.department_id || user.departmentId || user.department_id || null,
    branchId: employee.branchId || employee.branch_id || user.branchId || user.branch_id || null,
    identifiers: getEmployeeIdentifiers(user, employee),
  };
}

function buildManagerScope(user) {
  const role = normalizeRole(user?.role);
  if (role === "superadmin") {
    return { superadmin: true, organizationId: getOrganizationId(user), departmentIds: new Set(), employeeIds: new Set() };
  }
  if (!MANAGER_ROLES.has(role)) {
    return null;
  }

  const managerEmployee = getActorEmployee(user);
  const identifiers = getEmployeeIdentifiers(user, managerEmployee);
  const departmentIds = new Set(
    [
      user.departmentId,
      user.department_id,
      managerEmployee?.departmentId,
      managerEmployee?.department_id,
      ...arrayValue(user.departmentIds),
      ...arrayValue(user.department_ids),
    ].filter(Boolean)
  );
  const branchIds = new Set([user.branchId, user.branch_id, managerEmployee?.branchId, managerEmployee?.branch_id].filter(Boolean));

  for (const assignment of activeRecords("user_departments")) {
    if ((assignment.userId || assignment.user_id) === user.id) {
      departmentIds.add(assignment.departmentId || assignment.department_id);
    }
  }

  for (const department of activeRecords("departments")) {
    const leaders = [
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
    ];
    if (leaders.some((id) => identifiers.has(normalizeIdentifier(id)))) {
      departmentIds.add(department.id);
    }
  }

  const organizationId = getOrganizationId(user, managerEmployee);
  const employeeIds = new Set(
    activeRecords("employees")
      .filter((employee) => sameOrganization(employee, organizationId))
      .filter((employee) => {
        const departmentId = employee.departmentId || employee.department_id;
        const reportsTo = [
          employee.managerId,
          employee.manager_id,
          employee.supervisorId,
          employee.supervisor_id,
          employee.reportsTo,
          employee.reports_to,
        ];
        return (departmentId && departmentIds.has(departmentId)) || reportsTo.some((id) => identifiers.has(normalizeIdentifier(id)));
      })
      .map((employee) => employee.id)
  );

  return { superadmin: false, organizationId, branchIds, departmentIds, employeeIds };
}

function assertPermission(user, permission) {
  if (user?.role === "superadmin" || hasPermission(user, permission)) return;
  throw createHttpError(403, "Forbidden.", "FORBIDDEN", { permission });
}

function assertCanManage(user) {
  if (!ATTENDANCE_MANAGE_ROLES.has(normalizeRole(user?.role))) {
    throw createHttpError(403, "Attendance location and schedule management is limited to Super Admin and managers.", "ATTENDANCE_MANAGE_FORBIDDEN");
  }
  assertPermission(user, "attendance.manage");
}

function assertCanView(user) {
  if (!ATTENDANCE_MONITOR_ROLES.has(normalizeRole(user?.role))) {
    throw createHttpError(403, "Attendance monitoring is limited to Super Admin, HR, and managers.", "ATTENDANCE_MONITOR_FORBIDDEN");
  }
  assertPermission(user, "attendance.view");
}

function assertManagerPayloadScope(user, payload = {}) {
  if (normalizeRole(user?.role) === "superadmin") return;
  const scope = buildManagerScope(user);
  if (!scope) throw createHttpError(403, "Forbidden.", "FORBIDDEN");

  const departmentIds = [
    payload.departmentId,
    payload.department_id,
    ...arrayValue(payload.departmentIds),
    ...arrayValue(payload.department_ids),
  ].filter(Boolean);
  const employeeIds = [
    payload.employeeId,
    payload.employee_id,
    ...arrayValue(payload.employeeIds),
    ...arrayValue(payload.employee_ids),
  ].filter(Boolean);
  const branchId = payload.branchId || payload.branch_id || null;
  if (!departmentIds.length && !employeeIds.length && !branchId) {
    throw createHttpError(403, "Manager attendance records must be assigned to a scoped branch, department, or employee.", "ATTENDANCE_SCOPE_REQUIRED");
  }

  if (departmentIds.some((id) => !scope.departmentIds.has(id))) {
    throw createHttpError(403, "Requested department is outside your attendance scope.", "ATTENDANCE_SCOPE_FORBIDDEN");
  }
  if (employeeIds.some((id) => !scope.employeeIds.has(id))) {
    throw createHttpError(403, "Requested employee is outside your attendance scope.", "ATTENDANCE_SCOPE_FORBIDDEN");
  }
  if (branchId && !scope.branchIds.has(branchId)) {
    throw createHttpError(403, "Requested branch is outside your attendance scope.", "ATTENDANCE_SCOPE_FORBIDDEN");
  }
}

function normalizeTime(value, fallback) {
  const time = String(value || fallback || "").trim();
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw createHttpError(400, "Schedule time must use HH:mm format.", "INVALID_SCHEDULE_TIME");
  }
  const [hours, minutes] = time.split(":").map(Number);
  if (hours > 23 || minutes > 59) {
    throw createHttpError(400, "Schedule time must use HH:mm format.", "INVALID_SCHEDULE_TIME");
  }
  return time;
}

function minutesOfDay(time) {
  const [hours, minutes] = normalizeTime(time, "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function assertTimezone(timezone) {
  const candidate = String(timezone || "Africa/Lagos").trim();
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (_error) {
    throw createHttpError(400, "Timezone must be a valid IANA timezone.", "INVALID_TIMEZONE");
  }
}

function getZonedParts(date = new Date(), timezone = "Africa/Lagos") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: assertTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function shiftDate(dateText, days) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dayOfWeekForDate(dateText) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function normalizeDays(days) {
  const source = Array.isArray(days) && days.length ? days : [1, 2, 3, 4, 5];
  return [...new Set(source.map((day) => {
    if (typeof day === "number") return day;
    const normalized = String(day).trim().toLowerCase();
    if (/^\d+$/.test(normalized)) return Number(normalized);
    return DAY_NAMES.indexOf(normalized);
  }))].filter((day) => day >= 0 && day <= 6).sort();
}

function evaluateScheduleWindow(schedule, at = new Date(), timezoneOverride = null) {
  const timezone = assertTimezone(timezoneOverride || schedule.timezone || schedule.time_zone || "Africa/Lagos");
  const openMinutes = minutesOfDay(schedule.openingTime || schedule.opening_time || DEFAULT_OPENING_TIME);
  const lateMinutes = minutesOfDay(schedule.lateAfterTime || schedule.late_after_time || DEFAULT_LATE_AFTER_TIME);
  const closeMinutes = minutesOfDay(schedule.closingTime || schedule.closing_time || DEFAULT_CLOSING_TIME);
  const local = getZonedParts(at, timezone);
  const currentMinutes = local.hour * 60 + local.minute;
  const spansMidnight = closeMinutes < openMinutes;
  let workDate = local.date;
  let scheduleDay = local.dayOfWeek;

  if (spansMidnight && currentMinutes <= closeMinutes) {
    workDate = shiftDate(local.date, -1);
    scheduleDay = dayOfWeekForDate(workDate);
  }

  const workingDays = normalizeDays(schedule.daysOfWeek || schedule.days_of_week);
  const withinConfiguredDay = workingDays.includes(scheduleDay);
  const withinActiveDates =
    (!schedule.startDate && !schedule.start_date && !schedule.activeFrom && !schedule.active_from || workDate >= String(schedule.startDate || schedule.start_date || schedule.activeFrom || schedule.active_from).slice(0, 10)) &&
    (!schedule.endDate && !schedule.end_date && !schedule.activeTo && !schedule.active_to || workDate <= String(schedule.endDate || schedule.end_date || schedule.activeTo || schedule.active_to).slice(0, 10));

  const afterOpen = spansMidnight ? currentMinutes >= openMinutes || currentMinutes <= closeMinutes : currentMinutes >= openMinutes;
  const beforeClose = spansMidnight ? currentMinutes >= openMinutes || currentMinutes <= closeMinutes : currentMinutes <= closeMinutes;
  const isOpen = withinConfiguredDay && withinActiveDates && afterOpen && beforeClose;
  const isTooEarly = withinConfiguredDay && withinActiveDates && !afterOpen;
  const isClosed = withinConfiguredDay && withinActiveDates && afterOpen && !beforeClose;
  const isLate = isOpen && (spansMidnight ? currentMinutes >= lateMinutes || currentMinutes <= closeMinutes && lateMinutes < openMinutes : currentMinutes > lateMinutes);

  return {
    timezone,
    localDate: local.date,
    localTime: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
    workDate,
    dayOfWeek: scheduleDay,
    workingDays,
    openingTime: normalizeTime(schedule.openingTime || schedule.opening_time, DEFAULT_OPENING_TIME),
    lateAfterTime: normalizeTime(schedule.lateAfterTime || schedule.late_after_time, DEFAULT_LATE_AFTER_TIME),
    closingTime: normalizeTime(schedule.closingTime || schedule.closing_time, DEFAULT_CLOSING_TIME),
    spansMidnight,
    isOpen,
    isTooEarly,
    isClosed,
    isLate,
    reason: !withinConfiguredDay
      ? "NOT_WORKING_DAY"
      : !withinActiveDates
        ? "SCHEDULE_NOT_ACTIVE_FOR_DATE"
        : isTooEarly
          ? "ATTENDANCE_NOT_OPEN"
          : isClosed
            ? "ATTENDANCE_CLOSED"
            : isOpen
              ? "OPEN"
              : "ATTENDANCE_CLOSED",
  };
}

function normalizeLocationPayload(payload = {}, user) {
  const latitude = toCoordinate(payload.latitude ?? payload.lat, -90, 90, "latitude");
  const longitude = toCoordinate(payload.longitude ?? payload.lng ?? payload.lon, -180, 180, "longitude");
  const radiusMeters = Number(payload.radiusMeters ?? payload.radius_meters ?? DEFAULT_RADIUS_METERS);
  if (!Number.isFinite(radiusMeters) || radiusMeters < MIN_RADIUS_METERS || radiusMeters > MAX_RADIUS_METERS) {
    throw createHttpError(400, "Attendance radius is outside the configured bounds.", "INVALID_ATTENDANCE_RADIUS", {
      min: MIN_RADIUS_METERS,
      max: MAX_RADIUS_METERS,
    });
  }
  const timezone = assertTimezone(payload.timezone || payload.time_zone || "Africa/Lagos");
  const organizationId = payload.organizationId || payload.organization_id || user.organizationId || user.organization_id || null;
  return compactObject({
    name: String(payload.name || "").trim(),
    description: payload.description || payload.address || null,
    address: payload.address || payload.description || null,
    latitude,
    longitude,
    radiusMeters,
    radius_meters: radiusMeters,
    timezone,
    time_zone: timezone,
    active: payload.active ?? payload.isActive ?? payload.is_active ?? true,
    status: payload.status || ((payload.active ?? payload.isActive ?? payload.is_active ?? true) ? "active" : "inactive"),
    organizationId,
    organization_id: organizationId,
    branchId: payload.branchId || payload.branch_id || null,
    branch_id: payload.branch_id || payload.branchId || null,
    departmentId: payload.departmentId || payload.department_id || null,
    department_id: payload.department_id || payload.departmentId || null,
    departmentIds: normalizeAssignedIds(payload.departmentIds || payload.department_ids),
    department_ids: normalizeAssignedIds(payload.departmentIds || payload.department_ids),
    employeeIds: normalizeAssignedIds(payload.employeeIds || payload.employee_ids),
    employee_ids: normalizeAssignedIds(payload.employeeIds || payload.employee_ids),
  });
}

function normalizeAssignedIds(value) {
  return [...new Set(arrayValue(value).map(String))];
}

function normalizeSchedulePayload(payload = {}, user) {
  const organizationId = payload.organizationId || payload.organization_id || user.organizationId || user.organization_id || null;
  const timezone = payload.timezone || payload.time_zone || null;
  return compactObject({
    name: String(payload.name || "").trim(),
    description: payload.description || null,
    openingTime: normalizeTime(payload.openingTime || payload.opening_time, DEFAULT_OPENING_TIME),
    opening_time: normalizeTime(payload.openingTime || payload.opening_time, DEFAULT_OPENING_TIME),
    lateAfterTime: normalizeTime(payload.lateAfterTime || payload.late_after_time, DEFAULT_LATE_AFTER_TIME),
    late_after_time: normalizeTime(payload.lateAfterTime || payload.late_after_time, DEFAULT_LATE_AFTER_TIME),
    closingTime: normalizeTime(payload.closingTime || payload.closing_time, DEFAULT_CLOSING_TIME),
    closing_time: normalizeTime(payload.closingTime || payload.closing_time, DEFAULT_CLOSING_TIME),
    daysOfWeek: normalizeDays(payload.daysOfWeek || payload.days_of_week),
    days_of_week: normalizeDays(payload.daysOfWeek || payload.days_of_week),
    timezone: timezone ? assertTimezone(timezone) : null,
    time_zone: timezone ? assertTimezone(timezone) : null,
    startDate: payload.startDate || payload.start_date || payload.activeFrom || payload.active_from || null,
    start_date: payload.start_date || payload.startDate || payload.active_from || payload.activeFrom || null,
    endDate: payload.endDate || payload.end_date || payload.activeTo || payload.active_to || null,
    end_date: payload.end_date || payload.endDate || payload.active_to || payload.activeTo || null,
    active: payload.active ?? payload.isActive ?? payload.is_active ?? true,
    status: payload.status || ((payload.active ?? payload.isActive ?? payload.is_active ?? true) ? "active" : "inactive"),
    organizationId,
    organization_id: organizationId,
    locationIds: normalizeAssignedIds(payload.locationIds || payload.location_ids || payload.attendanceLocationIds || payload.attendance_location_ids),
    location_ids: normalizeAssignedIds(payload.locationIds || payload.location_ids || payload.attendanceLocationIds || payload.attendance_location_ids),
    branchId: payload.branchId || payload.branch_id || null,
    branch_id: payload.branch_id || payload.branchId || null,
    departmentId: payload.departmentId || payload.department_id || null,
    department_id: payload.department_id || payload.departmentId || null,
    departmentIds: normalizeAssignedIds(payload.departmentIds || payload.department_ids),
    department_ids: normalizeAssignedIds(payload.departmentIds || payload.department_ids),
    employeeIds: normalizeAssignedIds(payload.employeeIds || payload.employee_ids),
    employee_ids: normalizeAssignedIds(payload.employeeIds || payload.employee_ids),
  });
}

function assignedToScope(record, scope) {
  if (!sameOrganization(record, scope.organizationId)) return false;
  const employeeIds = normalizeAssignedIds(record.employeeIds || record.employee_ids);
  const departmentIds = normalizeAssignedIds(record.departmentIds || record.department_ids);
  const singleEmployeeId = record.employeeId || record.employee_id;
  const singleDepartmentId = record.departmentId || record.department_id;
  const branchId = record.branchId || record.branch_id;
  if (singleEmployeeId && !scope.identifiers.has(String(singleEmployeeId)) && singleEmployeeId !== scope.employeeId) return false;
  if (employeeIds.length && !employeeIds.some((id) => scope.identifiers.has(id) || id === scope.employeeId)) return false;
  if (singleDepartmentId && String(singleDepartmentId) !== String(scope.departmentId)) return false;
  if (departmentIds.length && !departmentIds.includes(String(scope.departmentId))) return false;
  if (branchId && scope.branchId && String(branchId) !== String(scope.branchId)) return false;
  if (branchId && !scope.branchId) return false;
  return true;
}

function getAssignedLocations(scope) {
  return activeRecords(LOCATION_COLLECTION).filter((location) => isActive(location) && assignedToScope(location, scope));
}

function getAssignedSchedules(scope, at = new Date()) {
  const locations = getAssignedLocations(scope);
  const locationIds = new Set(locations.map((location) => location.id));
  return activeRecords(SCHEDULE_COLLECTION)
    .filter((schedule) => isActive(schedule) && assignedToScope(schedule, scope))
    .map((schedule) => {
      const explicitLocationIds = normalizeAssignedIds(schedule.locationIds || schedule.location_ids);
      const scheduleLocations = explicitLocationIds.length
        ? locations.filter((location) => explicitLocationIds.includes(location.id))
        : locations;
      const timezone = schedule.timezone || schedule.time_zone || scheduleLocations[0]?.timezone || scheduleLocations[0]?.time_zone || "Africa/Lagos";
      return { schedule, locations: scheduleLocations.filter((location) => locationIds.has(location.id)), window: evaluateScheduleWindow(schedule, at, timezone) };
    })
    .filter((entry) => entry.locations.length);
}

function sanitizeLocation(location, includeCoordinates = false) {
  return {
    id: location.id,
    name: location.name,
    description: location.description || null,
    address: location.address || null,
    ...(includeCoordinates ? { latitude: location.latitude, longitude: location.longitude } : {}),
    radiusMeters: Number(location.radiusMeters || location.radius_meters || DEFAULT_RADIUS_METERS),
    timezone: location.timezone || location.time_zone || "Africa/Lagos",
    active: isActive(location),
    organizationId: location.organizationId || location.organization_id || null,
    branchId: location.branchId || location.branch_id || null,
    departmentId: location.departmentId || location.department_id || null,
    departmentIds: normalizeAssignedIds(location.departmentIds || location.department_ids),
    employeeIds: normalizeAssignedIds(location.employeeIds || location.employee_ids),
    createdAt: location.createdAt || location.created_at || null,
    updatedAt: location.updatedAt || location.updated_at || null,
  };
}

function sanitizeSchedule(schedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    description: schedule.description || null,
    openingTime: schedule.openingTime || schedule.opening_time || DEFAULT_OPENING_TIME,
    lateAfterTime: schedule.lateAfterTime || schedule.late_after_time || DEFAULT_LATE_AFTER_TIME,
    closingTime: schedule.closingTime || schedule.closing_time || DEFAULT_CLOSING_TIME,
    daysOfWeek: normalizeDays(schedule.daysOfWeek || schedule.days_of_week),
    timezone: schedule.timezone || schedule.time_zone || null,
    startDate: schedule.startDate || schedule.start_date || null,
    endDate: schedule.endDate || schedule.end_date || null,
    locationIds: normalizeAssignedIds(schedule.locationIds || schedule.location_ids),
    active: isActive(schedule),
    organizationId: schedule.organizationId || schedule.organization_id || null,
    branchId: schedule.branchId || schedule.branch_id || null,
    departmentId: schedule.departmentId || schedule.department_id || null,
    departmentIds: normalizeAssignedIds(schedule.departmentIds || schedule.department_ids),
    employeeIds: normalizeAssignedIds(schedule.employeeIds || schedule.employee_ids),
    createdAt: schedule.createdAt || schedule.created_at || null,
    updatedAt: schedule.updatedAt || schedule.updated_at || null,
  };
}

function createLocation(payload = {}, req) {
  assertCanManage(req.user);
  assertManagerPayloadScope(req.user, payload);
  const values = normalizeLocationPayload(payload, req.user);
  if (!values.name) throw createHttpError(400, "Attendance location name is required.", "ATTENDANCE_LOCATION_NAME_REQUIRED");
  const timestamp = now();
  const record = {
    id: crypto.randomUUID(),
    ...values,
    createdBy: req.user.id,
    created_by: req.user.id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  appendRecord(LOCATION_COLLECTION, record);
  audit(req, "ATTENDANCE_LOCATION_CREATED", LOCATION_COLLECTION, record.id, null, safeAuditLocation(record));
  notifyAttendanceChange("ATTENDANCE_LOCATION_UPDATED", "Check-in location updated", "An attendance location assigned to you was created.", record);
  return sanitizeLocation(record, true);
}

function updateRecord(collection, id, updates) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt && !record.deleted_at);
  if (index === -1) return null;
  records[index] = { ...records[index], ...updates, id, updatedAt: now(), updated_at: now() };
  writeCollection(collection, records);
  return records[index];
}

function getLocationForManager(id, user) {
  const location = activeRecords(LOCATION_COLLECTION).find((record) => record.id === id);
  if (!location) return null;
  if (user?.role === "superadmin") return location;
  const scope = buildManagerScope(user);
  if (!scope || !sameOrganization(location, scope.organizationId)) {
    throw createHttpError(404, "Attendance location was not found.", "ATTENDANCE_LOCATION_NOT_FOUND");
  }
  const departments = [location.departmentId, location.department_id, ...normalizeAssignedIds(location.departmentIds || location.department_ids)].filter(Boolean);
  const employees = normalizeAssignedIds(location.employeeIds || location.employee_ids);
  const branchId = location.branchId || location.branch_id || null;
  const scoped =
    departments.some((id) => scope.departmentIds.has(id)) ||
    employees.some((id) => scope.employeeIds.has(id)) ||
    (branchId && scope.branchIds.has(branchId));
  if (!scoped) {
    throw createHttpError(404, "Attendance location was not found.", "ATTENDANCE_LOCATION_NOT_FOUND");
  }
  return location;
}

function updateLocation(id, payload = {}, req) {
  assertCanManage(req.user);
  const existing = getLocationForManager(id, req.user);
  if (!existing) return null;
  assertManagerPayloadScope(req.user, { ...existing, ...payload });
  const updated = updateRecord(LOCATION_COLLECTION, id, {
    ...normalizeLocationPayload({ ...existing, ...payload }, req.user),
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, "ATTENDANCE_LOCATION_UPDATED", LOCATION_COLLECTION, id, safeAuditLocation(existing), safeAuditLocation(updated));
  notifyAttendanceChange("ATTENDANCE_LOCATION_UPDATED", "Check-in location updated", "An attendance location assigned to you was updated.", updated);
  return sanitizeLocation(updated, true);
}

function setLocationActive(id, active, req) {
  assertCanManage(req.user);
  const existing = getLocationForManager(id, req.user);
  if (!existing) return null;
  const updated = updateRecord(LOCATION_COLLECTION, id, {
    active,
    isActive: active,
    is_active: active,
    status: active ? "active" : "inactive",
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, active ? "ATTENDANCE_LOCATION_ENABLED" : "ATTENDANCE_LOCATION_DISABLED", LOCATION_COLLECTION, id, safeAuditLocation(existing), safeAuditLocation(updated));
  notifyAttendanceChange("ATTENDANCE_LOCATION_UPDATED", active ? "Check-in location enabled" : "Check-in location disabled", "An attendance location assigned to you was updated.", updated);
  return sanitizeLocation(updated, true);
}

function createSchedule(payload = {}, req) {
  assertCanManage(req.user);
  assertManagerPayloadScope(req.user, payload);
  const values = normalizeSchedulePayload(payload, req.user);
  if (!values.name) throw createHttpError(400, "Attendance schedule name is required.", "ATTENDANCE_SCHEDULE_NAME_REQUIRED");
  for (const locationId of values.locationIds || []) {
    if (!getLocationForManager(locationId, req.user)) {
      throw createHttpError(404, "Attendance location was not found.", "ATTENDANCE_LOCATION_NOT_FOUND");
    }
  }
  const timestamp = now();
  const record = {
    id: crypto.randomUUID(),
    ...values,
    createdBy: req.user.id,
    created_by: req.user.id,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  };
  appendRecord(SCHEDULE_COLLECTION, record);
  audit(req, "ATTENDANCE_SCHEDULE_CREATED", SCHEDULE_COLLECTION, record.id, null, record);
  notifyAttendanceChange("ATTENDANCE_LOCATION_UPDATED", "Check-in schedule updated", "Your check-in schedule was created.", record);
  return sanitizeSchedule(record);
}

function getScheduleForManager(id, user) {
  const schedule = activeRecords(SCHEDULE_COLLECTION).find((record) => record.id === id);
  if (!schedule) return null;
  if (user?.role === "superadmin") return schedule;
  const scope = buildManagerScope(user);
  if (!scope || !sameOrganization(schedule, scope.organizationId)) {
    throw createHttpError(404, "Attendance schedule was not found.", "ATTENDANCE_SCHEDULE_NOT_FOUND");
  }
  const departments = [schedule.departmentId, schedule.department_id, ...normalizeAssignedIds(schedule.departmentIds || schedule.department_ids)].filter(Boolean);
  const employees = normalizeAssignedIds(schedule.employeeIds || schedule.employee_ids);
  const branchId = schedule.branchId || schedule.branch_id || null;
  const scoped =
    departments.some((id) => scope.departmentIds.has(id)) ||
    employees.some((id) => scope.employeeIds.has(id)) ||
    (branchId && scope.branchIds.has(branchId));
  if (!scoped) {
    throw createHttpError(404, "Attendance schedule was not found.", "ATTENDANCE_SCHEDULE_NOT_FOUND");
  }
  return schedule;
}

function updateSchedule(id, payload = {}, req) {
  assertCanManage(req.user);
  const existing = getScheduleForManager(id, req.user);
  if (!existing) return null;
  assertManagerPayloadScope(req.user, { ...existing, ...payload });
  const updates = normalizeSchedulePayload({ ...existing, ...payload }, req.user);
  for (const locationId of updates.locationIds || []) {
    if (!getLocationForManager(locationId, req.user)) {
      throw createHttpError(404, "Attendance location was not found.", "ATTENDANCE_LOCATION_NOT_FOUND");
    }
  }
  const updated = updateRecord(SCHEDULE_COLLECTION, id, { ...updates, updatedBy: req.user.id, updated_by: req.user.id });
  audit(req, "ATTENDANCE_SCHEDULE_UPDATED", SCHEDULE_COLLECTION, id, existing, updated);
  notifyAttendanceChange("ATTENDANCE_LOCATION_UPDATED", "Check-in schedule updated", "Your check-in schedule was updated.", updated);
  return sanitizeSchedule(updated);
}

function setScheduleActive(id, active, req) {
  assertCanManage(req.user);
  const existing = getScheduleForManager(id, req.user);
  if (!existing) return null;
  const updated = updateRecord(SCHEDULE_COLLECTION, id, {
    active,
    isActive: active,
    is_active: active,
    status: active ? "active" : "inactive",
    updatedBy: req.user.id,
    updated_by: req.user.id,
  });
  audit(req, active ? "ATTENDANCE_SCHEDULE_ENABLED" : "ATTENDANCE_SCHEDULE_DISABLED", SCHEDULE_COLLECTION, id, existing, updated);
  return sanitizeSchedule(updated);
}

function listLocations(user, query = {}) {
  assertCanView(user);
  const scope = buildManagerScope(user);
  const records = activeRecords(LOCATION_COLLECTION).filter((location) => {
    if (user.role === "superadmin") return true;
    if (!scope || !sameOrganization(location, scope.organizationId)) return false;
    const departments = [location.departmentId, location.department_id, ...normalizeAssignedIds(location.departmentIds || location.department_ids)].filter(Boolean);
    const employees = normalizeAssignedIds(location.employeeIds || location.employee_ids);
    const branchId = location.branchId || location.branch_id || null;
    return departments.some((id) => scope.departmentIds.has(id)) || employees.some((id) => scope.employeeIds.has(id)) || (branchId && scope.branchIds.has(branchId));
  });
  const result = paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["name", "description", "address", "status"]), query);
  return { data: result.data.map((record) => sanitizeLocation(record, true)), meta: result.meta };
}

function listSchedules(user, query = {}) {
  assertCanView(user);
  const scope = buildManagerScope(user);
  const records = activeRecords(SCHEDULE_COLLECTION).filter((schedule) => {
    if (user.role === "superadmin") return true;
    if (!scope || !sameOrganization(schedule, scope.organizationId)) return false;
    const departments = [schedule.departmentId, schedule.department_id, ...normalizeAssignedIds(schedule.departmentIds || schedule.department_ids)].filter(Boolean);
    const employees = normalizeAssignedIds(schedule.employeeIds || schedule.employee_ids);
    const branchId = schedule.branchId || schedule.branch_id || null;
    return departments.some((id) => scope.departmentIds.has(id)) || employees.some((id) => scope.employeeIds.has(id)) || (branchId && scope.branchIds.has(branchId));
  });
  const result = paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["name", "description", "status"]), query);
  return { data: result.data.map(sanitizeSchedule), meta: result.meta };
}

function listMyLocations(user, query = {}) {
  const scope = buildEmployeeScope(user);
  const result = paginate(applyBasicFilters(getAssignedLocations(scope), { ...query, q: query.q || query.search }, ["name", "description", "address"]), query);
  return {
    data: result.data.map((location) => sanitizeLocation(location, false)),
    meta: { ...result.meta, gpsAccuracyPolicy: getGpsPolicy() },
  };
}

function getGpsPolicy() {
  return {
    maxAccuracyMeters: MAX_GPS_ACCURACY_METERS,
    maxLocationAgeSeconds: MAX_LOCATION_AGE_SECONDS,
    radiusPolicy: "The backend does not expand the approved radius for poor GPS accuracy. Browser GPS can be spoofed; this check-in is not spoof-proof.",
    locationRetentionDays: LOCATION_RETENTION_DAYS,
    defaultOpeningTime: DEFAULT_OPENING_TIME,
    defaultLateAfterTime: DEFAULT_LATE_AFTER_TIME,
    defaultClosingTime: DEFAULT_CLOSING_TIME,
  };
}

function getCheckInStatus(user, query = {}, at = new Date()) {
  const scope = buildEmployeeScope(user);
  assertEmployeeCanCheckIn(scope);
  const applicable = getAssignedSchedules(scope, at).map(({ schedule, locations, window }) => {
    const existing = findExistingCheckIn(scope.employeeId, schedule.id, window.workDate);
    return {
      schedule: sanitizeSchedule(schedule),
      locations: locations.map((location) => sanitizeLocation(location, false)),
      window,
      alreadyCheckedIn: Boolean(existing),
      checkIn: existing ? sanitizeAttendance(existing) : null,
      canCheckIn: window.isOpen && !existing,
      reason: existing ? "ALREADY_CHECKED_IN" : window.reason,
    };
  });

  return {
    employeeId: scope.employeeId,
    organizationId: scope.organizationId,
    serverTime: at.toISOString(),
    gpsAccuracyPolicy: getGpsPolicy(),
    schedules: applicable,
    canCheckIn: applicable.some((entry) => entry.canCheckIn),
  };
}

function assertEmployeeCanCheckIn(scope) {
  const userStatus = String(scope.user.status || "active").toLowerCase();
  const employeeStatus = String(scope.employee.status || scope.employee.employmentStatus || scope.employee.employment_status || "active").toLowerCase();
  if (userStatus !== "active" || !ACTIVE_STATUSES.has(employeeStatus)) {
    throw createHttpError(403, "This account is not eligible to check in.", "CHECK_IN_ACCOUNT_INACTIVE", { userStatus, employeeStatus });
  }
}

function validatePositionPayload(payload = {}, at = new Date()) {
  const latitude = toCoordinate(payload.latitude ?? payload.lat, -90, 90, "latitude");
  const longitude = toCoordinate(payload.longitude ?? payload.lng ?? payload.lon, -180, 180, "longitude");
  const accuracyMeters = Number(payload.accuracyMeters ?? payload.accuracy_meters ?? payload.accuracy);
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    throw createHttpError(400, "A valid GPS accuracy value is required.", "INVALID_LOCATION_ACCURACY");
  }
  if (accuracyMeters > MAX_GPS_ACCURACY_METERS) {
    throw createHttpError(422, "We could not get an accurate location. Move to an open area and try again.", "LOW_LOCATION_ACCURACY", {
      maxAccuracyMeters: MAX_GPS_ACCURACY_METERS,
      accuracyMeters,
    });
  }

  const locationTimestamp = payload.locationTimestamp || payload.location_timestamp || payload.timestamp;
  const locationTime = locationTimestamp ? new Date(locationTimestamp) : null;
  if (!locationTime || Number.isNaN(locationTime.getTime())) {
    throw createHttpError(400, "A fresh location timestamp is required.", "LOCATION_TIMESTAMP_REQUIRED");
  }
  const ageSeconds = Math.abs(at.getTime() - locationTime.getTime()) / 1000;
  if (ageSeconds > MAX_LOCATION_AGE_SECONDS) {
    throw createHttpError(422, "Location reading is stale. Please try again.", "STALE_LOCATION_READING", {
      maxLocationAgeSeconds: MAX_LOCATION_AGE_SECONDS,
      locationAgeSeconds: Math.round(ageSeconds),
    });
  }

  return {
    latitude,
    longitude,
    accuracyMeters,
    locationTimestamp: locationTime.toISOString(),
    clientTimezone: payload.clientTimezone || payload.client_timezone || null,
    device: payload.device || payload.deviceInfo || payload.device_info || null,
  };
}

function findLatestCheckIn(employeeId) {
  return activeRecords(ATTENDANCE_COLLECTION)
    .filter((record) => (record.employeeId || record.employee_id) === employeeId && record.latitude != null && record.longitude != null)
    .sort((left, right) => new Date(right.checkInAt || right.check_in_at || right.createdAt || 0) - new Date(left.checkInAt || left.check_in_at || left.createdAt || 0))[0] || null;
}

function notifyAttendanceChange(type, title, message, record) {
  try {
    const userIds = new Set();
    const assignedIds = [
      record.employeeId,
      record.employee_id,
      ...normalizeAssignedIds(record.employeeIds || record.employee_ids),
    ].filter(Boolean);
    const departmentIds = new Set([
      record.departmentId,
      record.department_id,
      ...normalizeAssignedIds(record.departmentIds || record.department_ids),
    ].filter(Boolean));

    for (const employee of activeRecords("employees")) {
      const matchesAssignment = assignedIds.some((id) => [employee.id, employee.userId, employee.user_id].map(String).includes(String(id)));
      const matchesDepartment = departmentIds.has(employee.departmentId || employee.department_id);
      if ((matchesAssignment || matchesDepartment) && (employee.userId || employee.user_id)) {
        userIds.add(employee.userId || employee.user_id);
      }
    }

    for (const userId of userIds) {
      const user = getUserById(userId);
      notificationService.send({
        userId,
        type,
        title,
        message,
        destinationUrl: checkInDestination(user?.role),
        channels: ["in_app", "push"],
        idempotencyKey: `${type}:${record.id}:${userId}`,
        data: { recordId: record.id },
      });
    }
  } catch (_error) {
    // Push/in-app delivery must not fail location or schedule writes.
  }
}

function findExistingCheckIn(employeeId, scheduleId, workDate) {
  return activeRecords(ATTENDANCE_COLLECTION).find((record) =>
    (record.employeeId || record.employee_id) === employeeId &&
    (record.scheduleId || record.schedule_id) === scheduleId &&
    (record.workDate || record.work_date || record.date) === workDate &&
    !["rejected", "void"].includes(String(record.status || "").toLowerCase())
  ) || null;
}

function selectCheckInCandidate(scope, payload, reading, at) {
  const scheduleId = payload.scheduleId || payload.schedule_id || null;
  const locationId = payload.locationId || payload.location_id || null;
  const schedules = getAssignedSchedules(scope, at).filter((entry) => !scheduleId || entry.schedule.id === scheduleId);
  if (!schedules.length) {
    throw createHttpError(403, "This location is not assigned to your account.", "NO_ASSIGNED_ATTENDANCE_SCHEDULE");
  }

  const candidates = [];
  for (const entry of schedules) {
    if (!entry.window.isOpen) {
      continue;
    }
    if (findExistingCheckIn(scope.employeeId, entry.schedule.id, entry.window.workDate)) {
      continue;
    }
    for (const location of entry.locations) {
      if (locationId && location.id !== locationId) continue;
      const distanceMeters = haversineDistanceMeters(
        { latitude: reading.latitude, longitude: reading.longitude },
        { latitude: location.latitude, longitude: location.longitude }
      );
      candidates.push({ ...entry, location, distanceMeters });
    }
  }

  if (!candidates.length) {
    const status = getCheckInStatus(scope.user, {}, at);
    const first = status.schedules.find((entry) => scheduleId ? entry.schedule.id === scheduleId : true);
    if (first?.alreadyCheckedIn) {
      throw createHttpError(409, "You have already checked in today.", "ALREADY_CHECKED_IN", { workDate: first.window.workDate });
    }
    if (first?.window.reason === "ATTENDANCE_NOT_OPEN") {
      throw createHttpError(422, `Check-in opens at ${first.window.openingTime}.`, "ATTENDANCE_NOT_OPEN", { openingTime: first.window.openingTime });
    }
    if (first?.window.reason === "ATTENDANCE_CLOSED") {
      throw createHttpError(422, "The check-in period has closed.", "ATTENDANCE_CLOSED", { closingTime: first.window.closingTime });
    }
    throw createHttpError(403, "This location is not assigned to your account.", "NO_ASSIGNED_ATTENDANCE_LOCATION");
  }

  const insideCandidates = candidates
    .filter((candidate) => candidate.distanceMeters <= Number(candidate.location.radiusMeters || candidate.location.radius_meters || DEFAULT_RADIUS_METERS))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  if (!insideCandidates.length) {
    const nearest = candidates.sort((left, right) => left.distanceMeters - right.distanceMeters)[0];
    throw createHttpError(422, "You are outside the approved work location.", "OUTSIDE_ATTENDANCE_LOCATION", {
      distanceMeters: Math.round(nearest.distanceMeters),
      radiusMeters: Number(nearest.location.radiusMeters || nearest.location.radius_meters || DEFAULT_RADIUS_METERS),
    });
  }
  return insideCandidates[0];
}

function createCheckIn(payload = {}, req, options = {}) {
  const at = options.now ? new Date(options.now) : new Date();
  const scope = buildEmployeeScope(req.user);
  assertEmployeeCanCheckIn(scope);
  const reading = validatePositionPayload(payload, at);
  const idempotencyKey = req.get?.("idempotency-key") || payload.idempotencyKey || payload.idempotency_key || null;
  if (idempotencyKey) {
    const previous = activeRecords(ATTENDANCE_COLLECTION).find(
      (record) => (record.idempotencyKey || record.idempotency_key) === idempotencyKey && (record.userId || record.user_id) === req.user.id
    );
    if (previous) return { record: sanitizeAttendance(previous), created: false, idempotent: true };
  }

  const candidate = selectCheckInCandidate(scope, payload, reading, at);
  const lockKey = `${scope.employeeId}:${candidate.schedule.id}:${candidate.window.workDate}`;
  if (checkInLocks.has(lockKey)) {
    throw createHttpError(409, "You have already checked in today.", "ALREADY_CHECKED_IN", { workDate: candidate.window.workDate });
  }
  checkInLocks.add(lockKey);
  try {
    const existing = findExistingCheckIn(scope.employeeId, candidate.schedule.id, candidate.window.workDate);
    if (existing) {
      throw createHttpError(409, "You have already checked in today.", "ALREADY_CHECKED_IN", { workDate: candidate.window.workDate });
    }

    const checkInStatus = candidate.window.isLate ? "late" : "on_time";
    const riskFlags = assessCheckInRisk({
      reading,
      candidate,
      previousCheckIn: findLatestCheckIn(scope.employeeId),
      at,
    });
    const timestamp = now();
    const record = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      user_id: req.user.id,
      employeeId: scope.employeeId,
      employee_id: scope.employeeId,
      employeeName: scope.employee.fullName || scope.employee.name || req.user.fullName || req.user.name || null,
      employee_name: scope.employee.fullName || scope.employee.name || req.user.fullName || req.user.name || null,
      organizationId: scope.organizationId,
      organization_id: scope.organizationId,
      departmentId: scope.departmentId,
      department_id: scope.departmentId,
      locationId: candidate.location.id,
      location_id: candidate.location.id,
      scheduleId: candidate.schedule.id,
      schedule_id: candidate.schedule.id,
      workDate: candidate.window.workDate,
      work_date: candidate.window.workDate,
      date: candidate.window.workDate,
      checkIn: at.toISOString(),
      check_in: at.toISOString(),
      checkInAt: at.toISOString(),
      check_in_at: at.toISOString(),
      latitude: reading.latitude,
      longitude: reading.longitude,
      accuracyMeters: reading.accuracyMeters,
      accuracy_meters: reading.accuracyMeters,
      calculatedDistanceMeters: Math.round(candidate.distanceMeters * 100) / 100,
      calculated_distance_meters: Math.round(candidate.distanceMeters * 100) / 100,
      clientLocationTimestamp: reading.locationTimestamp,
      client_location_timestamp: reading.locationTimestamp,
      clientTimezone: reading.clientTimezone,
      client_timezone: reading.clientTimezone,
      timezone: candidate.window.timezone,
      status: checkInStatus,
      attendanceStatus: checkInStatus,
      attendance_status: checkInStatus,
      riskFlags,
      risk_flags: riskFlags,
      source: "web_check_in",
      idempotencyKey,
      idempotency_key: idempotencyKey,
      device: reading.device,
      createdAt: timestamp,
      created_at: timestamp,
      updatedAt: timestamp,
      updated_at: timestamp,
    };

    appendRecord(ATTENDANCE_COLLECTION, record);
    audit(req, "ATTENDANCE_CHECK_IN_ACCEPTED", ATTENDANCE_COLLECTION, record.id, null, safeAuditAttendance(record));
    try {
      notificationService.send({
        userId: req.user.id,
        type: "ATTENDANCE_CHECK_IN_ACCEPTED",
        title: "Check-in successful",
        message: `Your ${checkInStatus === "late" ? "late" : "on-time"} check-in was recorded.`,
        destinationUrl: checkInDestination(req.user.role),
        idempotencyKey: `attendance-check-in:${record.id}`,
        channels: ["in_app", "push"],
        data: { attendanceId: record.id, workDate: record.workDate, status: checkInStatus },
      });
    } catch (_error) {
      // Persistent check-in already saved; push failure must not roll it back.
    }
    return { record: sanitizeAttendance(record), created: true, idempotent: false };
  } finally {
    checkInLocks.delete(lockKey);
  }
}

function auditCheckInRejected(req, error) {
  audit(req, "ATTENDANCE_CHECK_IN_REJECTED", ATTENDANCE_COLLECTION, null, null, {
    code: error?.code || "ATTENDANCE_CHECK_IN_REJECTED",
    message: error?.publicMessage || error?.message || "Check-in rejected.",
  });
}

function safeAuditLocation(location) {
  if (!location) return null;
  return {
    id: location.id,
    name: location.name,
    organizationId: location.organizationId || location.organization_id || null,
    departmentId: location.departmentId || location.department_id || null,
    radiusMeters: location.radiusMeters || location.radius_meters || null,
    active: isActive(location),
  };
}

function safeAuditAttendance(record) {
  if (!record) return null;
  return {
    id: record.id,
    employeeId: record.employeeId || record.employee_id,
    organizationId: record.organizationId || record.organization_id || null,
    departmentId: record.departmentId || record.department_id || null,
    locationId: record.locationId || record.location_id,
    scheduleId: record.scheduleId || record.schedule_id,
    workDate: record.workDate || record.work_date || record.date,
    status: record.attendanceStatus || record.attendance_status || record.status,
    calculatedDistanceMeters: record.calculatedDistanceMeters || record.calculated_distance_meters,
    accuracyMeters: record.accuracyMeters || record.accuracy_meters,
    riskFlags: record.riskFlags || record.risk_flags || [],
  };
}

function getAttendanceLocationName(locationId) {
  if (!locationId) return null;
  const location = activeRecords(LOCATION_COLLECTION).find((record) => record.id === locationId);
  return location?.name || null;
}

function getAttendanceScheduleName(scheduleId) {
  if (!scheduleId) return null;
  const schedule = activeRecords(SCHEDULE_COLLECTION).find((record) => record.id === scheduleId);
  return schedule?.name || null;
}

function audit(req, action, module, recordId, oldValue, newValue) {
  return recordOperationalAudit({
    user: req.user,
    action,
    module: "Attendance",
    recordId,
    targetType: module,
    oldValue,
    newValue,
    ipAddress: req.ip,
    userAgent: req.get?.("user-agent"),
    requestId: req.id,
    metadata: {
      organizationId: req.user?.organizationId || req.user?.organization_id || null,
      role: req.user?.role || null,
    },
  });
}

function sanitizeAttendance(record, includeCoordinates = false) {
  return {
    id: record.id,
    employeeId: record.employeeId || record.employee_id,
    employeeName: record.employeeName || record.employee_name || null,
    organizationId: record.organizationId || record.organization_id || null,
    departmentId: record.departmentId || record.department_id || null,
    locationId: record.locationId || record.location_id || null,
    locationName: getAttendanceLocationName(record.locationId || record.location_id),
    scheduleId: record.scheduleId || record.schedule_id || null,
    scheduleName: getAttendanceScheduleName(record.scheduleId || record.schedule_id),
    workDate: record.workDate || record.work_date || record.date,
    checkInAt: record.checkInAt || record.check_in_at || record.checkIn || record.check_in || null,
    checkOutAt: record.checkOutAt || record.check_out_at || record.checkOut || record.check_out || null,
    accuracyMeters: record.accuracyMeters || record.accuracy_meters || null,
    calculatedDistanceMeters: record.calculatedDistanceMeters || record.calculated_distance_meters || null,
    clientLocationTimestamp: record.clientLocationTimestamp || record.client_location_timestamp || null,
    clientTimezone: record.clientTimezone || record.client_timezone || null,
    timezone: record.timezone || null,
    status: record.attendanceStatus || record.attendance_status || record.status,
    riskFlags: record.riskFlags || record.risk_flags || [],
    ...(includeCoordinates ? { latitude: record.latitude, longitude: record.longitude } : {}),
    createdAt: record.createdAt || record.created_at || null,
  };
}

function listMyHistory(user, query = {}) {
  const scope = buildEmployeeScope(user);
  const records = activeRecords(ATTENDANCE_COLLECTION).filter((record) => (record.employeeId || record.employee_id) === scope.employeeId);
  const result = paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["employeeName", "employee_name", "status", "attendanceStatus"]), query);
  return { data: result.data.map(sanitizeAttendance), meta: result.meta };
}

function recordInViewScope(record, scope) {
  if (scope?.superadmin) return true;
  if (scope?.organizationWide) return sameOrganization(record, scope.organizationId);
  if (!scope || !sameOrganization(record, scope.organizationId)) return false;
  const employeeId = record.employeeId || record.employee_id;
  const departmentId = record.departmentId || record.department_id;
  return (employeeId && scope.employeeIds.has(employeeId)) || (departmentId && scope.departmentIds.has(departmentId));
}

function buildRecordViewScope(user) {
  const role = normalizeRole(user?.role);
  if (!ATTENDANCE_MONITOR_ROLES.has(role)) {
    throw createHttpError(403, "Attendance monitoring is limited to Super Admin, HR, and managers.", "ATTENDANCE_MONITOR_FORBIDDEN");
  }
  if (role === "superadmin") {
    return { superadmin: true, organizationId: getOrganizationId(user) };
  }
  if (HR_VIEW_ROLES.has(role)) {
    return { organizationWide: true, organizationId: getOrganizationId(user) };
  }
  const scope = buildManagerScope(user);
  if (!scope) {
    throw createHttpError(403, "Attendance monitoring is limited to Super Admin, HR, and managers.", "ATTENDANCE_MONITOR_FORBIDDEN");
  }
  return scope;
}

function listRecords(user, query = {}) {
  assertCanView(user);
  const scope = buildRecordViewScope(user);
  const records = activeRecords(ATTENDANCE_COLLECTION).filter((record) => recordInViewScope(record, scope));
  const result = paginate(applyBasicFilters(records, { ...query, q: query.q || query.search }, ["employeeName", "employee_name", "status", "attendanceStatus", "source"]), query);
  return { data: result.data.map((record) => sanitizeAttendance(record, normalizeRole(user.role) === "superadmin")), meta: result.meta };
}

function getRecord(id, user) {
  assertCanView(user);
  const scope = buildRecordViewScope(user);
  const record = activeRecords(ATTENDANCE_COLLECTION).find((item) => item.id === id);
  if (!record || !recordInViewScope(record, scope)) return null;
  return sanitizeAttendance(record, normalizeRole(user.role) === "superadmin");
}

function getSummary(user, query = {}) {
  const records = listRecords(user, { ...query, limit: 100 }).data;
  const counts = records.reduce((summary, record) => {
    const status = String(record.status || "unknown").toLowerCase();
    summary[status] = (summary[status] || 0) + 1;
    summary.total += 1;
    return summary;
  }, { total: 0, on_time: 0, late: 0 });
  return { ...counts, period: query.period || "current" };
}

module.exports = {
  auditCheckInRejected,
  createCheckIn,
  createLocation,
  createSchedule,
  DEFAULT_OPENING_TIME,
  evaluateScheduleWindow,
  getCheckInStatus,
  getRecord,
  getSummary,
  haversineDistanceMeters,
  listLocations,
  listMyHistory,
  listMyLocations,
  listRecords,
  listSchedules,
  setLocationActive,
  setScheduleActive,
  updateLocation,
  updateSchedule,
};
