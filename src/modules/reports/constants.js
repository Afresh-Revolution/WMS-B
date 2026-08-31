const REPORT_PERMISSIONS = Object.freeze({
  VIEW: "report.view",
  CREATE: "report.create",
  EDIT: "report.edit",
  DELETE: "report.delete",
  EXPORT: "report.export",
  VIEW_PAYROLL: "report.viewPayroll",
  VIEW_SALARY: "report.viewSalary",
  VIEW_EXPENSES: "report.viewExpenses",
  VIEW_DISCIPLINE: "report.viewDiscipline",
  VIEW_ATTENDANCE: "report.viewAttendance",
  VIEW_EMPLOYEE_DATA: "report.viewEmployeeData",
  VIEW_ANALYTICS: "report.viewAnalytics",
});

const EXPORT_STATUS = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  EXPIRED: "expired",
});

const EXPORT_FORMATS = Object.freeze(["csv", "xlsx", "pdf"]);

module.exports = { EXPORT_FORMATS, EXPORT_STATUS, REPORT_PERMISSIONS };
