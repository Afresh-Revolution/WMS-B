const TARGET_TYPE = Object.freeze({
  COMPANY: "COMPANY",
  DEPARTMENT: "DEPARTMENT",
  TEAM: "TEAM",
  EMPLOYEE: "EMPLOYEE",
  PROJECT: "PROJECT",
  TASK: "TASK",
});

const MEASUREMENT_TYPE = Object.freeze({
  NUMBER: "NUMBER",
  PERCENTAGE: "PERCENTAGE",
  CURRENCY: "CURRENCY",
  COUNT: "COUNT",
  HOURS: "HOURS",
  BOOLEAN: "BOOLEAN",
  CUSTOM: "CUSTOM",
});

const TARGET_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  OVERDUE: "OVERDUE",
  CANCELLED: "CANCELLED",
});

const TARGET_PRIORITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

const TARGET_ASSIGNMENT_STATUS = Object.freeze({
  ASSIGNED: "ASSIGNED",
  UNASSIGNED: "UNASSIGNED",
  COMPLETED: "COMPLETED",
});

const TARGET_PERMISSIONS = Object.freeze({
  VIEW: "target.view",
  VIEW_ALL: "target.view_all",
  CREATE: "target.create",
  UPDATE: "target.update",
  DELETE: "target.delete",
  ASSIGN: "target.assign",
  UPDATE_PROGRESS: "target.update_progress",
  MANAGE_MILESTONES: "target.manage_milestones",
  MANAGE_REVIEWS: "target.manage_reviews",
  VIEW_REPORTS: "target.view_reports",
  EXPORT: "target.export",
});

module.exports = {
  MEASUREMENT_TYPE,
  TARGET_ASSIGNMENT_STATUS,
  TARGET_PERMISSIONS,
  TARGET_PRIORITY,
  TARGET_STATUS,
  TARGET_TYPE,
};
