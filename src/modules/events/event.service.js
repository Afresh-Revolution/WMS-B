const { hasPermission } = require("../../constants/rbac");
const {
  ATTENDEE_STATUS,
  AUDIENCE_TYPE,
  EVENT_PERMISSIONS,
  EVENT_STATUS,
  EVENT_TYPE,
  SPONSORSHIP_TYPE,
} = require("./constants");
const repository = require("./event.repository");

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

function todayIso() {
  return new Date().toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeDateTime({ date, startDate, startTime, endDate, endTime, timezone }) {
  const startDateOnly = startDate || date;
  if (!startDateOnly) {
    throw createHttpError(400, "Event start date is required.", "EVENT_DATE_REQUIRED");
  }
  const startAt = `${startDateOnly}T${startTime || "00:00"}:00.000Z`;
  const endDateOnly = endDate || startDateOnly;
  const endAt = `${endDateOnly}T${endTime || "23:59"}:00.000Z`;
  if (Number.isNaN(new Date(startAt).getTime()) || Number.isNaN(new Date(endAt).getTime())) {
    throw createHttpError(400, "Event date/time is invalid.", "INVALID_EVENT_DATE");
  }
  if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
    throw createHttpError(400, "Event end date/time cannot be before start date/time.", "INVALID_EVENT_RANGE");
  }
  return {
    date: startDateOnly,
    startDate: startAt,
    start_date: startAt,
    startTime: startTime || null,
    start_time: startTime || null,
    endDate: endAt,
    end_date: endAt,
    endTime: endTime || null,
    end_time: endTime || null,
    timezone: timezone || "UTC",
  };
}

function buildEventCode() {
  const count = repository.listAllEvents({ limit: 1 }).length + 1;
  return `EVT-${String(count).padStart(4, "0")}`;
}

function recordHistory({ eventId, actor, action, oldStatus, newStatus, comment, metadata }) {
  return repository.createHistory({
    eventId,
    actorId: actor?.id || null,
    action,
    oldStatus: oldStatus || null,
    newStatus: newStatus || null,
    comment: comment || null,
    metadata: metadata || {},
  });
}

function getEmployeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || null;
}

function normalizeAudiencePayload(payload = {}) {
  const targetAudienceType = normalizeEnum(
    payload.targetAudienceType || payload.target_audience_type || payload.audienceType || payload.audience_type,
    Object.values(AUDIENCE_TYPE),
    AUDIENCE_TYPE.ALL_STAFF
  );
  const entries = Array.isArray(payload.audience) ? payload.audience : Array.isArray(payload.audiences) ? payload.audiences : [];
  if (entries.length) {
    return entries.map((entry) => ({
      audienceType: normalizeEnum(entry.audienceType || entry.audience_type || targetAudienceType, Object.values(AUDIENCE_TYPE), targetAudienceType),
      departmentId: entry.departmentId || entry.department_id || null,
      userId: entry.userId || entry.user_id || null,
      roleId: entry.roleId || entry.role_id || entry.role || null,
      locationId: entry.locationId || entry.location_id || entry.location || null,
      departmentName: entry.departmentName || entry.department_name || null,
    }));
  }
  const ids = payload.departmentIds || payload.department_ids || payload.userIds || payload.user_ids || payload.roleIds || payload.role_ids || [];
  if (Array.isArray(ids) && ids.length) {
    return ids.map((id) => ({
      audienceType: targetAudienceType,
      departmentId: targetAudienceType === AUDIENCE_TYPE.SPECIFIC_DEPARTMENT ? id : null,
      userId: targetAudienceType === AUDIENCE_TYPE.SPECIFIC_STAFF ? id : null,
      roleId: targetAudienceType === AUDIENCE_TYPE.SPECIFIC_ROLES ? id : null,
      locationId: targetAudienceType === AUDIENCE_TYPE.SPECIFIC_LOCATIONS ? id : null,
      departmentName: null,
    }));
  }
  return [{ audienceType: targetAudienceType, departmentId: payload.departmentId || payload.department_id || null, userId: payload.userId || payload.user_id || null, roleId: payload.roleId || payload.role_id || null, locationId: payload.locationId || payload.location_id || null, departmentName: null }];
}

function writeAudience(eventId, audiencePayloads) {
  repository.deleteAudiences(eventId);
  return audiencePayloads.map((audience) => {
    const department = audience.departmentId ? repository.findDepartment(audience.departmentId) : null;
    return repository.createAudience({
      eventId,
      audienceType: audience.audienceType,
      departmentId: audience.departmentId,
      departmentName: department?.name || audience.departmentName || null,
      userId: audience.userId,
      roleId: audience.roleId,
      locationId: audience.locationId,
    });
  });
}

function createEvent(payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.CREATE);
  if (!payload.title) {
    throw createHttpError(400, "Event title is required.", "EVENT_TITLE_REQUIRED");
  }
  const type = normalizeEnum(payload.type, Object.values(EVENT_TYPE), EVENT_TYPE.INTERNAL);
  const timing = normalizeDateTime({
    date: payload.date,
    startDate: payload.startDate || payload.start_date,
    startTime: payload.startTime || payload.start_time,
    endDate: payload.endDate || payload.end_date,
    endTime: payload.endTime || payload.end_time,
    timezone: payload.timezone,
  });
  const audience = normalizeAudiencePayload(payload);
  const event = repository.createEvent({
    eventCode: buildEventCode(),
    event_code: null,
    title: payload.title,
    type,
    description: payload.description || null,
    ...timing,
    location: payload.location || null,
    virtualLink: payload.virtualLink || payload.virtual_link || null,
    virtual_link: payload.virtualLink || payload.virtual_link || null,
    targetAudienceType: audience[0]?.audienceType || AUDIENCE_TYPE.ALL_STAFF,
    target_audience_type: audience[0]?.audienceType || AUDIENCE_TYPE.ALL_STAFF,
    status: payload.publish ? EVENT_STATUS.PUBLISHED : EVENT_STATUS.DRAFT,
    createdBy: user.id,
    publishedBy: null,
    publishedAt: null,
  });
  const audiences = writeAudience(event.id, audience);
  recordHistory({ eventId: event.id, actor: user, action: "CREATED", oldStatus: null, newStatus: event.status, metadata: { audiences: audiences.length } });
  return { record: { ...event, audiences } };
}

function resolveAudienceUsers(event) {
  const audiences = repository.listAudiences(event.id);
  const employees = repository.listEmployees();
  const users = repository.listUsers();
  const resolved = new Map();
  const addUser = (user, employee) => {
    if (!user || user.status === "deleted") {
      return;
    }
    resolved.set(user.id, {
      user,
      employee: employee || repository.findEmployeeByUserId(user.id),
    });
  };

  for (const audience of audiences.length ? audiences : [{ audienceType: event.targetAudienceType || AUDIENCE_TYPE.ALL_STAFF }]) {
    if ([AUDIENCE_TYPE.ALL_STAFF, AUDIENCE_TYPE.ALL_DEPARTMENTS].includes(audience.audienceType)) {
      for (const employee of employees) {
        addUser(repository.findUser(employee.userId || employee.user_id), employee);
      }
      continue;
    }
    if (audience.audienceType === AUDIENCE_TYPE.SPECIFIC_DEPARTMENT) {
      for (const employee of employees.filter((employee) => (employee.departmentId || employee.department_id) === audience.departmentId)) {
        addUser(repository.findUser(employee.userId || employee.user_id), employee);
      }
      continue;
    }
    if (audience.audienceType === AUDIENCE_TYPE.SPECIFIC_STAFF) {
      addUser(repository.findUser(audience.userId));
      continue;
    }
    if (audience.audienceType === AUDIENCE_TYPE.SPECIFIC_ROLES) {
      for (const user of users.filter((user) => user.role === audience.roleId)) {
        addUser(user);
      }
      continue;
    }
    if (audience.audienceType === AUDIENCE_TYPE.SPECIFIC_LOCATIONS) {
      for (const employee of employees.filter((employee) => employee.location === audience.locationId || employee.branch === audience.locationId)) {
        addUser(repository.findUser(employee.userId || employee.user_id), employee);
      }
    }
  }
  return [...resolved.values()];
}

function createEventNotifications(event, recipients) {
  return recipients.map(({ user, employee }) => {
    const notification = repository.createNotification({
      userId: user.id,
      recipientUserId: user.id,
      recipientEmployeeId: employee?.id || null,
      type: "EVENT",
      title: event.title,
      message: `${event.title} has been scheduled for ${event.date}.`,
      body: `${event.title} has been scheduled for ${event.date}.`,
      entityType: "EVENT",
      entityId: event.id,
      isRead: false,
      status: "queued",
      data: { eventId: event.id, eventCode: event.eventCode },
    });
    repository.createNotificationDelivery({
      notificationId: notification.id,
      channel: "IN_APP",
      status: "PENDING",
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      errorMessage: null,
    });
    return notification;
  });
}

function ensureAttendees(event, recipients) {
  return recipients.map(({ user, employee }) => {
    const existing = repository.findAttendee(event.id, user.id);
    if (existing) {
      return existing;
    }
    return repository.createAttendee({
      eventId: event.id,
      userId: user.id,
      attendeeType: "USER",
      attendee_type: "USER",
      attendeeId: user.id,
      attendee_id: user.id,
      employeeId: employee?.id || null,
      employeeName: getEmployeeName(employee),
      status: ATTENDEE_STATUS.INVITED,
      rsvpStatus: ATTENDEE_STATUS.INVITED,
      rsvp_status: ATTENDEE_STATUS.INVITED,
      attendanceStatus: null,
      invitedAt: todayIso(),
      invited_at: todayIso(),
      respondedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
    });
  });
}

function publishEvent(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.PUBLISH);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  if (![EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED].includes(event.status)) {
    throw createHttpError(409, "Only draft events can be published.", "EVENT_NOT_PUBLISHABLE");
  }
  if (!event.title || !event.startDate) {
    throw createHttpError(409, "Event title and date are required before publishing.", "EVENT_REQUIRED_FIELDS_MISSING");
  }
  if (new Date(event.endDate || event.startDate).getTime() < Date.now()) {
    throw createHttpError(409, "Past events cannot be published.", "EVENT_DATE_IN_PAST");
  }
  const recipients = resolveAudienceUsers(event);
  const attendees = ensureAttendees(event, recipients);
  const notifications = payload.notify === false ? [] : createEventNotifications(event, recipients);
  const updated = repository.updateEvent(id, {
    status: EVENT_STATUS.PUBLISHED,
    publishedBy: user.id,
    publishedAt: todayIso(),
  });
  recordHistory({ eventId: id, actor: user, action: "PUBLISHED", oldStatus: event.status, newStatus: updated.status, metadata: { notifiedUsers: notifications.length, attendees: attendees.length } });
  return { oldValues: event, record: updated, meta: { notifiedUsers: notifications.length, attendees: attendees.length } };
}

function listEvents(user, query = {}) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW);
  if (can(user, EVENT_PERMISSIONS.VIEW_ALL)) {
    return repository.listEvents(query);
  }
  const userId = user?.id;
  const eligibleEventIds = repository.listAllEvents({}).filter((event) => canAccessEvent(user, event)).map((event) => event.id);
  const result = repository.listEvents(query);
  result.data = result.data.filter((event) => eligibleEventIds.includes(event.id) || event.createdBy === userId);
  result.meta.total = result.data.length;
  result.meta.totalPages = Math.max(1, Math.ceil(result.data.length / result.meta.limit));
  return result;
}

function canAccessEvent(user, event) {
  if (can(user, EVENT_PERMISSIONS.VIEW_ALL) || event.createdBy === user?.id) {
    return true;
  }
  const attendee = repository.findAttendee(event.id, user?.id);
  if (attendee) {
    return true;
  }
  return resolveAudienceUsers(event).some(({ user: resolvedUser }) => resolvedUser.id === user?.id);
}

function assertEventAccess(user, event) {
  if (!canAccessEvent(user, event)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function getEventDetails(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW);
  const event = repository.findEvent(id);
  if (!event) {
    throw createHttpError(404, "Event was not found.", "EVENT_NOT_FOUND");
  }
  assertEventAccess(user, event);
  const attendees = repository.listAttendees(id);
  const sponsors = repository.listSponsors(id);
  const budget = repository.findBudget(id);
  const expenses = repository.listEventExpenses(id);
  return {
    ...event,
    organizer: event.createdBy ? repository.findUser(event.createdBy) : null,
    audiences: repository.listAudiences(id),
    attendees,
    rsvpStatistics: buildRsvpStats(attendees),
    attendanceStatistics: buildAttendanceStats(attendees),
    notifications: repository.listNotifications(id),
    notificationStatus: buildNotificationStatus(id),
    documents: repository.listDocuments(id),
    sponsors,
    budget: budget ? decorateBudget(budget, expenses) : null,
    expenses,
    history: repository.listHistory(id),
    changeHistory: repository.listChangeHistory(id),
  };
}

function buildRsvpStats(attendees) {
  return attendees.reduce((summary, attendee) => {
    const status = attendee.status || attendee.rsvpStatus || ATTENDEE_STATUS.INVITED;
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
}

function buildAttendanceStats(attendees) {
  const invited = attendees.length;
  const attended = attendees.filter((attendee) => attendee.status === ATTENDEE_STATUS.ATTENDED || attendee.checkedInAt).length;
  return {
    invited,
    attended,
    absent: Math.max(0, invited - attended),
    attendanceRate: invited ? Number(((attended / invited) * 100).toFixed(2)) : 0,
  };
}

function buildNotificationStatus(eventId) {
  const notifications = repository.listNotifications(eventId);
  return {
    total: notifications.length,
    queued: notifications.filter((notification) => notification.status === "queued").length,
  };
}

function updateEvent(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.UPDATE);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  if (![EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED].includes(event.status)) {
    throw createHttpError(409, "Only draft or published events can be updated.", "EVENT_LOCKED");
  }
  const sensitiveFields = ["date", "startDate", "start_date", "endDate", "end_date", "location", "virtualLink", "virtual_link", "targetAudienceType", "target_audience_type"];
  const changes = [];
  const timing = payload.date || payload.startDate || payload.start_date || payload.endDate || payload.end_date || payload.startTime || payload.start_time || payload.endTime || payload.end_time
    ? normalizeDateTime({
        date: payload.date || event.date,
        startDate: payload.startDate || payload.start_date || payload.date || String(event.startDate || "").slice(0, 10),
        startTime: payload.startTime || payload.start_time || event.startTime,
        endDate: payload.endDate || payload.end_date || payload.date || String(event.endDate || "").slice(0, 10),
        endTime: payload.endTime || payload.end_time || event.endTime,
        timezone: payload.timezone || event.timezone,
      })
    : {};
  const update = {
    title: payload.title ?? event.title,
    type: payload.type ? normalizeEnum(payload.type, Object.values(EVENT_TYPE), event.type) : event.type,
    description: payload.description ?? event.description,
    location: payload.location ?? event.location,
    virtualLink: payload.virtualLink || payload.virtual_link || event.virtualLink || null,
    virtual_link: payload.virtualLink || payload.virtual_link || event.virtualLink || null,
    ...timing,
  };
  for (const field of sensitiveFields) {
    if (payload[field] !== undefined && String(event[field] || "") !== String(payload[field] || "")) {
      changes.push({ field, oldValue: event[field] || null, newValue: payload[field], reason: payload.reason || null });
    }
  }
  const updated = repository.updateEvent(id, update);
  for (const change of changes) {
    repository.createChangeHistory({ eventId: id, changedBy: user.id, ...change });
  }
  recordHistory({ eventId: id, actor: user, action: changes.length ? "RESCHEDULED_OR_UPDATED" : "UPDATED", oldStatus: event.status, newStatus: updated.status, metadata: { changes } });
  if (event.status === EVENT_STATUS.PUBLISHED && changes.length) {
    createEventNotifications(updated, resolveAudienceUsers(updated));
  }
  return { oldValues: event, record: updated };
}

function rescheduleEvent(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.UPDATE);
  if (!payload.reason) {
    throw createHttpError(400, "Reschedule reason is required.", "RESCHEDULE_REASON_REQUIRED");
  }
  return updateEvent(id, payload, user);
}

function cancelEvent(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.CANCEL);
  if (!payload.reason) {
    throw createHttpError(400, "Cancellation reason is required.", "CANCELLATION_REASON_REQUIRED");
  }
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  if ([EVENT_STATUS.CANCELLED, EVENT_STATUS.ARCHIVED].includes(event.status)) {
    throw createHttpError(409, "Event is already cancelled or archived.", "EVENT_FINALIZED");
  }
  const updated = repository.updateEvent(id, {
    status: EVENT_STATUS.CANCELLED,
    cancelledBy: user.id,
    cancelledAt: todayIso(),
    cancellationReason: payload.reason,
  });
  createEventNotifications(updated, resolveAudienceUsers(event));
  recordHistory({ eventId: id, actor: user, action: "CANCELLED", oldStatus: event.status, newStatus: updated.status, comment: payload.reason });
  return { oldValues: event, record: updated };
}

function archiveEvent(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.DELETE);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  const updated = repository.updateEvent(id, { status: EVENT_STATUS.ARCHIVED, archivedBy: user.id, archivedAt: todayIso(), deletedAt: todayIso() });
  recordHistory({ eventId: id, actor: user, action: "ARCHIVED", oldStatus: event.status, newStatus: EVENT_STATUS.ARCHIVED });
  return { oldValues: event, record: updated };
}

function ensureInvitedAttendee(id, user) {
  const event = repository.findEvent(id);
  if (!event) {
    return { event: null, attendee: null };
  }
  assertEventAccess(user, event);
  let attendee = repository.findAttendee(id, user.id);
  if (!attendee) {
    const employee = repository.findEmployeeByUserId(user.id);
    attendee = repository.createAttendee({
      eventId: id,
      userId: user.id,
      attendeeType: "USER",
      attendee_type: "USER",
      attendeeId: user.id,
      attendee_id: user.id,
      employeeId: employee?.id || null,
      employeeName: getEmployeeName(employee),
      status: ATTENDEE_STATUS.INVITED,
      rsvpStatus: ATTENDEE_STATUS.INVITED,
      attendanceStatus: null,
      invitedAt: todayIso(),
    });
  }
  return { event, attendee };
}

function rsvpEvent(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW);
  const { event, attendee } = ensureInvitedAttendee(id, user);
  if (!event) {
    return null;
  }
  const status = normalizeEnum(payload.status, [ATTENDEE_STATUS.GOING, ATTENDEE_STATUS.MAYBE, ATTENDEE_STATUS.DECLINED], null);
  if (!status) {
    throw createHttpError(400, "RSVP status must be GOING, MAYBE, or DECLINED.", "INVALID_RSVP_STATUS");
  }
  const updated = repository.updateAttendee(attendee.id, {
    status,
    rsvpStatus: status,
    rsvp_status: status,
    respondedAt: todayIso(),
  });
  recordHistory({ eventId: id, actor: user, action: "RSVP", oldStatus: attendee.status, newStatus: updated.status });
  return updated;
}

function isEventActive(event) {
  const now = Date.now();
  return [EVENT_STATUS.PUBLISHED, EVENT_STATUS.ONGOING].includes(event.status) && new Date(event.startDate).getTime() <= now && new Date(event.endDate || event.startDate).getTime() >= now;
}

function checkInEvent(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.CHECKIN);
  const { event, attendee } = ensureInvitedAttendee(id, user);
  if (!event) {
    return null;
  }
  if (!isEventActive(event)) {
    throw createHttpError(409, "Event is not active for check-in.", "EVENT_NOT_ACTIVE");
  }
  const updated = repository.updateAttendee(attendee.id, {
    status: ATTENDEE_STATUS.ATTENDED,
    attendanceStatus: ATTENDEE_STATUS.ATTENDED,
    checkedInAt: todayIso(),
    checked_in_at: todayIso(),
  });
  recordHistory({ eventId: id, actor: user, action: "CHECKIN", oldStatus: attendee.status, newStatus: updated.status });
  return updated;
}

function checkOutEvent(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.CHECKIN);
  const { event, attendee } = ensureInvitedAttendee(id, user);
  if (!event) {
    return null;
  }
  const updated = repository.updateAttendee(attendee.id, { checkedOutAt: todayIso(), checked_out_at: todayIso() });
  recordHistory({ eventId: id, actor: user, action: "CHECKOUT", oldStatus: attendee.status, newStatus: updated.status });
  return updated;
}

function getAudience(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  assertEventAccess(user, event);
  return repository.listAudiences(id);
}

function updateAudience(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.MANAGE_AUDIENCE);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  const oldAudience = repository.listAudiences(id);
  const audiences = writeAudience(id, normalizeAudiencePayload(payload));
  recordHistory({ eventId: id, actor: user, action: "AUDIENCE_CHANGED", oldStatus: event.status, newStatus: event.status, metadata: { oldAudience, audiences } });
  return { oldValues: oldAudience, record: audiences };
}

function listAttendees(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  assertEventAccess(user, event);
  return repository.listAttendees(id);
}

function upsertBudget(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.MANAGE_BUDGET);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  const existing = repository.findBudget(id);
  const expenses = repository.listEventExpenses(id);
  const actualSpend = expenses.reduce((total, expense) => total + Number(expense.approvedAmount || expense.amount || 0), 0);
  const budgetPayload = {
    eventId: id,
    estimatedBudget: Number(payload.estimatedBudget || payload.estimated_budget || existing?.estimatedBudget || 0),
    approvedBudget: Number(payload.approvedBudget || payload.approved_budget || existing?.approvedBudget || 0),
    actualSpend,
    currency: payload.currency || existing?.currency || "NGN",
    approvedBy: payload.approvedBudget || payload.approved_budget ? user.id : existing?.approvedBy || null,
    approvedAt: payload.approvedBudget || payload.approved_budget ? todayIso() : existing?.approvedAt || null,
  };
  const record = existing ? repository.updateBudget(existing.id, budgetPayload) : repository.createBudget(budgetPayload);
  recordHistory({ eventId: id, actor: user, action: "BUDGET_UPDATED", oldStatus: event.status, newStatus: event.status, metadata: { budgetId: record.id } });
  return { oldValues: existing, record: decorateBudget(record, expenses) };
}

function decorateBudget(budget, expenses) {
  const actualSpend = expenses.reduce((total, expense) => total + Number(expense.approvedAmount || expense.amount || 0), 0);
  return {
    ...budget,
    actualSpend,
    remainingBudget: Number(budget.approvedBudget || 0) - actualSpend,
  };
}

function addSponsor(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.MANAGE_SPONSORS);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  let sponsor = payload.sponsorId || payload.sponsor_id ? repository.findSponsor(payload.sponsorId || payload.sponsor_id) : repository.findSponsorByEmail(payload.email);
  if (!sponsor) {
    if (!payload.name && !payload.company) {
      throw createHttpError(400, "Sponsor name or company is required.", "SPONSOR_REQUIRED");
    }
    sponsor = repository.createSponsor({
      name: payload.name || payload.company,
      company: payload.company || payload.name,
      email: payload.email || null,
      phone: payload.phone || null,
      website: payload.website || null,
      category: payload.category || null,
      status: payload.sponsorStatus || "ACTIVE",
    });
  }
  const sponsorshipType = normalizeEnum(payload.sponsorshipType || payload.sponsorship_type, Object.values(SPONSORSHIP_TYPE), SPONSORSHIP_TYPE.PARTNER);
  const eventSponsor = repository.createEventSponsor({
    eventId: id,
    sponsorId: sponsor.id,
    sponsorshipType,
    amount: Number(payload.amount || 0),
    currency: payload.currency || "NGN",
    status: payload.status || "PLEDGED",
    notes: payload.notes || null,
  });
  recordHistory({ eventId: id, actor: user, action: "SPONSOR_ADDED", oldStatus: event.status, newStatus: event.status, metadata: { sponsorId: sponsor.id, eventSponsorId: eventSponsor.id } });
  return { record: { ...eventSponsor, sponsor } };
}

function listSponsors(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  assertEventAccess(user, event);
  return repository.listSponsors(id).map((eventSponsor) => ({ ...eventSponsor, sponsor: repository.findSponsor(eventSponsor.sponsorId) }));
}

function addDocument(id, payload, user) {
  assertPermission(user, EVENT_PERMISSIONS.MANAGE_DOCUMENTS);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  if (!payload.fileName && !payload.name) {
    throw createHttpError(400, "Document file name is required.", "DOCUMENT_NAME_REQUIRED");
  }
  if (!payload.fileUrl && !payload.url) {
    throw createHttpError(400, "Document URL is required.", "DOCUMENT_URL_REQUIRED");
  }
  const document = repository.createDocument({
    eventId: id,
    documentType: payload.documentType || payload.document_type || "OTHER",
    fileName: payload.fileName || payload.name,
    fileUrl: payload.fileUrl || payload.url,
    uploadedBy: user.id,
  });
  recordHistory({ eventId: id, actor: user, action: "DOCUMENT_UPLOADED", oldStatus: event.status, newStatus: event.status, metadata: { documentId: document.id } });
  return document;
}

function listDocuments(id, user) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW);
  const event = repository.findEvent(id);
  if (!event) {
    return null;
  }
  assertEventAccess(user, event);
  return repository.listDocuments(id);
}

function getDashboard(user) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW_REPORTS);
  const events = can(user, EVENT_PERMISSIONS.VIEW_ALL) ? repository.listAllEvents({}) : repository.listAllEvents({}).filter((event) => canAccessEvent(user, event));
  const upcoming = events.filter((event) => !["CANCELLED", "COMPLETED", "ARCHIVED"].includes(event.status) && String(event.startDate || "") > todayIso());
  const attendees = events.flatMap((event) => repository.listAttendees(event.id));
  const attended = attendees.filter((attendee) => attendee.status === ATTENDEE_STATUS.ATTENDED).length;
  return {
    upcomingEvents: upcoming.length,
    totalEvents: events.length,
    publishedEvents: events.filter((event) => event.status === EVENT_STATUS.PUBLISHED).length,
    draftEvents: events.filter((event) => event.status === EVENT_STATUS.DRAFT).length,
    completedEvents: events.filter((event) => event.status === EVENT_STATUS.COMPLETED).length,
    cancelledEvents: events.filter((event) => event.status === EVENT_STATUS.CANCELLED).length,
    totalNotifiedStaff: attendees.length,
    attendanceRate: attendees.length ? Number(((attended / attendees.length) * 100).toFixed(2)) : 0,
    upcomingSponsorships: events.filter((event) => event.type === EVENT_TYPE.SPONSORSHIP && String(event.startDate || "") > todayIso()).length,
  };
}

function getReports(user, query = {}) {
  assertPermission(user, EVENT_PERMISSIONS.VIEW_REPORTS);
  const events = (can(user, EVENT_PERMISSIONS.VIEW_ALL) ? repository.listAllEvents(query) : repository.listAllEvents(query).filter((event) => canAccessEvent(user, event)));
  const groupCount = (key) => events.reduce((summary, event) => {
    const value = event[key] || "Unassigned";
    summary[value] = (summary[value] || 0) + 1;
    return summary;
  }, {});
  const attendees = events.flatMap((event) => repository.listAttendees(event.id));
  const sponsorContributions = events
    .flatMap((event) => repository.listSponsors(event.id))
    .reduce((total, sponsor) => total + Number(sponsor.amount || 0), 0);
  const eventExpenses = events
    .flatMap((event) => repository.listEventExpenses(event.id))
    .reduce((total, expense) => total + Number(expense.approvedAmount || expense.amount || 0), 0);
  return {
    totalEvents: events.length,
    eventsByType: groupCount("type"),
    eventsByStatus: groupCount("status"),
    attendance: buildAttendanceStats(attendees),
    rsvpRate: attendees.length ? Number(((attendees.filter((attendee) => attendee.respondedAt).length / attendees.length) * 100).toFixed(2)) : 0,
    absenceRate: attendees.length ? Number(((attendees.filter((attendee) => attendee.status === ATTENDEE_STATUS.ABSENT).length / attendees.length) * 100).toFixed(2)) : 0,
    notificationDeliveryRate: 0,
    eventExpenses,
    sponsorContributions,
    eventCost: eventExpenses - sponsorContributions,
    upcomingEvents: events.filter((event) => String(event.startDate || "") > todayIso()).length,
    completedEvents: events.filter((event) => event.status === EVENT_STATUS.COMPLETED).length,
  };
}

function getEventReport(id, user) {
  const details = getEventDetails(id, user);
  return {
    event: details,
    rsvpStatistics: details.rsvpStatistics,
    attendanceStatistics: details.attendanceStatistics,
    notificationStatus: details.notificationStatus,
    sponsorContributions: details.sponsors.reduce((total, sponsor) => total + Number(sponsor.amount || 0), 0),
    eventExpenses: details.expenses.reduce((total, expense) => total + Number(expense.approvedAmount || expense.amount || 0), 0),
  };
}

function exportEvents(user, query = {}) {
  assertPermission(user, EVENT_PERMISSIONS.EXPORT);
  const events = (can(user, EVENT_PERMISSIONS.VIEW_ALL) ? repository.listAllEvents(query) : repository.listAllEvents(query).filter((event) => canAccessEvent(user, event)));
  const headers = ["eventCode", "title", "type", "date", "location", "status", "targetAudienceType"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...events.map((event) => headers.map((header) => escape(event[header])).join(","))].join("\n");
}

module.exports = {
  addDocument,
  addSponsor,
  archiveEvent,
  cancelEvent,
  checkInEvent,
  checkOutEvent,
  createEvent,
  exportEvents,
  getAudience,
  getDashboard,
  getEventDetails,
  getEventReport,
  getReports,
  listAttendees,
  listDocuments,
  listEvents,
  listSponsors,
  publishEvent,
  rescheduleEvent,
  rsvpEvent,
  updateAudience,
  updateEvent,
  upsertBudget,
};
