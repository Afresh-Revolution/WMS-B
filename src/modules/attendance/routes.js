const express = require("express");
const { authenticate } = require("../../auth/middleware");
const attendanceService = require("./service");

const attendanceRouter = express.Router();

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

function submitCheckIn(req, res) {
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
}

function registerSelfServiceAttendance(router, actor = "Attendance") {
  router.get("/attendance/locations", handle((req, res) => paged(res, `${actor} attendance locations loaded.`, attendanceService.listMyLocations(req.user, req.query))));
  router.get("/attendance/status", handle((req, res) => send(res, `${actor} check-in status loaded.`, attendanceService.getCheckInStatus(req.user, req.query))));
  router.get("/attendance/history", handle((req, res) => paged(res, `${actor} attendance history loaded.`, attendanceService.listMyHistory(req.user, req.query))));
  router.post("/attendance/check-in", handle(submitCheckIn));
}

attendanceRouter.use(authenticate);

attendanceRouter.get("/me/locations", handle((req, res) => paged(res, "Assigned attendance locations loaded.", attendanceService.listMyLocations(req.user, req.query))));
attendanceRouter.get("/me/status", handle((req, res) => send(res, "Check-in status loaded.", attendanceService.getCheckInStatus(req.user, req.query))));
attendanceRouter.get("/me/history", handle((req, res) => paged(res, "My attendance history loaded.", attendanceService.listMyHistory(req.user, req.query))));
attendanceRouter.post("/check-in", handle(submitCheckIn));

attendanceRouter.get("/locations", handle((req, res) => paged(res, "Attendance locations loaded.", attendanceService.listLocations(req.user, req.query))));
attendanceRouter.post("/locations", handle((req, res) => res.status(201).json({ success: true, message: "Attendance location created.", data: attendanceService.createLocation(req.body || {}, req), meta: {} })));
attendanceRouter.get("/locations/:id", handle((req, res) => {
  const location = attendanceService.listLocations(req.user, { id: req.params.id, limit: 1 }).data.find((item) => item.id === req.params.id);
  return location ? send(res, "Attendance location loaded.", location) : notFound(res, "ATTENDANCE_LOCATION_NOT_FOUND");
}));
attendanceRouter.patch("/locations/:id", handle((req, res) => {
  const location = attendanceService.updateLocation(req.params.id, req.body || {}, req);
  return location ? send(res, "Attendance location updated.", location) : notFound(res, "ATTENDANCE_LOCATION_NOT_FOUND");
}));
attendanceRouter.put("/locations/:id", handle((req, res) => {
  const location = attendanceService.updateLocation(req.params.id, req.body || {}, req);
  return location ? send(res, "Attendance location updated.", location) : notFound(res, "ATTENDANCE_LOCATION_NOT_FOUND");
}));
attendanceRouter.post("/locations/:id/enable", handle((req, res) => {
  const location = attendanceService.setLocationActive(req.params.id, true, req);
  return location ? send(res, "Attendance location enabled.", location) : notFound(res, "ATTENDANCE_LOCATION_NOT_FOUND");
}));
attendanceRouter.post("/locations/:id/disable", handle((req, res) => {
  const location = attendanceService.setLocationActive(req.params.id, false, req);
  return location ? send(res, "Attendance location disabled.", location) : notFound(res, "ATTENDANCE_LOCATION_NOT_FOUND");
}));

attendanceRouter.get("/schedules", handle((req, res) => paged(res, "Attendance schedules loaded.", attendanceService.listSchedules(req.user, req.query))));
attendanceRouter.post("/schedules", handle((req, res) => res.status(201).json({ success: true, message: "Attendance schedule created.", data: attendanceService.createSchedule(req.body || {}, req), meta: {} })));
attendanceRouter.get("/schedules/:id", handle((req, res) => {
  const schedule = attendanceService.listSchedules(req.user, { id: req.params.id, limit: 1 }).data.find((item) => item.id === req.params.id);
  return schedule ? send(res, "Attendance schedule loaded.", schedule) : notFound(res, "ATTENDANCE_SCHEDULE_NOT_FOUND");
}));
attendanceRouter.patch("/schedules/:id", handle((req, res) => {
  const schedule = attendanceService.updateSchedule(req.params.id, req.body || {}, req);
  return schedule ? send(res, "Attendance schedule updated.", schedule) : notFound(res, "ATTENDANCE_SCHEDULE_NOT_FOUND");
}));
attendanceRouter.put("/schedules/:id", handle((req, res) => {
  const schedule = attendanceService.updateSchedule(req.params.id, req.body || {}, req);
  return schedule ? send(res, "Attendance schedule updated.", schedule) : notFound(res, "ATTENDANCE_SCHEDULE_NOT_FOUND");
}));
attendanceRouter.post("/schedules/:id/enable", handle((req, res) => {
  const schedule = attendanceService.setScheduleActive(req.params.id, true, req);
  return schedule ? send(res, "Attendance schedule enabled.", schedule) : notFound(res, "ATTENDANCE_SCHEDULE_NOT_FOUND");
}));
attendanceRouter.post("/schedules/:id/disable", handle((req, res) => {
  const schedule = attendanceService.setScheduleActive(req.params.id, false, req);
  return schedule ? send(res, "Attendance schedule disabled.", schedule) : notFound(res, "ATTENDANCE_SCHEDULE_NOT_FOUND");
}));

attendanceRouter.get("/records", handle((req, res) => paged(res, "Attendance records loaded.", attendanceService.listRecords(req.user, req.query))));
attendanceRouter.get("/records/:id", handle((req, res) => {
  const record = attendanceService.getRecord(req.params.id, req.user);
  return record ? send(res, "Attendance record loaded.", record) : notFound(res, "ATTENDANCE_RECORD_NOT_FOUND");
}));
attendanceRouter.get("/reports/summary", handle((req, res) => send(res, "Attendance summary loaded.", attendanceService.getSummary(req.user, req.query))));

module.exports = { attendanceRouter, registerSelfServiceAttendance };
