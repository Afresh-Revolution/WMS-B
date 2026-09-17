const crypto = require("crypto");
const { readCollection, writeCollection } = require("../../database/jsonStore");

const STAFF_PROFILE_ROLES = new Set([
  "employee",
  "accountant",
  "intern",
  "nysc_intern",
  "manager",
  "hr",
  "hod",
  "secretary",
  "department_manager",
]);

function now() {
  return new Date().toISOString();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function employmentStatusForUser(user) {
  const status = String(user?.status || "active").trim().toLowerCase();
  if (["inactive", "locked", "suspended", "deactivated", "terminated", "deleted"].includes(status)) {
    return status === "deactivated" ? "inactive" : status;
  }
  return "active";
}

function listEmployeeRecords() {
  return readCollection("employees").filter((record) => !record.deletedAt && !record.deleted_at);
}

function findEmployeeForUser(user) {
  if (!user) {
    return null;
  }
  const userIds = [user.id, user.employeeId, user.employee_id].filter(Boolean).map(String);
  const email = normalizeEmail(user.email);
  return (
    listEmployeeRecords().find((employee) => {
      const recordIds = [employee.id, employee.userId, employee.user_id, employee.employeeId, employee.employee_id]
        .filter(Boolean)
        .map(String);
      if (recordIds.some((id) => userIds.includes(id))) {
        return true;
      }
      return Boolean(email && normalizeEmail(employee.email) === email);
    }) || null
  );
}

function needsEmployeeProfile(user) {
  const role = String(user?.role || user?.roleKey || "").trim().toLowerCase();
  return Boolean(user?.id) && STAFF_PROFILE_ROLES.has(role);
}

function saveEmployees(records) {
  writeCollection("employees", records);
}

function linkUserToEmployeeProfile(user, profile) {
  if (!user?.id || !profile?.id || user.employeeId === profile.id) {
    return;
  }
  try {
    const localUserStore = require("../../auth/userStore");
    const local = localUserStore.getUserById(user.id);
    if (local && !local.employeeId) {
      localUserStore.updateUser(user.id, { employeeId: profile.id });
    }
    const accountStore = require("../../auth/accountStore");
    Promise.resolve(accountStore.updateUser(user.id, { employeeId: profile.id })).catch((error) => {
      console.error("Failed to link user to employee profile:", error.message);
    });
  } catch (_error) {
    // Local employee row is enough for leave, expenses, and attendance.
  }
}

function ensureEmployeeProfile(user, extras = {}) {
  if (!needsEmployeeProfile(user)) {
    return findEmployeeForUser(user);
  }

  const existing = findEmployeeForUser(user);
  const timestamp = now();
  if (existing) {
    const records = readCollection("employees");
    const index = records.findIndex((record) => record.id === existing.id);
    if (index !== -1) {
      records[index] = {
        ...records[index],
        userId: records[index].userId || user.id,
        user_id: records[index].user_id || user.id,
        email: records[index].email || user.email,
        fullName: records[index].fullName || records[index].name || user.fullName || user.name,
        phone: records[index].phone || user.phone || null,
        departmentId: records[index].departmentId || records[index].department_id || user.departmentId || extras.departmentId || null,
        department: records[index].department || user.department || extras.department || null,
        jobTitle: records[index].jobTitle || user.jobTitle || extras.jobTitle || null,
        status: records[index].status || employmentStatusForUser(user),
        updatedAt: timestamp,
        updated_at: timestamp,
      };
      saveEmployees(records);
      linkUserToEmployeeProfile(user, records[index]);
      return records[index];
    }
    linkUserToEmployeeProfile(user, existing);
    return existing;
  }

  const id = isUuid(user.employeeId) ? user.employeeId : crypto.randomUUID();
  const employeeNumber = extras.employeeId || extras.employeeNumber || user.employeeNumber || (!isUuid(user.employeeId) && user.employeeId) || `EMP-${String(id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const record = {
    id,
    userId: user.id,
    user_id: user.id,
    employeeId: employeeNumber,
    employee_id: employeeNumber,
    fullName: user.fullName || user.name || user.email,
    name: user.fullName || user.name || user.email,
    email: user.email,
    phone: user.phone || extras.phone || null,
    departmentId: user.departmentId || extras.departmentId || null,
    department_id: user.departmentId || extras.departmentId || null,
    department: user.department || extras.department || null,
    jobTitle: user.jobTitle || extras.jobTitle || extras.position || null,
    job_title: user.jobTitle || extras.jobTitle || extras.position || null,
    organizationId: user.organizationId || extras.organizationId || null,
    status: employmentStatusForUser(user),
    role: user.role,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  };

  const records = readCollection("employees");
  records.push(record);
  saveEmployees(records);
  linkUserToEmployeeProfile(user, record);
  return record;
}

function ensureEmployeeProfilesForUsers(users = []) {
  return users.map((user) => ensureEmployeeProfile(user)).filter(Boolean);
}

function resolveEmployeeForUser(user) {
  if (!user) {
    return null;
  }
  return findEmployeeForUser(user) || ensureEmployeeProfile(user);
}

function resolveEmployeeForUserId(userId) {
  if (!userId) {
    return null;
  }
  const { getUserById } = require("../../auth/userStore");
  const user = getUserById(userId);
  if (user) {
    return resolveEmployeeForUser(user);
  }
  return findEmployeeForUser({ id: userId, employeeId: userId });
}

module.exports = {
  STAFF_PROFILE_ROLES,
  ensureEmployeeProfile,
  ensureEmployeeProfilesForUsers,
  findEmployeeForUser,
  needsEmployeeProfile,
  resolveEmployeeForUser,
  resolveEmployeeForUserId,
};
