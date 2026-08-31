const PROFILE_TYPE = Object.freeze({
  NYSC: "NYSC",
  INTERN: "INTERN",
});

const PLACEMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  ENDING_SOON: "ENDING_SOON",
  COMPLETED: "COMPLETED",
  EXITED: "EXITED",
  TERMINATED: "TERMINATED",
  CANCELLED: "CANCELLED",
});

const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LATE: "LATE",
  EXCUSED: "EXCUSED",
  REMOTE: "REMOTE",
});

const REVIEW_PERIOD = Object.freeze({
  MONTHLY: "MONTHLY",
  MID_PLACEMENT: "MID_PLACEMENT",
  FINAL: "FINAL",
});

const REVIEW_RECOMMENDATION = Object.freeze({
  CONTINUE: "CONTINUE",
  EXTEND_PLACEMENT: "EXTEND_PLACEMENT",
  COMPLETE: "COMPLETE",
  RECOMMEND_FOR_EMPLOYMENT: "RECOMMEND_FOR_EMPLOYMENT",
  DO_NOT_RECOMMEND: "DO_NOT_RECOMMEND",
});

const EXIT_TYPE = Object.freeze({
  COMPLETED: "COMPLETED",
  EARLY_EXIT: "EARLY_EXIT",
  TERMINATED: "TERMINATED",
  TRANSFERRED: "TRANSFERRED",
});

const NYSC_INTERN_PERMISSIONS = Object.freeze({
  VIEW: "nysc_intern.view",
  VIEW_ALL: "nysc_intern.view_all",
  CREATE: "nysc_intern.create",
  UPDATE: "nysc_intern.update",
  DELETE: "nysc_intern.delete",
  ASSIGN_SUPERVISOR: "nysc_intern.assign_supervisor",
  MANAGE_PLACEMENT: "nysc_intern.manage_placement",
  EXTEND: "nysc_intern.extend",
  COMPLETE: "nysc_intern.complete",
  TERMINATE: "nysc_intern.terminate",
  MANAGE_DOCUMENTS: "nysc_intern.manage_documents",
  VIEW_DOCUMENTS: "nysc_intern.view_documents",
  MANAGE_ATTENDANCE: "nysc_intern.manage_attendance",
  MANAGE_REVIEWS: "nysc_intern.manage_reviews",
  VIEW_REVIEWS: "nysc_intern.view_reviews",
  MANAGE_EXIT: "nysc_intern.manage_exit",
  CONVERT_EMPLOYEE: "nysc_intern.convert_employee",
  EXPORT: "nysc_intern.export",
});

module.exports = {
  ATTENDANCE_STATUS,
  EXIT_TYPE,
  NYSC_INTERN_PERMISSIONS,
  PLACEMENT_STATUS,
  PROFILE_TYPE,
  REVIEW_PERIOD,
  REVIEW_RECOMMENDATION,
};
