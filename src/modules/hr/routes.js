const express = require("express");
const { authenticate } = require("../../auth/middleware");
const hrService = require("./hr.service");

const hrRouter = express.Router();

function handle(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res, code = "NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

hrRouter.use(authenticate);

hrRouter.get("/dashboard", handle((req, res) => send(res, "HR dashboard loaded.", hrService.getDashboard(req.user, req.query))));
hrRouter.get("/dashboard/stats", handle((req, res) => send(res, "HR dashboard stats loaded.", hrService.getStats(req.user, req.query))));
hrRouter.get("/profile", handle((req, res) => send(res, "HR profile loaded.", hrService.getHrProfile(req.user))));
hrRouter.patch("/profile", handle((req, res) => send(res, "HR profile updated.", hrService.updateHrProfile(req.body || {}, req))));
hrRouter.put("/profile", handle((req, res) => send(res, "HR profile updated.", hrService.updateHrProfile(req.body || {}, req))));
hrRouter.get("/settings", handle((req, res) => send(res, "HR settings loaded.", hrService.getHrSettings(req.user))));
hrRouter.patch("/settings", handle((req, res) => send(res, "HR settings updated.", hrService.updateHrSettings(req.body || {}, req))));
hrRouter.get("/help-center", handle((req, res) => send(res, "HR help center loaded.", hrService.getHelpCenter(req.user))));
hrRouter.get("/notifications", handle((req, res) => send(res, "HR notifications loaded.", hrService.listHrNotifications(req.query, req.user))));
hrRouter.patch("/notifications/:id/read", handle((req, res) => send(res, "HR notification marked as read.", hrService.markHrNotificationRead(req.params.id, req.user))));

hrRouter.get("/nysc-interns/dashboard", handle((req, res) => send(res, "HR NYSC and interns dashboard loaded.", hrService.getNyscInternDashboard(req.user))));
hrRouter.get("/nysc-interns/reports/summary", handle((req, res) => send(res, "HR NYSC and interns summary loaded.", hrService.getNyscInternSummary(req.user))));
hrRouter.get("/nysc-interns", handle((req, res) => {
  const result = hrService.listNyscInternProfiles(req.query, req.user);
  return send(res, "HR NYSC and interns loaded.", result.data, result.meta);
}));
hrRouter.post("/nysc-interns", handle((req, res) => res.status(201).json({ success: true, message: "HR NYSC/intern profile created.", data: hrService.createNyscInternProfile(req.body || {}, req), meta: {} })));
hrRouter.get("/nysc-interns/:id", handle((req, res) => send(res, "HR NYSC/intern profile loaded.", hrService.getNyscInternProfile(req.params.id, req.user))));
hrRouter.patch("/nysc-interns/:id", handle((req, res) => {
  const result = hrService.updateNyscInternProfile(req.params.id, req.body || {}, req);
  return result ? send(res, "HR NYSC/intern profile updated.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.post("/nysc-interns/:id/supervisor", handle((req, res) => {
  const result = hrService.assignNyscInternSupervisor(req.params.id, req.body || {}, req);
  return result ? send(res, "HR NYSC/intern supervisor assigned.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.post("/nysc-interns/:id/department", handle((req, res) => {
  const result = hrService.changeNyscInternDepartment(req.params.id, req.body || {}, req);
  return result ? send(res, "HR NYSC/intern department changed.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.post("/nysc-interns/:id/extend", handle((req, res) => {
  const result = hrService.extendNyscInternPlacement(req.params.id, req.body || {}, req);
  return result ? send(res, "HR NYSC/intern placement extended.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.post("/nysc-interns/:id/complete", handle((req, res) => {
  const result = hrService.completeNyscInternPlacement(req.params.id, req.body || {}, req);
  return result ? send(res, "HR NYSC/intern placement completed.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.post("/nysc-interns/:id/terminate", handle((req, res) => {
  const result = hrService.terminateNyscInternPlacement(req.params.id, req.body || {}, req);
  return result ? send(res, "HR NYSC/intern placement terminated.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.post("/nysc-interns/:id/exit", handle((req, res) => {
  const result = hrService.processNyscInternExit(req.params.id, req.body || {}, req);
  return result ? send(res, "HR NYSC/intern exit processed.", result.record) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.get("/nysc-interns/:id/documents", handle((req, res) => send(res, "HR NYSC/intern documents loaded.", hrService.listNyscInternDocuments(req.params.id, req.user))));
hrRouter.post("/nysc-interns/:id/documents", handle((req, res) => {
  const document = hrService.addNyscInternDocument(req.params.id, req.body || {}, req);
  return document ? res.status(201).json({ success: true, message: "HR NYSC/intern document uploaded.", data: document, meta: {} }) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.get("/nysc-interns/:id/reviews", handle((req, res) => send(res, "HR NYSC/intern reviews loaded.", hrService.listNyscInternReviews(req.params.id, req.user))));
hrRouter.post("/nysc-interns/:id/reviews", handle((req, res) => {
  const review = hrService.addNyscInternReview(req.params.id, req.body || {}, req);
  return review ? res.status(201).json({ success: true, message: "HR NYSC/intern review recorded.", data: review, meta: {} }) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.get("/nysc-interns/:id/attendance", handle((req, res) => {
  const result = hrService.listNyscInternAttendance(req.params.id, req.user, req.query);
  return result ? send(res, "HR NYSC/intern attendance loaded.", result.data, result.meta) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.post("/nysc-interns/:id/attendance", handle((req, res) => {
  const attendance = hrService.addNyscInternAttendance(req.params.id, req.body || {}, req);
  return attendance ? res.status(201).json({ success: true, message: "HR NYSC/intern attendance recorded.", data: attendance, meta: {} }) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));
hrRouter.get("/nysc-interns/:id/history", handle((req, res) => send(res, "HR NYSC/intern history loaded.", hrService.listNyscInternHistory(req.params.id, req.user))));
hrRouter.post("/nysc-interns/:id/convert-to-employee", handle((req, res) => {
  const result = hrService.convertNyscInternToEmployee(req.params.id, req.body || {}, req);
  return result ? res.status(201).json({ success: true, message: "HR NYSC/intern converted to employee.", data: result.record, meta: result.meta || {} }) : notFound(res, "NYSC_INTERN_PROFILE_NOT_FOUND");
}));

hrRouter.get("/employees", handle((req, res) => {
  const result = hrService.listEmployees(req.query, req.user);
  return send(res, "HR employees loaded.", result.data, result.meta);
}));
hrRouter.post("/employees", handle((req, res) => res.status(201).json({ success: true, message: "HR employee created.", data: hrService.createEmployee(req.body || {}, req), meta: {} })));
hrRouter.get("/employees/:id", handle((req, res) => {
  const profile = hrService.getEmployeeProfile(req.params.id, req.user);
  return profile ? send(res, "HR employee loaded.", profile) : notFound(res, "EMPLOYEE_NOT_FOUND");
}));
hrRouter.put("/employees/:id", handle((req, res) => {
  const result = hrService.updateEmployee(req.params.id, req.body || {}, req);
  return result ? send(res, "HR employee updated.", result.record) : notFound(res, "EMPLOYEE_NOT_FOUND");
}));
hrRouter.patch("/employees/:id/status", handle((req, res) => {
  const result = hrService.patchEmployeeStatus(req.params.id, req.body || {}, req);
  return result ? send(res, "HR employee status updated.", result.record) : notFound(res, "EMPLOYEE_NOT_FOUND");
}));

hrRouter.get("/employee-exits", handle((req, res) => {
  const result = hrService.listEmployeeExits(req.query, req.user);
  return send(res, "HR employee exits loaded.", result.data, result.meta);
}));
hrRouter.post("/employee-exits", handle((req, res) => res.status(201).json({ success: true, message: "HR employee exit created.", data: hrService.createEmployeeExit(req.body || {}, req), meta: {} })));
hrRouter.get("/employee-exits/:id", handle((req, res) => {
  const result = hrService.getEmployeeExit(req.params.id, req.user);
  return result ? send(res, "HR employee exit loaded.", result) : notFound(res, "EMPLOYEE_EXIT_NOT_FOUND");
}));
hrRouter.patch("/employee-exits/:id", handle((req, res) => {
  const result = hrService.updateEmployeeExit(req.params.id, req.body || {}, req);
  return result ? send(res, "HR employee exit updated.", result) : notFound(res, "EMPLOYEE_EXIT_NOT_FOUND");
}));
hrRouter.patch("/employee-exits/:id/approve", handle((req, res) => {
  const result = hrService.approveEmployeeExit(req.params.id, req.body || {}, req);
  return result ? send(res, "HR employee exit approved.", result) : notFound(res, "EMPLOYEE_EXIT_NOT_FOUND");
}));
hrRouter.patch("/employee-exits/:id/complete", handle((req, res) => {
  const result = hrService.completeEmployeeExit(req.params.id, req.body || {}, req);
  return result ? send(res, "HR employee exit completed.", result) : notFound(res, "EMPLOYEE_EXIT_NOT_FOUND");
}));
hrRouter.patch("/employee-exits/:id/cancel", handle((req, res) => {
  const result = hrService.cancelEmployeeExit(req.params.id, req.body || {}, req);
  return result ? send(res, "HR employee exit cancelled.", result) : notFound(res, "EMPLOYEE_EXIT_NOT_FOUND");
}));
hrRouter.patch("/employee-exits/:id/reject", handle((req, res) => {
  const result = hrService.cancelEmployeeExit(req.params.id, { ...(req.body || {}), status: "REJECTED" }, req);
  return result ? send(res, "HR employee exit rejected.", result) : notFound(res, "EMPLOYEE_EXIT_NOT_FOUND");
}));

hrRouter.get("/onboarding", handle((req, res) => {
  const result = hrService.listOnboarding(req.query, req.user);
  return send(res, "HR onboarding records loaded.", result.data, result.meta);
}));
hrRouter.post("/onboarding", handle((req, res) => res.status(201).json({ success: true, message: "HR onboarding record created.", data: hrService.createOnboarding(req.body || {}, req), meta: {} })));
hrRouter.get("/onboarding/:id", handle((req, res) => {
  const record = hrService.getOnboarding(req.params.id, req.user);
  return record ? send(res, "HR onboarding record loaded.", record) : notFound(res, "ONBOARDING_RECORD_NOT_FOUND");
}));
hrRouter.put("/onboarding/:id", handle((req, res) => {
  const result = hrService.updateOnboarding(req.params.id, req.body || {}, req);
  return result ? send(res, "HR onboarding record updated.", result.record) : notFound(res, "ONBOARDING_RECORD_NOT_FOUND");
}));
hrRouter.post("/onboarding/:id/tasks", handle((req, res) => {
  const task = hrService.createOnboardingTask(req.params.id, req.body || {}, req);
  return task ? res.status(201).json({ success: true, message: "HR onboarding task created.", data: task, meta: {} }) : notFound(res, "ONBOARDING_RECORD_NOT_FOUND");
}));
hrRouter.patch("/onboarding/tasks/:id", handle((req, res) => {
  const result = hrService.updateOnboardingTask(req.params.id, req.body || {}, req);
  return result ? send(res, "HR onboarding task updated.", result.record) : notFound(res, "ONBOARDING_TASK_NOT_FOUND");
}));

hrRouter.get("/departments", handle((req, res) => {
  const result = hrService.listDepartments(req.query, req.user);
  return send(res, "HR departments loaded.", result.data, result.meta);
}));
hrRouter.post("/departments", handle((req, res) => res.status(201).json({ success: true, message: "HR department created.", data: hrService.createDepartment(req.body || {}, req), meta: {} })));
hrRouter.put("/departments/:id", handle((req, res) => {
  const result = hrService.updateDepartment(req.params.id, req.body || {}, req);
  return result ? send(res, "HR department updated.", result.record) : notFound(res, "DEPARTMENT_NOT_FOUND");
}));
hrRouter.delete("/departments/:id", handle((req, res) => {
  const result = hrService.deleteDepartment(req.params.id, req);
  return result ? send(res, "HR department deleted.", result.record) : notFound(res, "DEPARTMENT_NOT_FOUND");
}));

hrRouter.get("/positions", handle((req, res) => {
  const result = hrService.listPositions(req.query, req.user);
  return send(res, "HR positions loaded.", result.data, result.meta);
}));
hrRouter.post("/positions", handle((req, res) => res.status(201).json({ success: true, message: "HR position created.", data: hrService.createPosition(req.body || {}, req), meta: {} })));
hrRouter.put("/positions/:id", handle((req, res) => {
  const result = hrService.updatePosition(req.params.id, req.body || {}, req);
  return result ? send(res, "HR position updated.", result.record) : notFound(res, "POSITION_NOT_FOUND");
}));

hrRouter.get("/leave", handle((req, res) => {
  const result = hrService.listLeave(req.query, req.user);
  return send(res, "HR leave requests loaded.", result.data, result.meta);
}));
hrRouter.get("/leave/:id", handle((req, res) => {
  const request = hrService.getLeave(req.params.id, req.user);
  return request ? send(res, "HR leave request loaded.", request) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));
hrRouter.post("/leave", handle((req, res) => {
  const result = hrService.createLeave(req.body || {}, req);
  return res.status(201).json({ success: true, message: "HR leave request created.", data: result.record || result.request || result, meta: {} });
}));
hrRouter.patch("/leave/:id/approve", handle((req, res) => {
  const result = hrService.approveLeave(req.params.id, req.body || {}, req);
  return result ? send(res, "HR leave approved.", result.record) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));
hrRouter.patch("/leave/:id/reject", handle((req, res) => {
  const result = hrService.rejectLeave(req.params.id, req.body || {}, req);
  return result ? send(res, "HR leave rejected.", result.record) : notFound(res, "LEAVE_REQUEST_NOT_FOUND");
}));

hrRouter.get("/promotions", handle((req, res) => {
  const result = hrService.listPromotions(req.query, req.user);
  return send(res, "HR promotions loaded.", result.data, result.meta);
}));
hrRouter.post("/promotions", handle((req, res) => res.status(201).json({ success: true, message: "HR promotion created.", data: hrService.createPromotion(req.body || {}, req), meta: {} })));
hrRouter.patch("/promotions/:id/approve", handle((req, res) => {
  const result = hrService.approvePromotion(req.params.id, req.body || {}, req);
  return result ? send(res, "HR promotion approved.", result.record) : notFound(res, "PROMOTION_NOT_FOUND");
}));
hrRouter.patch("/promotions/:id/reject", handle((req, res) => {
  const result = hrService.rejectPromotion(req.params.id, req.body || {}, req);
  return result ? send(res, "HR promotion rejected.", result.record) : notFound(res, "PROMOTION_NOT_FOUND");
}));

hrRouter.get("/salary-adjustments", handle((req, res) => {
  const result = hrService.listSalaryAdjustments(req.query, req.user);
  return send(res, "HR salary adjustments loaded.", result.data, result.meta);
}));
hrRouter.post("/salary-adjustments", handle((req, res) => res.status(201).json({ success: true, message: "HR salary adjustment created.", data: hrService.createSalaryAdjustment(req.body || {}, req), meta: {} })));
hrRouter.patch("/salary-adjustments/:id/approve", handle((req, res) => {
  const result = hrService.approveSalaryAdjustment(req.params.id, req.body || {}, req);
  return result ? send(res, "HR salary adjustment approved.", result.record) : notFound(res, "SALARY_ADJUSTMENT_NOT_FOUND");
}));
hrRouter.patch("/salary-adjustments/:id/reject", handle((req, res) => {
  const result = hrService.rejectSalaryAdjustment(req.params.id, req.body || {}, req);
  return result ? send(res, "HR salary adjustment rejected.", result.record) : notFound(res, "SALARY_ADJUSTMENT_NOT_FOUND");
}));
hrRouter.get("/salary-increments", handle((req, res) => {
  const result = hrService.listSalaryAdjustments(req.query, req.user);
  return send(res, "HR salary increments loaded.", result.data, result.meta);
}));
hrRouter.post("/salary-increments", handle((req, res) => res.status(201).json({ success: true, message: "HR salary increment created.", data: hrService.createSalaryAdjustment(req.body || {}, req), meta: {} })));
hrRouter.patch("/salary-increments/:id/approve", handle((req, res) => {
  const result = hrService.approveSalaryAdjustment(req.params.id, req.body || {}, req);
  return result ? send(res, "HR salary increment approved.", result.record) : notFound(res, "SALARY_ADJUSTMENT_NOT_FOUND");
}));
hrRouter.patch("/salary-increments/:id/reject", handle((req, res) => {
  const result = hrService.rejectSalaryAdjustment(req.params.id, req.body || {}, req);
  return result ? send(res, "HR salary increment rejected.", result.record) : notFound(res, "SALARY_ADJUSTMENT_NOT_FOUND");
}));

hrRouter.get("/discipline", handle((req, res) => {
  const result = hrService.listDiscipline(req.query, req.user);
  return send(res, "HR discipline loaded.", result.data, result.meta);
}));
hrRouter.post("/discipline", handle((req, res) => {
  const result = hrService.createDisciplineCase(req.body || {}, req);
  return res.status(201).json({ success: true, message: "HR discipline case created.", data: result.record, meta: result.meta || {} });
}));
hrRouter.put("/discipline/:id", handle((req, res) => {
  const result = hrService.updateDisciplineCase(req.params.id, req.body || {}, req);
  return result ? send(res, "HR discipline case updated.", result.record) : notFound(res, "DISCIPLINE_CASE_NOT_FOUND");
}));
hrRouter.patch("/discipline/:id/resolve", handle((req, res) => {
  const result = hrService.resolveDisciplineCase(req.params.id, req.body || {}, req);
  return result ? send(res, "HR discipline case resolved.", result.record) : notFound(res, "DISCIPLINE_CASE_NOT_FOUND");
}));
hrRouter.patch("/discipline/:id/close", handle((req, res) => {
  const result = hrService.closeDisciplineCase(req.params.id, req.body || {}, req);
  return result ? send(res, "HR discipline case closed.", result.record) : notFound(res, "DISCIPLINE_CASE_NOT_FOUND");
}));

hrRouter.get("/documents", handle((req, res) => {
  const result = hrService.listDocuments(req.query, req.user);
  return send(res, "HR documents loaded.", result.data, result.meta);
}));
hrRouter.post("/documents", handle((req, res) => res.status(201).json({ success: true, message: "HR document uploaded.", data: hrService.createDocument(req.body || {}, req), meta: {} })));
hrRouter.get("/documents/expiring", handle((req, res) => {
  const result = hrService.listExpiringDocuments(req.query, req.user);
  return send(res, "HR expiring documents loaded.", result.data, result.meta);
}));
hrRouter.get("/documents/expired", handle((req, res) => {
  const result = hrService.listExpiredDocuments(req.query, req.user);
  return send(res, "HR expired documents loaded.", result.data, result.meta);
}));
hrRouter.get("/documents/missing", handle((req, res) => {
  const result = hrService.listMissingDocuments(req.query, req.user);
  return send(res, "HR missing documents loaded.", result.data, result.meta);
}));
hrRouter.patch("/documents/:id/verify", handle((req, res) => {
  const result = hrService.verifyDocument(req.params.id, req.body || {}, req);
  return result ? send(res, "HR document verification updated.", result.record) : notFound(res, "DOCUMENT_NOT_FOUND");
}));
hrRouter.delete("/documents/:id", handle((req, res) => {
  const result = hrService.deleteDocument(req.params.id, req);
  return result ? send(res, "HR document deleted.", result.record) : notFound(res, "DOCUMENT_NOT_FOUND");
}));

hrRouter.get("/confirmations", handle((req, res) => {
  const result = hrService.listConfirmations(req.query, req.user);
  return send(res, "HR confirmations loaded.", result.data, result.meta);
}));
hrRouter.patch("/confirmations/:id/approve", handle((req, res) => {
  const result = hrService.approveConfirmation(req.params.id, req.body || {}, req);
  return result ? send(res, "HR confirmation approved.", result.record) : notFound(res, "CONFIRMATION_NOT_FOUND");
}));
hrRouter.patch("/confirmations/:id/extend", handle((req, res) => {
  const result = hrService.extendConfirmation(req.params.id, req.body || {}, req);
  return result ? send(res, "HR confirmation extended.", result.record) : notFound(res, "CONFIRMATION_NOT_FOUND");
}));
hrRouter.patch("/confirmations/:id/not-confirm", handle((req, res) => {
  const result = hrService.notConfirmEmployee(req.params.id, req.body || {}, req);
  return result ? send(res, "HR confirmation returned.", result.record) : notFound(res, "CONFIRMATION_NOT_FOUND");
}));

hrRouter.get("/reports", handle((req, res) => send(res, "HR reports loaded.", hrService.listReports(req.query, req.user))));
hrRouter.get("/audit-logs", handle((req, res) => {
  const result = hrService.listAuditLogs(req.query, req.user);
  return send(res, "HR audit logs loaded.", result.data, result.meta);
}));
hrRouter.get("/approval-queue", handle((req, res) => {
  const result = hrService.listApprovalQueue(req.user, req.query);
  return send(res, "HR approval queue loaded.", result.data, result.meta);
}));
hrRouter.get("/returned-requests", handle((req, res) => {
  const result = hrService.listReturnedRequests(req.query, req.user);
  return send(res, "HR returned requests loaded.", result.data, result.meta);
}));
hrRouter.patch("/requests/:type/:id/return", handle((req, res) => {
  const result = hrService.returnRequest(req.params.type, req.params.id, req.body || {}, req);
  return result ? send(res, "HR request returned.", result.record) : notFound(res, "REQUEST_NOT_FOUND");
}));

module.exports = { hrRouter };
