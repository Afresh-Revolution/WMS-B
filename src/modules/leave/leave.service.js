const { hasPermission } = require("../../constants/rbac");
const { paginate } = require("../../utils/query");
const { queueNotification } = require("../_shared/notificationService");
const { resolveEmployeeForUser } = require("../employees/employeeProfile");
const { APPROVAL_STATUS, DURATION_TYPE, LEAVE_PERMISSIONS, LEAVE_STATUS } = require("./constants");
const { calculateLeaveDuration, parseDateOnly } = require("./leave-duration.service");
const repository = require("./leave.repository");

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value) {
  return String(value || "").toUpperCase();
}

function getEmployeeDisplayName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || null;
}

function assertActiveEmployee(employee) {
  if (!employee) {
    throw createHttpError(404, "Employee profile was not found for this user.", "EMPLOYEE_NOT_FOUND");
  }

  if (String(employee.status || "active").toLowerCase() !== "active") {
    throw createHttpError(403, "Employee is not active.", "EMPLOYEE_INACTIVE");
  }
}

function getActorEmployee(user) {
  return resolveEmployeeForUser(user);
}

function requireEmployeeForUser(user) {
  const employee = getActorEmployee(user);
  assertActiveEmployee(employee);
  return employee;
}

function canViewAll(user) {
  return user?.role === "superadmin" || hasPermission(user, LEAVE_PERMISSIONS.VIEW_ALL) || hasPermission(user, LEAVE_PERMISSIONS.VIEW);
}

function canViewDepartment(user) {
  return user?.role === "superadmin" || hasPermission(user, LEAVE_PERMISSIONS.VIEW_DEPARTMENT);
}

function canManageBalances(user) {
  return user?.role === "superadmin" || hasPermission(user, LEAVE_PERMISSIONS.MANAGE_BALANCES);
}

function calculateRemaining(balance) {
  return (
    toNumber(balance.allocatedDays) +
    toNumber(balance.carriedForwardDays) +
    toNumber(balance.accruedDays) -
    toNumber(balance.usedDays) -
    toNumber(balance.pendingDays)
  );
}

function normalizeBalance(balance) {
  const normalized = {
    ...balance,
    allocatedDays: toNumber(balance.allocatedDays),
    carriedForwardDays: toNumber(balance.carriedForwardDays),
    accruedDays: toNumber(balance.accruedDays),
    usedDays: toNumber(balance.usedDays),
    pendingDays: toNumber(balance.pendingDays),
  };
  normalized.remainingDays = calculateRemaining(normalized);
  return normalized;
}

function getOrCreateBalance(employee, leaveType, policy, year) {
  const existing = repository.findBalance(employee.id, leaveType.id, year);
  if (existing) {
    return normalizeBalance(existing);
  }

  return normalizeBalance(
    repository.saveBalance({
      employeeId: employee.id,
      employeeName: getEmployeeDisplayName(employee),
      leaveTypeId: leaveType.id,
      leaveTypeName: leaveType.name,
      year,
      allocatedDays: toNumber(policy.annualDays ?? leaveType.defaultDays),
      carriedForwardDays: 0,
      accruedDays: 0,
      usedDays: 0,
      pendingDays: 0,
      remainingDays: toNumber(policy.annualDays ?? leaveType.defaultDays),
    })
  );
}

function saveRecalculatedBalance(balance, updates) {
  const updated = normalizeBalance({ ...balance, ...updates });
  return normalizeBalance(repository.saveBalance(updated));
}

function getLeaveTypeOrThrow(id) {
  const leaveType = repository.findLeaveType(id);
  if (!leaveType) {
    throw createHttpError(404, "Leave type was not found.", "LEAVE_TYPE_NOT_FOUND");
  }

  if (String(leaveType.status || "active").toLowerCase() !== "active") {
    throw createHttpError(400, "Leave type is not active.", "LEAVE_TYPE_INACTIVE");
  }

  return leaveType;
}

function getYearFromDate(date) {
  return parseDateOnly(date).getUTCFullYear();
}

function checkNotice(policy, startDate) {
  const noticeDays = toNumber(policy.minimumNoticeDays);
  if (!noticeDays) {
    return;
  }

  const start = parseDateOnly(startDate);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffDays = Math.ceil((start.getTime() - todayUtc.getTime()) / 86400000);
  if (diffDays < noticeDays) {
    throw createHttpError(400, `This leave type requires at least ${noticeDays} days notice.`, "NOTICE_REQUIRED");
  }
}

function checkMaximumConsecutive(policy, duration) {
  const maximum = toNumber(policy.maximumConsecutiveDays);
  if (maximum > 0 && duration > maximum) {
    throw createHttpError(400, `Leave exceeds the maximum consecutive limit of ${maximum} days.`, "MAXIMUM_LEAVE_EXCEEDED");
  }
}

function checkOverlap(employeeId, startDate, endDate, ignoredRequestId) {
  const overlapping = repository.listAllRequests({ employeeId }).find((request) => {
    if (request.id === ignoredRequestId) {
      return false;
    }

    return (
      [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED].includes(normalizeStatus(request.status)) &&
      request.startDate <= endDate &&
      request.endDate >= startDate
    );
  });

  if (overlapping) {
    throw createHttpError(409, "Leave dates overlap with an existing request.", "LEAVE_DATES_OVERLAP");
  }
}

function createApprovalWorkflowForRequest({ request, employee }) {
  const workflow = repository.createWorkflow({
    leaveRequestId: request.id,
    leaveTypeId: request.leaveTypeId,
    name: `${request.leaveTypeName || "Leave"} approval workflow`,
    status: "active",
  });

  const steps = [];
  if (employee.managerId || employee.manager_id) {
    steps.push(
      repository.createWorkflowStep({
        workflowId: workflow.id,
        leaveRequestId: request.id,
        stepOrder: 1,
        approverType: "MANAGER",
        approverEmployeeId: employee.managerId || employee.manager_id,
        status: APPROVAL_STATUS.PENDING,
      })
    );
  } else {
    steps.push(
      repository.createWorkflowStep({
        workflowId: workflow.id,
        leaveRequestId: request.id,
        stepOrder: 1,
        approverType: "HR_OR_SUPERADMIN",
        approverEmployeeId: null,
        status: APPROVAL_STATUS.PENDING,
      })
    );
  }

  return { workflow, steps };
}

function attachFiles(requestId, attachments, user) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.map((attachment) =>
    repository.createAttachment({
      leaveRequestId: requestId,
      fileId: attachment.fileId || null,
      fileUrl: attachment.fileUrl || attachment.url || null,
      name: attachment.name || attachment.filename || null,
      type: attachment.type || null,
      uploadedBy: user?.id || null,
      status: "active",
    })
  );
}

function createLeaveRequest(payload, user, req) {
  if (!hasPermission(user, LEAVE_PERMISSIONS.CREATE) && user?.role !== "superadmin") {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  const employee = requireEmployeeForUser(user);
  const leaveType = getLeaveTypeOrThrow(payload.leaveTypeId || payload.leave_type_id);
  const policy = repository.findPolicyForLeaveType(leaveType.id);
  const startDate = payload.startDate || payload.start_date;
  const endDate = payload.endDate || payload.end_date;

  const holidays = repository.getHolidaysBetween(startDate, endDate);
  const duration = calculateLeaveDuration({
    startDate,
    endDate,
    durationType: payload.durationType || payload.duration_type || DURATION_TYPE.FULL_DAY,
    policy,
    holidays,
  });

  if (duration.workingDays <= 0) {
    throw createHttpError(400, "Leave duration must include at least one working day.", "INVALID_LEAVE_DURATION");
  }

  checkNotice(policy, startDate);
  checkMaximumConsecutive(policy, duration.workingDays);
  checkOverlap(employee.id, startDate, endDate);

  const year = getYearFromDate(startDate);
  const balance = getOrCreateBalance(employee, leaveType, policy, year);
  if (balance.remainingDays < duration.workingDays) {
    throw createHttpError(409, "Insufficient leave balance.", "INSUFFICIENT_LEAVE_BALANCE");
  }

  const request = repository.createLeaveRequest({
    employeeId: employee.id,
    employeeName: getEmployeeDisplayName(employee),
    employeeNumber: employee.employeeId || employee.employee_id || null,
    departmentId: employee.departmentId || employee.department_id || null,
    leaveTypeId: leaveType.id,
    leaveTypeName: leaveType.name,
    startDate,
    endDate,
    duration: duration.workingDays,
    calendarDays: duration.calendarDays,
    durationType: duration.durationType,
    note: payload.note || payload.reason || null,
    status: LEAVE_STATUS.PENDING,
    submittedAt: new Date().toISOString(),
    createdBy: user.id,
  });

  const updatedBalance = saveRecalculatedBalance(balance, {
    pendingDays: balance.pendingDays + duration.workingDays,
  });
  const workflow = createApprovalWorkflowForRequest({ request, employee });
  const attachments = attachFiles(request.id, payload.attachments, user);

  repository.createHistory({
    leaveRequestId: request.id,
    employeeId: employee.id,
    actorId: user.id,
    action: "LEAVE_CREATED",
    status: LEAVE_STATUS.PENDING,
    oldValue: null,
    newValue: request,
    comment: request.note,
  });

  queueNotification({
    recipientEmployeeId: employee.managerId || employee.manager_id || null,
    type: "leave_request_submitted",
    title: "Leave request submitted",
    body: `${request.employeeName} submitted a leave request.`,
    data: { leaveRequestId: request.id },
  });

  return { request: { ...request, workflow, attachments }, balance: updatedBalance, oldValue: null, record: request };
}

function getVisibleRequests(user, query = {}) {
  const actorEmployee = getActorEmployee(user);
  let requests = repository.listAllRequests(query);

  if (canViewAll(user)) {
    return paginate(requests, query);
  }

  if (canViewDepartment(user) && actorEmployee?.departmentId) {
    requests = requests.filter((request) => request.departmentId === actorEmployee.departmentId);
    return paginate(requests, query);
  }

  if (actorEmployee && (hasPermission(user, LEAVE_PERMISSIONS.VIEW_OWN) || hasPermission(user, LEAVE_PERMISSIONS.VIEW))) {
    requests = requests.filter((request) => request.employeeId === actorEmployee.id);
    return paginate(requests, query);
  }

  throw createHttpError(403, "Forbidden.", "FORBIDDEN");
}

function getLeaveRequest(id, user) {
  const request = repository.findRequest(id);
  if (!request) {
    return null;
  }

  const visible = getVisibleRequests(user, { id, limit: 1 }).data.some((item) => item.id === id);
  return visible ? request : null;
}

function isAuthorizedApprover(request, user) {
  if (user?.role === "superadmin") {
    return true;
  }

  if (!hasPermission(user, LEAVE_PERMISSIONS.APPROVE) && !hasPermission(user, LEAVE_PERMISSIONS.REJECT)) {
    return false;
  }

  if (user?.role === "hr") {
    return true;
  }

  const actorEmployee = getActorEmployee(user);
  const employee = repository.findEmployeeById(request.employeeId);
  return Boolean(actorEmployee && employee && (employee.managerId === actorEmployee.id || employee.manager_id === actorEmployee.id));
}

function approveLeaveRequest(id, payload, user) {
  if (!hasPermission(user, LEAVE_PERMISSIONS.APPROVE) && user?.role !== "superadmin") {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  const request = repository.findRequest(id);
  if (!request) {
    return null;
  }

  if (normalizeStatus(request.status) !== LEAVE_STATUS.PENDING) {
    throw createHttpError(409, "Only pending leave requests can be approved.", "LEAVE_NOT_PENDING");
  }

  if (!isAuthorizedApprover(request, user)) {
    throw createHttpError(403, "Approver is not authorized for this leave request.", "APPROVER_NOT_AUTHORIZED");
  }

  const employee = repository.findEmployeeById(request.employeeId);
  assertActiveEmployee(employee);

  const leaveType = getLeaveTypeOrThrow(request.leaveTypeId);
  const policy = repository.findPolicyForLeaveType(leaveType.id);
  const year = getYearFromDate(request.startDate);
  const balance = getOrCreateBalance(employee, leaveType, policy, year);
  if (balance.remainingDays + request.duration < request.duration) {
    throw createHttpError(409, "Insufficient leave balance.", "INSUFFICIENT_LEAVE_BALANCE");
  }

  const oldValue = request;
  const updatedRequest = repository.updateLeaveRequest(id, {
    status: LEAVE_STATUS.APPROVED,
    approvedAt: new Date().toISOString(),
    approvedBy: user.id,
  });
  const updatedBalance = saveRecalculatedBalance(balance, {
    pendingDays: Math.max(0, balance.pendingDays - toNumber(request.duration)),
    usedDays: balance.usedDays + toNumber(request.duration),
  });

  repository.createApproval({
    leaveRequestId: id,
    approverId: user.id,
    workflowStepId: payload.workflowStepId || null,
    status: APPROVAL_STATUS.APPROVED,
    comment: payload.comment || null,
    approvedAt: new Date().toISOString(),
  });
  repository.createHistory({
    leaveRequestId: id,
    employeeId: request.employeeId,
    actorId: user.id,
    action: "LEAVE_APPROVED",
    status: LEAVE_STATUS.APPROVED,
    oldValue,
    newValue: updatedRequest,
    comment: payload.comment || null,
  });
  queueNotification({
    recipientEmployeeId: request.employeeId,
    type: "leave_request_approved",
    title: "Leave request approved",
    body: "Your leave request was approved.",
    data: { leaveRequestId: id },
  });

  return { oldValue, record: updatedRequest, balance: updatedBalance };
}

function rejectLeaveRequest(id, payload, user) {
  if (!hasPermission(user, LEAVE_PERMISSIONS.REJECT) && user?.role !== "superadmin") {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  if (!payload.reason && !payload.comment) {
    throw createHttpError(400, "Rejection reason is required.", "REJECTION_REASON_REQUIRED");
  }

  const request = repository.findRequest(id);
  if (!request) {
    return null;
  }

  if (normalizeStatus(request.status) !== LEAVE_STATUS.PENDING) {
    throw createHttpError(409, "Only pending leave requests can be rejected.", "LEAVE_NOT_PENDING");
  }

  if (!isAuthorizedApprover(request, user)) {
    throw createHttpError(403, "Approver is not authorized for this leave request.", "APPROVER_NOT_AUTHORIZED");
  }

  const employee = repository.findEmployeeById(request.employeeId);
  const leaveType = repository.findLeaveType(request.leaveTypeId);
  const policy = repository.findPolicyForLeaveType(request.leaveTypeId);
  const balance = getOrCreateBalance(employee, leaveType, policy, getYearFromDate(request.startDate));
  const oldValue = request;
  const updatedRequest = repository.updateLeaveRequest(id, {
    status: LEAVE_STATUS.REJECTED,
    rejectedAt: new Date().toISOString(),
    rejectedBy: user.id,
    rejectionReason: payload.reason || payload.comment,
  });
  const updatedBalance = saveRecalculatedBalance(balance, {
    pendingDays: Math.max(0, balance.pendingDays - toNumber(request.duration)),
  });

  repository.createApproval({
    leaveRequestId: id,
    approverId: user.id,
    workflowStepId: payload.workflowStepId || null,
    status: APPROVAL_STATUS.REJECTED,
    comment: payload.reason || payload.comment,
    rejectedAt: new Date().toISOString(),
  });
  repository.createHistory({
    leaveRequestId: id,
    employeeId: request.employeeId,
    actorId: user.id,
    action: "LEAVE_REJECTED",
    status: LEAVE_STATUS.REJECTED,
    oldValue,
    newValue: updatedRequest,
    comment: payload.reason || payload.comment,
  });
  queueNotification({
    recipientEmployeeId: request.employeeId,
    type: "leave_request_rejected",
    title: "Leave request rejected",
    body: "Your leave request was rejected.",
    data: { leaveRequestId: id },
  });

  return { oldValue, record: updatedRequest, balance: updatedBalance };
}

function withdrawLeaveRequest(id, payload, user) {
  const request = repository.findRequest(id);
  if (!request) {
    return null;
  }

  const actorEmployee = requireEmployeeForUser(user);
  const isOwner = request.employeeId === actorEmployee.id;
  if (!isOwner && user?.role !== "superadmin") {
    throw createHttpError(403, "Only the employee who submitted this pending request can withdraw it.", "FORBIDDEN");
  }

  if (!hasPermission(user, LEAVE_PERMISSIONS.WITHDRAW) && user?.role !== "superadmin") {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  if (normalizeStatus(request.status) !== LEAVE_STATUS.PENDING) {
    throw createHttpError(409, "Only pending leave requests can be withdrawn.", "LEAVE_NOT_PENDING");
  }

  const leaveType = repository.findLeaveType(request.leaveTypeId);
  const policy = repository.findPolicyForLeaveType(request.leaveTypeId);
  const balance = getOrCreateBalance(actorEmployee, leaveType, policy, getYearFromDate(request.startDate));
  const oldValue = request;
  const updatedRequest = repository.updateLeaveRequest(id, {
    status: LEAVE_STATUS.WITHDRAWN,
    withdrawnAt: new Date().toISOString(),
    withdrawnBy: user.id,
    withdrawalReason: payload.reason || payload.comment || null,
  });
  const updatedBalance = saveRecalculatedBalance(balance, {
    pendingDays: Math.max(0, balance.pendingDays - toNumber(request.duration)),
  });

  repository.createHistory({
    leaveRequestId: id,
    employeeId: request.employeeId,
    actorId: user.id,
    action: "LEAVE_WITHDRAWN",
    status: LEAVE_STATUS.WITHDRAWN,
    oldValue,
    newValue: updatedRequest,
    comment: payload.reason || payload.comment || null,
  });

  return { oldValue, record: updatedRequest, balance: updatedBalance };
}

function cancelLeaveRequest(id, payload, user) {
  if (!hasPermission(user, LEAVE_PERMISSIONS.CANCEL) && user?.role !== "superadmin") {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  const request = repository.findRequest(id);
  if (!request) {
    return null;
  }

  if (normalizeStatus(request.status) !== LEAVE_STATUS.APPROVED) {
    throw createHttpError(409, "Only approved leave requests can be cancelled.", "LEAVE_NOT_APPROVED");
  }

  const employee = repository.findEmployeeById(request.employeeId);
  const leaveType = repository.findLeaveType(request.leaveTypeId);
  const policy = repository.findPolicyForLeaveType(request.leaveTypeId);
  const balance = getOrCreateBalance(employee, leaveType, policy, getYearFromDate(request.startDate));
  const oldValue = request;
  const updatedRequest = repository.updateLeaveRequest(id, {
    status: LEAVE_STATUS.CANCELLED,
    cancelledAt: new Date().toISOString(),
    cancelledBy: user.id,
    cancellationReason: payload.reason || payload.comment || null,
  });
  const updatedBalance = saveRecalculatedBalance(balance, {
    usedDays: Math.max(0, balance.usedDays - toNumber(request.duration)),
  });

  repository.createHistory({
    leaveRequestId: id,
    employeeId: request.employeeId,
    actorId: user.id,
    action: "LEAVE_CANCELLED",
    status: LEAVE_STATUS.CANCELLED,
    oldValue,
    newValue: updatedRequest,
    comment: payload.reason || payload.comment || null,
  });
  queueNotification({
    recipientEmployeeId: request.employeeId,
    type: "leave_request_cancelled",
    title: "Leave request cancelled",
    body: "An approved leave request was cancelled.",
    data: { leaveRequestId: id },
  });

  return { oldValue, record: updatedRequest, balance: updatedBalance };
}

function listBalances(user, query = {}) {
  if (!canManageBalances(user) && !canViewAll(user)) {
    const actorEmployee = requireEmployeeForUser(user);
    return repository.listBalances({ ...query, employeeId: actorEmployee.id });
  }

  return repository.listBalances(query);
}

function getEmployeeBalances(employeeId, user, query = {}) {
  const actorEmployee = getActorEmployee(user);
  if (!canManageBalances(user) && !canViewAll(user) && actorEmployee?.id !== employeeId) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  return repository.listBalances({ ...query, employeeId });
}

function adjustBalance(payload, user) {
  if (!canManageBalances(user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  const employee = repository.findEmployeeById(payload.employeeId);
  const leaveType = repository.findLeaveType(payload.leaveTypeId);
  if (!employee || !leaveType) {
    throw createHttpError(404, "Employee or leave type was not found.", "BALANCE_TARGET_NOT_FOUND");
  }

  const year = Number(payload.year || new Date().getUTCFullYear());
  const policy = repository.findPolicyForLeaveType(leaveType.id);
  const balance = getOrCreateBalance(employee, leaveType, policy, year);
  const adjustment = Number(payload.adjustmentDays ?? payload.adjustment ?? 0);
  if (!Number.isFinite(adjustment) || adjustment === 0) {
    throw createHttpError(400, "A non-zero adjustment is required.", "INVALID_BALANCE_ADJUSTMENT");
  }

  if (!payload.reason) {
    throw createHttpError(400, "Balance adjustment reason is required.", "ADJUSTMENT_REASON_REQUIRED");
  }

  const oldValue = balance;
  const updatedBalance = saveRecalculatedBalance(balance, {
    accruedDays: balance.accruedDays + adjustment,
  });
  repository.createHistory({
    leaveRequestId: null,
    employeeId: employee.id,
    actorId: user.id,
    action: "BALANCE_CHANGED",
    status: "ADJUSTED",
    oldValue,
    newValue: updatedBalance,
    comment: payload.reason,
  });

  return { oldValue, record: updatedBalance };
}

function listLeaveTypes(query) {
  return repository.listLeaveTypes(query);
}

function createLeaveType(payload, user) {
  return repository.createLeaveType(payload, user?.id);
}

function updateLeaveType(id, payload) {
  return repository.updateLeaveType(id, payload);
}

function listPolicies(query) {
  return repository.listPolicies(query);
}

function createPolicy(payload, user) {
  return repository.createPolicy(payload, user?.id);
}

function updatePolicy(id, payload) {
  return repository.updatePolicy(id, payload);
}

function getCalendar(user, query = {}) {
  const requests = getVisibleRequests(user, query).data.filter((request) =>
    [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED].includes(normalizeStatus(request.status))
  );
  return requests.map((request) => ({
    id: request.id,
    title: `${request.employeeName || "Employee"} - ${request.leaveTypeName || "Leave"}`,
    startDate: request.startDate,
    endDate: request.endDate,
    status: request.status,
    duration: request.duration,
  }));
}

function listHistory(user, query = {}) {
  if (canViewAll(user) || canManageBalances(user)) {
    return repository.listHistory(query);
  }

  const actorEmployee = requireEmployeeForUser(user);
  return repository.listHistory({ ...query, employeeId: actorEmployee.id });
}

function getReports(user, query = {}) {
  if (!hasPermission(user, LEAVE_PERMISSIONS.REPORTS) && !canViewAll(user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  const requests = repository.listAllRequests(query);
  const balances = repository.listBalances({ limit: 100 }).data;
  const byStatus = requests.reduce((summary, request) => {
    const status = normalizeStatus(request.status);
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});

  return {
    requests: {
      total: requests.length,
      byStatus,
      totalApprovedDays: requests
        .filter((request) => normalizeStatus(request.status) === LEAVE_STATUS.APPROVED)
        .reduce((total, request) => total + toNumber(request.duration), 0),
    },
    balances: {
      totalRemainingDays: balances.reduce((total, balance) => total + toNumber(balance.remainingDays), 0),
      totalPendingDays: balances.reduce((total, balance) => total + toNumber(balance.pendingDays), 0),
      totalUsedDays: balances.reduce((total, balance) => total + toNumber(balance.usedDays), 0),
    },
  };
}

module.exports = {
  adjustBalance,
  approveLeaveRequest,
  cancelLeaveRequest,
  createLeaveRequest,
  createLeaveType,
  createPolicy,
  getCalendar,
  getEmployeeBalances,
  getLeaveRequest,
  getReports,
  listBalances,
  listHistory,
  listLeaveTypes,
  listPolicies,
  getVisibleRequests,
  rejectLeaveRequest,
  updateLeaveType,
  updatePolicy,
  withdrawLeaveRequest,
};
