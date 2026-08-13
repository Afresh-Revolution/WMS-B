const BILL_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  SCHEDULED: "SCHEDULED",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
  DISPUTED: "DISPUTED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

const BILL_PAYMENT_STATUS = Object.freeze({
  UNPAID: "UNPAID",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  OVERPAID: "OVERPAID",
});

const BILL_APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SKIPPED: "SKIPPED",
});

const BILL_PAYMENT_RECORD_STATUS = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESSFUL: "SUCCESSFUL",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
});

const BILL_MATCH_STATUS = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  MATCHED: "MATCHED",
  MISMATCH: "MISMATCH",
});

const BILL_PERMISSIONS = Object.freeze({
  VIEW: "bill.view",
  VIEW_ALL: "bill.view_all",
  CREATE: "bill.create",
  UPDATE: "bill.update",
  SUBMIT: "bill.submit",
  REVIEW: "bill.review",
  APPROVE: "bill.approve",
  REJECT: "bill.reject",
  DISPUTE: "bill.dispute",
  SCHEDULE_PAYMENT: "bill.schedule_payment",
  PAY: "bill.pay",
  UPLOAD: "bill.upload",
  COMMENT: "bill.comment",
  EXPORT: "bill.export",
  DELETE: "bill.delete",
});

const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  "Utilities",
  "Software",
  "Office Supplies",
  "Rent",
  "Insurance",
  "Transportation",
  "Equipment",
  "Professional Services",
  "Marketing",
  "Taxes",
  "Maintenance",
  "Other",
]);

module.exports = {
  BILL_APPROVAL_STATUS,
  BILL_MATCH_STATUS,
  BILL_PAYMENT_RECORD_STATUS,
  BILL_PAYMENT_STATUS,
  BILL_PERMISSIONS,
  BILL_STATUS,
  DEFAULT_EXPENSE_CATEGORIES,
};
