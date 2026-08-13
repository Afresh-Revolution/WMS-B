const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { LEAVE_PERMISSIONS } = require("./constants");
const leaveService = require("./leave.service");

const leaveRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireLeavePermission(permission) {
  return (req, res, next) => {
    if (can(req.user, permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Operation failed",
      error: { code: "FORBIDDEN", details: {} },
    });
  };
}

function auditLeave(req, action, result) {
  if (!result) {
    return;
  }

  recordOperationalAudit({
    user: req.user,
    action,
    module: "leave",
    recordId: result.record?.id || result.request?.id || null,
    oldValue: result.oldValue || null,
    newValue: result.record || result.request || result,
    ipAddress: req.ip,
  });
}

function sendNotFound(res, code) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

leaveRouter.use(authenticate);

leaveRouter.get(
  "/types",
  requireLeavePermission(LEAVE_PERMISSIONS.VIEW_OWN),
  handle((req, res) => {
    const result = leaveService.listLeaveTypes(req.query);
    return res.json({ success: true, message: "Leave types loaded.", data: result.data, meta: result.meta });
  })
);

leaveRouter.post(
  "/types",
  requireLeavePermission(LEAVE_PERMISSIONS.MANAGE_TYPES),
  handle((req, res) => {
    const leaveType = leaveService.createLeaveType(req.body || {}, req.user);
    auditLeave(req, "LEAVE_TYPE_CREATED", { record: leaveType });
    return res.status(201).json({ success: true, message: "Leave type created.", data: leaveType, meta: {} });
  })
);

leaveRouter.patch(
  "/types/:id",
  requireLeavePermission(LEAVE_PERMISSIONS.MANAGE_TYPES),
  handle((req, res) => {
    const oldValue = leaveService.listLeaveTypes({ id: req.params.id, limit: 1 }).data[0] || null;
    const leaveType = leaveService.updateLeaveType(req.params.id, req.body || {});
    if (!leaveType) {
      return sendNotFound(res, "LEAVE_TYPE_NOT_FOUND");
    }

    auditLeave(req, "LEAVE_TYPE_UPDATED", { oldValue, record: leaveType });
    return res.json({ success: true, message: "Leave type updated.", data: leaveType, meta: {} });
  })
);

leaveRouter.get(
  "/policies",
  requireLeavePermission(LEAVE_PERMISSIONS.MANAGE_POLICIES),
  handle((req, res) => {
    const result = leaveService.listPolicies(req.query);
    return res.json({ success: true, message: "Leave policies loaded.", data: result.data, meta: result.meta });
  })
);

leaveRouter.post(
  "/policies",
  requireLeavePermission(LEAVE_PERMISSIONS.MANAGE_POLICIES),
  handle((req, res) => {
    const policy = leaveService.createPolicy(req.body || {}, req.user);
    auditLeave(req, "LEAVE_POLICY_CREATED", { record: policy });
    return res.status(201).json({ success: true, message: "Leave policy created.", data: policy, meta: {} });
  })
);

leaveRouter.patch(
  "/policies/:id",
  requireLeavePermission(LEAVE_PERMISSIONS.MANAGE_POLICIES),
  handle((req, res) => {
    const oldValue = leaveService.listPolicies({ id: req.params.id, limit: 1 }).data[0] || null;
    const policy = leaveService.updatePolicy(req.params.id, req.body || {});
    if (!policy) {
      return sendNotFound(res, "LEAVE_POLICY_NOT_FOUND");
    }

    auditLeave(req, "LEAVE_POLICY_CHANGED", { oldValue, record: policy });
    return res.json({ success: true, message: "Leave policy updated.", data: policy, meta: {} });
  })
);

leaveRouter.get(
  "/balances",
  requireLeavePermission(LEAVE_PERMISSIONS.VIEW_OWN),
  handle((req, res) => {
    const result = leaveService.listBalances(req.user, req.query);
    return res.json({ success: true, message: "Leave balances loaded.", data: result.data, meta: result.meta });
  })
);

leaveRouter.get(
  "/balances/:employeeId",
  requireLeavePermission(LEAVE_PERMISSIONS.VIEW_OWN),
  handle((req, res) => {
    const result = leaveService.getEmployeeBalances(req.params.employeeId, req.user, req.query);
    return res.json({ success: true, message: "Employee leave balances loaded.", data: result.data, meta: result.meta });
  })
);

leaveRouter.post(
  "/balances/adjust",
  requireLeavePermission(LEAVE_PERMISSIONS.MANAGE_BALANCES),
  handle((req, res) => {
    const result = leaveService.adjustBalance(req.body || {}, req.user);
    auditLeave(req, "BALANCE_CHANGED", result);
    return res.json({ success: true, message: "Leave balance adjusted.", data: result.record, meta: {} });
  })
);

leaveRouter.post(
  "/requests",
  requireLeavePermission(LEAVE_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = leaveService.createLeaveRequest(req.body || {}, req.user, req);
    auditLeave(req, "LEAVE_CREATED", result);
    return res.status(201).json({ success: true, message: "Leave request submitted.", data: result.request, meta: {} });
  })
);

leaveRouter.get(
  "/requests",
  requireLeavePermission(LEAVE_PERMISSIONS.VIEW_OWN),
  handle((req, res) => {
    const result = leaveService.getVisibleRequests(req.user, req.query);
    return res.json({ success: true, message: "Leave requests loaded.", data: result.data, meta: result.meta });
  })
);

leaveRouter.get(
  "/requests/:id",
  requireLeavePermission(LEAVE_PERMISSIONS.VIEW_OWN),
  handle((req, res) => {
    const request = leaveService.getLeaveRequest(req.params.id, req.user);
    if (!request) {
      return sendNotFound(res, "LEAVE_REQUEST_NOT_FOUND");
    }

    return res.json({ success: true, message: "Leave request loaded.", data: request, meta: {} });
  })
);

leaveRouter.post(
  "/requests/:id/approve",
  requireLeavePermission(LEAVE_PERMISSIONS.APPROVE),
  handle((req, res) => {
    const result = leaveService.approveLeaveRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return sendNotFound(res, "LEAVE_REQUEST_NOT_FOUND");
    }

    auditLeave(req, "LEAVE_APPROVED", result);
    return res.json({ success: true, message: "Leave request approved.", data: result.record, meta: { balance: result.balance } });
  })
);

leaveRouter.post(
  "/requests/:id/reject",
  requireLeavePermission(LEAVE_PERMISSIONS.REJECT),
  handle((req, res) => {
    const result = leaveService.rejectLeaveRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return sendNotFound(res, "LEAVE_REQUEST_NOT_FOUND");
    }

    auditLeave(req, "LEAVE_REJECTED", result);
    return res.json({ success: true, message: "Leave request rejected.", data: result.record, meta: { balance: result.balance } });
  })
);

leaveRouter.post(
  "/requests/:id/withdraw",
  requireLeavePermission(LEAVE_PERMISSIONS.WITHDRAW),
  handle((req, res) => {
    const result = leaveService.withdrawLeaveRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return sendNotFound(res, "LEAVE_REQUEST_NOT_FOUND");
    }

    auditLeave(req, "LEAVE_WITHDRAWN", result);
    return res.json({ success: true, message: "Leave request withdrawn.", data: result.record, meta: { balance: result.balance } });
  })
);

leaveRouter.post(
  "/requests/:id/cancel",
  requireLeavePermission(LEAVE_PERMISSIONS.CANCEL),
  handle((req, res) => {
    const result = leaveService.cancelLeaveRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return sendNotFound(res, "LEAVE_REQUEST_NOT_FOUND");
    }

    auditLeave(req, "LEAVE_CANCELLED", result);
    return res.json({ success: true, message: "Leave request cancelled.", data: result.record, meta: { balance: result.balance } });
  })
);

leaveRouter.get(
  "/calendar",
  requireLeavePermission(LEAVE_PERMISSIONS.VIEW_OWN),
  handle((req, res) => {
    const calendar = leaveService.getCalendar(req.user, req.query);
    return res.json({ success: true, message: "Leave calendar loaded.", data: calendar, meta: {} });
  })
);

leaveRouter.get(
  "/history",
  requireLeavePermission(LEAVE_PERMISSIONS.VIEW_OWN),
  handle((req, res) => {
    const result = leaveService.listHistory(req.user, req.query);
    return res.json({ success: true, message: "Leave history loaded.", data: result.data, meta: result.meta });
  })
);

leaveRouter.get(
  "/reports",
  requireLeavePermission(LEAVE_PERMISSIONS.REPORTS),
  handle((req, res) => {
    const report = leaveService.getReports(req.user, req.query);
    return res.json({ success: true, message: "Leave reports loaded.", data: report, meta: {} });
  })
);

module.exports = { leaveRouter };
