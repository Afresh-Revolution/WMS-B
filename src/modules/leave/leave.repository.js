const crypto = require("crypto");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { DEFAULT_LEAVE_TYPES, DEFAULT_POLICY } = require("./constants");

function now() {
  return new Date().toISOString();
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function getCollection(name) {
  return readCollection(name).filter((record) => !record.deletedAt);
}

function saveCollection(name, records) {
  writeCollection(name, records);
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
  saveCollection(collection, records);
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
  saveCollection(collection, records);
  return records[index];
}

function ensureDefaultLeaveTypes() {
  const existing = readCollection("leave_types");
  if (existing.length > 0) {
    return existing.filter((record) => !record.deletedAt);
  }

  const timestamp = now();
  const seeded = DEFAULT_LEAVE_TYPES.map((leaveType) => ({
    id: crypto.randomUUID(),
    ...leaveType,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  saveCollection("leave_types", seeded);
  return seeded;
}

function listLeaveTypes(query = {}) {
  return paginate(applyBasicFilters(ensureDefaultLeaveTypes(), query, ["name", "code", "description"]), query);
}

function findLeaveType(id) {
  return ensureDefaultLeaveTypes().find((record) => record.id === id && !record.deletedAt) || null;
}

function findLeaveTypeByCode(code) {
  const normalizedCode = normalizeCode(code);
  return ensureDefaultLeaveTypes().find((record) => normalizeCode(record.code) === normalizedCode && !record.deletedAt) || null;
}

function createLeaveType(payload, actorId) {
  const code = normalizeCode(payload.code || payload.name);
  if (!code) {
    const error = new Error("Leave type code or name is required.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  if (findLeaveTypeByCode(code)) {
    const error = new Error("Leave type code already exists.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }

  return createRecord("leave_types", {
    name: payload.name,
    code,
    description: payload.description || null,
    defaultDays: Number(payload.defaultDays ?? payload.default_days ?? 0),
    paid: payload.paid !== false,
    requiresDocument: Boolean(payload.requiresDocument ?? payload.requires_document),
    requiresApproval: payload.requiresApproval !== false && payload.requires_approval !== false,
    carryForwardAllowed: Boolean(payload.carryForwardAllowed ?? payload.carry_forward_allowed),
    maxCarryForwardDays: Number(payload.maxCarryForwardDays ?? payload.max_carry_forward_days ?? 0),
    status: payload.status || "active",
    createdBy: actorId || null,
  });
}

function updateLeaveType(id, payload) {
  const updates = compactObject({
    name: payload.name,
    description: payload.description,
    defaultDays:
      payload.defaultDays === undefined && payload.default_days === undefined
        ? undefined
        : Number(payload.defaultDays ?? payload.default_days),
    paid: payload.paid,
    requiresDocument: payload.requiresDocument ?? payload.requires_document,
    requiresApproval: payload.requiresApproval ?? payload.requires_approval,
    carryForwardAllowed: payload.carryForwardAllowed ?? payload.carry_forward_allowed,
    maxCarryForwardDays:
      payload.maxCarryForwardDays === undefined && payload.max_carry_forward_days === undefined
        ? undefined
        : Number(payload.maxCarryForwardDays ?? payload.max_carry_forward_days),
    status: payload.status,
  });

  if (payload.code) {
    updates.code = normalizeCode(payload.code);
  }

  return updateRecord("leave_types", id, updates);
}

function findPolicyForLeaveType(leaveTypeId) {
  const policy = getCollection("leave_policies").find((record) => record.leaveTypeId === leaveTypeId);
  const leaveType = findLeaveType(leaveTypeId);
  return {
    ...DEFAULT_POLICY,
    leaveTypeId,
    annualDays: Number(policy?.annualDays ?? leaveType?.defaultDays ?? 0),
    ...(policy || {}),
  };
}

function listPolicies(query = {}) {
  const policies = getCollection("leave_policies");
  return paginate(applyBasicFilters(policies, query, ["name", "accrualMethod"]), query);
}

function createPolicy(payload, actorId) {
  const leaveTypeId = payload.leaveTypeId || payload.leave_type_id;
  if (!findLeaveType(leaveTypeId)) {
    const error = new Error("Leave type does not exist.");
    error.statusCode = 404;
    error.publicMessage = error.message;
    throw error;
  }

  const existing = getCollection("leave_policies").find((policy) => policy.leaveTypeId === leaveTypeId);
  if (existing) {
    const error = new Error("Leave policy already exists for this leave type.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }

  return createRecord("leave_policies", normalizePolicyPayload(payload, actorId, true));
}

function updatePolicy(id, payload) {
  return updateRecord("leave_policies", id, normalizePolicyPayload(payload));
}

function normalizePolicyPayload(payload, actorId, withDefaults = false) {
  return compactObject({
    leaveTypeId: payload.leaveTypeId || payload.leave_type_id,
    annualDays:
      payload.annualDays === undefined && payload.annual_days === undefined
        ? withDefaults
          ? 0
          : undefined
        : Number(payload.annualDays ?? payload.annual_days),
    accrualMethod: payload.accrualMethod || payload.accrual_method || (withDefaults ? "YEARLY" : undefined),
    minimumNoticeDays:
      payload.minimumNoticeDays === undefined && payload.minimum_notice_days === undefined
        ? withDefaults
          ? 0
          : undefined
        : Number(payload.minimumNoticeDays ?? payload.minimum_notice_days),
    maximumConsecutiveDays: payload.maximumConsecutiveDays ?? payload.maximum_consecutive_days,
    carryForwardEnabled:
      payload.carryForwardEnabled === undefined && payload.carry_forward_enabled === undefined
        ? withDefaults
          ? false
          : undefined
        : Boolean(payload.carryForwardEnabled ?? payload.carry_forward_enabled),
    maxCarryForwardDays:
      payload.maxCarryForwardDays === undefined && payload.max_carry_forward_days === undefined
        ? withDefaults
          ? 0
          : undefined
        : Number(payload.maxCarryForwardDays ?? payload.max_carry_forward_days),
    halfDayEnabled:
      payload.halfDayEnabled === undefined && payload.half_day_enabled === undefined
        ? withDefaults
          ? true
          : undefined
        : payload.halfDayEnabled !== false && payload.half_day_enabled !== false,
    weekendCounted:
      payload.weekendCounted === undefined && payload.weekend_counted === undefined
        ? withDefaults
          ? false
          : undefined
        : Boolean(payload.weekendCounted ?? payload.weekend_counted),
    holidayCounted:
      payload.holidayCounted === undefined && payload.holiday_counted === undefined
        ? withDefaults
          ? false
          : undefined
        : Boolean(payload.holidayCounted ?? payload.holiday_counted),
    createdBy: actorId,
  });
}

function findEmployeeById(id) {
  if (!id) {
    return null;
  }
  const { findEmployeeForUser } = require("../employees/employeeProfile");
  return (
    getCollection("employees").find((employee) => employee.id === id || employee.employeeId === id || employee.employee_id === id) ||
    findEmployeeForUser({ id, employeeId: id }) ||
    null
  );
}

function findEmployeeByUserId(userId) {
  const { resolveEmployeeForUserId } = require("../employees/employeeProfile");
  return resolveEmployeeForUserId(userId);
}

function listEmployees() {
  return getCollection("employees");
}

function getHolidaysBetween(startDate, endDate) {
  return getCollection("holidays").filter((holiday) => {
    const date = holiday.date || holiday.holidayDate || holiday.startDate;
    return date && date >= startDate && date <= endDate;
  });
}

function findBalance(employeeId, leaveTypeId, year) {
  return (
    getCollection("leave_balances").find(
      (balance) =>
        balance.employeeId === employeeId &&
        balance.leaveTypeId === leaveTypeId &&
        Number(balance.year) === Number(year)
    ) || null
  );
}

function saveBalance(balance) {
  return balance.id ? updateRecord("leave_balances", balance.id, balance) : createRecord("leave_balances", balance);
}

function listBalances(query = {}) {
  return paginate(applyBasicFilters(getCollection("leave_balances"), query, ["employeeName", "leaveTypeName", "year"]), query);
}

function listRequests(query = {}) {
  return paginate(applyBasicFilters(getCollection("leave_requests"), query, ["employeeName", "leaveTypeName", "note", "status"]), query);
}

function listAllRequests(query = {}) {
  return applyBasicFilters(getCollection("leave_requests"), query, ["employeeName", "leaveTypeName", "note", "status"]);
}

function findRequest(id) {
  return getCollection("leave_requests").find((request) => request.id === id) || null;
}

function createLeaveRequest(payload) {
  return createRecord("leave_requests", payload);
}

function updateLeaveRequest(id, payload) {
  return updateRecord("leave_requests", id, payload);
}

function createApproval(payload) {
  return createRecord("leave_approvals", payload);
}

function createAttachment(payload) {
  return createRecord("leave_attachments", payload);
}

function createHistory(payload) {
  return createRecord("leave_history", payload);
}

function createWorkflow(payload) {
  return createRecord("approval_workflows", payload);
}

function createWorkflowStep(payload) {
  return createRecord("approval_workflow_steps", payload);
}

function listHistory(query = {}) {
  return paginate(applyBasicFilters(getCollection("leave_history"), query, ["action", "comment", "status"]), query);
}

function listExtensions(leaveRequestId) {
  return getCollection("leave_extensions").filter((record) => !leaveRequestId || record.leaveRequestId === leaveRequestId);
}

function findExtension(id) {
  return getCollection("leave_extensions").find((record) => record.id === id) || null;
}

function createExtension(payload) {
  return createRecord("leave_extensions", payload);
}

function updateExtension(id, payload) {
  return updateRecord("leave_extensions", id, payload);
}

module.exports = {
  createApproval,
  createAttachment,
  createExtension,
  createHistory,
  createLeaveRequest,
  createLeaveType,
  createPolicy,
  createWorkflow,
  createWorkflowStep,
  findBalance,
  findEmployeeById,
  findEmployeeByUserId,
  findExtension,
  findLeaveType,
  findLeaveTypeByCode,
  findPolicyForLeaveType,
  findRequest,
  getHolidaysBetween,
  listAllRequests,
  listBalances,
  listEmployees,
  listExtensions,
  listHistory,
  listLeaveTypes,
  listPolicies,
  listRequests,
  saveBalance,
  updateExtension,
  updateLeaveRequest,
  updateLeaveType,
  updatePolicy,
};
