const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { REPORT_PERMISSIONS } = require("./constants");
const reportService = require("./service");

const reportsRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireReportPermission(permission) {
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

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code: "REPORT_NOT_FOUND", details: {} },
  });
}

function auditReport(req, action, result) {
  recordOperationalAudit({
    user: req.user,
    action,
    module: "reports",
    recordId: result?.record?.id || result?.id || result?.job?.id || req.params.id || null,
    oldValue: result?.oldValues || null,
    newValue: result?.record || result?.job || result || null,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

function sendReport(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

reportsRouter.use(authenticate);

reportsRouter.get("/overview", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => {
  const data = reportService.getOverview(req.user, req.query);
  auditReport(req, "REPORT_VIEWED", { record: { id: "overview", filters: req.query } });
  return sendReport(res, "Reports overview loaded.", data);
}));

reportsRouter.get("/headcount", requireReportPermission(REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA), handle((req, res) => sendReport(res, "Headcount report loaded.", reportService.getHeadcount(req.user, req.query))));
reportsRouter.get("/headcount-growth", requireReportPermission(REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA), handle((req, res) => sendReport(res, "Headcount growth report loaded.", reportService.getHeadcountGrowth(req.user, req.query))));
reportsRouter.get("/attendance", requireReportPermission(REPORT_PERMISSIONS.VIEW_ATTENDANCE), handle((req, res) => sendReport(res, "Attendance report loaded.", reportService.getAttendance(req.user, req.query))));
reportsRouter.get("/attrition", requireReportPermission(REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA), handle((req, res) => sendReport(res, "Attrition report loaded.", reportService.getAttrition(req.user, req.query))));
reportsRouter.get("/departments", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Department reports loaded.", reportService.getDepartmentReports(req.user, req.query))));
reportsRouter.get("/leave", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Leave report loaded.", reportService.getLeave(req.user, req.query))));
reportsRouter.get("/payroll", requireReportPermission(REPORT_PERMISSIONS.VIEW_PAYROLL), handle((req, res) => sendReport(res, "Payroll report loaded.", reportService.getPayroll(req.user, req.query))));
reportsRouter.get("/tasks", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Task report loaded.", reportService.getTasks(req.user, req.query))));
reportsRouter.get("/targets", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Target report loaded.", reportService.getTargets(req.user, req.query))));
reportsRouter.get("/promotions", requireReportPermission(REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA), handle((req, res) => sendReport(res, "Promotion report loaded.", reportService.getPromotions(req.user, req.query))));
reportsRouter.get("/salary-increments", requireReportPermission(REPORT_PERMISSIONS.VIEW_SALARY), handle((req, res) => sendReport(res, "Salary increment report loaded.", reportService.getSalaryIncrements(req.user, req.query))));
reportsRouter.get("/expenses", requireReportPermission(REPORT_PERMISSIONS.VIEW_EXPENSES), handle((req, res) => sendReport(res, "Expense report loaded.", reportService.getExpenses(req.user, req.query))));
reportsRouter.get("/purchases", requireReportPermission(REPORT_PERMISSIONS.VIEW_EXPENSES), handle((req, res) => sendReport(res, "Purchase report loaded.", reportService.getPurchases(req.user, req.query))));
reportsRouter.get("/bills", requireReportPermission(REPORT_PERMISSIONS.VIEW_EXPENSES), handle((req, res) => sendReport(res, "Bill report loaded.", reportService.getBills(req.user, req.query))));
reportsRouter.get("/vendors", requireReportPermission(REPORT_PERMISSIONS.VIEW_EXPENSES), handle((req, res) => sendReport(res, "Vendor report loaded.", reportService.getVendors(req.user, req.query))));
reportsRouter.get("/nysc-interns", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "NYSC and intern report loaded.", reportService.getNyscInterns(req.user, req.query))));
reportsRouter.get("/discipline", requireReportPermission(REPORT_PERMISSIONS.VIEW_DISCIPLINE), handle((req, res) => sendReport(res, "Discipline report loaded.", reportService.getDiscipline(req.user, req.query))));
reportsRouter.get("/meetings", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Meeting report loaded.", reportService.getMeetings(req.user, req.query))));
reportsRouter.get("/events", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Event report loaded.", reportService.getEvents(req.user, req.query))));
reportsRouter.get("/announcements", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Announcement report loaded.", reportService.getAnnouncements(req.user, req.query))));
reportsRouter.get("/data-quality", requireReportPermission(REPORT_PERMISSIONS.VIEW_ANALYTICS), handle((req, res) => sendReport(res, "Report data quality loaded.", reportService.getDataQuality(req.user))));

reportsRouter.post("/custom", requireReportPermission(REPORT_PERMISSIONS.CREATE), handle((req, res) => {
  const data = reportService.getCustomReport(req.user, req.body || {});
  auditReport(req, "REPORT_CREATED", { record: { id: "custom", report: data.module } });
  return sendReport(res, "Custom report generated.", data);
}));

reportsRouter.get("/export-history", requireReportPermission(REPORT_PERMISSIONS.EXPORT), handle((req, res) => {
  const result = reportService.listExports(req.user, req.query);
  return sendReport(res, "Report export history loaded.", result.data, result.meta);
}));

reportsRouter.get("/export", requireReportPermission(REPORT_PERMISSIONS.EXPORT), handle((req, res) => {
  const result = reportService.exportReport(req.query, req.user);
  auditReport(req, "REPORT_EXPORTED", result);
  if (result.job.format === "csv") {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${result.job.reportType}.csv"`);
    res.setHeader("x-report-export-id", result.job.id);
    return res.status(200).send(result.content);
  }
  return res.status(202).json({ success: true, message: "Report export completed.", data: result.job, meta: {} });
}));

reportsRouter.post("/saved", requireReportPermission(REPORT_PERMISSIONS.CREATE), handle((req, res) => {
  const report = reportService.createSavedReport(req.body || {}, req.user);
  auditReport(req, "REPORT_SAVED", report);
  return res.status(201).json({ success: true, message: "Saved report created.", data: report, meta: {} });
}));

reportsRouter.get("/saved", requireReportPermission(REPORT_PERMISSIONS.VIEW), handle((req, res) => {
  const result = reportService.listSavedReports(req.user, req.query);
  return sendReport(res, "Saved reports loaded.", result.data, result.meta);
}));

reportsRouter.get("/saved/:id", requireReportPermission(REPORT_PERMISSIONS.VIEW), handle((req, res) => {
  const report = reportService.getSavedReport(req.params.id, req.user);
  if (!report) {
    return notFound(res);
  }
  return sendReport(res, "Saved report loaded.", report);
}));

reportsRouter.patch("/saved/:id", requireReportPermission(REPORT_PERMISSIONS.EDIT), handle((req, res) => {
  const result = reportService.updateSavedReport(req.params.id, req.body || {}, req.user);
  if (!result) {
    return notFound(res);
  }
  auditReport(req, "REPORT_SAVED_UPDATED", result);
  return sendReport(res, "Saved report updated.", result.record);
}));

reportsRouter.delete("/saved/:id", requireReportPermission(REPORT_PERMISSIONS.DELETE), handle((req, res) => {
  const result = reportService.deleteSavedReport(req.params.id, req.user);
  if (!result) {
    return notFound(res);
  }
  auditReport(req, "REPORT_DELETED", result);
  return sendReport(res, "Saved report deleted.", result.record);
}));

reportsRouter.post("/saved/:id/run", requireReportPermission(REPORT_PERMISSIONS.VIEW), handle((req, res) => {
  const result = reportService.runSavedReport(req.params.id, req.user);
  if (!result) {
    return notFound(res);
  }
  auditReport(req, "REPORT_VIEWED", { record: result.savedReport });
  return sendReport(res, "Saved report run completed.", result);
}));

module.exports = { reportsRouter };
