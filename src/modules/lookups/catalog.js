const crypto = require("crypto");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { ROLE_DEFINITIONS } = require("../../constants/rbac");

const DEFAULT_DEPARTMENTS = Object.freeze([
  { name: "Software Engineers", code: "SE" },
  { name: "Finance", code: "FIN" },
  { name: "Human Resources", code: "HR" },
  { name: "Media / Photography", code: "MED" },
  { name: "Administration", code: "ADM" },
  { name: "IT & Operations", code: "ITO" },
]);

const EMPLOYMENT_TYPES = Object.freeze([
  { key: "full_time", label: "Full-time", staffType: "employee" },
  { key: "nysc", label: "NYSC", staffType: "nysc" },
  { key: "intern", label: "Intern", staffType: "intern" },
]);

const EMPLOYMENT_TYPE_ALIASES = Object.freeze({
  fulltime: "full_time",
  full_time: "full_time",
  "full-time": "full_time",
  "full time": "full_time",
  permanent: "full_time",
  employee: "full_time",
  nysc: "nysc",
  nysc_intern: "nysc",
  "nysc intern": "nysc",
  intern: "intern",
  interns: "intern",
  internship: "intern",
});

function now() {
  return new Date().toISOString();
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function ensureDefaultDepartments() {
  const existing = readCollection("departments").filter((department) => !department.deletedAt && !department.deleted_at);
  if (existing.length) {
    return existing;
  }

  const timestamp = now();
  const seeded = DEFAULT_DEPARTMENTS.map((department) => ({
    id: crypto.randomUUID(),
    name: department.name,
    code: department.code,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  writeCollection("departments", seeded);
  return seeded;
}

function listDepartmentOptions() {
  return ensureDefaultDepartments()
    .filter((department) => String(department.status || "active").toLowerCase() !== "inactive")
    .map((department) => ({
      id: department.id,
      name: department.name || department.departmentName,
      code: department.code || department.departmentCode || null,
    }))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

function resolveDepartment(departmentIdOrName) {
  if (!departmentIdOrName) {
    return null;
  }

  const requested = String(departmentIdOrName).trim().toLowerCase();
  return (
    ensureDefaultDepartments().find(
      (department) =>
        department.id === departmentIdOrName ||
        String(department.name || "").toLowerCase() === requested ||
        String(department.code || "").toLowerCase() === requested
    ) || null
  );
}

function listEmploymentTypes() {
  return EMPLOYMENT_TYPES.map((item) => ({ key: item.key, label: item.label, staffType: item.staffType }));
}

function resolveEmploymentType(value) {
  if (!value) {
    return EMPLOYMENT_TYPES[0];
  }

  const requested = String(value).trim().toLowerCase();
  const aliased = EMPLOYMENT_TYPE_ALIASES[requested] || EMPLOYMENT_TYPE_ALIASES[normalizeKey(requested)] || normalizeKey(requested);
  return EMPLOYMENT_TYPES.find((item) => item.key === aliased || item.label.toLowerCase() === requested) || EMPLOYMENT_TYPES[0];
}

function listRoleOptions() {
  return Object.values(ROLE_DEFINITIONS)
    .filter((role) => role.key !== "superadmin")
    .map((role) => ({ key: role.key, name: role.name }));
}

const LOCATION_TYPES = Object.freeze([
  { key: "onsite", label: "Onsite" },
  { key: "remote", label: "Remote" },
]);

function looksLikeRecordId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeWorkLocation(payload = {}) {
  const requestedType = String(payload.locationType || payload.location_type || payload.workMode || payload.work_mode || "").trim().toLowerCase();
  const rawLocation = String(payload.location || payload.workLocation || payload.work_location || "").trim();
  const location = looksLikeRecordId(rawLocation) ? "" : rawLocation;
  if (requestedType === "remote" || location.toLowerCase() === "remote") {
    return { locationType: "remote", location: location && location.toLowerCase() !== "remote" ? location : "Remote" };
  }
  if (requestedType === "onsite" || location) {
    return { locationType: "onsite", location: location || null };
  }
  return { locationType: null, location: null };
}

function displayLocation(record = {}) {
  const normalized = normalizeWorkLocation(record);
  if (normalized.locationType === "remote") {
    return normalized.location || "Remote";
  }
  return normalized.location || null;
}

function getLookups() {
  return {
    departments: listDepartmentOptions(),
    employmentTypes: listEmploymentTypes(),
    roles: listRoleOptions(),
    locationTypes: LOCATION_TYPES,
  };
}

module.exports = {
  DEFAULT_DEPARTMENTS,
  EMPLOYMENT_TYPES,
  LOCATION_TYPES,
  displayLocation,
  ensureDefaultDepartments,
  getLookups,
  listDepartmentOptions,
  listEmploymentTypes,
  listRoleOptions,
  normalizeWorkLocation,
  resolveDepartment,
  resolveEmploymentType,
};
