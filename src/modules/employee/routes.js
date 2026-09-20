const express = require("express");
const { authenticate } = require("../../auth/middleware");
const attendanceService = require("../attendance/service");
const employeeService = require("./service");
const leaveService = require("../leave/leave.service");

const employeeRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res, code = "RESOURCE_NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

function paged(res, message, result) {
  return send(res, message, result.data, result.meta);
}

employeeRouter.use(authenticate);

employeeRouter.get("/scope", handle((req, res) => send(res, "Employee scope loaded.", employeeService.getScopeSummary(req.user))));
employeeRouter.get("/dashboard", handle((req, res) => send(res, "Employee dashboard loaded.", employeeService.getDashboard(req.user, req.query))));
employeeRouter.get("/home", handle((req, res) => send(res, "Employee dashboard loaded.", employeeService.getDashboard(req.user, req.query))));

employeeRouter.get("/employment-record", handle((req, res) => send(res, "Employee employment record loaded.", employeeService.getEmploymentRecord(req.user))));
employeeRouter.get("/profile", handle((req, res) => send(res, "Employee profile loaded.", employeeService.getEmploymentRecord(req.user))));
employeeRouter.patch("/employment-record", handle((req, res) => send(res, "Employee employment record updated.", employeeService.updateEmploymentRecord(req.body || {}, req))));
employeeRouter.put("/employment-record", handle((req, res) => send(res, "Employee employment record updated.", employeeService.updateEmploymentRecord(req.body || {}, req))));
employeeRouter.patch("/profile", handle((req, res) => send(res, "Employee profile updated.", employeeService.updateEmploymentRecord(req.body || {}, req))));
employeeRouter.put("/profile", handle((req, res) => send(res, "Employee profile updated.", employeeService.updateEmploymentRecord(req.body || {}, req))));
employeeRouter.get("/settings", handle((req, res) => send(res, "Employee settings loaded.", { profile: employeeService.getEmploymentRecord(req.user).overview, preferences: req.user.preferences || {} })));
employeeRouter.patch("/settings", handle((req, res) => send(res, "Employee settings updated.", employeeService.updateSettings(req.body || {}, req))));

employeeRouter.get("/leave", handle((req, res) => paged(res, "Employee leave requests loaded.", employeeService.listLeaveRequests(req.user, req.query))));
employeeRouter.get("/leave/types", handle((req, res) => paged(res, "Employee leave types loaded.", employeeService.listLeaveTypes(req.query))));
employeeRouter.get("/leave/balances", handle((req, res) => paged(res, "Employee leave balances loaded.", employeeService.listLeaveBalances(req.user, req.query))));
employeeRouter.get("/leave/requests", handle((req, res) => paged(res, "Employee leave requests loaded.", employeeService.listLeaveRequests(req.user, req.query))));
employeeRouter.post("/leave", handle((req, res) => {
  const result = employeeService.createLeaveRequest(req.body || {}, req.user, req);
  return res.status(201).json({ success: true, message: "Employee leave request submitted.", data: result.request, meta: { balance: result.balance } });
}));
employeeRouter.post("/leave/requests", handle((req, res) => {
  const result = employeeService.createLeaveRequest(req.body || {}, req.user, req);
  return res.status(201).json({ success: true, message: "Employee leave request submitted.", data: result.request, meta: { balance: result.balance } });
}));
employeeRouter.post("/leave/:id/extend", handle((req, res) => {
  const result = leaveService.requestLeaveExtension(req.params.id, req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "Leave extension requested.", data: result.request, meta: { extension: result.extension } });
}));
employeeRouter.get("/leave/:id", handle((req, res) => {
  const request = employeeService.getLeaveRequest(req.params.id, req.user);
  return request ? send(res, "Employee leave request loaded.", request) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));

employeeRouter.get("/tasks", handle((req, res) => paged(res, "Employee assigned tasks loaded.", employeeService.listTasks(req.user, req.query))));
employeeRouter.get("/assigned-to-me", handle((req, res) => paged(res, "Employee assigned tasks loaded.", employeeService.listTasks(req.user, req.query))));
employeeRouter.get("/tasks/:id", handle((req, res) => {
  const task = employeeService.listTasks(req.user, { id: req.params.id, limit: 1 }).data.find((record) => record.id === req.params.id);
  return task ? send(res, "Employee task loaded.", task) : notFound(res, "TASK_NOT_FOUND");
}));
employeeRouter.patch("/tasks/:id/progress", handle((req, res) => {
  const result = employeeService.updateTaskProgress(req.params.id, req.body || {}, req);
  return result ? send(res, "Employee task progress updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));
employeeRouter.patch("/tasks/:id", handle((req, res) => {
  const result = employeeService.updateTaskProgress(req.params.id, req.body || {}, req);
  return result ? send(res, "Employee task updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));

employeeRouter.get("/targets", handle((req, res) => paged(res, "Employee targets loaded.", employeeService.listTargets(req.user, req.query))));
employeeRouter.get("/targets/:id", handle((req, res) => send(res, "Employee target loaded.", employeeService.getTarget(req.params.id, req.user))));
employeeRouter.patch("/targets/:id/progress", handle((req, res) => {
  const result = employeeService.updateTargetProgress(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Employee target progress updated.", result.record, { progress: result.progress }) : notFound(res, "TARGET_NOT_FOUND");
}));
employeeRouter.post("/targets/:id/progress", handle((req, res) => {
  const result = employeeService.updateTargetProgress(req.params.id, req.body || {}, req.user);
  return result ? res.status(201).json({ success: true, message: "Employee target progress updated.", data: result.record, meta: { progress: result.progress } }) : notFound(res, "TARGET_NOT_FOUND");
}));

employeeRouter.get("/meetings", handle((req, res) => paged(res, "Employee meetings loaded.", employeeService.listMeetings(req.user, req.query))));
employeeRouter.get("/schedule", handle((req, res) => paged(res, "Employee schedule loaded.", employeeService.listMeetings(req.user, req.query))));
employeeRouter.get("/meetings/:id", handle((req, res) => send(res, "Employee meeting loaded.", employeeService.getMeeting(req.params.id, req.user))));

employeeRouter.get("/attendance/locations", handle((req, res) => paged(res, "Employee attendance locations loaded.", attendanceService.listMyLocations(req.user, req.query))));
employeeRouter.get("/attendance/status", handle((req, res) => send(res, "Employee check-in status loaded.", attendanceService.getCheckInStatus(req.user, req.query))));
employeeRouter.get("/attendance/history", handle((req, res) => paged(res, "Employee attendance history loaded.", attendanceService.listMyHistory(req.user, req.query))));
employeeRouter.post("/attendance/check-in", handle((req, res) => {
  try {
    const result = attendanceService.createCheckIn(req.body || {}, req);
    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created ? "Check-in recorded." : "Check-in already recorded.",
      data: result.record,
      meta: { idempotent: result.idempotent },
    });
  } catch (error) {
    attendanceService.auditCheckInRejected(req, error);
    throw error;
  }
}));

employeeRouter.get("/expenses", handle((req, res) => paged(res, "Employee expense claims loaded.", employeeService.listExpenses(req.user, req.query))));
employeeRouter.get("/expense-claims", handle((req, res) => paged(res, "Employee expense claims loaded.", employeeService.listExpenses(req.user, req.query))));
employeeRouter.post("/expenses", handle((req, res) => {
  const result = employeeService.createExpense(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "Employee expense claim created.", data: result.record, meta: {} });
}));
employeeRouter.post("/expense-claims", handle((req, res) => {
  const result = employeeService.createExpense(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "Employee expense claim created.", data: result.record, meta: {} });
}));
employeeRouter.get("/expenses/:id", handle((req, res) => send(res, "Employee expense claim loaded.", employeeService.getExpense(req.params.id, req.user))));
employeeRouter.get("/expense-claims/:id", handle((req, res) => send(res, "Employee expense claim loaded.", employeeService.getExpense(req.params.id, req.user))));
employeeRouter.patch("/expenses/:id", handle((req, res) => {
  const result = employeeService.updateExpense(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Employee expense claim updated.", result.record) : notFound(res, "EXPENSE_NOT_FOUND");
}));
employeeRouter.post("/expenses/:id/submit", handle((req, res) => {
  const result = employeeService.submitExpense(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Employee expense claim submitted.", result.record) : notFound(res, "EXPENSE_NOT_FOUND");
}));
employeeRouter.post("/expenses/:id/cancel", handle((req, res) => {
  const result = employeeService.cancelExpense(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Employee expense claim cancelled.", result.record) : notFound(res, "EXPENSE_NOT_FOUND");
}));

employeeRouter.get("/performance", handle((req, res) => paged(res, "Employee performance reviews loaded.", employeeService.listPerformance(req.user, req.query))));
employeeRouter.get("/records", handle((req, res) => send(res, "Employee records loaded.", employeeService.getEmploymentRecord(req.user))));
employeeRouter.get("/notifications", handle((req, res) => paged(res, "Employee notifications loaded.", employeeService.listNotifications(req.user, req.query))));
employeeRouter.patch("/notifications/:id/read", handle((req, res) => {
  const notification = employeeService.markNotificationRead(req.params.id, req);
  return notification ? send(res, "Employee notification marked as read.", notification) : notFound(res, "NOTIFICATION_NOT_FOUND");
}));

module.exports = { employeeRouter };
