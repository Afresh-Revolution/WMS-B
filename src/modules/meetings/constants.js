const MEETING_STATUS = Object.freeze({
  SCHEDULED: "SCHEDULED",
  ONGOING: "ONGOING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  POSTPONED: "POSTPONED",
});

const MEETING_VISIBILITY = Object.freeze({
  PRIVATE: "PRIVATE",
  DEPARTMENT: "DEPARTMENT",
  COMPANY_WIDE: "COMPANY_WIDE",
});

const PARTICIPANT_ROLE = Object.freeze({
  ORGANIZER: "ORGANIZER",
  HOST: "HOST",
  PARTICIPANT: "PARTICIPANT",
  OPTIONAL: "OPTIONAL",
});

const INVITATION_STATUS = Object.freeze({
  INVITED: "INVITED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  TENTATIVE: "TENTATIVE",
});

const RESPONSE_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  TENTATIVE: "TENTATIVE",
});

const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LATE: "LATE",
  EXCUSED: "EXCUSED",
});

const MEETING_PERMISSIONS = Object.freeze({
  VIEW: "meeting.view",
  VIEW_ALL: "meeting.view_all",
  CREATE: "meeting.create",
  UPDATE: "meeting.update",
  CANCEL: "meeting.cancel",
  POSTPONE: "meeting.postpone",
  MANAGE_PARTICIPANTS: "meeting.manage_participants",
  MANAGE_AGENDA: "meeting.manage_agenda",
  MANAGE_MINUTES: "meeting.manage_minutes",
  MANAGE_ATTENDANCE: "meeting.manage_attendance",
  MANAGE_ACTION_ITEMS: "meeting.manage_action_items",
  MANAGE_TYPES: "meeting.manage_types",
  MANAGE_ROOMS: "meeting.manage_rooms",
  VIEW_REPORTS: "meeting.view_reports",
  EXPORT: "meeting.export",
});

const DEFAULT_MEETING_TYPES = Object.freeze([
  {
    name: "In-person",
    code: "IN_PERSON",
    description: "A physical meeting that requires a room or location.",
    requiresLocation: true,
    requiresVirtualLink: false,
    status: "active",
  },
  {
    name: "Virtual",
    code: "VIRTUAL",
    description: "An online meeting that requires a virtual meeting link.",
    requiresLocation: false,
    requiresVirtualLink: true,
    status: "active",
  },
  {
    name: "Hybrid",
    code: "HYBRID",
    description: "A physical and online meeting that requires a location and a link.",
    requiresLocation: true,
    requiresVirtualLink: true,
    status: "active",
  },
]);

const DEFAULT_REMINDERS = Object.freeze([1440, 60, 15]);

module.exports = {
  ATTENDANCE_STATUS,
  DEFAULT_MEETING_TYPES,
  DEFAULT_REMINDERS,
  INVITATION_STATUS,
  MEETING_PERMISSIONS,
  MEETING_STATUS,
  MEETING_VISIBILITY,
  PARTICIPANT_ROLE,
  RESPONSE_STATUS,
};
