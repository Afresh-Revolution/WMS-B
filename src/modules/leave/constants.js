const LEAVE_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  WITHDRAWN: "WITHDRAWN",
});

const APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

const DURATION_TYPE = Object.freeze({
  FULL_DAY: "FULL_DAY",
  HALF_DAY: "HALF_DAY",
});

const LEAVE_PERMISSIONS = Object.freeze({
  VIEW: "leave.view",
  CREATE: "leave.create",
  APPROVE: "leave.approve",
  REJECT: "leave.reject",
  CANCEL: "leave.cancel",
  WITHDRAW: "leave.withdraw",
  MANAGE_TYPES: "leave.manage_types",
  MANAGE_POLICIES: "leave.manage_policies",
  MANAGE_BALANCES: "leave.manage_balances",
  VIEW_ALL: "leave.view_all",
  VIEW_DEPARTMENT: "leave.view_department",
  VIEW_OWN: "leave.view_own",
  EXPORT: "leave.export",
  REPORTS: "leave.reports",
});

const DEFAULT_LEAVE_TYPES = Object.freeze([
  {
    name: "Annual Leave",
    code: "ANNUAL",
    description: "Paid annual vacation leave.",
    defaultDays: 25,
    paid: true,
    requiresDocument: false,
    requiresApproval: true,
    carryForwardAllowed: true,
    maxCarryForwardDays: 5,
    status: "active",
  },
  {
    name: "Sick Leave",
    code: "SICK",
    description: "Paid medical leave.",
    defaultDays: 10,
    paid: true,
    requiresDocument: true,
    requiresApproval: true,
    carryForwardAllowed: false,
    maxCarryForwardDays: 0,
    status: "active",
  },
  {
    name: "Personal Leave",
    code: "PERSONAL",
    description: "Paid personal leave.",
    defaultDays: 5,
    paid: true,
    requiresDocument: false,
    requiresApproval: true,
    carryForwardAllowed: false,
    maxCarryForwardDays: 0,
    status: "active",
  },
  {
    name: "Unpaid Leave",
    code: "UNPAID",
    description: "Unpaid time away from work.",
    defaultDays: 0,
    paid: false,
    requiresDocument: false,
    requiresApproval: true,
    carryForwardAllowed: false,
    maxCarryForwardDays: 0,
    status: "active",
  },
]);

const DEFAULT_POLICY = Object.freeze({
  accrualMethod: "YEARLY",
  minimumNoticeDays: 0,
  maximumConsecutiveDays: null,
  carryForwardEnabled: false,
  maxCarryForwardDays: 0,
  halfDayEnabled: true,
  weekendCounted: false,
  holidayCounted: false,
});

module.exports = {
  APPROVAL_STATUS,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_POLICY,
  DURATION_TYPE,
  LEAVE_PERMISSIONS,
  LEAVE_STATUS,
};
