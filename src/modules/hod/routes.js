const express = require("express");
const { authenticate } = require("../../auth/middleware");
const announcementService = require("../announcements/service");
const managerService = require("../manager/service");
const nyscInternService = require("../nyscIntern/nyscIntern.service");

const hodRouter = express.Router();

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

function scopedList(collection, req, options = {}) {
  const scope = managerService.buildScope(req.user);
  return managerService.listScoped(collection, req.query, scope, options);
}

hodRouter.use(authenticate);

hodRouter.get("/scope", handle((req, res) => send(res, "HOD scope loaded.", managerService.getScopeSummary(req.user))));
hodRouter.get("/dashboard", handle((req, res) => send(res, "HOD dashboard loaded.", managerService.getHodWorkspace(req.user, req.query))));
hodRouter.get("/overview", handle((req, res) => send(res, "HOD workspace loaded.", managerService.getHodWorkspace(req.user, req.query))));
hodRouter.get("/dashboard/stats", handle((req, res) => send(res, "HOD dashboard stats loaded.", managerService.getStats(req.user, req.query))));

hodRouter.get("/department", handle((req, res) => {
  const workspace = managerService.getHodWorkspace(req.user, req.query);
  return workspace.department ? send(res, "HOD department loaded.", workspace.department) : notFound(res, "DEPARTMENT_NOT_FOUND");
}));
hodRouter.get("/departments", handle((req, res) => paged(res, "HOD departments loaded.", managerService.listDepartments(req.user, req.query))));
hodRouter.get("/departments/:id", handle((req, res) => {
  const department = managerService.getDepartment(req.user, req.params.id);
  return department ? send(res, "HOD department loaded.", department) : notFound(res, "DEPARTMENT_NOT_FOUND");
}));

hodRouter.get("/team-members", handle((req, res) => paged(res, "HOD team members loaded.", managerService.listEmployees(req.user, req.query))));
hodRouter.get("/team", handle((req, res) => paged(res, "HOD team members loaded.", managerService.listEmployees(req.user, req.query))));
hodRouter.get("/team-members/:id", handle((req, res) => {
  const employee = managerService.getEmployee(req.user, req.params.id);
  return employee ? send(res, "HOD team member loaded.", employee) : notFound(res, "EMPLOYEE_NOT_FOUND");
}));
hodRouter.get("/team/:id", handle((req, res) => {
  const employee = managerService.getEmployee(req.user, req.params.id);
  return employee ? send(res, "HOD team member loaded.", employee) : notFound(res, "EMPLOYEE_NOT_FOUND");
}));

hodRouter.get("/tasks", handle((req, res) => paged(res, "HOD department tasks loaded.", scopedList("tasks", req, { allowCreatedBy: true }))));
hodRouter.get("/tasks/overdue", handle((req, res) => paged(res, "HOD overdue tasks loaded.", managerService.listOverdueTasks(req.user, req.query))));
hodRouter.post("/tasks", handle((req, res) => {
  const task = managerService.createScopedRecord("tasks", req.body || {}, req, {
    permission: "tasks.create",
    defaults: { status: "PENDING" },
    auditAction: "HOD_TASK_CREATED",
    notification: { type: "hod_task_created", title: "Task assigned", body: "A department task was assigned to you." },
  });
  return res.status(201).json({ success: true, message: "HOD task created.", data: task, meta: {} });
}));
hodRouter.get("/tasks/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("tasks", req.params.id, req.user, { permission: "tasks.view", allowCreatedBy: true });
  return record ? send(res, "HOD task loaded.", record) : notFound(res, "TASK_NOT_FOUND");
}));
hodRouter.patch("/tasks/:id/complete", handle((req, res) => {
  const result = managerService.completeTask(req.params.id, req.body || {}, req);
  return result ? send(res, "HOD task completed.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));
hodRouter.patch("/tasks/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("tasks", req.params.id, req.body || {}, req, { permission: "tasks.update", allowCreatedBy: true, auditAction: "HOD_TASK_UPDATED" });
  return result ? send(res, "HOD task updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));
hodRouter.put("/tasks/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("tasks", req.params.id, req.body || {}, req, { permission: "tasks.update", allowCreatedBy: true, auditAction: "HOD_TASK_UPDATED" });
  return result ? send(res, "HOD task updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));

hodRouter.get("/targets", handle((req, res) => paged(res, "HOD targets and KPIs loaded.", scopedList("targets", req, { allowCreatedBy: true }))));
hodRouter.post("/targets", handle((req, res) => {
  const target = managerService.createScopedRecord("targets", req.body || {}, req, {
    permission: "targets.create",
    defaults: { status: "ACTIVE" },
    auditAction: "HOD_TARGET_CREATED",
    notification: { type: "hod_target_created", title: "Target assigned", body: "A department target was assigned to you." },
  });
  return res.status(201).json({ success: true, message: "HOD target created.", data: target, meta: {} });
}));
hodRouter.get("/targets/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("targets", req.params.id, req.user, { permission: "targets.view", allowCreatedBy: true });
  return record ? send(res, "HOD target loaded.", record) : notFound(res, "TARGET_NOT_FOUND");
}));
hodRouter.patch("/targets/:id/progress", handle((req, res) => {
  const result = managerService.updateTargetProgress(req.params.id, req.body || {}, req);
  return result ? send(res, "HOD target progress updated.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));
hodRouter.patch("/targets/:id/complete", handle((req, res) => {
  const result = managerService.completeTarget(req.params.id, req.body || {}, req);
  return result ? send(res, "HOD target completed.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));
hodRouter.patch("/targets/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("targets", req.params.id, req.body || {}, req, { permission: "targets.update", allowCreatedBy: true, auditAction: "HOD_TARGET_UPDATED" });
  return result ? send(res, "HOD target updated.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));
hodRouter.put("/targets/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("targets", req.params.id, req.body || {}, req, { permission: "targets.update", allowCreatedBy: true, auditAction: "HOD_TARGET_UPDATED" });
  return result ? send(res, "HOD target updated.", result.record) : notFound(res, "TARGET_NOT_FOUND");
}));

hodRouter.get("/meetings", handle((req, res) => paged(res, "HOD department meetings loaded.", scopedList("meetings", req, { allowCreatedBy: true }))));
hodRouter.post("/meetings", handle((req, res) => {
  const meeting = managerService.createScopedRecord("meetings", req.body || {}, req, {
    permission: "meetings.create",
    defaults: { status: "SCHEDULED" },
    auditAction: "HOD_MEETING_CREATED",
  });
  return res.status(201).json({ success: true, message: "HOD meeting created.", data: meeting, meta: {} });
}));
hodRouter.get("/meetings/:id", handle((req, res) => {
  const record = managerService.getScopedRecord("meetings", req.params.id, req.user, { permission: "meetings.view", allowCreatedBy: true });
  return record ? send(res, "HOD meeting loaded.", record) : notFound(res, "MEETING_NOT_FOUND");
}));
hodRouter.patch("/meetings/:id/cancel", handle((req, res) => {
  const result = managerService.cancelMeeting(req.params.id, req.body || {}, req);
  return result ? send(res, "HOD meeting cancelled.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));
hodRouter.patch("/meetings/:id/reschedule", handle((req, res) => {
  const result = managerService.rescheduleMeeting(req.params.id, req.body || {}, req);
  return result ? send(res, "HOD meeting rescheduled.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));
hodRouter.patch("/meetings/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("meetings", req.params.id, req.body || {}, req, { permission: "meetings.update", allowCreatedBy: true, auditAction: "HOD_MEETING_UPDATED" });
  return result ? send(res, "HOD meeting updated.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));
hodRouter.put("/meetings/:id", handle((req, res) => {
  const result = managerService.writeScopedRecord("meetings", req.params.id, req.body || {}, req, { permission: "meetings.update", allowCreatedBy: true, auditAction: "HOD_MEETING_UPDATED" });
  return result ? send(res, "HOD meeting updated.", result.record) : notFound(res, "MEETING_NOT_FOUND");
}));

hodRouter.get("/attendance", handle((req, res) => paged(res, "HOD attendance loaded.", managerService.listAttendance(req.user, req.query))));
hodRouter.get("/attendance/locations", handle((req, res) => paged(res, "HOD attendance locations loaded.", { data: [], meta: { page: 1, limit: 25, total: 0 } })));
hodRouter.get("/attendance/status", handle((req, res) => send(res, "HOD check-in status loaded.", managerService.getSelfClockStatus(req.user))));
hodRouter.get("/attendance/me/status", handle((req, res) => send(res, "HOD check-in status loaded.", managerService.getSelfClockStatus(req.user))));
hodRouter.get("/attendance/history", handle((req, res) => paged(res, "HOD attendance history loaded.", managerService.listAttendance(req.user, req.query))));
hodRouter.get("/attendance/me/history", handle((req, res) => paged(res, "HOD attendance history loaded.", managerService.listAttendance(req.user, req.query))));
hodRouter.post("/attendance/check-in", handle((req, res) => {
  const result = managerService.clockInSelf(req.body || {}, req);
  return res.status(result.created ? 201 : 200).json({ success: true, message: result.created ? "Clock-in recorded." : "Clock-in already recorded.", data: result.record, meta: { idempotent: !result.created } });
}));
hodRouter.post("/attendance/clock-in", handle((req, res) => {
  const result = managerService.clockInSelf(req.body || {}, req);
  return res.status(result.created ? 201 : 200).json({ success: true, message: result.created ? "Clock-in recorded." : "Clock-in already recorded.", data: result.record, meta: { idempotent: !result.created } });
}));

hodRouter.get("/announcements/dashboard", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "HOD announcements dashboard loaded.", announcementService.getDashboard(req.user));
}));
hodRouter.get("/announcements", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.listAdminAnnouncements(req.user, req.query);
  return paged(res, "HOD announcements loaded.", result);
}));
hodRouter.post("/announcements/drafts", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.createDraft(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "Announcement draft created.", data: result.record, meta: result.meta || {} });
}));
hodRouter.post("/announcements", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.createAnnouncement({ ...(req.body || {}), status: req.body?.status || "published" }, req.user);
  return res.status(201).json({ success: true, message: "Announcement published.", data: result.record, meta: result.meta || {} });
}));
hodRouter.post("/announcements/:id/publish", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.publishAnnouncement(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Announcement published.", result.record) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}));
hodRouter.post("/announcements/:id/pin", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.setPin(req.params.id, true, req.user);
  return result ? send(res, "Announcement pinned.", result.record) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}));
hodRouter.post("/announcements/:id/unpin", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.setPin(req.params.id, false, req.user);
  return result ? send(res, "Announcement unpinned.", result.record) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}));
hodRouter.patch("/announcements/:id/pin", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.setPin(req.params.id, true, req.user);
  return result ? send(res, "Announcement pinned.", result.record) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}));
hodRouter.patch("/announcements/:id/unpin", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = announcementService.setPin(req.params.id, false, req.user);
  return result ? send(res, "Announcement unpinned.", result.record) : notFound(res, "ANNOUNCEMENT_NOT_FOUND");
}));

hodRouter.get("/nysc-interns/dashboard", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "HOD NYSC and interns dashboard loaded.", nyscInternService.getDashboard(req.user));
}));
hodRouter.get("/nysc-interns/export", handle((req, res) => {
  managerService.buildScope(req.user);
  const csv = nyscInternService.exportProfiles(req.user, req.query);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"nysc-interns.csv\"");
  return res.status(200).send(csv);
}));
hodRouter.get("/nysc-interns", handle((req, res) => {
  managerService.buildScope(req.user);
  return paged(res, "HOD NYSC and intern members loaded.", nyscInternService.listProfiles(req.user, req.query));
}));
hodRouter.post("/nysc-interns", handle(async (req, res) => {
  managerService.buildScope(req.user);
  const result = await nyscInternService.createProfile(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "NYSC/intern member created.", ...nyscInternService.credentialsFor(result) });
}));
hodRouter.get("/nysc-interns/:id", handle((req, res) => {
  managerService.buildScope(req.user);
  return send(res, "HOD NYSC/intern profile loaded.", nyscInternService.getDetails(req.params.id, req.user));
}));
hodRouter.patch("/nysc-interns/:id", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.updateProfile(req.params.id, req.body || {}, req.user);
  return result ? send(res, "HOD NYSC/intern profile updated.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hodRouter.post("/nysc-interns/:id/supervisor", handle((req, res) => {
  managerService.buildScope(req.user);
  const result = nyscInternService.assignSupervisor(req.params.id, req.body || {}, req.user);
  return result ? send(res, "Placement supervisor assigned.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hodRouter.get("/nysc", handle((req, res) => {
  managerService.buildScope(req.user);
  return paged(res, "HOD NYSC and intern members loaded.", nyscInternService.listProfiles(req.user, req.query));
}));
hodRouter.post("/nysc", handle(async (req, res) => {
  managerService.buildScope(req.user);
  const result = await nyscInternService.createProfile(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "NYSC/intern member created.", ...nyscInternService.credentialsFor(result) });
}));
hodRouter.post("/nysc-interns/members", handle(async (req, res) => {
  managerService.buildScope(req.user);
  const result = await nyscInternService.createProfile(req.body || {}, req.user);
  return res.status(201).json({ success: true, message: "NYSC/intern member created.", ...nyscInternService.credentialsFor(result) });
}));

hodRouter.get("/leave", handle((req, res) => paged(res, "HOD leave requests loaded.", scopedList("leave_requests", req))));
hodRouter.patch("/leave/:id/approve", handle((req, res) => {
  const result = managerService.updateStatus("leave_requests", req.params.id, "APPROVED", req, { permission: "leave.approve", auditAction: "HOD_LEAVE_APPROVED", requirePending: true });
  return result ? send(res, "HOD leave approved.", result.record) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));
hodRouter.patch("/leave/:id/reject", handle((req, res) => {
  const result = managerService.updateStatus("leave_requests", req.params.id, "REJECTED", req, { permission: "leave.reject", auditAction: "HOD_LEAVE_REJECTED", requirePending: true });
  return result ? send(res, "HOD leave rejected.", result.record) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));

hodRouter.get("/reports", handle((req, res) => send(res, "HOD reports loaded.", managerService.getReports(req.user, req.query))));
hodRouter.get("/notifications", handle((req, res) => paged(res, "HOD notifications loaded.", managerService.listNotifications(req.user, req.query))));
hodRouter.patch("/notifications/:id/read", handle((req, res) => {
  const notification = managerService.markNotificationRead(req.params.id, req);
  return notification ? send(res, "HOD notification marked as read.", notification) : notFound(res, "NOTIFICATION_NOT_FOUND");
}));

module.exports = { hodRouter };
