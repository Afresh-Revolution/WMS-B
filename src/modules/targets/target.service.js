const { hasPermission } = require("../../constants/rbac");
const { paginate } = require("../../utils/query");
const { queueNotification } = require("../_shared/notificationService");
const {
  MEASUREMENT_TYPE,
  TARGET_ASSIGNMENT_STATUS,
  TARGET_PERMISSIONS,
  TARGET_PRIORITY,
  TARGET_STATUS,
  TARGET_TYPE,
} = require("./constants");
const repository = require("./target.repository");

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

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function getEmployeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || null;
}

function getDepartmentName(department) {
  return department?.name || department?.title || null;
}

function calculateProgress({ measurementType, currentValue, targetValue }) {
  if (measurementType === MEASUREMENT_TYPE.BOOLEAN) {
    return currentValue ? 100 : 0;
  }

  const target = toNumber(targetValue);
  if (target <= 0) {
    return 0;
  }

  const percentage = (toNumber(currentValue) / target) * 100;
  return Math.max(0, Math.min(100, Number(percentage.toFixed(2))));
}

function resolveStatus(target, nextValues = {}) {
  const merged = { ...target, ...nextValues };
  if (merged.status === TARGET_STATUS.CANCELLED || merged.status === TARGET_STATUS.PAUSED || merged.status === TARGET_STATUS.DRAFT) {
    return merged.status;
  }

  const percentage = calculateProgress(merged);
  if (percentage >= 100) {
    return TARGET_STATUS.COMPLETED;
  }

  if (merged.endDate && merged.endDate < todayDateOnly()) {
    return TARGET_STATUS.OVERDUE;
  }

  return merged.status === TARGET_STATUS.OVERDUE ? TARGET_STATUS.OVERDUE : TARGET_STATUS.ACTIVE;
}

function recordHistory({ targetId, actor, action, oldValues, newValues }) {
  return repository.createHistory({
    targetId,
    actorId: actor?.id || null,
    action,
    oldValues: oldValues || null,
    newValues: newValues || null,
  });
}

function notifyAssignees(target, type, title, body) {
  const assignments = repository.listAssignments(target.id);
  for (const assignment of assignments) {
    if (assignment.employeeId) {
      const employee = repository.findEmployee(assignment.employeeId);
      const userId = employee?.userId || employee?.user_id;
      if (userId) {
        queueNotification({ recipientUserId: userId, type, title, body, data: { targetId: target.id } });
      }
    }
  }
}

function assertValidDates(startDate, endDate) {
  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw createHttpError(400, "Target start date and end date must use YYYY-MM-DD.", "INVALID_TARGET_DATES");
  }

  if (startDate > endDate) {
    throw createHttpError(400, "Target start date cannot be after end date.", "INVALID_TARGET_DATES");
  }
}

function assertTitle(title) {
  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 180) {
    throw createHttpError(400, "Target title must be between 3 and 180 characters.", "INVALID_TARGET_TITLE");
  }
}

function buildAssignments(target, payload, user) {
  const assignments = [];
  const employeeIds = new Set(payload.employeeIds || payload.employee_ids || []);

  if (payload.employeeId || payload.employee_id) {
    employeeIds.add(payload.employeeId || payload.employee_id);
  }

  for (const employeeId of employeeIds) {
    const employee = repository.findEmployee(employeeId);
    if (!employee || String(employee.status || "active").toLowerCase() !== "active") {
      throw createHttpError(404, "Assigned employee was not found or inactive.", "EMPLOYEE_NOT_FOUND");
    }

    assignments.push(
      repository.createAssignment({
        targetId: target.id,
        employeeId,
        employeeName: getEmployeeName(employee),
        departmentId: employee.departmentId || employee.department_id || null,
        assignedBy: user.id,
        assignedAt: new Date().toISOString(),
        status: TARGET_ASSIGNMENT_STATUS.ASSIGNED,
      })
    );
  }

  const departmentId = payload.departmentId || payload.department_id || target.departmentId;
  if (departmentId && assignments.length === 0) {
    const department = repository.findDepartment(departmentId);
    if (!department) {
      throw createHttpError(404, "Department was not found.", "DEPARTMENT_NOT_FOUND");
    }
    assignments.push(
      repository.createAssignment({
        targetId: target.id,
        employeeId: null,
        departmentId,
        departmentName: getDepartmentName(department),
        assignedBy: user.id,
        assignedAt: new Date().toISOString(),
        status: TARGET_ASSIGNMENT_STATUS.ASSIGNED,
      })
    );
  }

  if (assignments.length === 0 && target.targetType === TARGET_TYPE.COMPANY) {
    assignments.push(
      repository.createAssignment({
        targetId: target.id,
        employeeId: null,
        departmentId: null,
        assignedBy: user.id,
        assignedAt: new Date().toISOString(),
        status: TARGET_ASSIGNMENT_STATUS.ASSIGNED,
      })
    );
  }

  return assignments;
}

function normalizeTargetPayload(payload, user, oldTarget = null) {
  const title = payload.title ?? oldTarget?.title;
  assertTitle(title);

  const targetType = normalizeEnum(payload.targetType || payload.target_type || oldTarget?.targetType, Object.values(TARGET_TYPE), TARGET_TYPE.EMPLOYEE);
  const measurementType = normalizeEnum(
    payload.measurementType || payload.measurement_type || oldTarget?.measurementType,
    Object.values(MEASUREMENT_TYPE),
    MEASUREMENT_TYPE.NUMBER
  );
  const startDate = payload.startDate || payload.start_date || oldTarget?.startDate;
  const endDate = payload.endDate || payload.end_date || oldTarget?.endDate;
  assertValidDates(startDate, endDate);

  const targetValue = measurementType === MEASUREMENT_TYPE.BOOLEAN ? 1 : toNumber(payload.targetValue ?? payload.target_value ?? oldTarget?.targetValue);
  if (measurementType !== MEASUREMENT_TYPE.BOOLEAN && targetValue <= 0) {
    throw createHttpError(400, "Target value must be greater than zero.", "INVALID_TARGET_VALUE");
  }

  const currentValue = oldTarget ? toNumber(payload.currentValue ?? payload.current_value ?? oldTarget.currentValue) : 0;
  const departmentId = payload.departmentId || payload.department_id || oldTarget?.departmentId || null;
  const department = departmentId ? repository.findDepartment(departmentId) : null;
  if (departmentId && !department) {
    throw createHttpError(404, "Department was not found.", "DEPARTMENT_NOT_FOUND");
  }

  const progress = calculateProgress({ measurementType, currentValue, targetValue });
  const status = oldTarget
    ? resolveStatus(oldTarget, { currentValue, targetValue, measurementType, status: oldTarget.status })
    : normalizeEnum(payload.status, Object.values(TARGET_STATUS), TARGET_STATUS.ACTIVE);

  return {
    title: title.trim(),
    description: payload.description ?? oldTarget?.description ?? null,
    targetType,
    type: targetType.toLowerCase(),
    measurementType,
    metricName: payload.metricName || payload.metric_name || oldTarget?.metricName || title.trim(),
    targetValue,
    currentValue,
    unit: payload.unit ?? oldTarget?.unit ?? null,
    startDate,
    start_date: startDate,
    endDate,
    end_date: endDate,
    status: resolveStatus({ status, measurementType, currentValue, targetValue, endDate }),
    priority: normalizeEnum(payload.priority || oldTarget?.priority, Object.values(TARGET_PRIORITY), TARGET_PRIORITY.MEDIUM),
    departmentId,
    departmentName: getDepartmentName(department),
    parentTargetId: payload.parentTargetId || payload.parent_target_id || oldTarget?.parentTargetId || null,
    progress,
    achievementPercentage: progress,
    completedAt: progress >= 100 ? oldTarget?.completedAt || new Date().toISOString() : null,
    createdBy: oldTarget?.createdBy || user.id,
  };
}

function createTarget(payload, user) {
  assertPermission(user, TARGET_PERMISSIONS.CREATE);
  const values = normalizeTargetPayload(payload, user);
  const target = repository.createTarget(values);
  const assignments = buildAssignments(target, payload, user);

  repository.createProgress({
    targetId: target.id,
    value: target.currentValue,
    percentage: target.progress,
    recordedBy: user.id,
    recordedAt: new Date().toISOString(),
    note: "Initial target value.",
  });
  recordHistory({ targetId: target.id, actor: user, action: "CREATED", oldValues: null, newValues: target });
  if (assignments.length > 0) {
    recordHistory({ targetId: target.id, actor: user, action: "ASSIGNED", oldValues: null, newValues: assignments });
  }
  notifyAssignees(target, "target_assigned", "Target assigned", `${target.title} has been assigned.`);

  return { record: { ...target, assignments } };
}

function getActorEmployee(user) {
  return repository.findEmployeeByUserId(user?.id);
}

function canAccessTarget(target, user) {
  if (can(user, TARGET_PERMISSIONS.VIEW_ALL)) {
    return true;
  }

  if (target.createdBy === user?.id) {
    return true;
  }

  const employee = getActorEmployee(user);
  if (!employee) {
    return false;
  }

  return repository.listAssignments(target.id).some((assignment) => {
    if (assignment.employeeId === employee.id) {
      return true;
    }
    const employeeDepartmentId = employee.departmentId || employee.department_id;
    return assignment.departmentId && assignment.departmentId === employeeDepartmentId;
  });
}

function assertCanManageTarget(target, user, permission) {
  if (can(user, permission) || target.createdBy === user?.id) {
    return;
  }

  throw createHttpError(403, "Forbidden.", "FORBIDDEN");
}

function listTargets(user, query = {}) {
  assertPermission(user, TARGET_PERMISSIONS.VIEW);
  if (can(user, TARGET_PERMISSIONS.VIEW_ALL)) {
    return repository.listTargets(query);
  }

  const targets = repository.listAllTargets(query).filter((target) => canAccessTarget(target, user));
  return paginate(targets, query);
}

function getTargetDetails(id, user) {
  const target = repository.findTarget(id);
  if (!target) {
    throw createHttpError(404, "Target was not found.", "TARGET_NOT_FOUND");
  }

  if (!canAccessTarget(target, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  return {
    ...target,
    assignments: repository.listAssignments(id),
    metrics: repository.listMetrics(id),
    progressHistory: repository.listProgress(id),
    milestones: repository.listMilestones(id),
    comments: repository.listComments(id),
    attachments: repository.listAttachments(id),
    reviews: repository.listReviews(id),
    history: repository.listHistory(id),
    tasks: repository.listTasksForTarget(id),
  };
}

function updateTarget(id, payload, user) {
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  assertCanManageTarget(target, user, TARGET_PERMISSIONS.UPDATE);
  const values = normalizeTargetPayload(payload, user, target);
  const updated = repository.updateTarget(id, values);
  recordHistory({ targetId: id, actor: user, action: "UPDATED", oldValues: target, newValues: updated });
  notifyAssignees(updated, "target_updated", "Target updated", `${updated.title} has been updated.`);
  return { oldValues: target, record: updated };
}

function updateProgressFromTasks(target) {
  const tasks = repository.listTasksForTarget(target.id);
  if (!tasks.length) {
    return null;
  }

  const completed = tasks.filter((task) => ["completed", "done"].includes(String(task.status || "").toLowerCase())).length;
  return completed;
}

function updateProgress(id, payload, user) {
  assertPermission(user, TARGET_PERMISSIONS.UPDATE_PROGRESS);
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  if (!canAccessTarget(target, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  if (![TARGET_STATUS.ACTIVE, TARGET_STATUS.OVERDUE].includes(target.status)) {
    throw createHttpError(409, "Only active or overdue targets can receive progress updates.", "TARGET_NOT_ACTIVE");
  }

  const taskValue = target.metricSource === "TASKS" || target.source === "TASKS" ? updateProgressFromTasks(target) : null;
  const value = taskValue === null ? toNumber(payload.value, NaN) : taskValue;
  if (!Number.isFinite(value) || value < 0) {
    throw createHttpError(400, "Progress value must be a non-negative number.", "INVALID_PROGRESS_VALUE");
  }

  const percentage = calculateProgress({ ...target, currentValue: value });
  const nextStatus = resolveStatus(target, { currentValue: value });
  const completedAt = nextStatus === TARGET_STATUS.COMPLETED ? target.completedAt || new Date().toISOString() : null;
  const oldValues = target;
  const updated = repository.updateTarget(id, {
    currentValue: value,
    progress: percentage,
    achievementPercentage: percentage,
    status: nextStatus,
    completedAt,
  });
  const progress = repository.createProgress({
    targetId: id,
    value,
    percentage,
    recordedBy: user.id,
    recordedAt: new Date().toISOString(),
    note: payload.note || null,
  });
  recordHistory({ targetId: id, actor: user, action: percentage >= 100 ? "COMPLETED" : "PROGRESS_UPDATED", oldValues, newValues: { target: updated, progress } });
  notifyAssignees(updated, percentage >= 100 ? "target_completed" : "target_progress_updated", "Target progress updated", `${updated.title} is now ${percentage}% complete.`);
  return { oldValues, record: updated, progress };
}

function addMilestone(id, payload, user) {
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  assertCanManageTarget(target, user, TARGET_PERMISSIONS.MANAGE_MILESTONES);
  if (!payload.title) {
    throw createHttpError(400, "Milestone title is required.", "MILESTONE_TITLE_REQUIRED");
  }

  const milestone = repository.createMilestone({
    targetId: id,
    title: payload.title,
    description: payload.description || null,
    targetValue: toNumber(payload.targetValue ?? payload.target_value),
    dueDate: payload.dueDate || payload.due_date || null,
    status: payload.status || TARGET_STATUS.ACTIVE,
    completedAt: null,
    createdBy: user.id,
  });
  recordHistory({ targetId: id, actor: user, action: "MILESTONE_CREATED", oldValues: null, newValues: milestone });
  return milestone;
}

function updateMilestone(id, milestoneId, payload, user) {
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  assertCanManageTarget(target, user, TARGET_PERMISSIONS.MANAGE_MILESTONES);
  const oldValues = repository.findMilestone(milestoneId);
  if (!oldValues || oldValues.targetId !== id) {
    return null;
  }
  const status = payload.status ? String(payload.status).toUpperCase() : oldValues.status;
  const updated = repository.updateMilestone(milestoneId, {
    title: payload.title ?? oldValues.title,
    description: payload.description ?? oldValues.description,
    targetValue: payload.targetValue === undefined && payload.target_value === undefined ? oldValues.targetValue : toNumber(payload.targetValue ?? payload.target_value),
    dueDate: payload.dueDate || payload.due_date || oldValues.dueDate,
    status,
    completedAt: status === TARGET_STATUS.COMPLETED ? oldValues.completedAt || new Date().toISOString() : oldValues.completedAt,
  });
  recordHistory({ targetId: id, actor: user, action: status === TARGET_STATUS.COMPLETED ? "MILESTONE_COMPLETED" : "MILESTONE_UPDATED", oldValues, newValues: updated });
  return { oldValues, record: updated };
}

function addComment(id, payload, user) {
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  if (!canAccessTarget(target, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  if (!payload.comment) {
    throw createHttpError(400, "Comment is required.", "COMMENT_REQUIRED");
  }
  return repository.createComment({ targetId: id, userId: user.id, comment: payload.comment });
}

function assignTarget(id, payload, user) {
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  assertCanManageTarget(target, user, TARGET_PERMISSIONS.ASSIGN);
  const assignments = buildAssignments(target, payload, user);
  recordHistory({ targetId: id, actor: user, action: "ASSIGNED", oldValues: null, newValues: assignments });
  notifyAssignees(target, "target_assigned", "Target assigned", `${target.title} has been assigned.`);
  return assignments;
}

function unassignTarget(id, employeeId, user) {
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  assertCanManageTarget(target, user, TARGET_PERMISSIONS.ASSIGN);
  const removed = repository.removeAssignment(id, employeeId, user.id);
  if (removed) {
    recordHistory({ targetId: id, actor: user, action: "UNASSIGNED", oldValues: null, newValues: removed });
  }
  return removed;
}

function setTargetStatus(id, status, payload, user) {
  const target = repository.findTarget(id);
  if (!target) {
    return null;
  }
  assertCanManageTarget(target, user, status === TARGET_STATUS.CANCELLED ? TARGET_PERMISSIONS.DELETE : TARGET_PERMISSIONS.UPDATE);
  const oldValues = target;
  const updated = repository.updateTarget(id, {
    status,
    statusReason: payload.reason || null,
    completedAt: status === TARGET_STATUS.COMPLETED ? target.completedAt || new Date().toISOString() : target.completedAt || null,
    cancelledAt: status === TARGET_STATUS.CANCELLED ? new Date().toISOString() : target.cancelledAt || null,
    cancelledBy: status === TARGET_STATUS.CANCELLED ? user.id : target.cancelledBy || null,
  });
  const action = status === TARGET_STATUS.PAUSED ? "PAUSED" : status === TARGET_STATUS.ACTIVE ? "RESUMED" : status;
  recordHistory({ targetId: id, actor: user, action, oldValues, newValues: updated });
  notifyAssignees(updated, `target_${status.toLowerCase()}`, "Target status changed", `${updated.title} is now ${status}.`);
  return { oldValues, record: updated };
}

function getReports(user, query = {}) {
  assertPermission(user, TARGET_PERMISSIONS.VIEW_REPORTS);
  const targets = repository.listAllTargets(query);
  const totalProgress = targets.reduce((total, target) => total + toNumber(target.progress), 0);
  const byStatus = targets.reduce((summary, target) => {
    const status = resolveStatus(target);
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});

  return {
    total: targets.length,
    active: byStatus[TARGET_STATUS.ACTIVE] || 0,
    completed: byStatus[TARGET_STATUS.COMPLETED] || 0,
    overdue: byStatus[TARGET_STATUS.OVERDUE] || 0,
    cancelled: byStatus[TARGET_STATUS.CANCELLED] || 0,
    averageProgress: targets.length ? Number((totalProgress / targets.length).toFixed(2)) : 0,
    achievementRate: targets.length ? Number((((byStatus[TARGET_STATUS.COMPLETED] || 0) / targets.length) * 100).toFixed(2)) : 0,
    byStatus,
  };
}

function getDepartmentReports(user, query = {}) {
  assertPermission(user, TARGET_PERMISSIONS.VIEW_REPORTS);
  const targets = repository.listAllTargets(query).filter((target) => target.departmentId);
  const grouped = new Map();
  for (const target of targets) {
    const key = target.departmentId;
    const current = grouped.get(key) || {
      departmentId: key,
      departmentName: target.departmentName || key,
      targets: 0,
      completed: 0,
      averageProgress: 0,
      progressTotal: 0,
    };
    current.targets += 1;
    current.progressTotal += toNumber(target.progress);
    if (resolveStatus(target) === TARGET_STATUS.COMPLETED) {
      current.completed += 1;
    }
    current.averageProgress = Number((current.progressTotal / current.targets).toFixed(2));
    grouped.set(key, current);
  }
  return [...grouped.values()].map(({ progressTotal, ...row }) => row);
}

function getEmployeeReport(employeeId, user) {
  assertPermission(user, TARGET_PERMISSIONS.VIEW_REPORTS);
  const employee = repository.findEmployee(employeeId);
  if (!employee) {
    throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  }
  const targets = repository.listAllTargets({ employeeId });
  const completed = targets.filter((target) => resolveStatus(target) === TARGET_STATUS.COMPLETED).length;
  const overdue = targets.filter((target) => resolveStatus(target) === TARGET_STATUS.OVERDUE).length;
  const averageProgress = targets.length
    ? Number((targets.reduce((total, target) => total + toNumber(target.progress), 0) / targets.length).toFixed(2))
    : 0;
  return {
    employeeId,
    employeeName: getEmployeeName(employee),
    assignedTargets: targets.length,
    completedTargets: completed,
    overdueTargets: overdue,
    averageProgress,
    achievementRate: targets.length ? Number(((completed / targets.length) * 100).toFixed(2)) : 0,
    history: targets.flatMap((target) => repository.listHistory(target.id)),
  };
}

module.exports = {
  addComment,
  addMilestone,
  assignTarget,
  createTarget,
  getDepartmentReports,
  getEmployeeReport,
  getReports,
  getTargetDetails,
  listTargets,
  setTargetStatus,
  unassignTarget,
  updateMilestone,
  updateProgress,
  updateTarget,
};
