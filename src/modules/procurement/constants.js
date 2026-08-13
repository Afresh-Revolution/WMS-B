const PURCHASE_REQUEST_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  ORDERED: "ORDERED",
  PARTIALLY_DELIVERED: "PARTIALLY_DELIVERED",
  DELIVERED: "DELIVERED",
  CLOSED: "CLOSED",
});

const PURCHASE_PRIORITY = Object.freeze({
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
});

const APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SKIPPED: "SKIPPED",
});

const PURCHASE_ORDER_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SENT: "SENT",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  PARTIALLY_DELIVERED: "PARTIALLY_DELIVERED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  CLOSED: "CLOSED",
});

const RECEIPT_STATUS = Object.freeze({
  PARTIAL: "PARTIAL",
  COMPLETE: "COMPLETE",
  REJECTED: "REJECTED",
});

const VENDOR_QUOTE_STATUS = Object.freeze({
  SUBMITTED: "SUBMITTED",
  SELECTED: "SELECTED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
});

const PURCHASE_PERMISSIONS = Object.freeze({
  VIEW: "purchase_request.view",
  VIEW_ALL: "purchase_request.view_all",
  CREATE: "purchase_request.create",
  UPDATE: "purchase_request.update",
  SUBMIT: "purchase_request.submit",
  REVIEW: "purchase_request.review",
  APPROVE: "purchase_request.approve",
  REJECT: "purchase_request.reject",
  CANCEL: "purchase_request.cancel",
  ASSIGN_VENDOR: "purchase_request.assign_vendor",
  CREATE_ORDER: "purchase_request.create_order",
  RECEIVE: "purchase_request.receive",
  COMMENT: "purchase_request.comment",
  UPLOAD: "purchase_request.upload",
  VIEW_REPORTS: "purchase_request.view_reports",
  EXPORT: "purchase_request.export",
});

module.exports = {
  APPROVAL_STATUS,
  PURCHASE_ORDER_STATUS,
  PURCHASE_PERMISSIONS,
  PURCHASE_PRIORITY,
  PURCHASE_REQUEST_STATUS,
  RECEIPT_STATUS,
  VENDOR_QUOTE_STATUS,
};
