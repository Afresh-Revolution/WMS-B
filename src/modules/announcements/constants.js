const ANNOUNCEMENT_STATUS = Object.freeze({
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  PUBLISHED: "published",
  ARCHIVED: "archived",
  EXPIRED: "expired",
  DELETED: "deleted",
});

const ANNOUNCEMENT_PRIORITY = Object.freeze({
  NORMAL: "normal",
  IMPORTANT: "important",
  URGENT: "urgent",
});

const AUDIENCE_TYPE = Object.freeze({
  ALL_STAFF: "all_staff",
  DEPARTMENT: "department",
  EMPLOYEE: "employee",
  MULTIPLE_DEPARTMENTS: "multiple_departments",
});

const ANNOUNCEMENT_PERMISSIONS = Object.freeze({
  VIEW: "announcement.view",
  CREATE: "announcement.create",
  EDIT: "announcement.edit",
  DELETE: "announcement.delete",
  PUBLISH: "announcement.publish",
  SCHEDULE: "announcement.schedule",
  ARCHIVE: "announcement.archive",
  PIN: "announcement.pin",
  VIEW_RECIPIENTS: "announcement.viewRecipients",
  VIEW_ANALYTICS: "announcement.viewAnalytics",
});

module.exports = {
  ANNOUNCEMENT_PERMISSIONS,
  ANNOUNCEMENT_PRIORITY,
  ANNOUNCEMENT_STATUS,
  AUDIENCE_TYPE,
};
