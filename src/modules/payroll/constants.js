const PAYROLL_PERIOD_STATUS = Object.freeze({
  OPEN: "OPEN",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  LOCKED: "LOCKED",
  CANCELLED: "CANCELLED",
});

const PAYROLL_RUN_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PROCESSING: "PROCESSING",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  PAYMENT_PROCESSING: "PAYMENT_PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  LOCKED: "LOCKED",
  REJECTED: "REJECTED",
});

const COMPONENT_TYPE = Object.freeze({
  EARNING: "EARNING",
  DEDUCTION: "DEDUCTION",
  BENEFIT: "BENEFIT",
});

const CALCULATION_TYPE = Object.freeze({
  FIXED: "FIXED",
  PERCENTAGE: "PERCENTAGE",
  FORMULA: "FORMULA",
});

const DEDUCTION_CATEGORY = Object.freeze({
  TAX: "TAX",
  PENSION: "PENSION",
  LOAN: "LOAN",
  ADVANCE: "ADVANCE",
  ABSENCE: "ABSENCE",
  OTHER: "OTHER",
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
});

const APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

const PAYROLL_PERMISSIONS = Object.freeze({
  VIEW: "payroll.view",
  VIEW_ALL: "payroll.view_all",
  CREATE: "payroll.create",
  CALCULATE: "payroll.calculate",
  UPDATE: "payroll.update",
  APPROVE: "payroll.approve",
  REJECT: "payroll.reject",
  PROCESS_PAYMENT: "payroll.process_payment",
  RETRY_PAYMENT: "payroll.retry_payment",
  LOCK: "payroll.lock",
  CANCEL: "payroll.cancel",
  VIEW_PAYSLIPS: "payroll.view_payslips",
  MANAGE_SALARY: "payroll.manage_salary",
  MANAGE_DEDUCTIONS: "payroll.manage_deductions",
  MANAGE_TAX_RULES: "payroll.manage_tax_rules",
  MANAGE_STATUTORY_RULES: "payroll.manage_statutory_rules",
  VIEW_REPORTS: "payroll.view_reports",
  EXPORT: "payroll.export",
});

module.exports = {
  APPROVAL_STATUS,
  CALCULATION_TYPE,
  COMPONENT_TYPE,
  DEDUCTION_CATEGORY,
  PAYMENT_STATUS,
  PAYROLL_PERIOD_STATUS,
  PAYROLL_PERMISSIONS,
  PAYROLL_RUN_STATUS,
};
