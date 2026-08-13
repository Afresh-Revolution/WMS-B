const crypto = require("crypto");
const { getUserById, listUsers } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { DEFAULT_MEETING_TYPES, MEETING_STATUS } = require("./constants");

function now() {
  return new Date().toISOString();
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt);
}

function saveCollection(collection, records) {
  writeCollection(collection, records);
}

function createRecord(collection, payload) {
  const timestamp = now();
  const records = readCollection(collection);
  const record = {
    id: crypto.randomUUID(),
    ...payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  records.push(record);
  saveCollection(collection, records);
  return record;
}

function updateRecord(collection, id, payload) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt);
  if (index === -1) {
    return null;
  }

  records[index] = {
    ...records[index],
    ...payload,
    id: records[index].id,
    updatedAt: now(),
  };
  saveCollection(collection, records);
  return records[index];
}

function softDeleteRecord(collection, id, actorId) {
  return updateRecord(collection, id, { deletedAt: now(), deletedBy: actorId || null });
}

function ensureDefaultMeetingTypes() {
  const existing = readCollection("meeting_types");
  if (existing.length > 0) {
    return existing.filter((record) => !record.deletedAt);
  }

  const timestamp = now();
  const seeded = DEFAULT_MEETING_TYPES.map((meetingType) => ({
    id: crypto.randomUUID(),
    ...meetingType,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  saveCollection("meeting_types", seeded);
  return seeded;
}

function listMeetingTypes(query = {}) {
  return paginate(applyBasicFilters(ensureDefaultMeetingTypes(), query, ["name", "code", "description"]), query);
}

function findMeetingType(id) {
  return ensureDefaultMeetingTypes().find((record) => record.id === id && !record.deletedAt) || null;
}

function findMeetingTypeByCode(code) {
  const normalized = normalizeCode(code);
  return ensureDefaultMeetingTypes().find((record) => normalizeCode(record.code) === normalized) || null;
}

function createMeetingType(payload, actorId) {
  const code = normalizeCode(payload.code || payload.name);
  if (!payload.name || !code) {
    const error = new Error("Meeting type name and code are required.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  if (findMeetingTypeByCode(code)) {
    const error = new Error("Meeting type code already exists.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }

  return createRecord("meeting_types", {
    name: payload.name,
    code,
    description: payload.description || null,
    requiresLocation: Boolean(payload.requiresLocation ?? payload.requires_location),
    requiresVirtualLink: Boolean(payload.requiresVirtualLink ?? payload.requires_virtual_link),
    status: payload.status || "active",
    createdBy: actorId || null,
  });
}

function updateMeetingType(id, payload) {
  const updates = compactObject({
    name: payload.name,
    description: payload.description,
    requiresLocation: payload.requiresLocation ?? payload.requires_location,
    requiresVirtualLink: payload.requiresVirtualLink ?? payload.requires_virtual_link,
    status: payload.status,
  });
  if (payload.code) {
    updates.code = normalizeCode(payload.code);
  }
  return updateRecord("meeting_types", id, updates);
}

function removeMeetingType(id, actorId) {
  return softDeleteRecord("meeting_types", id, actorId);
}

function listMeetingRooms(query = {}) {
  return paginate(applyBasicFilters(activeRecords("meeting_rooms"), query, ["name", "building", "location", "equipment"]), query);
}

function findMeetingRoom(id) {
  return activeRecords("meeting_rooms").find((record) => record.id === id) || null;
}

function createMeetingRoom(payload, actorId) {
  if (!payload.name) {
    const error = new Error("Meeting room name is required.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return createRecord("meeting_rooms", {
    name: payload.name,
    building: payload.building || null,
    branchId: payload.branchId || payload.branch_id || null,
    capacity: Number(payload.capacity || 0),
    location: payload.location || null,
    equipment: Array.isArray(payload.equipment) ? payload.equipment : [],
    status: payload.status || "active",
    createdBy: actorId || null,
  });
}

function updateMeetingRoom(id, payload) {
  return updateRecord(
    "meeting_rooms",
    id,
    compactObject({
      name: payload.name,
      building: payload.building,
      branchId: payload.branchId || payload.branch_id,
      capacity: payload.capacity === undefined ? undefined : Number(payload.capacity),
      location: payload.location,
      equipment: payload.equipment,
      status: payload.status,
    })
  );
}

function listMeetings(query = {}) {
  let meetings = applyMeetingFilters(activeRecords("meetings"), query);
  return paginate(meetings, query);
}

function listAllMeetings(query = {}) {
  return applyMeetingFilters(activeRecords("meetings"), query);
}

function applyMeetingFilters(meetings, query = {}) {
  const normalized = {
    q: query.q || query.search,
    status: query.status,
    departmentId: query.departmentId || query.department_id,
    organizerId: query.organizerId || query.organizer_id,
    meetingTypeId: query.meetingTypeId || query.meeting_type_id,
    participantId: query.participantId || query.participant_id,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
  let filtered = applyBasicFilters(meetings, normalized, ["title", "description", "organizerName", "departmentName", "location"]);

  const dateFrom = normalized.dateFrom || normalized.date_from || normalized.start;
  const dateTo = normalized.dateTo || normalized.date_to || normalized.end;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((meeting) => {
      if (dateFrom && meeting.endAt < dateFrom) {
        return false;
      }
      if (dateTo && meeting.startAt > dateTo) {
        return false;
      }
      return true;
    });
  }

  if (normalized.participantId) {
    const meetingIds = new Set(
      activeRecords("meeting_participants")
        .filter((participant) => participant.userId === normalized.participantId)
        .map((participant) => participant.meetingId)
    );
    filtered = filtered.filter((meeting) => meetingIds.has(meeting.id));
  }

  return filtered;
}

function findMeeting(id) {
  return activeRecords("meetings").find((record) => record.id === id) || null;
}

function createMeeting(payload) {
  return createRecord("meetings", payload);
}

function updateMeeting(id, payload) {
  return updateRecord("meetings", id, payload);
}

function createParticipant(payload) {
  return createRecord("meeting_participants", payload);
}

function updateParticipant(id, payload) {
  return updateRecord("meeting_participants", id, payload);
}

function removeParticipant(id, actorId) {
  return softDeleteRecord("meeting_participants", id, actorId);
}

function findParticipant(meetingId, userId) {
  return activeRecords("meeting_participants").find(
    (participant) => participant.meetingId === meetingId && participant.userId === userId
  );
}

function listParticipants(meetingId) {
  return activeRecords("meeting_participants").filter((participant) => participant.meetingId === meetingId);
}

function createAgenda(payload) {
  return createRecord("meeting_agendas", payload);
}

function updateAgenda(id, payload) {
  return updateRecord("meeting_agendas", id, payload);
}

function removeAgenda(id, actorId) {
  return softDeleteRecord("meeting_agendas", id, actorId);
}

function listAgenda(meetingId) {
  return activeRecords("meeting_agendas")
    .filter((agenda) => agenda.meetingId === meetingId)
    .sort((left, right) => Number(left.orderNumber || 0) - Number(right.orderNumber || 0));
}

function findAgenda(id) {
  return activeRecords("meeting_agendas").find((agenda) => agenda.id === id) || null;
}

function createMinutes(payload) {
  return createRecord("meeting_minutes", payload);
}

function updateMinutes(id, payload) {
  return updateRecord("meeting_minutes", id, payload);
}

function listMinutes(meetingId) {
  return activeRecords("meeting_minutes").filter((minutes) => minutes.meetingId === meetingId);
}

function createActionItem(payload) {
  return createRecord("meeting_action_items", payload);
}

function listActionItems(meetingId) {
  return activeRecords("meeting_action_items").filter((item) => item.meetingId === meetingId);
}

function createAttendance(payload) {
  return createRecord("meeting_attendance", payload);
}

function updateAttendance(id, payload) {
  return updateRecord("meeting_attendance", id, payload);
}

function findAttendance(meetingId, userId) {
  return activeRecords("meeting_attendance").find((record) => record.meetingId === meetingId && record.userId === userId) || null;
}

function listAttendance(meetingId) {
  return activeRecords("meeting_attendance").filter((record) => record.meetingId === meetingId);
}

function createReminder(payload) {
  return createRecord("meeting_reminders", payload);
}

function listReminders(meetingId) {
  return activeRecords("meeting_reminders").filter((reminder) => reminder.meetingId === meetingId);
}

function createAttachment(payload) {
  return createRecord("meeting_attachments", payload);
}

function createHistory(payload) {
  return createRecord("meeting_history", payload);
}

function listHistory(query = {}) {
  return paginate(applyBasicFilters(activeRecords("meeting_history"), query, ["action"]), query);
}

function listMeetingHistory(meetingId) {
  return activeRecords("meeting_history").filter((history) => history.meetingId === meetingId);
}

function listEmployees() {
  return activeRecords("employees");
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function findUser(id) {
  return getUserById(id);
}

function listActiveUsers() {
  return listUsers().filter((user) => String(user.status || "active").toLowerCase() === "active");
}

function createTask(payload) {
  return createRecord("tasks", payload);
}

function activeMeetingStatuses() {
  return [MEETING_STATUS.SCHEDULED, MEETING_STATUS.ONGOING, MEETING_STATUS.POSTPONED, MEETING_STATUS.COMPLETED];
}

module.exports = {
  activeMeetingStatuses,
  createActionItem,
  createAgenda,
  createAttachment,
  createAttendance,
  createHistory,
  createMeeting,
  createMeetingRoom,
  createMeetingType,
  createMinutes,
  createParticipant,
  createReminder,
  createTask,
  findAgenda,
  findAttendance,
  findDepartment,
  findMeeting,
  findMeetingRoom,
  findMeetingType,
  findParticipant,
  findUser,
  listActionItems,
  listActiveUsers,
  listAgenda,
  listAllMeetings,
  listAttendance,
  listEmployees,
  listHistory,
  listMeetingHistory,
  listMeetingRooms,
  listMeetings,
  listMeetingTypes,
  listMinutes,
  listParticipants,
  listReminders,
  removeAgenda,
  removeParticipant,
  updateAgenda,
  updateAttendance,
  updateMeeting,
  updateMeetingRoom,
  updateMeetingType,
  removeMeetingType,
  updateMinutes,
  updateParticipant,
};
