const crypto = require("crypto");
const { getUserById, listUsers } = require("../../auth/userStore");
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

function softDeleteRecord(collection, id, actorId) {
  return updateRecord(collection, id, { deletedAt: now(), deletedBy: actorId || null });
}

function normalizeQuery(query = {}) {
  return {
    q: query.q || query.search,
    status: query.status,
    priority: query.priority,
    targetType: query.targetType || query.target_type,
    departmentId: query.departmentId || query.department_id,
    employeeId: query.employeeId || query.employee_id,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
}

function applyTargetFilters(targets, query = {}) {
  const normalized = normalizeQuery(query);
  const { employeeId, ...basicFilters } = normalized;
  let filtered = applyBasicFilters(targets, basicFilters, ["title", "description", "metricName", "departmentName", "ownerName"]);

  const startDate = query.startDate || query.start_date;
  const endDate = query.endDate || query.end_date;
  if (startDate || endDate) {
    filtered = filtered.filter((target) => {
      if (startDate && target.endDate < startDate) {
        return false;
      }
      if (endDate && target.startDate > endDate) {
        return false;
      }
      return true;
    });
  }

  if (employeeId) {
    const assignedTargetIds = new Set(
      activeRecords("target_assignments")
        .filter((assignment) => assignment.employeeId === employeeId && assignment.status !== "UNASSIGNED")
        .map((assignment) => assignment.targetId)
    );
    filtered = filtered.filter((target) => target.employeeId === employeeId || assignedTargetIds.has(target.id));
  }

  return filtered;
}

function listTargets(query = {}) {
  return paginate(applyTargetFilters(activeRecords("targets"), query), query);
}

function listAllTargets(query = {}) {
  return applyTargetFilters(activeRecords("targets"), query);
}

function findTarget(id) {
  return activeRecords("targets").find((target) => target.id === id) || null;
}

function createTarget(payload) {
  return createRecord("targets", payload);
}

function updateTarget(id, payload) {
  return updateRecord("targets", id, payload);
}

function deleteTarget(id, actorId) {
  return softDeleteRecord("targets", id, actorId);
}

function createAssignment(payload) {
  return createRecord("target_assignments", payload);
}

function updateAssignment(id, payload) {
  return updateRecord("target_assignments", id, payload);
}

function findAssignment(targetId, filters = {}) {
  return (
    activeRecords("target_assignments").find((assignment) => {
      if (assignment.targetId !== targetId) {
        return false;
      }
      return Object.entries(filters).every((entry) => assignment[entry[0]] === entry[1]);
    }) || null
  );
}

function listAssignments(targetId) {
  return activeRecords("target_assignments").filter((assignment) => assignment.targetId === targetId);
}

function removeAssignment(targetId, employeeId, actorId) {
  const assignment = findAssignment(targetId, { employeeId });
  return assignment ? updateAssignment(assignment.id, { status: "UNASSIGNED", unassignedAt: now(), unassignedBy: actorId || null }) : null;
}

function createMetric(payload) {
  return createRecord("target_metrics", payload);
}

function listMetrics(targetId) {
  return activeRecords("target_metrics").filter((metric) => metric.targetId === targetId);
}

function createProgress(payload) {
  return createRecord("target_progress", payload);
}

function listProgress(targetId) {
  return activeRecords("target_progress").filter((progress) => progress.targetId === targetId);
}

function createMilestone(payload) {
  return createRecord("target_milestones", payload);
}

function updateMilestone(id, payload) {
  return updateRecord("target_milestones", id, payload);
}

function findMilestone(id) {
  return activeRecords("target_milestones").find((milestone) => milestone.id === id) || null;
}

function listMilestones(targetId) {
  return activeRecords("target_milestones").filter((milestone) => milestone.targetId === targetId);
}

function createComment(payload) {
  return createRecord("target_comments", payload);
}

function listComments(targetId) {
  return activeRecords("target_comments").filter((comment) => comment.targetId === targetId);
}

function createAttachment(payload) {
  return createRecord("target_attachments", payload);
}

function listAttachments(targetId) {
  return activeRecords("target_attachments").filter((attachment) => attachment.targetId === targetId);
}

function createReview(payload) {
  return createRecord("target_reviews", payload);
}

function listReviews(targetId) {
  return activeRecords("target_reviews").filter((review) => review.targetId === targetId);
}

function createHistory(payload) {
  return createRecord("target_history", payload);
}

function listHistory(targetId) {
  return activeRecords("target_history").filter((history) => history.targetId === targetId);
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function findEmployee(id) {
  return activeRecords("employees").find((employee) => employee.id === id) || null;
}

function findEmployeeByUserId(userId) {
  return activeRecords("employees").find((employee) => employee.userId === userId || employee.user_id === userId) || null;
}

function findUser(id) {
  return getUserById(id);
}

function listActiveUsers() {
  return listUsers().filter((user) => String(user.status || "active").toLowerCase() === "active");
}

function listTasksForTarget(targetId) {
  return activeRecords("tasks").filter((task) => task.targetId === targetId || task.target_id === targetId);
}

module.exports = {
  createAssignment,
  createAttachment,
  createComment,
  createHistory,
  createMetric,
  createMilestone,
  createProgress,
  createReview,
  createTarget,
  deleteTarget,
  findAssignment,
  findDepartment,
  findEmployee,
  findEmployeeByUserId,
  findMilestone,
  findTarget,
  findUser,
  listActiveUsers,
  listAllTargets,
  listAssignments,
  listAttachments,
  listComments,
  listHistory,
  listMetrics,
  listMilestones,
  listProgress,
  listReviews,
  listTargets,
  listTasksForTarget,
  removeAssignment,
  updateMilestone,
  updateTarget,
};
