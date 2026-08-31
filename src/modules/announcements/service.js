const { hasPermission } = require("../../constants/rbac");
const { ANNOUNCEMENT_PERMISSIONS, ANNOUNCEMENT_PRIORITY, ANNOUNCEMENT_STATUS, AUDIENCE_TYPE } = require("./constants");
const repository = require("./repository");

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function assertPermission(user, permission) {
  if (!can(user, permission)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeCategory(value) {
  return String(value || "General").trim() || "General";
}

function getEmployeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || null;
}

function isActiveEmployee(employee) {
  const status = String(employee?.status || "active").toLowerCase();
  return employee && !["inactive", "suspended", "terminated", "deleted"].includes(status);
}

function normalizeAudiencePayload(payload = {}) {
  const audienceType = normalizeEnum(
    payload.audienceType || payload.audience_type || payload.targetAudienceType || payload.target_audience_type,
    Object.values(AUDIENCE_TYPE),
    AUDIENCE_TYPE.ALL_STAFF
  );
  if (audienceType === AUDIENCE_TYPE.MULTIPLE_DEPARTMENTS) {
    const ids = payload.departmentIds || payload.department_ids || [];
    return ids.map((departmentId) => ({ audienceType, departmentId, employeeId: null }));
  }
  if (audienceType === AUDIENCE_TYPE.DEPARTMENT) {
    return [{ audienceType, departmentId: payload.departmentId || payload.department_id || null, employeeId: null }];
  }
  if (audienceType === AUDIENCE_TYPE.EMPLOYEE) {
    const employeeIds = payload.employeeIds || payload.employee_ids || (payload.employeeId ? [payload.employeeId] : []);
    const userIds = payload.userIds || payload.user_ids || (payload.userId ? [payload.userId] : []);
    return [
      ...employeeIds.map((employeeId) => ({ audienceType, departmentId: null, employeeId })),
      ...userIds
        .map((userId) => repository.findEmployeeByUserId(userId))
        .filter(Boolean)
        .map((employee) => ({ audienceType, departmentId: null, employeeId: employee.id })),
    ];
  }
  return [{ audienceType: AUDIENCE_TYPE.ALL_STAFF, departmentId: null, employeeId: null }];
}

function validateAudience(audience) {
  if (!audience.length) {
    throw createHttpError(400, "Announcement target audience is required.", "ANNOUNCEMENT_AUDIENCE_REQUIRED");
  }
  for (const entry of audience) {
    if ([AUDIENCE_TYPE.DEPARTMENT, AUDIENCE_TYPE.MULTIPLE_DEPARTMENTS].includes(entry.audienceType) && !entry.departmentId) {
      throw createHttpError(400, "Department audience requires departmentId.", "ANNOUNCEMENT_DEPARTMENT_REQUIRED");
    }
    if (entry.audienceType === AUDIENCE_TYPE.EMPLOYEE && !entry.employeeId) {
      throw createHttpError(400, "Employee audience requires employeeId.", "ANNOUNCEMENT_EMPLOYEE_REQUIRED");
    }
  }
}

function writeAudience(announcementId, audience) {
  repository.deleteAudiences(announcementId);
  return audience.map((entry) =>
    repository.createAudience({
      announcementId,
      audienceType: entry.audienceType,
      departmentId: entry.departmentId || null,
      employeeId: entry.employeeId || null,
    })
  );
}

function buildAnnouncementCode() {
  return `ANN-${String(repository.listAllAnnouncements({ limit: 1 }).length + 1).padStart(4, "0")}`;
}

function recordHistory({ announcementId, actor, action, oldStatus, newStatus, comment, metadata }) {
  return repository.createHistory({
    announcementId,
    actorId: actor?.id || null,
    action,
    oldStatus: oldStatus || null,
    newStatus: newStatus || null,
    comment: comment || null,
    metadata: metadata || {},
  });
}

function resolveAudienceEmployees(announcement) {
  const audience = repository.listAudiences(announcement.id);
  const employees = repository.listEmployees().filter(isActiveEmployee);
  const resolved = new Map();
  const addEmployee = (employee) => {
    if (!employee || !isActiveEmployee(employee)) {
      return;
    }
    resolved.set(employee.id, employee);
  };

  for (const entry of audience.length ? audience : [{ audienceType: announcement.audienceType || AUDIENCE_TYPE.ALL_STAFF }]) {
    if (entry.audienceType === AUDIENCE_TYPE.ALL_STAFF) {
      employees.forEach(addEmployee);
      continue;
    }
    if (entry.audienceType === AUDIENCE_TYPE.DEPARTMENT || entry.audienceType === AUDIENCE_TYPE.MULTIPLE_DEPARTMENTS) {
      employees
        .filter((employee) => (employee.departmentId || employee.department_id) === entry.departmentId)
        .forEach(addEmployee);
      continue;
    }
    if (entry.audienceType === AUDIENCE_TYPE.EMPLOYEE) {
      addEmployee(repository.findEmployee(entry.employeeId));
    }
  }

  return [...resolved.values()];
}

function createRecipientRecords(announcement, employees) {
  return employees.map((employee) => {
    const existing = repository.findRecipient(announcement.id, employee.id);
    if (existing) {
      return existing;
    }
    return repository.createRecipient({
      announcementId: announcement.id,
      employeeId: employee.id,
      userId: employee.userId || employee.user_id || null,
      deliveredAt: nowIso(),
      readAt: null,
      isRead: false,
    });
  });
}

function createNotifications(announcement, employees) {
  return employees
    .map((employee) => {
      const userId = employee.userId || employee.user_id;
      if (!userId) {
        return null;
      }
      const notification = repository.createNotification({
        userId,
        recipientUserId: userId,
        recipientEmployeeId: employee.id,
        type: "announcement",
        title: announcement.title,
        message: announcement.message,
        body: announcement.message,
        referenceType: "announcement",
        referenceId: announcement.id,
        entityType: "announcement",
        entityId: announcement.id,
        isRead: false,
        readAt: null,
        status: "queued",
        data: { announcementId: announcement.id, priority: announcement.priority },
      });
      repository.createNotificationDelivery({
        notificationId: notification.id,
        channel: "in_app",
        status: "queued",
        sentAt: nowIso(),
        deliveredAt: nowIso(),
        failedAt: null,
        errorMessage: null,
      });
      return notification;
    })
    .filter(Boolean);
}

function publishAnnouncementRecord(announcement, user, payload = {}) {
  if (announcement.status === ANNOUNCEMENT_STATUS.PUBLISHED) {
    throw createHttpError(409, "Announcement has already been published.", "ANNOUNCEMENT_ALREADY_PUBLISHED");
  }
  if ([ANNOUNCEMENT_STATUS.DELETED, ANNOUNCEMENT_STATUS.ARCHIVED, ANNOUNCEMENT_STATUS.EXPIRED].includes(announcement.status)) {
    throw createHttpError(409, "Announcement cannot be published in its current status.", "ANNOUNCEMENT_NOT_PUBLISHABLE");
  }
  const employees = resolveAudienceEmployees(announcement);
  const recipients = createRecipientRecords(announcement, employees);
  const notifications = payload.notify === false ? [] : createNotifications(announcement, employees);
  const updated = repository.updateAnnouncement(announcement.id, {
    status: ANNOUNCEMENT_STATUS.PUBLISHED,
    publishedAt: nowIso(),
    publishedBy: user?.id || null,
    scheduledAt: null,
  });
  recordHistory({
    announcementId: announcement.id,
    actor: user,
    action: "PUBLISHED",
    oldStatus: announcement.status,
    newStatus: updated.status,
    metadata: { recipients: recipients.length, notifications: notifications.length },
  });
  return { oldValues: announcement, record: decorateAnnouncement(updated), meta: { recipients: recipients.length, notifications: notifications.length } };
}

function createAnnouncement(payload, user, options = {}) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.CREATE);
  if (!payload.title || !payload.message) {
    throw createHttpError(400, "Announcement title and message are required.", "ANNOUNCEMENT_REQUIRED_FIELDS");
  }
  const audience = normalizeAudiencePayload(payload);
  validateAudience(audience);
  const requestedStatus = options.draftOnly
    ? ANNOUNCEMENT_STATUS.DRAFT
    : normalizeEnum(payload.status, Object.values(ANNOUNCEMENT_STATUS), ANNOUNCEMENT_STATUS.DRAFT);
  const initialStatus = requestedStatus === ANNOUNCEMENT_STATUS.PUBLISHED ? ANNOUNCEMENT_STATUS.DRAFT : requestedStatus;
  const announcement = repository.createAnnouncement({
    announcementCode: buildAnnouncementCode(),
    title: String(payload.title).trim(),
    message: String(payload.message).trim(),
    category: normalizeCategory(payload.category),
    status: initialStatus,
    priority: normalizeEnum(payload.priority, Object.values(ANNOUNCEMENT_PRIORITY), ANNOUNCEMENT_PRIORITY.NORMAL),
    isPinned: Boolean(payload.isPinned),
    audienceType: audience[0]?.audienceType || AUDIENCE_TYPE.ALL_STAFF,
    createdBy: user.id,
    publishedAt: null,
    publishedBy: null,
    scheduledAt: payload.scheduledAt || payload.scheduled_at || null,
    expiresAt: payload.expiresAt || payload.expires_at || null,
    deletedAt: null,
  });
  const audiences = writeAudience(announcement.id, audience);
  recordHistory({ announcementId: announcement.id, actor: user, action: "CREATED", newStatus: announcement.status, metadata: { audiences: audiences.length } });
  if (requestedStatus === ANNOUNCEMENT_STATUS.PUBLISHED) {
    return publishAnnouncementRecord(announcement, user, payload);
  }
  return { record: decorateAnnouncement(announcement), meta: { audiences: audiences.length } };
}

function createDraft(payload, user) {
  return createAnnouncement(payload, user, { draftOnly: true });
}

function publishAnnouncement(id, payload, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.PUBLISH);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  return publishAnnouncementRecord(announcement, user, payload);
}

function scheduleAnnouncement(id, payload, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.SCHEDULE);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  if (![ANNOUNCEMENT_STATUS.DRAFT, ANNOUNCEMENT_STATUS.SCHEDULED].includes(announcement.status)) {
    throw createHttpError(409, "Only draft or scheduled announcements can be scheduled.", "ANNOUNCEMENT_NOT_SCHEDULABLE");
  }
  if (!payload.scheduledAt && !payload.scheduled_at) {
    throw createHttpError(400, "scheduledAt is required.", "ANNOUNCEMENT_SCHEDULE_REQUIRED");
  }
  const scheduledAt = new Date(payload.scheduledAt || payload.scheduled_at);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw createHttpError(400, "scheduledAt must be a valid date.", "ANNOUNCEMENT_INVALID_SCHEDULE");
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw createHttpError(400, "scheduledAt must be in the future.", "ANNOUNCEMENT_SCHEDULE_IN_PAST");
  }
  const updated = repository.updateAnnouncement(id, {
    status: ANNOUNCEMENT_STATUS.SCHEDULED,
    scheduledAt: scheduledAt.toISOString(),
  });
  recordHistory({ announcementId: id, actor: user, action: "SCHEDULED", oldStatus: announcement.status, newStatus: updated.status });
  return { oldValues: announcement, record: decorateAnnouncement(updated) };
}

function expireDueAnnouncements() {
  const timestamp = nowIso();
  for (const announcement of repository.listAllAnnouncements({})) {
    if (
      announcement.status === ANNOUNCEMENT_STATUS.PUBLISHED &&
      announcement.expiresAt &&
      String(announcement.expiresAt) <= timestamp
    ) {
      const updated = repository.updateAnnouncement(announcement.id, { status: ANNOUNCEMENT_STATUS.EXPIRED, expiredAt: timestamp });
      recordHistory({ announcementId: announcement.id, actor: null, action: "EXPIRED", oldStatus: announcement.status, newStatus: updated.status });
    }
  }
}

function listAdminAnnouncements(user, query = {}) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW);
  expireDueAnnouncements();
  return repository.listAnnouncements(query);
}

function buildAnalytics(announcementId) {
  const recipients = repository.listRecipients(announcementId);
  const delivered = recipients.filter((recipient) => recipient.deliveredAt).length;
  const read = recipients.filter((recipient) => recipient.isRead || recipient.readAt).length;
  const unread = Math.max(0, recipients.length - read);
  const departmentBreakdown = recipients.reduce((summary, recipient) => {
    const employee = repository.findEmployee(recipient.employeeId);
    const departmentId = employee?.departmentId || employee?.department_id || "unassigned";
    const department = departmentId === "unassigned" ? null : repository.findDepartment(departmentId);
    if (!summary[departmentId]) {
      summary[departmentId] = {
        departmentId,
        departmentName: department?.name || employee?.department || "Unassigned",
        recipients: 0,
        read: 0,
        unread: 0,
      };
    }
    summary[departmentId].recipients += 1;
    if (recipient.isRead || recipient.readAt) {
      summary[departmentId].read += 1;
    } else {
      summary[departmentId].unread += 1;
    }
    return summary;
  }, {});
  return {
    recipients: recipients.length,
    delivered,
    read,
    unread,
    readPercentage: recipients.length ? Number(((read / recipients.length) * 100).toFixed(2)) : 0,
    departmentBreakdown: Object.values(departmentBreakdown),
  };
}

function decorateAnnouncement(announcement) {
  if (!announcement) {
    return null;
  }
  return {
    ...announcement,
    creator: announcement.createdBy ? sanitizeUser(repository.findUser(announcement.createdBy)) : null,
    audiences: repository.listAudiences(announcement.id),
  };
}

function getAdminDetails(id, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  return {
    ...decorateAnnouncement(announcement),
    analytics: buildAnalytics(id),
    auditHistory: repository.listHistory(id),
    auditLogs: repository.listAuditLogs(id),
  };
}

function updateAnnouncement(id, payload, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.EDIT);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  const update = {
    title: payload.title !== undefined ? String(payload.title).trim() : announcement.title,
    category: payload.category !== undefined ? normalizeCategory(payload.category) : announcement.category,
    message: payload.message !== undefined ? String(payload.message).trim() : announcement.message,
    priority: payload.priority !== undefined ? normalizeEnum(payload.priority, Object.values(ANNOUNCEMENT_PRIORITY), announcement.priority) : announcement.priority,
    expiresAt: payload.expiresAt !== undefined || payload.expires_at !== undefined ? payload.expiresAt || payload.expires_at || null : announcement.expiresAt || null,
    isPinned: payload.isPinned !== undefined ? Boolean(payload.isPinned) : Boolean(announcement.isPinned),
  };
  if (!update.title || !update.message) {
    throw createHttpError(400, "Announcement title and message are required.", "ANNOUNCEMENT_REQUIRED_FIELDS");
  }
  const updated = repository.updateAnnouncement(id, update);
  let audiences = repository.listAudiences(id);
  if (payload.audienceType || payload.audience_type || payload.departmentId || payload.departmentIds || payload.employeeId || payload.employeeIds) {
    const audience = normalizeAudiencePayload(payload);
    validateAudience(audience);
    audiences = writeAudience(id, audience);
    repository.updateAnnouncement(id, { audienceType: audience[0]?.audienceType || AUDIENCE_TYPE.ALL_STAFF });
  }
  recordHistory({
    announcementId: id,
    actor: user,
    action: announcement.status === ANNOUNCEMENT_STATUS.PUBLISHED ? "UPDATED_PUBLISHED" : "UPDATED",
    oldStatus: announcement.status,
    newStatus: updated.status,
    metadata: { audiences: audiences.length },
  });
  return { oldValues: announcement, record: decorateAnnouncement(repository.findAnnouncement(id)) };
}

function setPin(id, isPinned, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.PIN);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  const updated = repository.updateAnnouncement(id, { isPinned, pinnedAt: isPinned ? nowIso() : null });
  recordHistory({
    announcementId: id,
    actor: user,
    action: isPinned ? "PINNED" : "UNPINNED",
    oldStatus: announcement.status,
    newStatus: updated.status,
  });
  return { oldValues: announcement, record: decorateAnnouncement(updated) };
}

function archiveAnnouncement(id, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.ARCHIVE);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  const updated = repository.updateAnnouncement(id, { status: ANNOUNCEMENT_STATUS.ARCHIVED, archivedBy: user.id, archivedAt: nowIso() });
  recordHistory({ announcementId: id, actor: user, action: "ARCHIVED", oldStatus: announcement.status, newStatus: updated.status });
  return { oldValues: announcement, record: decorateAnnouncement(updated) };
}

function deleteAnnouncement(id, payload, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.DELETE);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  const updated = repository.updateAnnouncement(id, {
    status: ANNOUNCEMENT_STATUS.DELETED,
    deletedBy: user.id,
    deletedReason: payload.reason || null,
    deletedAt: nowIso(),
  });
  recordHistory({ announcementId: id, actor: user, action: "DELETED", oldStatus: announcement.status, newStatus: updated.status, comment: payload.reason });
  return { oldValues: announcement, record: updated };
}

function isVisibleToEmployee(announcement, employee) {
  if (!employee || !isActiveEmployee(employee)) {
    return false;
  }
  if (announcement.status !== ANNOUNCEMENT_STATUS.PUBLISHED) {
    return false;
  }
  if (announcement.expiresAt && String(announcement.expiresAt) <= nowIso()) {
    return false;
  }
  const recipient = repository.findRecipient(announcement.id, employee.id);
  if (recipient) {
    return true;
  }
  return resolveAudienceEmployees(announcement).some((candidate) => candidate.id === employee.id);
}

function getCurrentEmployee(user) {
  const employee = repository.findEmployeeByUserId(user?.id);
  if (!employee || !isActiveEmployee(employee)) {
    throw createHttpError(403, "No active employee profile is linked to this account.", "EMPLOYEE_PROFILE_REQUIRED");
  }
  return employee;
}

function decorateForEmployee(announcement, employee) {
  const recipient = repository.findRecipient(announcement.id, employee.id);
  return {
    id: announcement.id,
    announcementCode: announcement.announcementCode,
    title: announcement.title,
    message: announcement.message,
    category: announcement.category,
    priority: announcement.priority,
    status: announcement.status,
    isPinned: Boolean(announcement.isPinned),
    publishedAt: announcement.publishedAt,
    expiresAt: announcement.expiresAt,
    createdAt: announcement.createdAt,
    recipient: recipient
      ? {
          id: recipient.id,
          deliveredAt: recipient.deliveredAt,
          readAt: recipient.readAt,
          isRead: Boolean(recipient.isRead),
        }
      : null,
  };
}

function listEmployeeAnnouncements(user, query = {}) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW);
  expireDueAnnouncements();
  const employee = getCurrentEmployee(user);
  const data = repository
    .listAllAnnouncements(query)
    .filter((announcement) => isVisibleToEmployee(announcement, employee))
    .map((announcement) => decorateForEmployee(announcement, employee));
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const total = data.length;
  return {
    data: data.slice((page - 1) * limit, (page - 1) * limit + limit),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

function getEmployeeAnnouncement(id, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW);
  expireDueAnnouncements();
  const employee = getCurrentEmployee(user);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  if (!isVisibleToEmployee(announcement, employee)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  return decorateForEmployee(announcement, employee);
}

function markRead(id, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW);
  const employee = getCurrentEmployee(user);
  const announcement = repository.findAnnouncement(id);
  if (!announcement) {
    return null;
  }
  if (!isVisibleToEmployee(announcement, employee)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  const recipient = repository.findRecipient(id, employee.id) || createRecipientRecords(announcement, [employee])[0];
  const updated = repository.updateRecipient(recipient.id, { isRead: true, readAt: recipient.readAt || nowIso() });
  recordHistory({ announcementId: id, actor: user, action: "READ", oldStatus: announcement.status, newStatus: announcement.status });
  return updated;
}

function getUnreadCount(user) {
  const employee = getCurrentEmployee(user);
  return repository
    .listAllAnnouncements({})
    .filter((announcement) => isVisibleToEmployee(announcement, employee))
    .filter((announcement) => {
      const recipient = repository.findRecipient(announcement.id, employee.id);
      return !recipient || (!recipient.isRead && !recipient.readAt);
    }).length;
}

function listRecipients(id, user, query = {}) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW_RECIPIENTS);
  if (!repository.findAnnouncement(id)) {
    return null;
  }
  const recipients = repository.listRecipients(id).map((recipient) => {
    const employee = repository.findEmployee(recipient.employeeId);
    return {
      id: recipient.id,
      announcementId: recipient.announcementId,
      employeeId: recipient.employeeId,
      employeeName: getEmployeeName(employee),
      departmentId: employee?.departmentId || employee?.department_id || null,
      deliveredAt: recipient.deliveredAt,
      readAt: recipient.readAt,
      isRead: Boolean(recipient.isRead),
      createdAt: recipient.createdAt,
    };
  });
  const status = query.status ? String(query.status).toLowerCase() : null;
  return status === "read"
    ? recipients.filter((recipient) => recipient.isRead)
    : status === "unread"
      ? recipients.filter((recipient) => !recipient.isRead)
      : recipients;
}

function getAnalytics(id, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS);
  if (!repository.findAnnouncement(id)) {
    return null;
  }
  return buildAnalytics(id);
}

function getAuditLogs(id, user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW);
  if (!repository.findAnnouncement(id)) {
    return null;
  }
  return [...repository.listHistory(id), ...repository.listAuditLogs(id)];
}

function getDashboard(user) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS);
  expireDueAnnouncements();
  const announcements = repository.listAllAnnouncements({});
  return {
    totalAnnouncements: announcements.length,
    drafts: announcements.filter((announcement) => announcement.status === ANNOUNCEMENT_STATUS.DRAFT).length,
    scheduled: announcements.filter((announcement) => announcement.status === ANNOUNCEMENT_STATUS.SCHEDULED).length,
    published: announcements.filter((announcement) => announcement.status === ANNOUNCEMENT_STATUS.PUBLISHED).length,
    archived: announcements.filter((announcement) => announcement.status === ANNOUNCEMENT_STATUS.ARCHIVED).length,
    expired: announcements.filter((announcement) => announcement.status === ANNOUNCEMENT_STATUS.EXPIRED).length,
    pinned: announcements.filter((announcement) => announcement.isPinned).length,
    totalRecipients: announcements.reduce((sum, announcement) => sum + repository.listRecipients(announcement.id).length, 0),
  };
}

function getReports(user, query = {}) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS);
  const result = listAdminAnnouncements(user, query);
  return {
    summary: getDashboard(user),
    announcements: result.data.map((announcement) => ({
      ...announcement,
      analytics: buildAnalytics(announcement.id),
    })),
    pagination: result.meta,
  };
}

function exportAnnouncements(user, query = {}) {
  assertPermission(user, ANNOUNCEMENT_PERMISSIONS.VIEW_ANALYTICS);
  const result = listAdminAnnouncements(user, { ...query, limit: 100 });
  const header = ["announcementCode", "title", "category", "priority", "status", "isPinned", "recipients", "read", "unread"];
  const rows = result.data.map((announcement) => {
    const analytics = buildAnalytics(announcement.id);
    return [
      announcement.announcementCode,
      announcement.title,
      announcement.category,
      announcement.priority,
      announcement.status,
      announcement.isPinned ? "yes" : "no",
      analytics.recipients,
      analytics.read,
      analytics.unread,
    ];
  });
  return [header, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

module.exports = {
  archiveAnnouncement,
  createAnnouncement,
  createDraft,
  deleteAnnouncement,
  exportAnnouncements,
  getAdminDetails,
  getAnalytics,
  getAuditLogs,
  getDashboard,
  getEmployeeAnnouncement,
  getReports,
  getUnreadCount,
  listAdminAnnouncements,
  listEmployeeAnnouncements,
  listRecipients,
  markRead,
  publishAnnouncement,
  scheduleAnnouncement,
  setPin,
  updateAnnouncement,
};
