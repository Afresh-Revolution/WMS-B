const express = require("express");
const secretaryService = require("./service");
const { authenticate } = require("../../auth/middleware");

const secretaryRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function created(res, message, data, meta = {}) {
  return res.status(201).json({ success: true, message, data, meta });
}

function notFound(res, code = "RESOURCE_NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

function paged(res, message, result) {
  return send(res, message, result.data, result.meta);
}

secretaryRouter.use(authenticate);

secretaryRouter.get("/scope", handle((req, res) => send(res, "Secretary scope loaded.", secretaryService.getScopeSummary(req.user))));
secretaryRouter.get("/dashboard", handle((req, res) => send(res, "Secretary dashboard loaded.", secretaryService.getDashboard(req.user, req.query))));
secretaryRouter.get("/employment-record", handle((req, res) => send(res, "Secretary employment record loaded.", secretaryService.getSelfEmploymentRecord(req.user))));
secretaryRouter.get("/employment-record/documents", handle((req, res) => {
  const record = secretaryService.getSelfEmploymentRecord(req.user);
  return send(res, "Secretary employment documents loaded.", record.documents);
}));
secretaryRouter.patch("/employment-record", handle((req, res) => send(res, "Secretary employment record updated.", secretaryService.updateSelfEmploymentRecord(req.body || {}, req))));
secretaryRouter.put("/employment-record", handle((req, res) => send(res, "Secretary employment record updated.", secretaryService.updateSelfEmploymentRecord(req.body || {}, req))));

secretaryRouter.get("/email-requests/failed", handle((req, res) => {
  return paged(res, "Failed email creation requests loaded.", secretaryService.listScoped("email_requests", req.user, { ...req.query, status: "FAILED" }, "email_requests.view", { enrich: (record) => secretaryService.getEmailRequest(req.user, record.id) }));
}));

secretaryRouter.post("/email-requests/check-availability", handle((req, res) => {
  return send(res, "Email availability checked.", secretaryService.checkEmailAvailability(req.body || {}, req));
}));

secretaryRouter.post("/email-requests/:id/retry", handle((req, res) => {
  const request = secretaryService.retryEmailCreation(req.params.id, req.body || {}, req);
  return request ? send(res, "Email creation retry queued.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.post("/email-requests/:id/create-email", handle((req, res) => {
  const result = secretaryService.createAndAssignCompanyEmail(req.params.id, req.body || {}, req);
  return result ? send(res, "Company email created and assigned.", result) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.patch("/email-requests/:id/resolve", handle((req, res) => {
  const request = secretaryService.resolveEmailCreation(req.params.id, req.body || {}, req);
  return request ? send(res, "Email creation resolved.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.get("/email-requests", handle((req, res) => {
  return send(res, "Email requests loaded.", secretaryService.getEmailQueue(req.user, req.query));
}));

secretaryRouter.post("/email-requests", handle((req, res) => {
  return created(res, "Email request created.", secretaryService.createEmailRequest(req.body || {}, req));
}));

secretaryRouter.get("/email-requests/:id", handle((req, res) => {
  const request = secretaryService.getEmailRequest(req.user, req.params.id);
  return request ? send(res, "Email request loaded.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.patch("/email-requests/:id/review", handle((req, res) => {
  const request = secretaryService.reviewEmailRequest(req.params.id, req.body || {}, req);
  return request ? send(res, "Email request moved under review.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.patch("/email-requests/:id/approve", handle((req, res) => {
  const request = secretaryService.approveEmailRequest(req.params.id, req.body || {}, req);
  return request ? send(res, "Email request approved.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.patch("/email-requests/:id/reject", handle((req, res) => {
  const request = secretaryService.rejectEmailRequest(req.params.id, req.body || {}, req);
  return request ? send(res, "Email request rejected.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.patch("/email-requests/:id/return", handle((req, res) => {
  const request = secretaryService.returnEmailRequest(req.params.id, req.body || {}, req);
  return request ? send(res, "Email request returned for correction.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.patch("/email-requests/:id/cancel", handle((req, res) => {
  const request = secretaryService.cancelEmailRequest(req.params.id, req.body || {}, req);
  return request ? send(res, "Email request cancelled.", request) : notFound(res, "EMAIL_REQUEST_NOT_FOUND");
}));

secretaryRouter.get("/company-emails", handle((req, res) => {
  return send(res, "Company email directory loaded.", secretaryService.getCompanyEmailDirectory(req.user, req.query));
}));

secretaryRouter.get("/company-emails/:id", handle((req, res) => {
  const account = secretaryService.getCompanyEmail(req.user, req.params.id);
  return account ? send(res, "Company email loaded.", account) : notFound(res, "COMPANY_EMAIL_NOT_FOUND");
}));

secretaryRouter.patch("/company-emails/:id/address", handle((req, res) => {
  const account = secretaryService.changeCompanyEmailAddress(req.params.id, req.body || {}, req);
  return account ? send(res, "Company email address updated.", account) : notFound(res, "COMPANY_EMAIL_NOT_FOUND");
}));

secretaryRouter.post("/company-emails/:id/suspend", handle((req, res) => {
  const account = secretaryService.suspendCompanyEmail(req.params.id, req.body || {}, req);
  return account ? send(res, "Company email suspended.", account) : notFound(res, "COMPANY_EMAIL_NOT_FOUND");
}));

secretaryRouter.post("/company-emails/:id/reactivate", handle((req, res) => {
  const account = secretaryService.reactivateCompanyEmail(req.params.id, req);
  return account ? send(res, "Company email reactivated.", account) : notFound(res, "COMPANY_EMAIL_NOT_FOUND");
}));

secretaryRouter.post("/company-emails/:id/request-deactivation", handle((req, res) => {
  const account = secretaryService.requestCompanyEmailDeactivation(req.params.id, req.body || {}, req);
  return account ? send(res, "Company email deactivation requested.", account) : notFound(res, "COMPANY_EMAIL_NOT_FOUND");
}));

secretaryRouter.get("/calendar", handle((req, res) => send(res, "Secretary calendar loaded.", secretaryService.getCalendar(req.user, req.query))));
secretaryRouter.get("/calendar/events", handle((req, res) => paged(res, "Calendar events loaded.", secretaryService.listScoped("calendar_events", req.user, req.query, "calendar.view"))));
secretaryRouter.post("/calendar/events", handle((req, res) => created(res, "Calendar event created.", secretaryService.createCalendarEvent(req.body || {}, req))));
secretaryRouter.get("/calendar/events/:id", handle((req, res) => {
  const event = secretaryService.getCalendarEvent(req.user, req.params.id);
  return event ? send(res, "Calendar event loaded.", event) : notFound(res, "CALENDAR_EVENT_NOT_FOUND");
}));
secretaryRouter.put("/calendar/events/:id", handle((req, res) => {
  const event = secretaryService.updateCalendarEvent(req.params.id, req.body || {}, req);
  return event ? send(res, "Calendar event updated.", event) : notFound(res, "CALENDAR_EVENT_NOT_FOUND");
}));
secretaryRouter.patch("/calendar/events/:id", handle((req, res) => {
  const event = secretaryService.updateCalendarEvent(req.params.id, req.body || {}, req);
  return event ? send(res, "Calendar event updated.", event) : notFound(res, "CALENDAR_EVENT_NOT_FOUND");
}));
secretaryRouter.delete("/calendar/events/:id", handle((req, res) => {
  const event = secretaryService.deleteCalendarEvent(req.params.id, req);
  return event ? send(res, "Calendar event deleted.", event) : notFound(res, "CALENDAR_EVENT_NOT_FOUND");
}));

secretaryRouter.get("/meetings/today", handle((req, res) => {
  return paged(res, "Today's meetings loaded.", secretaryService.listMeetings(req.user, req.query, (meeting) => String(meeting.status || "").toUpperCase() !== "CANCELLED" && String(meeting.startAt || meeting.start_at || meeting.startTime || meeting.start_time || meeting.date || "").slice(0, 10) === new Date().toISOString().slice(0, 10)));
}));
secretaryRouter.get("/meetings/upcoming", handle((req, res) => {
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  return paged(res, "Upcoming meetings loaded.", secretaryService.listMeetings(req.user, req.query, (meeting) => {
    const timestamp = new Date(meeting.startAt || meeting.start_at || meeting.startTime || meeting.start_time || meeting.date || 0).getTime();
    return !Number.isNaN(timestamp) && timestamp >= tomorrow.getTime() && String(meeting.status || "").toUpperCase() !== "CANCELLED";
  }));
}));
secretaryRouter.get("/meetings", handle((req, res) => paged(res, "Secretary meetings loaded.", secretaryService.listMeetings(req.user, req.query))));
secretaryRouter.post("/meetings", handle((req, res) => created(res, "Meeting created.", secretaryService.createMeeting(req.body || {}, req))));
secretaryRouter.get("/meetings/:id", handle((req, res) => {
  const meeting = secretaryService.getMeeting(req.user, req.params.id);
  return meeting ? send(res, "Meeting loaded.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.put("/meetings/:id", handle((req, res) => {
  const meeting = secretaryService.updateMeeting(req.params.id, req.body || {}, req);
  return meeting ? send(res, "Meeting updated.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.patch("/meetings/:id", handle((req, res) => {
  const meeting = secretaryService.updateMeeting(req.params.id, req.body || {}, req);
  return meeting ? send(res, "Meeting updated.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.post("/meetings/:id/reschedule", handle((req, res) => {
  const meeting = secretaryService.updateMeeting(req.params.id, { ...(req.body || {}), status: "RESCHEDULED" }, req, "SECRETARY_MEETING_RESCHEDULED");
  return meeting ? send(res, "Meeting rescheduled.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.patch("/meetings/:id/reschedule", handle((req, res) => {
  const meeting = secretaryService.updateMeeting(req.params.id, { ...(req.body || {}), status: "RESCHEDULED" }, req, "SECRETARY_MEETING_RESCHEDULED");
  return meeting ? send(res, "Meeting rescheduled.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.post("/meetings/:id/cancel", handle((req, res) => {
  const meeting = secretaryService.cancelMeeting(req.params.id, req.body || {}, req);
  return meeting ? send(res, "Meeting cancelled.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.patch("/meetings/:id/cancel", handle((req, res) => {
  const meeting = secretaryService.cancelMeeting(req.params.id, req.body || {}, req);
  return meeting ? send(res, "Meeting cancelled.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.post("/meetings/:id/attendees", handle((req, res) => {
  const meeting = secretaryService.updateMeeting(req.params.id, req.body || {}, req);
  return meeting ? send(res, "Meeting attendees updated.", meeting) : notFound(res, "MEETING_NOT_FOUND");
}));
secretaryRouter.delete("/meetings/:id/attendees/:userId", handle((req, res) => {
  const result = secretaryService.removeMeetingAttendee(req.params.id, req.params.userId, req);
  return result ? send(res, "Meeting attendee removed.", result) : notFound(res, "MEETING_ATTENDEE_NOT_FOUND");
}));
secretaryRouter.post("/meetings/:id/reminders", handle((req, res) => {
  const meeting = secretaryService.getMeeting(req.user, req.params.id);
  if (!meeting) return notFound(res, "MEETING_NOT_FOUND");
  const reminders = secretaryService.createMeetingReminders(meeting, req.body || {}, req);
  return created(res, "Meeting reminders scheduled.", reminders);
}));

secretaryRouter.get("/tasks/overdue", handle((req, res) => paged(res, "Overdue management tasks loaded.", secretaryService.listTasks(req.user, req.query, (task) => {
  const due = new Date(task.dueDate || task.due_date || 0).getTime();
  return !Number.isNaN(due) && due < Date.now() && !["COMPLETED", "CANCELLED"].includes(String(task.status || "").toUpperCase());
}))));
secretaryRouter.get("/tasks", handle((req, res) => paged(res, "Management tasks loaded.", secretaryService.listTasks(req.user, req.query))));
secretaryRouter.post("/tasks", handle((req, res) => created(res, "Management task created.", secretaryService.createTask(req.body || {}, req))));
secretaryRouter.get("/tasks/:id", handle((req, res) => {
  const task = secretaryService.getTask(req.user, req.params.id);
  return task ? send(res, "Management task loaded.", task) : notFound(res, "TASK_NOT_FOUND");
}));
secretaryRouter.put("/tasks/:id", handle((req, res) => {
  const task = secretaryService.updateTask(req.params.id, req.body || {}, req);
  return task ? send(res, "Management task updated.", task) : notFound(res, "TASK_NOT_FOUND");
}));
secretaryRouter.patch("/tasks/:id", handle((req, res) => {
  const task = secretaryService.updateTask(req.params.id, req.body || {}, req);
  return task ? send(res, "Management task updated.", task) : notFound(res, "TASK_NOT_FOUND");
}));
secretaryRouter.patch("/tasks/:id/complete", handle((req, res) => {
  const task = secretaryService.completeTask(req.params.id, req.body || {}, req);
  return task ? send(res, "Management task completed.", task) : notFound(res, "TASK_NOT_FOUND");
}));

secretaryRouter.get("/reminders/upcoming", handle((req, res) => paged(res, "Upcoming reminders loaded.", secretaryService.listScoped("reminders", req.user, { ...req.query, status: "PENDING" }, "reminders.view", {
  filter: (reminder) => {
    const timestamp = new Date(reminder.remindAt || reminder.remind_at || 0).getTime();
    return !Number.isNaN(timestamp) && timestamp >= Date.now();
  },
  enrich: (reminder) => secretaryService.getReminder(req.user, reminder.id),
}))));
secretaryRouter.get("/reminders", handle((req, res) => paged(res, "Reminders loaded.", secretaryService.listScoped("reminders", req.user, req.query, "reminders.view", { enrich: (reminder) => secretaryService.getReminder(req.user, reminder.id) }))));
secretaryRouter.post("/reminders", handle((req, res) => created(res, "Reminder created.", secretaryService.createReminder(req.body || {}, req))));
secretaryRouter.get("/reminders/:id", handle((req, res) => {
  const reminder = secretaryService.getReminder(req.user, req.params.id);
  return reminder ? send(res, "Reminder loaded.", reminder) : notFound(res, "REMINDER_NOT_FOUND");
}));
secretaryRouter.put("/reminders/:id", handle((req, res) => {
  const reminder = secretaryService.updateReminder(req.params.id, req.body || {}, req);
  return reminder ? send(res, "Reminder updated.", reminder) : notFound(res, "REMINDER_NOT_FOUND");
}));
secretaryRouter.patch("/reminders/:id", handle((req, res) => {
  const reminder = secretaryService.updateReminder(req.params.id, req.body || {}, req);
  return reminder ? send(res, "Reminder updated.", reminder) : notFound(res, "REMINDER_NOT_FOUND");
}));
secretaryRouter.delete("/reminders/:id", handle((req, res) => {
  const reminder = secretaryService.cancelReminder(req.params.id, req);
  return reminder ? send(res, "Reminder cancelled.", reminder) : notFound(res, "REMINDER_NOT_FOUND");
}));
secretaryRouter.patch("/reminders/:id/cancel", handle((req, res) => {
  const reminder = secretaryService.cancelReminder(req.params.id, req);
  return reminder ? send(res, "Reminder cancelled.", reminder) : notFound(res, "REMINDER_NOT_FOUND");
}));

secretaryRouter.get("/notifications", handle((req, res) => paged(res, "Secretary notifications loaded.", secretaryService.listNotifications(req.user, req.query))));
secretaryRouter.patch("/notifications/:id/read", handle((req, res) => {
  const notification = secretaryService.markNotificationRead(req.params.id, req);
  return notification ? send(res, "Secretary notification marked as read.", notification) : notFound(res, "NOTIFICATION_NOT_FOUND");
}));
secretaryRouter.get("/audit-logs", handle((req, res) => paged(res, "Secretary audit logs loaded.", secretaryService.listAuditLogs(req.user, req.query))));

module.exports = { secretaryRouter };
