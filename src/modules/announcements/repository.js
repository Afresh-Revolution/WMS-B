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

function applyAnnouncementFilters(records, query = {}) {
  const normalized = {
    q: query.q || query.search,
    status: query.status,
    category: query.category,
    priority: query.priority,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || "createdAt",
    sortDirection: query.sortDirection || "desc",
  };
  let filtered = applyBasicFilters(records, normalized, ["title", "message", "category", "priority", "status"]);
  const audience = query.audience || query.audienceType || query.audience_type;
  if (audience) {
    const matchingIds = listAllAudiences({ audienceType: audience }).map((record) => record.announcementId);
    filtered = filtered.filter((announcement) => announcement.audienceType === audience || matchingIds.includes(announcement.id));
  }
  const pinned = query.pinned ?? query.isPinned;
  if (pinned !== undefined && pinned !== "") {
    const expected = ["true", "1", "yes", true].includes(pinned);
    filtered = filtered.filter((announcement) => Boolean(announcement.isPinned) === expected);
  }
  const dateFrom = query.dateFrom || query.date_from;
  const dateTo = query.dateTo || query.date_to;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((announcement) => {
      const value = announcement.publishedAt || announcement.scheduledAt || announcement.createdAt || "";
      if (dateFrom && value < dateFrom) {
        return false;
      }
      if (dateTo && value > `${dateTo}T23:59:59.999Z`) {
        return false;
      }
      return true;
    });
  }
  return filtered.sort((left, right) => {
    if (Boolean(left.isPinned) !== Boolean(right.isPinned)) {
      return left.isPinned ? -1 : 1;
    }
    return String(right.publishedAt || right.createdAt || "").localeCompare(String(left.publishedAt || left.createdAt || ""));
  });
}

function listAnnouncements(query = {}) {
  return paginate(applyAnnouncementFilters(activeRecords("announcements"), query), query);
}

function listAllAnnouncements(query = {}) {
  return applyAnnouncementFilters(activeRecords("announcements"), query);
}

function findAnnouncement(id) {
  return activeRecords("announcements").find((announcement) => announcement.id === id) || null;
}

function createAnnouncement(payload) {
  return createRecord("announcements", payload);
}

function updateAnnouncement(id, payload) {
  return updateRecord("announcements", id, payload);
}

function createAudience(payload) {
  return createRecord("announcement_audiences", payload);
}

function listAudiences(announcementId) {
  return activeRecords("announcement_audiences").filter((audience) => audience.announcementId === announcementId);
}

function listAllAudiences(query = {}) {
  return applyBasicFilters(activeRecords("announcement_audiences"), query, ["audienceType", "departmentId", "employeeId"]);
}

function deleteAudiences(announcementId) {
  const records = readCollection("announcement_audiences");
  writeCollection(
    "announcement_audiences",
    records.map((record) =>
      record.announcementId === announcementId && !record.deletedAt ? { ...record, deletedAt: now(), updatedAt: now() } : record
    )
  );
}

function findRecipient(announcementId, employeeId) {
  return (
    activeRecords("announcement_recipients").find(
      (recipient) => recipient.announcementId === announcementId && recipient.employeeId === employeeId
    ) || null
  );
}

function createRecipient(payload) {
  return createRecord("announcement_recipients", payload);
}

function updateRecipient(id, payload) {
  return updateRecord("announcement_recipients", id, payload);
}

function listRecipients(announcementId) {
  return activeRecords("announcement_recipients").filter((recipient) => recipient.announcementId === announcementId);
}

function createHistory(payload) {
  return createRecord("announcement_history", payload);
}

function listHistory(announcementId) {
  return activeRecords("announcement_history").filter((entry) => entry.announcementId === announcementId);
}

function createNotification(payload) {
  return createRecord("notifications", payload);
}

function createNotificationDelivery(payload) {
  return createRecord("notification_deliveries", payload);
}

function listNotifications(announcementId) {
  return activeRecords("notifications").filter(
    (notification) => notification.referenceId === announcementId || notification.entityId === announcementId || notification.data?.announcementId === announcementId
  );
}

function listEmployees() {
  return activeRecords("employees");
}

function findEmployee(id) {
  return activeRecords("employees").find((employee) => employee.id === id) || null;
}

function findEmployeeByUserId(userId) {
  return activeRecords("employees").find((employee) => employee.userId === userId || employee.user_id === userId) || null;
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

function listAuditLogs(announcementId) {
  return readCollection("audit_logs").filter((entry) => entry.targetId === announcementId || entry.entityId === announcementId);
}

module.exports = {
  createAnnouncement,
  createAudience,
  createHistory,
  createNotification,
  createNotificationDelivery,
  createRecipient,
  deleteAudiences,
  findAnnouncement,
  findDepartment,
  findEmployee,
  findEmployeeByUserId,
  findRecipient,
  findUser,
  listAllAnnouncements,
  listAllAudiences,
  listAnnouncements,
  listAudiences,
  listAuditLogs,
  listEmployees,
  listHistory,
  listNotifications,
  listRecipients,
  listUsers,
  updateAnnouncement,
  updateRecipient,
};
