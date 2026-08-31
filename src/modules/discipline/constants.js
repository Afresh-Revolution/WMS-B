const CASE_STATUS = Object.freeze({
  OPEN: "OPEN",
  UNDER_INVESTIGATION: "UNDER_INVESTIGATION",
  PENDING_REVIEW: "PENDING_REVIEW",
  ACTION_ISSUED: "ACTION_ISSUED",
  APPEAL_PENDING: "APPEAL_PENDING",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
  ARCHIVED: "ARCHIVED",
});

const ACTION_TYPE = Object.freeze({
  VERBAL_WARNING: "VERBAL_WARNING",
  WRITTEN_WARNING: "WRITTEN_WARNING",
  FINAL_WARNING: "FINAL_WARNING",
  STRIKE: "STRIKE",
  SUSPENSION: "SUSPENSION",
  PROBATION: "PROBATION",
  DEMOTION: "DEMOTION",
  LOSS_OF_PRIVILEGE: "LOSS_OF_PRIVILEGE",
  PAY_DEDUCTION: "PAY_DEDUCTION",
  TERMINATION: "TERMINATION",
  OTHER: "OTHER",
});

const SEVERITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

const ACTION_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REVOKED: "REVOKED",
});

const HEARING_STATUS = Object.freeze({
  SCHEDULED: "SCHEDULED",
  COMPLETED: "COMPLETED",
  POSTPONED: "POSTPONED",
  CANCELLED: "CANCELLED",
});

const APPEAL_STATUS = Object.freeze({
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
});

const ACKNOWLEDGEMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  REFUSED: "REFUSED",
});

const DISCIPLINE_PERMISSIONS = Object.freeze({
  VIEW: "discipline.view",
  VIEW_ALL: "discipline.view_all",
  VIEW_TEAM: "discipline.view_team",
  CREATE: "discipline.create",
  UPDATE: "discipline.update",
  DELETE: "discipline.delete",
  ASSIGN: "discipline.assign",
  INVESTIGATE: "discipline.investigate",
  ISSUE_ACTION: "discipline.issue_action",
  APPROVE_ACTION: "discipline.approve_action",
  RESOLVE: "discipline.resolve",
  CLOSE: "discipline.close",
  REOPEN: "discipline.reopen",
  UPLOAD_EVIDENCE: "discipline.upload_evidence",
  VIEW_EVIDENCE: "discipline.view_evidence",
  MANAGE_HEARINGS: "discipline.manage_hearings",
  MANAGE_APPEALS: "discipline.manage_appeals",
  VIEW_EMPLOYEE_HISTORY: "discipline.view_employee_history",
  EXPORT: "discipline.export",
  VIEW_REPORTS: "discipline.view_reports",
});

module.exports = {
  ACKNOWLEDGEMENT_STATUS,
  ACTION_STATUS,
  ACTION_TYPE,
  APPEAL_STATUS,
  CASE_STATUS,
  DISCIPLINE_PERMISSIONS,
  HEARING_STATUS,
  SEVERITY,
};
