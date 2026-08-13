const EXPENSE_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
});

const EXPENSE_APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SKIPPED: "SKIPPED",
});

const REIMBURSEMENT_STATUS = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
});

const EXPENSE_POLICY_RESULT = Object.freeze({
  VALID: "VALID",
  REQUIRES_REVIEW: "REQUIRES_REVIEW",
  POLICY_VIOLATION: "POLICY_VIOLATION",
});

const EXPENSE_PERMISSIONS = Object.freeze({
  VIEW: "expense.view",
  VIEW_ALL: "expense.view_all",
  VIEW_TEAM: "expense.view_team",
  CREATE: "expense.create",
  CREATE_FOR_EMPLOYEE: "expense.create_for_employee",
  UPDATE: "expense.update",
  SUBMIT: "expense.submit",
  REVIEW: "expense.review",
  APPROVE: "expense.approve",
  REJECT: "expense.reject",
  CANCEL: "expense.cancel",
  UPLOAD_RECEIPT: "expense.upload_receipt",
  COMMENT: "expense.comment",
  ADJUST: "expense.adjust",
  REIMBURSE: "expense.reimburse",
  EXPORT: "expense.export",
  MANAGE_POLICIES: "expense.manage_policies",
});

const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  { name: "Meals", requiresReceipt: true, maxAmount: 100000 },
  { name: "Transport", requiresReceipt: true, maxAmount: 150000 },
  { name: "Accommodation", requiresReceipt: true, maxAmount: 500000 },
  { name: "Fuel", requiresReceipt: true, maxAmount: 100000 },
  { name: "Office Supplies", requiresReceipt: true, maxAmount: 250000 },
  { name: "Communication", requiresReceipt: false, maxAmount: 50000 },
  { name: "Travel", requiresReceipt: true, maxAmount: 750000 },
  { name: "Client Entertainment", requiresReceipt: true, maxAmount: 250000 },
  { name: "Training", requiresReceipt: true, maxAmount: 500000 },
  { name: "Software", requiresReceipt: true, maxAmount: 500000 },
  { name: "Equipment", requiresReceipt: true, maxAmount: 1000000 },
  { name: "Medical", requiresReceipt: true, maxAmount: 250000 },
  { name: "Internet", requiresReceipt: false, maxAmount: 75000 },
  { name: "Other", requiresReceipt: true, maxAmount: null },
]);

module.exports = {
  DEFAULT_EXPENSE_CATEGORIES,
  EXPENSE_APPROVAL_STATUS,
  EXPENSE_PERMISSIONS,
  EXPENSE_POLICY_RESULT,
  EXPENSE_STATUS,
  REIMBURSEMENT_STATUS,
};
