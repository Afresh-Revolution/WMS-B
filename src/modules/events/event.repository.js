const crypto = require("crypto");
const { getUserById } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");

function now() {
  return new Date().toISOString();
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt);
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
  writeCollection(collection, records);
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
  writeCollection(collection, records);
  return records[index];
}

function softDeleteRecord(collection, id, payload = {}) {
  return updateRecord(collection, id, { ...payload, deletedAt: now() });
}

function applyEventFilters(events, query = {}) {
  const normalized = {
    q: query.q || query.search,
    status: query.status && String(query.status).toUpperCase() !== "UPCOMING" ? query.status : undefined,
    type: query.type,
    createdBy: query.createdBy || query.created_by,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection || "asc",
  };
  let filtered = applyBasicFilters(events, normalized, ["eventCode", "event_code", "title", "type", "description", "location", "status"]);
  const status = query.status ? String(query.status).toUpperCase() : null;
  if (status === "UPCOMING") {
    const timestamp = now();
    filtered = filtered.filter((event) => !["CANCELLED", "COMPLETED", "ARCHIVED"].includes(event.status) && String(event.startDate || event.date || "") > timestamp);
  }
  const department = query.departmentId || query.department_id || query.department;
  if (department) {
    const matchingEventIds = listAllAudiences({}).filter(
      (audience) => audience.departmentId === department || String(audience.departmentName || "").toLowerCase() === String(department).toLowerCase()
    ).map((audience) => audience.eventId);
    filtered = filtered.filter((event) => matchingEventIds.includes(event.id) || event.departmentId === department || event.departmentName === department);
  }
  const audience = query.audience || query.targetAudienceType || query.target_audience_type;
  if (audience) {
    const matchingEventIds = listAllAudiences({ audienceType: audience }).map((record) => record.eventId);
    filtered = filtered.filter((event) => event.targetAudienceType === audience || matchingEventIds.includes(event.id));
  }
  const dateFrom = query.dateFrom || query.date_from;
  const dateTo = query.dateTo || query.date_to;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((event) => {
      const value = event.startDate || event.date || "";
      if (dateFrom && value < dateFrom) {
        return false;
      }
      if (dateTo && value > `${dateTo}T23:59:59.999Z`) {
        return false;
      }
      return true;
    });
  }
  return filtered;
}

function listEvents(query = {}) {
  return paginate(applyEventFilters(activeRecords("events"), query), query);
}

function listAllEvents(query = {}) {
  return applyEventFilters(activeRecords("events"), query);
}

function findEvent(id) {
  return activeRecords("events").find((event) => event.id === id) || null;
}

function createEvent(payload) {
  return createRecord("events", payload);
}

function updateEvent(id, payload) {
  return updateRecord("events", id, payload);
}

function archiveEvent(id, payload) {
  return softDeleteRecord("events", id, payload);
}

function createAudience(payload) {
  return createRecord("event_audiences", payload);
}

function listAudiences(eventId) {
  return activeRecords("event_audiences").filter((audience) => audience.eventId === eventId);
}

function listAllAudiences(query = {}) {
  return applyBasicFilters(activeRecords("event_audiences"), query, ["audienceType", "roleId", "locationId", "departmentName"]);
}

function deleteAudiences(eventId) {
  const records = readCollection("event_audiences");
  writeCollection(
    "event_audiences",
    records.map((record) => (record.eventId === eventId && !record.deletedAt ? { ...record, deletedAt: now(), updatedAt: now() } : record))
  );
}

function findAttendee(eventId, userId) {
  return activeRecords("event_attendees").find((attendee) => attendee.eventId === eventId && (attendee.userId === userId || attendee.attendeeId === userId)) || null;
}

function createAttendee(payload) {
  return createRecord("event_attendees", payload);
}

function updateAttendee(id, payload) {
  return updateRecord("event_attendees", id, payload);
}

function listAttendees(eventId) {
  return activeRecords("event_attendees").filter((attendee) => attendee.eventId === eventId);
}

function findSponsor(id) {
  return activeRecords("sponsors").find((sponsor) => sponsor.id === id) || null;
}

function findSponsorByEmail(email) {
  return activeRecords("sponsors").find((sponsor) => String(sponsor.email || "").toLowerCase() === String(email || "").toLowerCase()) || null;
}

function createSponsor(payload) {
  return createRecord("sponsors", payload);
}

function updateSponsor(id, payload) {
  return updateRecord("sponsors", id, payload);
}

function createEventSponsor(payload) {
  return createRecord("event_sponsors", payload);
}

function updateEventSponsor(id, payload) {
  return updateRecord("event_sponsors", id, payload);
}

function listSponsors(eventId) {
  return activeRecords("event_sponsors").filter((sponsor) => sponsor.eventId === eventId);
}

function createDocument(payload) {
  return createRecord("event_documents", payload);
}

function listDocuments(eventId) {
  return activeRecords("event_documents").filter((document) => document.eventId === eventId);
}

function createBudget(payload) {
  return createRecord("event_budgets", payload);
}

function updateBudget(id, payload) {
  return updateRecord("event_budgets", id, payload);
}

function findBudget(eventId) {
  return activeRecords("event_budgets").find((budget) => budget.eventId === eventId) || null;
}

function createChangeHistory(payload) {
  return createRecord("event_change_history", payload);
}

function listChangeHistory(eventId) {
  return activeRecords("event_change_history").filter((entry) => entry.eventId === eventId);
}

function createHistory(payload) {
  return createRecord("event_history", payload);
}

function listHistory(eventId) {
  return activeRecords("event_history").filter((entry) => entry.eventId === eventId);
}

function createNotification(payload) {
  return createRecord("notifications", payload);
}

function createNotificationDelivery(payload) {
  return createRecord("notification_deliveries", payload);
}

function listNotifications(eventId) {
  return activeRecords("notifications").filter((notification) => notification.entityId === eventId || notification.data?.eventId === eventId);
}

function listEmployees() {
  return activeRecords("employees");
}

function findEmployeeByUserId(userId) {
  const { resolveEmployeeForUserId } = require("../employees/employeeProfile");
  return resolveEmployeeForUserId(userId);
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function listUsers() {
  return activeRecords("users");
}

function findUser(id) {
  return getUserById(id) || activeRecords("users").find((user) => user.id === id) || null;
}

function listEventExpenses(eventId) {
  return activeRecords("expenses").filter((expense) => expense.eventId === eventId || expense.event_id === eventId);
}

module.exports = {
  archiveEvent,
  createAudience,
  createBudget,
  createChangeHistory,
  createDocument,
  createEvent,
  createEventSponsor,
  createHistory,
  createNotification,
  createNotificationDelivery,
  createSponsor,
  createAttendee,
  findAttendee,
  findBudget,
  findDepartment,
  findEmployeeByUserId,
  findEvent,
  findSponsor,
  findSponsorByEmail,
  findUser,
  listAllAudiences,
  listAllEvents,
  listAudiences,
  listChangeHistory,
  listDocuments,
  listEmployees,
  listEventExpenses,
  listEvents,
  listHistory,
  listNotifications,
  listSponsors,
  listAttendees,
  listUsers,
  updateAttendee,
  updateBudget,
  updateEvent,
  updateEventSponsor,
  updateSponsor,
  deleteAudiences,
};
