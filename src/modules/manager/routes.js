const express = require("express");
const managerService = require("./service");
const { authenticate } = require("../../auth/middleware");
const announcementService = require("../announcements/service");
const { getLookups } = require("../lookups/catalog");
const nyscInternService = require("../nyscIntern/nyscIntern.service");
const payrollService = require("../payroll/payroll.service");
const { vendorsRouter } = require("../vendors/routes");

const managerRouter = express.Router();

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

managerRouter.use(authenticate);

managerRouter.get("/scope", handle((req, res) => send(res, "Manager scope loaded.", managerService.getScopeSummary(req.user))));

managerRouter.get("/dashboard", handle((req, res) => send(res, "Manager dashboard loaded.", managerService.getDashboard(req.user, req.query))));
managerRouter.get("/dashboard/stats", handle((req, res) => send(res, "Manager dashboard stats loaded.", managerService.getStats(req.user, req.query))));

managerRouter.get("/employment-record", handle((req, res) => send(res, "Manager employment record loaded.", managerService.getSelfEmploymentRecord(req.user))));
managerRouter.get("/employment-record/documents", handle((req, res) => {
  const record = managerService.getSelfEmploymentRecord(req.user);
  return send(res, "Manager employment documents loaded.", record.documents || []);
}));
managerRouter.patch("/employment-record", handle((req, res) => send(res, "Manager employment record updated.", managerService.updateSelfEmploymentRecord(req.body || {}, req))));
managerRouter.put("/employment-record", handle((req, res) => send(res, "Manager employment record updated.", managerService.updateSelfEmploymentRecord(req.body || {}, req))));
managerRouter.get("/profile", handle((req, res) => send(res, "Manager profile loaded.", managerService.getManagerProfile(req.user))));
managerRouter.patch("/profile", handle((req, res) => send(res, "Manager profile updated.", managerService.updateManagerProfile(req.body || {}, req))));
managerRouter.put("/profile", handle((req, res) => send(res, "Manager profile updated.", managerService.updateManagerProfile(req.body || {}, req))));
managerRouter.get("/settings", handle((req, res) => send(res, "Manager settings loaded.", managerService.getManagerSettings(req.user))));
managerRouter.patch("/settings", handle((req, res) => send(res, "Manager settings updated.", managerService.updateManagerSettings(req.body || {}, req))));
managerRouter.get("/help-center", handle((req, res) => send(res, "Manager help center loaded.", managerService.getHelpCenter(req.user))));

managerRouter.get("/employees", handle((req, res) => paged(res, "Manager employees loaded.", managerService.listEmployees(req.user, req.query))));
managerRouter.get("/team", handle((req, res) => paged(res, "Manager team loaded.", managerService.listEmployees(req.user, req.query))));
managerRouter.get("/employees/:id", handle((req, res) => {
  const employee = managerService.getEmployee(req.user, req.params.id);
  return employee ? send(res, "Manager employee loaded.", employee) : notFound(res, "EMPLOYEE_NOT_FOUND");
}));
managerRouter.get("/team/:id", handle((req, res) => {
  const employee = managerService.getEmployee(req.user, req.params.id);
  return employee ? send(res, "Manager team member loaded.", employee) : notFound(res, "EMPLOYEE_NOT_FOUND");
}));

managerRouter.get("/departments", handle((req, res) => paged(res, "Manager departments loaded.", managerService.listDepartments(req.user, req.query))));
managerRouter.get("/departments/:id", handle((req, res) => {
  const department = managerService.getDepartment(req.user, req.params.id);
  return department ? send(res, "Manager department loaded.", department) : notFound(res, "DEPARTMENT_NOT_FOUND");
}));

managerRouter.get("/leave", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager leave requests loaded.", managerService.listScoped("leave_requests", req.query, scope));
}));
managerRouter.post("/leave", handle((req, res) => res.status(201).json({ success: true, message: "Manager leave request created.", data: managerService.createLeave(req.body || {}, req), meta: {} })));
managerRouter.get("/leave/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("leave_requests", req.params.id, req.user, { permission: "leave.view" });
  return record ? send(res, "Manager leave request loaded.", record) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));
managerRouter.patch("/leave/:id/approve", handle((req, res) => {
  const result = managerService.updateStatus("leave_requests", req.params.id, "APPROVED", req, { permission: "leave.approve", auditAction: "MANAGER_LEAVE_APPROVED", requirePending: true });
  return result ? send(res, "Manager leave approved.", result.record) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));
managerRouter.patch("/leave/:id/reject", handle((req, res) => {
  const result = managerService.updateStatus("leave_requests", req.params.id, "REJECTED", req, { permission: "leave.reject", auditAction: "MANAGER_LEAVE_REJECTED", requirePending: true });
  return result ? send(res, "Manager leave rejected.", result.record) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));

function sendClockIn(res, result) {
  return res.status(result.created ? 201 : 200).json({
    success: true,
    message: result.created ? "Clock-in recorded." : "Clock-in already recorded.",
    data: result.record,
    meta: { idempotent: !result.created },
  });
}

managerRouter.get("/attendance", handle((req, res) => paged(res, "Manager attendance loaded.", managerService.listAttendance(req.user, req.query))));
managerRouter.get("/attendance/locations", handle((req, res) => paged(res, "Manager attendance locations loaded.", { data: [], meta: { page: 1, limit: 25, total: 0 } })));
managerRouter.get("/attendance/status", handle((req, res) => send(res, "Manager check-in status loaded.", managerService.getSelfClockStatus(req.user))));
managerRouter.get("/attendance/me/status", handle((req, res) => send(res, "Manager check-in status loaded.", managerService.getSelfClockStatus(req.user))));
managerRouter.get("/attendance/history", handle((req, res) => paged(res, "Manager attendance history loaded.", managerService.listAttendance(req.user, req.query))));
managerRouter.get("/attendance/me/history", handle((req, res) => paged(res, "Manager attendance history loaded.", managerService.listAttendance(req.user, req.query))));
managerRouter.post("/attendance", handle((req, res) => sendClockIn(res, managerService.clockInSelf(req.body || {}, req))));
managerRouter.post("/attendance/clock-in", handle((req, res) => sendClockIn(res, managerService.clockInSelf(req.body || {}, req))));
managerRouter.post("/attendance/clockIn", handle((req, res) => sendClockIn(res, managerService.clockInSelf(req.body || {}, req))));
managerRouter.post("/attendance/clockin", handle((req, res) => sendClockIn(res, managerService.clockInSelf(req.body || {}, req))));
managerRouter.post("/attendance/check-in", handle((req, res) => sendClockIn(res, managerService.clockInSelf(req.body || {}, req))));
managerRouter.post("/attendance/checkIn", handle((req, res) => sendClockIn(res, managerService.clockInSelf(req.body || {}, req))));
managerRouter.post("/attendance/clock-out", handle((req, res) => {
  const result = managerService.clockOutSelf(req.body || {}, req);
  return send(res, "Clock-out recorded.", result.record);
}));
managerRouter.post("/clock-in", handle((req, res) => sendClockIn(res, managerService.clockInSelf(req.body || {}, req))));
managerRouter.get("/attendance/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("attendance", req.params.id, req.user, { permission: "attendance.view" });
  return record ? send(res, "Manager attendance record loaded.", record) : notFound(res, "ATTENDANCE_NOT_FOUND");
}));
managerRouter.patch("/attendance/:id/correct", handle((req, res) => {
  const result = managerService.correctAttendance(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager attendance corrected.", result.record) : notFound(res, "ATTENDANCE_NOT_FOUND");
}));

managerRouter.get("/performance", handle((req, res) => paged(res, "Manager performance reviews loaded.", managerService.listPerformance(req.user, req.query))));
managerRouter.post("/performance", handle((req, res) => res.status(201).json({ success: true, message: "Manager performance review created.", data: managerService.createPerformanceReview(req.body || {}, req), meta: {} })));
managerRouter.get("/performance/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("performance_reviews", req.params.id, req.user, { permission: "performance.view", allowCreatedBy: true });
  return record ? send(res, "Manager performance review loaded.", record) : notFound(res, "PERFORMANCE_REVIEW_NOT_FOUND");
}));
managerRouter.patch("/performance/:id", handle((req, res) => {
  const result = managerService.updatePerformanceReview(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager performance review updated.", result.record) : notFound(res, "PERFORMANCE_REVIEW_NOT_FOUND");
}));
managerRouter.put("/performance/:id", handle((req, res) => {
  const result = managerService.updatePerformanceReview(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager performance review updated.", result.record) : notFound(res, "PERFORMANCE_REVIEW_NOT_FOUND");
}));

managerRouter.get("/promotions", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager promotions loaded.", managerService.listScoped("promotions", req.query, scope));
}));
managerRouter.post("/promotions", handle((req, res) => res.status(201).json({ success: true, message: "Manager promotion recommendation created.", data: managerService.createPromotion(req.body || {}, req), meta: {} })));
managerRouter.get("/promotions/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("promotions", req.params.id, req.user, { permission: "promotions.view" });
  return record ? send(res, "Manager promotion loaded.", record) : notFound(res, "PROMOTION_NOT_FOUND");
}));

managerRouter.get("/salary-recommendations", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager salary recommendations loaded.", managerService.listScoped("salary_adjustments", req.query, scope));
}));
managerRouter.post("/salary-recommendations", handle((req, res) => res.status(201).json({ success: true, message: "Manager salary recommendation created.", data: managerService.createSalaryRecommendation(req.body || {}, req), meta: {} })));
managerRouter.get("/salary-recommendations/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("salary_adjustments", req.params.id, req.user, { permission: "salary_increments.view" });
  return record ? send(res, "Manager salary recommendation loaded.", record) : notFound(res, "SALARY_RECOMMENDATION_NOT_FOUND");
}));
managerRouter.get("/salary", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager salary recommendations loaded.", managerService.listScoped("salary_adjustments", req.query, scope));
}));
managerRouter.post("/salary/recommend", handle((req, res) => res.status(201).json({ success: true, message: "Manager salary recommendation created.", data: managerService.createSalaryRecommendation(req.body || {}, req), meta: {} })));

managerRouter.get("/meetings", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager meetings loaded.", managerService.listScoped("meetings", req.query, scope, { allowCreatedBy: true }));
}));
managerRouter.post("/meetings", handle((req, res) => res.status(201).json({ success: true, message: "Manager meeting created.", data: managerService.createScopedRecord("meetings", req.body || {}, req, { permission: "meetings.create", auditAction: "MANAGER_MEETING_CREATED" }), meta: {} })));
managerRouter.get("/meetings/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("meetings", req.params.id, req.user, { permission: "meetings.view", allowCreatedBy: true });
  return record ? send(res, "Manager meeting loaded.", record) : notFound(res, "MEETING_NOT_FOUND");
}));
managerRouter.patch("/meetings/:id/cancel", handle((req, res) => {
  const result = managerService.cancelMeeting(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager meeting cancelled.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));
managerRouter.patch("/meetings/:id/reschedule", handle((req, res) => {
  const result = managerService.rescheduleMeeting(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager meeting rescheduled.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));
managerRouter.patch("/meetings/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("meetings", req.params.id, req.body || {}, req, { permission: "meetings.update", allowCreatedBy: true, auditAction: "MANAGER_MEETING_UPDATED" });
  return result ? send(res, "Manager meeting updated.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));
managerRouter.put("/meetings/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("meetings", req.params.id, req.body || {}, req, { permission: "meetings.update", allowCreatedBy: true, auditAction: "MANAGER_MEETING_UPDATED" });
  return result ? send(res, "Manager meeting updated.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));

managerRouter.get("/tasks", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager tasks loaded.", managerService.listScoped("tasks", req.query, scope, { allowCreatedBy: true }));
}));
managerRouter.get("/tasks/overdue", handle((req, res) => paged(res, "Manager overdue tasks loaded.", managerService.listOverdueTasks(req.user, req.query))));
managerRouter.post("/tasks", handle((req, res) => res.status(201).json({ success: true, message: "Manager task created.", data: managerService.createScopedRecord("tasks", req.body || {}, req, { permission: "tasks.create", defaults: { status: "PENDING" }, auditAction: "MANAGER_TASK_CREATED", notification: { type: "manager_task_created", title: "Task assigned", body: "A task was assigned to you." } }), meta: {} })));
managerRouter.get("/tasks/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("tasks", req.params.id, req.user, { permission: "tasks.view", allowCreatedBy: true });
  return record ? send(res, "Manager task loaded.", record) : notFound(res, "TASK_NOT_FOUND");
}));
managerRouter.patch("/tasks/:id/complete", handle((req, res) => {
  const result = managerService.completeTask(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager task completed.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));
managerRouter.patch("/tasks/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("tasks", req.params.id, req.body || {}, req, { permission: "tasks.update", allowCreatedBy: true, auditAction: "MANAGER_TASK_UPDATED" });
  return result ? send(res, "Manager task updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));
managerRouter.put("/tasks/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("tasks", req.params.id, req.body || {}, req, { permission: "tasks.update", allowCreatedBy: true, auditAction: "MANAGER_TASK_UPDATED" });
  return result ? send(res, "Manager task updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));

managerRouter.get("/targets", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager targets loaded.", managerService.listScoped("targets", req.query, scope, { allowCreatedBy: true }));
}));
managerRouter.post("/targets", handle((req, res) => res.status(201).json({ success: true, message: "Manager target created.", data: managerService.createScopedRecord("targets", req.body || {}, req, { permission: "targets.create", defaults: { status: "ACTIVE" }, auditAction: "MANAGER_TARGET_CREATED", notification: { type: "manager_target_created", title: "Target assigned", body: "A target was assigned to you." } }), meta: {} })));
managerRouter.get("/targets/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("targets", req.params.id, req.user, { permission: "targets.view", allowCreatedBy: true });
  return record ? send(res, "Manager target loaded.", record) : notFound(res, "TARGET_NOT_FOUND");
}));
managerRouter.patch("/targets/:id/progress", handle((req, res) => {
  const result = managerService.updateTargetProgress(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager target progress updated.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));
managerRouter.patch("/targets/:id/complete", handle((req, res) => {
  const result = managerService.completeTarget(req.params.id, req.body || {}, req);
  return result ? send(res, "Manager target completed.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));
managerRouter.patch("/targets/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("targets", req.params.id, req.body || {}, req, { permission: "targets.update", allowCreatedBy: true, auditAction: "MANAGER_TARGET_UPDATED" });
  return result ? send(res, "Manager target updated.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));
managerRouter.put("/targets/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("targets", req.params.id, req.body || {}, req, { permission: "targets.update", allowCreatedBy: true, auditAction: "MANAGER_TARGET_UPDATED" });
  return result ? send(res, "Manager target updated.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));

managerRouter.get("/finance", handle((req, res) => paged(res, "Manager finance requests loaded.", managerService.listFinance(req.user, req.query))));
managerRouter.get("/expenses", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager expenses loaded.", managerService.listScoped("expenses", req.query, scope, { allowCreatedBy: true }));
}));
managerRouter.post("/expenses", handle((req, res) => {
  const result = managerService.createExpenseClaim(req.body || {}, req);
  return res.status(201).json({ success: true, message: "Expense claim submitted.", data: result.record, meta: {} });
}));
managerRouter.post("/expense-claims", handle((req, res) => {
  const result = managerService.createExpenseClaim(req.body || {}, req);
  return res.status(201).json({ success: true, message: "Expense claim submitted.", data: result.record, meta: {} });
}));
managerRouter.post("/claims", handle((req, res) => {
  const result = managerService.createExpenseClaim(req.body || {}, req);
  return res.status(201).json({ success: true, message: "Expense claim submitted.", data: result.record, meta: {} });
}));
managerRouter.use("/vendors", vendorsRouter);
managerRouter.post("/vendor", handle((req, res) => res.status(201).json({ success: true, message: "Vendor created.", data: managerService.createVendor(req.body || {}, req), meta: {} })));
managerRouter.get("/expenses/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("expenses", req.params.id, req.user, { permission: "expenses.view", allowCreatedBy: true });
  return record ? send(res, "Manager expense loaded.", record) : notFound(res, "EXPENSE_NOT_FOUND");
}));
managerRouter.patch("/expenses/:id/approve", handle((req, res) => {
  const result = managerService.updateStatus("expenses", req.params.id, "APPROVED", req, { permission: "expenses.approve", allowCreatedBy: true, auditAction: "MANAGER_EXPENSE_APPROVED" });
  return result ? send(res, "Manager expense approved.", result.record) : notFound(res, "EXPENSE_NOT_FOUND");
}));
managerRouter.patch("/expenses/:id/reject", handle((req, res) => {
  const result = managerService.updateStatus("expenses", req.params.id, "REJECTED", req, { permission: "expenses.reject", allowCreatedBy: true, auditAction: "MANAGER_EXPENSE_REJECTED" });
  return result ? send(res, "Manager expense rejected.", result.record) : notFound(res, "EXPENSE_NOT_FOUND");
}));

managerRouter.get("/procurement-requests", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager procurement requests loaded.", managerService.listScoped("purchase_requests", req.query, scope, { allowCreatedBy: true }));
}));
managerRouter.post("/procurement-requests", handle((req, res) => res.status(201).json({ success: true, message: "Manager procurement request created.", data: managerService.createScopedRecord("purchase_requests", req.body || {}, req, { permission: "procurement.create", defaults: { status: "PENDING" }, auditAction: "MANAGER_PROCUREMENT_REQUEST_CREATED", notification: { type: "manager_procurement_created", title: "Procurement request created", body: "A procurement request was created for your team." } }), meta: {} })));
managerRouter.get("/procurement-requests/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("purchase_requests", req.params.id, req.user, { permission: "procurement.view", allowCreatedBy: true });
  return record ? send(res, "Manager procurement request loaded.", record) : notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
}));
managerRouter.patch("/procurement-requests/:id/approve", handle((req, res) => {
  const result = managerService.updateStatus("purchase_requests", req.params.id, "APPROVED", req, { permission: "procurement.approve", allowCreatedBy: true, auditAction: "MANAGER_PROCUREMENT_APPROVED" });
  return result ? send(res, "Manager procurement request approved.", result.record) : notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
}));
managerRouter.patch("/procurement-requests/:id/reject", handle((req, res) => {
  const result = managerService.updateStatus("purchase_requests", req.params.id, "REJECTED", req, { permission: "purchases.reject", allowCreatedBy: true, auditAction: "MANAGER_PROCUREMENT_REJECTED" });
  return result ? send(res, "Manager procurement request rejected.", result.record) : notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
}));

managerRouter.get("/events", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager events loaded.", managerService.listScoped("events", req.query, scope, { allowCreatedBy: true }));
}));
managerRouter.post("/events", handle((req, res) => res.status(201).json({ success: true, message: "Manager event created.", data: managerService.createScopedRecord("events", req.body || {}, req, { permission: "events.create", defaults: { status: "DRAFT" }, auditAction: "MANAGER_EVENT_CREATED" }), meta: {} })));
managerRouter.get("/events/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("events", req.params.id, req.user, { permission: "events.view", allowCreatedBy: true });
  return record ? send(res, "Manager event loaded.", record) : notFound(res, "EVENT_NOT_FOUND");
}));
managerRouter.patch("/events/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("events", req.params.id, req.body || {}, req, { permission: "events.update", allowCreatedBy: true, auditAction: "MANAGER_EVENT_UPDATED" });
  return result ? send(res, "Manager event updated.", result.record) : notFound(res, "EVENT_NOT_FOUND");
}));
managerRouter.put("/events/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("events", req.params.id, req.body || {}, req, { permission: "events.update", allowCreatedBy: true, auditAction: "MANAGER_EVENT_UPDATED" });
  return result ? send(res, "Manager event updated.", result.record) : notFound(res, "EVENT_NOT_FOUND");
}));
managerRouter.post("/events/:id/send", handle((req, res) => {
  const result = managerService.writeScopedRecord("events", req.params.id, { status: "SENT", sentAt: new Date().toISOString(), sent_at: new Date().toISOString() }, req, { permission: "events.update", allowCreatedBy: true, auditAction: "MANAGER_EVENT_SENT" });
  return result ? send(res, "Manager event sent.", result.record) : notFound(res, "EVENT_NOT_FOUND");
}));

managerRouter.get("/discipline", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager discipline cases loaded.", managerService.listScoped("disciplinary_cases", req.query, scope));
}));
managerRouter.post("/discipline", handle((req, res) => res.status(201).json({ success: true, message: "Manager discipline case created.", data: managerService.createScopedRecord("disciplinary_cases", req.body || {}, req, { permission: "discipline.create", defaults: { status: "OPEN" }, auditAction: "MANAGER_DISCIPLINE_CREATED" }), meta: {} })));
managerRouter.get("/discipline/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("disciplinary_cases", req.params.id, req.user, { permission: "discipline.view" });
  return record ? send(res, "Manager discipline case loaded.", record) : notFound(res, "DISCIPLINE_CASE_NOT_FOUND");
}));
managerRouter.patch("/discipline/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("disciplinary_cases", req.params.id, req.body || {}, req, { permission: "discipline.update", auditAction: "MANAGER_DISCIPLINE_UPDATED" });
  return result ? send(res, "Manager discipline case updated.", result.record) : notFound(res, "DISCIPLINE_CASE_NOT_FOUND");
}));
managerRouter.put("/discipline/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("disciplinary_cases", req.params.id, req.body || {}, req, { permission: "discipline.update", auditAction: "MANAGER_DISCIPLINE_UPDATED" });
  return result ? send(res, "Manager discipline case updated.", result.record) : notFound(res, "DISCIPLINE_CASE_NOT_FOUND");
}));
managerRouter.patch("/discipline/:id/close", handle((req, res) => {
  const result = managerService.updateStatus("disciplinary_cases", req.params.id, "CLOSED", req, { permission: "discipline.close", auditAction: "MANAGER_DISCIPLINE_CLOSED" });
  return result ? send(res, "Manager discipline case closed.", result.record) : notFound(res, "DISCIPLINE_CASE_NOT_FOUND");
}));

managerRouter.get("/approvals", handle((req, res) => {
  const scope = managerService.buildScope(req.user);
  return paged(res, "Manager approval queue loaded.", managerService.buildApprovalQueue(scope, req.query));
}));

managerRouter.get("/reports", handle((req, res) => send(res, "Manager reports loaded.", managerService.getReports(req.user, req.query))));
managerRouter.get("/notifications", handle((req, res) => paged(res, "Manager notifications loaded.", managerService.listNotifications(req.user, req.query))));
managerRouter.patch("/notifications/:id/read", handle((req, res) => {
  const notification = managerService.markNotificationRead(req.params.id, req);
  return notification ? send(res, "Manager notification marked as read.", notification) : notFound(res, "NOTIFICATION_NOT_FOUND");
}));
managerRouter.get("/audit-logs", handle((req, res) => paged(res, "Manager audit logs loaded.", managerService.listAuditLogs(req.user, req.query))));

managerRouter.get("/lookups", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "Manager lookups loaded.", getLookups());
}));

managerRouter.get("/nysc-interns/dashboard", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "Manager NYSC and interns dashboard loaded.", nyscInternService.getDashboard(req.user));
}));
managerRouter.get("/nysc-interns/export", handle((req, res) => {
  managerService.buildScope(req.user);
  const csv = nyscInternService.exportProfiles(req.user, req.query);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"nysc-interns.csv\"");
  return res.status(200).send(csv);
}));
managerRouter.get("/nysc-interns", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.listProfiles(req.user, req.query);
  return paged(res, "Manager NYSC and intern members loaded.", result);
}));
managerRouter.post("/nysc-interns", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.createProfile(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "NYSC/intern member created.", data: result.record, meta: {} });
}));
managerRouter.get("/nysc-interns/:id", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "Manager NYSC/intern profile loaded.", nyscInternService.getDetails(req.params.id, req.user));
}));
managerRouter.patch("/nysc-interns/:id", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.updateProfile(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Manager NYSC/intern profile updated.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
managerRouter.post("/nysc-interns/:id/supervisor", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.assignSupervisor(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Placement supervisor assigned.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));

managerRouter.get("/nysc", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.listProfiles(req.user, req.query);
  return paged(res, "Manager NYSC and intern members loaded.", result);
}));
managerRouter.get("/announcements/dashboard", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "Manager announcements dashboard loaded.", announcementService.getDashboard(req.user));
}));
managerRouter.get("/announcements", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.listAdminAnnouncements(req.user, req.query);
  return paged(res, "Manager announcements loaded.", result);
}));
managerRouter.post("/announcements/drafts", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.createDraft(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "Announcement draft created.", data: result.record, meta: result.meta || {} });
}));
managerRouter.post("/announcements", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.createAnnouncement({ ...(req.body || {}), status: req.body?.status || "published" }, req.user);
  return res.status(201).json({ success: true, message: "Announcement published.", data: result.record, meta: result.meta || {} });
}));
managerRouter.post("/announcement", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.createAnnouncement({ ...(req.body || {}), status: req.body?.status || "published" }, req.user);
  return res.status(201).json({ success: true, message: "Announcement published.", data: result.record, meta: result.meta || {} });
}));
managerRouter.post("/nysc", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.createProfile(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "NYSC/intern member created.", data: result.record, meta: {} });
}));
managerRouter.post("/nysc-interns/members", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.createProfile(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "NYSC/intern member created.", data: result.record, meta: {} });
}));
managerRouter.get("/announcements/:id", handle((req, res) => {
  managerService.buildScope(req.user);
  const announcement = announcementService.getAdminDetails(req.params.id, req.user);
  return announcement ? send(res, "Manager announcement loaded.", announcement) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}));
managerRouter.post("/announcements/:id/publish", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.publishAnnouncement(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Announcement published.", result.record) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}));
function pinAnnouncement(req, res, pinned) {
  managerService.buildScope(req.user);
  const result = announcementService.setPin(req.params.id, pinned, req.user);
  return result ? send(res, pinned ? "Announcement pinned." : "Announcement unpinned.", result.record) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}
managerRouter.patch("/announcements/:id/pin", handle((req, res) => pinAnnouncement(req, res, true)));
managerRouter.post("/announcements/:id/pin", handle((req, res) => pinAnnouncement(req, res, true)));
managerRouter.patch("/announcements/:id/unpin", handle((req, res) => pinAnnouncement(req, res, false)));
managerRouter.post("/announcements/:id/unpin", handle((req, res) => pinAnnouncement(req, res, false)));

managerRouter.get("/payroll/dashboard", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "Manager payroll dashboard loaded.", payrollService.getDashboard());
}));
managerRouter.get("/payroll/periods", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = payrollService.listPayrollPeriods(req.query);
  return paged(res, "Manager payroll periods loaded.", result);
}));
managerRouter.post("/payroll/periods", handle((req, res) => {
  managerService.buildScope(req.user);
  const period = payrollService.createPayrollPeriod(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "Payroll period created.", data: period, meta: {} });
}));
managerRouter.get("/payroll/export", handle((req, res) => {
  managerService.buildScope(req.user);
  const csv = payrollService.exportPayroll(req.user, req.query);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"payroll.csv\"");
  return res.status(200).send(csv);
}));
managerRouter.get("/payroll/runs", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = payrollService.listRuns(req.query);
  return paged(res, "Manager payroll runs loaded.", result);
}));
managerRouter.post("/payroll/runs", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = payrollService.createPayrollRun(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "Payroll run calculated.", data: result.record, meta: { readiness: result.readiness } });
}));
managerRouter.get("/payroll/runs/:id", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "Manager payroll run loaded.", payrollService.getRunDetails(req.params.id, req.user));
}));
managerRouter.get("/payroll", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = payrollService.listRuns(req.query);
  return paged(res, "Manager payroll loaded.", result);
}));
managerRouter.get("/payroll/:id", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "Manager payroll run loaded.", payrollService.getRunDetails(req.params.id, req.user));
}));

module.exports = { managerRouter };
