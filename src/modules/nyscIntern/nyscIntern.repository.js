const crypto = require("crypto");
const { getUserById } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");

function now() {
  return new Date().toISOString();
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt);
}

function createRecord(collection, payload) {
  const timestamp = now();
  const records = readCollection(collection);
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

function updateRecord(collection, id, payload) {
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

function applyProfileFilters(profiles, query = {}) {
  const normalized = {
    q: query.q || query.search,
    type: query.type,
    status: query.status,
    institution: query.institution,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
  let filtered = applyBasicFilters(profiles, normalized, ["profileNumber", "fullName", "institution", "courseOfStudy", "email", "phone"]);
  const placements = activeRecords("placements");
  const department = query.departmentId || query.department_id || query.department;
  const supervisor = query.supervisorId || query.supervisor_id || query.supervisor;
  const startDate = query.startDate || query.start_date;
  const endDate = query.endDate || query.end_date;
  if (department || supervisor || startDate || endDate || query.status) {
    filtered = filtered.filter((profile) => {
      const placement = placements.find((item) => item.profileId === profile.id);
      if (!placement) {
        return false;
      }
      if (department && placement.departmentId !== department && String(placement.departmentName || "").toLowerCase() !== String(department).toLowerCase()) {
        return false;
      }
      if (supervisor && placement.supervisorId !== supervisor && placement.supervisorEmployeeId !== supervisor) {
        return false;
      }
      if (startDate && placement.startDate < startDate) {
        return false;
      }
      if (endDate && placement.expectedEndDate > endDate) {
        return false;
      }
      return true;
    });
  }
  return filtered;
}

function listProfiles(query = {}) {
  return paginate(applyProfileFilters(activeRecords("nysc_intern_profiles"), query), query);
}

function listAllProfiles(query = {}) {
  return applyProfileFilters(activeRecords("nysc_intern_profiles"), query);
}

function findProfile(id) {
  return activeRecords("nysc_intern_profiles").find((profile) => profile.id === id) || null;
}

function findProfileByEmail(email) {
  return activeRecords("nysc_intern_profiles").find((profile) => String(profile.email || "").toLowerCase() === String(email || "").toLowerCase()) || null;
}

function createProfile(payload) {
  return createRecord("nysc_intern_profiles", payload);
}

function updateProfile(id, payload) {
  return updateRecord("nysc_intern_profiles", id, payload);
}

function createPlacement(payload) {
  return createRecord("placements", payload);
}

function updatePlacement(id, payload) {
  return updateRecord("placements", id, payload);
}

function findPlacementByProfile(profileId) {
  return activeRecords("placements").find((placement) => placement.profileId === profileId) || null;
}

function findPlacement(id) {
  return activeRecords("placements").find((placement) => placement.id === id) || null;
}

function listPlacements(query = {}) {
  return applyBasicFilters(activeRecords("placements"), query, ["role", "description", "workLocation", "placementStatus"]);
}

function createSupervisor(payload) {
  return createRecord("placement_supervisors", payload);
}

function updateSupervisor(id, payload) {
  return updateRecord("placement_supervisors", id, payload);
}

function currentSupervisor(placementId) {
  return activeRecords("placement_supervisors").find((supervisor) => supervisor.placementId === placementId && supervisor.isActive !== false && !supervisor.removedAt) || null;
}

function listSupervisors(placementId) {
  return activeRecords("placement_supervisors").filter((supervisor) => supervisor.placementId === placementId);
}

function createDocument(payload) {
  return createRecord("placement_documents", payload);
}

function findDocument(id) {
  return activeRecords("placement_documents").find((document) => document.id === id) || null;
}

function updateDocument(id, payload) {
  return updateRecord("placement_documents", id, payload);
}

function listDocuments(profileId, placementId) {
  return activeRecords("placement_documents").filter((document) => document.profileId === profileId || document.placementId === placementId);
}

function createAttendance(payload) {
  return createRecord("placement_attendance", payload);
}

function updateAttendance(id, payload) {
  return updateRecord("placement_attendance", id, payload);
}

function findAttendance(id) {
  return activeRecords("placement_attendance").find((attendance) => attendance.id === id) || null;
}

function findAttendanceByDate(placementId, date) {
  return activeRecords("placement_attendance").find((attendance) => attendance.placementId === placementId && attendance.date === date) || null;
}

function listAttendance(placementId, query = {}) {
  return applyBasicFilters(activeRecords("placement_attendance").filter((attendance) => attendance.placementId === placementId), query, ["status", "notes"]);
}

function createReview(payload) {
  return createRecord("placement_reviews", payload);
}

function listReviews(placementId) {
  return activeRecords("placement_reviews").filter((review) => review.placementId === placementId);
}

function createHistory(payload) {
  return createRecord("placement_history", payload);
}

function listHistory(placementId) {
  return activeRecords("placement_history").filter((history) => history.placementId === placementId);
}

function createExitRecord(payload) {
  return createRecord("placement_exit_records", payload);
}

function findExitRecord(placementId) {
  return activeRecords("placement_exit_records").find((record) => record.placementId === placementId) || null;
}

function createLegacyMember(collection, payload) {
  return createRecord(collection, payload);
}

function updateLegacyMember(collection, id, payload) {
  return updateRecord(collection, id, payload);
}

function findEmployee(idOrName) {
  const requested = String(idOrName || "").trim().toLowerCase();
  if (!requested) {
    return null;
  }
  return (
    activeRecords("employees").find((employee) => {
      const name = String(employee.fullName || employee.name || "").trim().toLowerCase();
      const email = String(employee.email || "").trim().toLowerCase();
      return employee.id === idOrName || name === requested || email === requested || (requested.length > 2 && name.includes(requested));
    }) || null
  );
}

function findEmployeeByUserId(userId) {
  const { resolveEmployeeForUserId } = require("../employees/employeeProfile");
  return resolveEmployeeForUserId(userId);
}

function createEmployee(payload) {
  return createRecord("employees", payload);
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function findUser(id) {
  return getUserById(id) || activeRecords("users").find((user) => user.id === id) || null;
}

function listTasks(profileId, placementId) {
  return activeRecords("tasks").filter(
    (task) => task.assignedToProfileId === profileId || task.placementId === placementId || task.assigneeId === profileId
  );
}

function listTargets(profileId, placementId) {
  return activeRecords("targets").filter((target) => target.profileId === profileId || target.placementId === placementId);
}

function createNotification(payload) {
  return createRecord("notifications", payload);
}

module.exports = {
  createAttendance,
  createDocument,
  createEmployee,
  createExitRecord,
  createHistory,
  createLegacyMember,
  createNotification,
  createPlacement,
  createProfile,
  createReview,
  createSupervisor,
  currentSupervisor,
  findAttendance,
  findAttendanceByDate,
  findDepartment,
  findDocument,
  findEmployee,
  findEmployeeByUserId,
  findExitRecord,
  findPlacement,
  findPlacementByProfile,
  findProfile,
  findProfileByEmail,
  findUser,
  listAllProfiles,
  listAttendance,
  listDocuments,
  listHistory,
  listPlacements,
  listProfiles,
  listReviews,
  listSupervisors,
  listTargets,
  listTasks,
  updateAttendance,
  updateDocument,
  updateLegacyMember,
  updatePlacement,
  updateProfile,
  updateSupervisor,
};
