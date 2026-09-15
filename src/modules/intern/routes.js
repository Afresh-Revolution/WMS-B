const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { registerSelfServiceAttendance } = require("../attendance/routes");
const internService = require("./service");

const internRouter = express.Router();

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

function findOne(result, id) {
  return result.data.find((record) => record.id === id) || null;
}

internRouter.use(authenticate);

internRouter.get("/scope", handle((req, res) => send(res, "NYSC/intern scope loaded.", internService.getScopeSummary(req.user))));
internRouter.get("/dashboard", handle((req, res) => send(res, "NYSC/intern dashboard loaded.", internService.getDashboard(req.user, req.query))));
internRouter.get("/home", handle((req, res) => send(res, "NYSC/intern dashboard loaded.", internService.getDashboard(req.user, req.query))));

internRouter.get("/placement-record", handle((req, res) => send(res, "NYSC/intern placement record loaded.", internService.getPlacementRecord(req.user))));
internRouter.get("/profile", handle((req, res) => send(res, "NYSC/intern profile loaded.", internService.getPlacementRecord(req.user))));
internRouter.patch("/placement-record", handle((req, res) => send(res, "NYSC/intern placement record updated.", internService.updatePlacementRecord(req.body || {}, req))));
internRouter.put("/placement-record", handle((req, res) => send(res, "NYSC/intern placement record updated.", internService.updatePlacementRecord(req.body || {}, req))));
internRouter.patch("/profile", handle((req, res) => send(res, "NYSC/intern profile updated.", internService.updatePlacementRecord(req.body || {}, req))));
internRouter.put("/profile", handle((req, res) => send(res, "NYSC/intern profile updated.", internService.updatePlacementRecord(req.body || {}, req))));

internRouter.get("/settings", handle((req, res) => send(res, "NYSC/intern settings loaded.", { profile: internService.getPlacementRecord(req.user).overview, preferences: req.user.preferences || {} })));
internRouter.patch("/settings", handle((req, res) => send(res, "NYSC/intern settings updated.", internService.updateSettings(req.body || {}, req))));

internRouter.get("/tasks", handle((req, res) => paged(res, "NYSC/intern assigned tasks loaded.", internService.listTasks(req.user, req.query))));
internRouter.get("/assigned-to-me", handle((req, res) => paged(res, "NYSC/intern assigned tasks loaded.", internService.listTasks(req.user, req.query))));
internRouter.get("/tasks/:id", handle((req, res) => {
  const task = findOne(internService.listTasks(req.user, { id: req.params.id, limit: 1 }), req.params.id);
  return task ? send(res, "NYSC/intern task loaded.", task) : notFound(res, "TASK_NOT_FOUND");
}));
internRouter.patch("/tasks/:id/progress", handle((req, res) => {
  const result = internService.updateTaskProgress(req.params.id, req.body || {}, req);
  return result ? send(res, "NYSC/intern task progress updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));
internRouter.patch("/tasks/:id", handle((req, res) => {
  const result = internService.updateTaskProgress(req.params.id, req.body || {}, req);
  return result ? send(res, "NYSC/intern task updated.", result.record) : notFound(res, "TASK_NOT_FOUND");
}));

internRouter.get("/targets", handle((req, res) => paged(res, "NYSC/intern targets loaded.", internService.listTargets(req.user, req.query))));
internRouter.get("/progress", handle((req, res) => send(res, "NYSC/intern placement progress loaded.", internService.getDashboard(req.user, req.query).progress)));
internRouter.get("/targets/:id", handle((req, res) => {
  const target = findOne(internService.listTargets(req.user, { id: req.params.id, limit: 1 }), req.params.id);
  return target ? send(res, "NYSC/intern target loaded.", target) : notFound(res, "TARGET_NOT_FOUND");
}));
internRouter.patch("/targets/:id/progress", handle((req, res) => {
  const result = internService.updateTargetProgress(req.params.id, req.body || {}, req);
  return result ? send(res, "NYSC/intern target progress updated.", result.record, { progress: result.progress }) : notFound(res, "TARGET_NOT_FOUND");
}));
internRouter.post("/targets/:id/progress", handle((req, res) => {
  const result = internService.updateTargetProgress(req.params.id, req.body || {}, req);
  return result ? res.status(201).json({ success: true, message: "NYSC/intern target progress updated.", data: result.record, meta: { progress: result.progress } }) : notFound(res, "TARGET_NOT_FOUND");
}));

internRouter.get("/schedule", handle((req, res) => paged(res, "NYSC/intern schedule loaded.", internService.listMeetings(req.user, req.query))));
internRouter.get("/meetings", handle((req, res) => paged(res, "NYSC/intern meetings loaded.", internService.listMeetings(req.user, req.query))));
internRouter.get("/meetings/:id", handle((req, res) => {
  const meeting = findOne(internService.listMeetings(req.user, { id: req.params.id, limit: 1 }), req.params.id);
  return meeting ? send(res, "NYSC/intern meeting loaded.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));

registerSelfServiceAttendance(internRouter, "NYSC/intern");
internRouter.get("/attendance", handle((req, res) => paged(res, "NYSC/intern attendance loaded.", internService.listAttendance(req.user, req.query))));
internRouter.post("/attendance", handle((req, res) => {
  const result = internService.recordAttendance(req.body || {}, req);
  return res.status(result.created ? 201 : 200).json({ success: true, message: result.created ? "NYSC/intern attendance recorded." : "NYSC/intern attendance updated.", data: result.record, meta: {} });
}));

internRouter.get("/documents", handle((req, res) => paged(res, "NYSC/intern documents loaded.", internService.listDocuments(req.user, req.query))));
internRouter.get("/reviews", handle((req, res) => paged(res, "NYSC/intern reviews loaded.", internService.listReviews(req.user, req.query))));
internRouter.get("/company-news", handle((req, res) => paged(res, "NYSC/intern company news loaded.", internService.listNews(req.user, req.query))));
internRouter.get("/department-news", handle((req, res) => paged(res, "NYSC/intern department news loaded.", internService.listNews(req.user, req.query))));
internRouter.get("/news", handle((req, res) => paged(res, "NYSC/intern news loaded.", internService.listNews(req.user, req.query))));
internRouter.get("/notifications", handle((req, res) => paged(res, "NYSC/intern notifications loaded.", internService.listNotifications(req.user, req.query))));
internRouter.patch("/notifications/:id/read", handle((req, res) => {
  const notification = internService.markNotificationRead(req.params.id, req);
  return notification ? send(res, "NYSC/intern notification marked as read.", notification) : notFound(res, "NOTIFICATION_NOT_FOUND");
}));

module.exports = { internRouter };
