const { hasPermission } = require("../../constants/rbac");
const { paginate } = require("../../utils/query");
const { queueNotification } = require("../_shared/notificationService");
const {
  ATTENDANCE_STATUS,
  DEFAULT_REMINDERS,
  INVITATION_STATUS,
  MEETING_PERMISSIONS,
  MEETING_STATUS,
  MEETING_VISIBILITY,
  PARTICIPANT_ROLE,
  RESPONSE_STATUS,
} = require("./constants");
const { buildSchedule, overlaps } = require("./meeting-scheduling.service");
const repository = require("./meeting.repository");

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function normalizeStatus(value) {
  return String(value || "").toUpperCase();
}

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function assertPermission(user, permission) {
  if (!can(user, permission)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function assertTitle(title) {
  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 160) {
    throw createHttpError(400, "Meeting title must be between 3 and 160 characters.", "INVALID_MEETING_TITLE");
  }
}

function assertActiveUser(userId, label = "User") {
  const user = repository.findUser(userId);
  if (!user) {
    throw createHttpError(404, `${label} was not found.`, "USER_NOT_FOUND");
  }

  if (String(user.status || "active").toLowerCase() !== "active") {
    throw createHttpError(403, `${label} is not active.`, "USER_INACTIVE");
  }

  return user;
}

function getUserName(user) {
  return user?.name || user?.email || null;
}

function getDepartmentName(department) {
  return department?.name || department?.title || null;
}

function validateMeetingTypeRequirements(meetingType, payload) {
  const hasLocation = Boolean(payload.location || payload.meetingRoomId || payload.meeting_room_id);
  const hasVirtualLink = Boolean(payload.virtualLink || payload.virtual_link || payload.meetingLink || payload.meeting_link);

  if (meetingType.requiresLocation && !hasLocation) {
    throw createHttpError(400, "This meeting type requires a location or meeting room.", "MEETING_LOCATION_REQUIRED");
  }

  if (meetingType.requiresVirtualLink && !hasVirtualLink) {
    throw createHttpError(400, "Virtual meetings require a meeting link.", "MEETING_LINK_REQUIRED");
  }
}

function getMeetingTypeOrThrow(id) {
  const meetingType = repository.findMeetingType(id);
  if (!meetingType) {
    throw createHttpError(404, "Meeting type was not found.", "MEETING_TYPE_NOT_FOUND");
  }

  if (String(meetingType.status || "active").toLowerCase() !== "active") {
    throw createHttpError(400, "Meeting type is not active.", "MEETING_TYPE_INACTIVE");
  }

  return meetingType;
}

function getMeetingOrThrow(id) {
  const meeting = repository.findMeeting(id);
  if (!meeting) {
    throw createHttpError(404, "Meeting was not found.", "MEETING_NOT_FOUND");
  }
  return meeting;
}

function canAccessMeeting(meeting, user) {
  if (can(user, MEETING_PERMISSIONS.VIEW_ALL)) {
    return true;
  }

  if (meeting.organizerId === user?.id || meeting.createdBy === user?.id) {
    return true;
  }

  return repository.listParticipants(meeting.id).some((participant) => participant.userId === user?.id);
}

function assertCanManageMeeting(meeting, user, permission) {
  if (can(user, permission) || meeting.organizerId === user?.id) {
    return;
  }

  throw createHttpError(403, "Forbidden.", "FORBIDDEN");
}

function resolveDepartment(departmentId) {
  if (!departmentId) {
    return null;
  }

  const department = repository.findDepartment(departmentId);
  if (!department) {
    throw createHttpError(404, "Department was not found.", "DEPARTMENT_NOT_FOUND");
  }
  return department;
}

function resolveParticipantIds(payload = {}) {
  const ids = new Set();
  for (const id of payload.participantIds || payload.participant_ids || []) {
    if (id) {
      ids.add(id);
    }
  }

  const participantDepartmentId = payload.participantDepartmentId || payload.participant_department_id;
  if (participantDepartmentId) {
    for (const employee of repository.listEmployees()) {
      const employeeDepartmentId = employee.departmentId || employee.department_id;
      if (
        employeeDepartmentId === participantDepartmentId &&
        (employee.userId || employee.user_id) &&
        String(employee.status || "active").toLowerCase() === "active"
      ) {
        ids.add(employee.userId || employee.user_id);
      }
    }
  }

  return [...ids];
}

function validateParticipants(participantIds) {
  return participantIds.map((userId) => assertActiveUser(userId, "Participant"));
}

function getConflictingMeetings({ startAt, endAt, organizerId, meetingRoomId, participantIds = [], ignoreMeetingId }) {
  const start = startAt;
  const end = endAt;
  const activeStatuses = repository.activeMeetingStatuses();
  const meetings = repository.listAllMeetings({}).filter((meeting) => {
    if (meeting.id === ignoreMeetingId || !activeStatuses.includes(normalizeStatus(meeting.status))) {
      return false;
    }
    return overlaps(start, end, meeting.startAt, meeting.endAt);
  });

  const organizerConflict = meetings.find((meeting) => meeting.organizerId === organizerId);
  if (organizerConflict) {
    throw createHttpError(409, "Organizer already has a meeting during this period.", "ORGANIZER_MEETING_CONFLICT");
  }

  if (meetingRoomId) {
    const roomConflict = meetings.find((meeting) => meeting.meetingRoomId === meetingRoomId);
    if (roomConflict) {
      throw createHttpError(409, "Meeting room is already booked during this period.", "MEETING_ROOM_CONFLICT");
    }
  }

  const warnings = [];
  const participantSet = new Set(participantIds);
  for (const meeting of meetings) {
    const conflictParticipants = repository
      .listParticipants(meeting.id)
      .filter((participant) => participantSet.has(participant.userId))
      .map((participant) => participant.userId);
    for (const userId of conflictParticipants) {
      warnings.push({ userId, meetingId: meeting.id, message: "Participant has another meeting during this period." });
    }
  }

  return warnings;
}

function createMeetingAgenda(meetingId, agendaInput, actor) {
  if (!agendaInput) {
    return [];
  }

  const agendaItems = Array.isArray(agendaInput)
    ? agendaInput
    : [{ title: "Agenda", description: String(agendaInput), orderNumber: 1 }];

  return agendaItems.map((item, index) =>
    repository.createAgenda({
      meetingId,
      title: item.title || `Agenda ${index + 1}`,
      description: item.description || item.content || null,
      orderNumber: Number(item.orderNumber || item.order_number || index + 1),
      durationMinutes: Number(item.durationMinutes || item.duration_minutes || 0),
      presenterId: item.presenterId || item.presenter_id || null,
      createdBy: actor?.id || null,
    })
  );
}

function addMeetingParticipants({ meeting, participantUsers, actor }) {
  const created = [];
  const seen = new Set(repository.listParticipants(meeting.id).map((participant) => participant.userId));

  function add(user, role) {
    if (!user || seen.has(user.id)) {
      return;
    }

    seen.add(user.id);
    created.push(
      repository.createParticipant({
        meetingId: meeting.id,
        userId: user.id,
        userName: getUserName(user),
        participantRole: role,
        invitationStatus: role === PARTICIPANT_ROLE.ORGANIZER ? INVITATION_STATUS.ACCEPTED : INVITATION_STATUS.INVITED,
        responseStatus: role === PARTICIPANT_ROLE.ORGANIZER ? RESPONSE_STATUS.ACCEPTED : RESPONSE_STATUS.PENDING,
        joinedAt: null,
        leftAt: null,
        createdBy: actor?.id || null,
      })
    );
  }

  add(assertActiveUser(meeting.organizerId, "Organizer"), PARTICIPANT_ROLE.ORGANIZER);
  for (const user of participantUsers) {
    add(user, PARTICIPANT_ROLE.PARTICIPANT);
  }

  return created;
}

function createMeetingReminders(meeting, participantIds, reminderInput) {
  const reminderMinutes = Array.isArray(reminderInput)
    ? reminderInput.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : [...DEFAULT_REMINDERS];
  const recipients = [...new Set([meeting.organizerId, ...participantIds].filter(Boolean))];
  const reminders = [];

  for (const userId of recipients) {
    for (const minutesBefore of reminderMinutes) {
      reminders.push(
        repository.createReminder({
          meetingId: meeting.id,
          userId,
          minutesBefore,
          channel: "IN_APP",
          status: "PENDING",
          sentAt: null,
        })
      );
    }
  }

  return reminders;
}

function recordHistory({ meetingId, actor, action, oldValues, newValues }) {
  return repository.createHistory({
    meetingId,
    actorId: actor?.id || null,
    action,
    oldValues: oldValues || null,
    newValues: newValues || null,
  });
}

function notifyParticipants(meeting, type, title, body) {
  const participants = repository.listParticipants(meeting.id);
  for (const participant of participants) {
    queueNotification({
      recipientUserId: participant.userId,
      type,
      title,
      body,
      data: { meetingId: meeting.id },
    });
  }
}

function createMeeting(payload, user) {
  assertPermission(user, MEETING_PERMISSIONS.CREATE);
  assertTitle(payload.title);

  const meetingType = getMeetingTypeOrThrow(payload.meetingTypeId || payload.meeting_type_id);
  validateMeetingTypeRequirements(meetingType, payload);

  const schedule = buildSchedule(payload);
  const organizerId = payload.organizerId && user.role === "superadmin" ? payload.organizerId : user.id;
  const organizer = assertActiveUser(organizerId, "Organizer");
  const department = resolveDepartment(payload.departmentId || payload.department_id);
  const meetingRoomId = payload.meetingRoomId || payload.meeting_room_id || null;
  const room = meetingRoomId ? repository.findMeetingRoom(meetingRoomId) : null;
  if (meetingRoomId && (!room || String(room.status || "active").toLowerCase() !== "active")) {
    throw createHttpError(404, "Meeting room was not found or is inactive.", "MEETING_ROOM_NOT_FOUND");
  }

  const participantIds = resolveParticipantIds(payload).filter((participantId) => participantId !== organizerId);
  const participantUsers = validateParticipants(participantIds);
  const warnings = getConflictingMeetings({
    ...schedule,
    organizerId,
    meetingRoomId,
    participantIds,
  });

  const visibility = normalizeStatus(payload.visibility || (department ? MEETING_VISIBILITY.DEPARTMENT : MEETING_VISIBILITY.PRIVATE));
  const meeting = repository.createMeeting({
    title: payload.title.trim(),
    description: payload.description || null,
    date: schedule.date,
    startDate: schedule.date,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    durationMinutes: schedule.durationMinutes,
    meetingTypeId: meetingType.id,
    meetingTypeName: meetingType.name,
    meetingTypeCode: meetingType.code,
    meetingRoomId,
    meetingRoomName: room?.name || null,
    location: payload.location || room?.location || room?.name || null,
    virtualLink: payload.virtualLink || payload.virtual_link || payload.meetingLink || payload.meeting_link || null,
    meetingLink: payload.virtualLink || payload.virtual_link || payload.meetingLink || payload.meeting_link || null,
    organizerId,
    organizerName: getUserName(organizer),
    departmentId: department?.id || null,
    departmentName: getDepartmentName(department),
    status: MEETING_STATUS.SCHEDULED,
    visibility: Object.values(MEETING_VISIBILITY).includes(visibility) ? visibility : MEETING_VISIBILITY.PRIVATE,
    createdBy: user.id,
    attendees: [organizerId, ...participantIds],
  });

  const participants = addMeetingParticipants({ meeting, participantUsers, actor: user });
  const agenda = createMeetingAgenda(meeting.id, payload.agendaItems || payload.agenda, user);
  const reminders = createMeetingReminders(meeting, participants.map((participant) => participant.userId), payload.reminders);
  recordHistory({ meetingId: meeting.id, actor: user, action: "CREATED", oldValues: null, newValues: meeting });
  notifyParticipants(meeting, "meeting_created", "Meeting invitation", `${meeting.title} has been scheduled.`);

  return { record: { ...meeting, participants, agenda, reminders }, warnings };
}

function listMeetings(user, query = {}) {
  assertPermission(user, MEETING_PERMISSIONS.VIEW);
  if (can(user, MEETING_PERMISSIONS.VIEW_ALL)) {
    return repository.listMeetings(query);
  }

  const all = repository.listAllMeetings(query).filter((meeting) => canAccessMeeting(meeting, user));
  return paginate(all, query);
}

function getMeetingDetails(id, user) {
  const meeting = getMeetingOrThrow(id);
  if (!canAccessMeeting(meeting, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }

  return {
    ...meeting,
    organizer: meeting.organizerId ? repository.findUser(meeting.organizerId) : null,
    department: meeting.departmentId ? repository.findDepartment(meeting.departmentId) : null,
    participants: repository.listParticipants(id),
    agenda: repository.listAgenda(id),
    minutes: repository.listMinutes(id),
    actionItems: repository.listActionItems(id),
    attendance: repository.listAttendance(id),
    reminders: repository.listReminders(id),
    history: repository.listMeetingHistory(id),
  };
}

function updateMeeting(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.UPDATE);
  const oldValues = meeting;

  const updates = {};
  if (payload.title !== undefined) {
    assertTitle(payload.title);
    updates.title = payload.title.trim();
  }

  if (payload.description !== undefined) {
    updates.description = payload.description;
  }

  const hasScheduleChange = payload.startAt || payload.start_at || payload.endAt || payload.end_at || payload.date || payload.startTime || payload.endTime;
  if (hasScheduleChange) {
    const schedule = buildSchedule({
      date: payload.date || meeting.date,
      startTime: payload.startTime || payload.start_time || meeting.startTime,
      endTime: payload.endTime || payload.end_time || meeting.endTime,
      startAt: payload.startAt || payload.start_at,
      endAt: payload.endAt || payload.end_at,
      durationMinutes: payload.durationMinutes || payload.duration_minutes || meeting.durationMinutes,
    });
    getConflictingMeetings({
      ...schedule,
      organizerId: meeting.organizerId,
      meetingRoomId: payload.meetingRoomId || payload.meeting_room_id || meeting.meetingRoomId,
      participantIds: repository.listParticipants(id).map((participant) => participant.userId),
      ignoreMeetingId: id,
    });
    Object.assign(updates, {
      date: schedule.date,
      startDate: schedule.date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      startAt: schedule.startAt,
      endAt: schedule.endAt,
      durationMinutes: schedule.durationMinutes,
    });
  }

  if (payload.meetingTypeId || payload.meeting_type_id) {
    const meetingType = getMeetingTypeOrThrow(payload.meetingTypeId || payload.meeting_type_id);
    validateMeetingTypeRequirements(meetingType, { ...meeting, ...payload });
    updates.meetingTypeId = meetingType.id;
    updates.meetingTypeName = meetingType.name;
    updates.meetingTypeCode = meetingType.code;
  }

  if (payload.departmentId !== undefined || payload.department_id !== undefined) {
    const department = resolveDepartment(payload.departmentId || payload.department_id);
    updates.departmentId = department?.id || null;
    updates.departmentName = getDepartmentName(department);
  }

  for (const [source, target] of [
    ["location", "location"],
    ["virtualLink", "virtualLink"],
    ["virtual_link", "virtualLink"],
    ["meetingRoomId", "meetingRoomId"],
    ["meeting_room_id", "meetingRoomId"],
    ["visibility", "visibility"],
  ]) {
    if (payload[source] !== undefined) {
      updates[target] = target === "visibility" ? normalizeStatus(payload[source]) : payload[source];
    }
  }

  if (updates.virtualLink) {
    updates.meetingLink = updates.virtualLink;
  }

  const updated = repository.updateMeeting(id, updates);
  recordHistory({ meetingId: id, actor: user, action: "UPDATED", oldValues, newValues: updated });
  notifyParticipants(updated, "meeting_updated", "Meeting updated", `${updated.title} has been updated.`);
  return { oldValues, record: updated };
}

function cancelMeeting(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.CANCEL);
  const oldValues = meeting;
  const updated = repository.updateMeeting(id, {
    status: MEETING_STATUS.CANCELLED,
    cancelledAt: new Date().toISOString(),
    cancelledBy: user.id,
    cancellationReason: payload.reason || payload.cancellationReason || null,
  });
  recordHistory({ meetingId: id, actor: user, action: "CANCELLED", oldValues, newValues: updated });
  notifyParticipants(updated, "meeting_cancelled", "Meeting cancelled", `${updated.title} has been cancelled.`);
  return { oldValues, record: updated };
}

function postponeMeeting(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.POSTPONE);
  const schedule = buildSchedule({
    startAt: payload.startAt || payload.start_at,
    endAt: payload.endAt || payload.end_at,
    durationMinutes: payload.durationMinutes || payload.duration_minutes || meeting.durationMinutes,
  });
  getConflictingMeetings({
    ...schedule,
    organizerId: meeting.organizerId,
    meetingRoomId: meeting.meetingRoomId,
    participantIds: repository.listParticipants(id).map((participant) => participant.userId),
    ignoreMeetingId: id,
  });

  const oldValues = meeting;
  const updated = repository.updateMeeting(id, {
    ...schedule,
    startDate: schedule.date,
    status: MEETING_STATUS.SCHEDULED,
    postponedAt: new Date().toISOString(),
    postponedBy: user.id,
    postponementReason: payload.reason || null,
  });
  recordHistory({ meetingId: id, actor: user, action: "POSTPONED", oldValues, newValues: updated });
  notifyParticipants(updated, "meeting_postponed", "Meeting postponed", `${updated.title} has been moved.`);
  return { oldValues, record: updated };
}

function setMeetingStatus(id, status, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.UPDATE);
  const oldValues = meeting;
  const updated = repository.updateMeeting(id, {
    status,
    ...(status === MEETING_STATUS.ONGOING ? { startedAt: new Date().toISOString() } : {}),
    ...(status === MEETING_STATUS.COMPLETED ? { completedAt: new Date().toISOString() } : {}),
  });
  recordHistory({ meetingId: id, actor: user, action: status === MEETING_STATUS.COMPLETED ? "COMPLETED" : "STARTED", oldValues, newValues: updated });
  return { oldValues, record: updated };
}

function addParticipants(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_PARTICIPANTS);
  const participantIds = resolveParticipantIds(payload).filter((participantId) => participantId !== meeting.organizerId);
  const participantUsers = validateParticipants(participantIds);
  const created = addMeetingParticipants({ meeting, participantUsers, actor: user });
  const updated = repository.updateMeeting(id, {
    attendees: [...new Set([...(meeting.attendees || []), ...created.map((participant) => participant.userId)])],
  });
  recordHistory({ meetingId: id, actor: user, action: "PARTICIPANT_ADDED", oldValues: meeting, newValues: created });
  notifyParticipants(updated, "meeting_participants_added", "Meeting invitation", `${updated.title} invitation updated.`);
  return { oldValues: meeting, record: created };
}

function removeParticipant(id, userId, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_PARTICIPANTS);
  const participant = repository.findParticipant(id, userId);
  if (!participant) {
    return null;
  }
  const removed = repository.removeParticipant(participant.id, user.id);
  repository.updateMeeting(id, { attendees: (meeting.attendees || []).filter((attendeeId) => attendeeId !== userId) });
  recordHistory({ meetingId: id, actor: user, action: "PARTICIPANT_REMOVED", oldValues: participant, newValues: removed });
  return { oldValues: participant, record: removed };
}

function respondToInvitation(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  if (!canAccessMeeting(meeting, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  const participant = repository.findParticipant(id, user.id);
  if (!participant) {
    throw createHttpError(404, "Participant was not found.", "PARTICIPANT_NOT_FOUND");
  }

  const responseStatus = normalizeStatus(payload.responseStatus || payload.status);
  if (![RESPONSE_STATUS.ACCEPTED, RESPONSE_STATUS.DECLINED, RESPONSE_STATUS.TENTATIVE].includes(responseStatus)) {
    throw createHttpError(400, "Invitation response must be ACCEPTED, DECLINED, or TENTATIVE.", "INVALID_INVITATION_RESPONSE");
  }
  const updated = repository.updateParticipant(participant.id, {
    responseStatus,
    invitationStatus: responseStatus,
    respondedAt: new Date().toISOString(),
  });
  return { oldValues: participant, record: updated };
}

function addAgenda(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_AGENDA);
  const agenda = createMeetingAgenda(id, Array.isArray(payload) ? payload : [payload], user);
  recordHistory({ meetingId: id, actor: user, action: "AGENDA_CREATED", oldValues: null, newValues: agenda });
  return agenda;
}

function updateAgenda(id, agendaId, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_AGENDA);
  const oldValues = repository.findAgenda(agendaId);
  if (!oldValues || oldValues.meetingId !== id) {
    return null;
  }
  const updated = repository.updateAgenda(agendaId, {
    title: payload.title,
    description: payload.description,
    orderNumber: payload.orderNumber || payload.order_number,
    durationMinutes: payload.durationMinutes || payload.duration_minutes,
    presenterId: payload.presenterId || payload.presenter_id,
  });
  recordHistory({ meetingId: id, actor: user, action: "AGENDA_UPDATED", oldValues, newValues: updated });
  return { oldValues, record: updated };
}

function removeAgenda(id, agendaId, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_AGENDA);
  const oldValues = repository.findAgenda(agendaId);
  if (!oldValues || oldValues.meetingId !== id) {
    return null;
  }
  const removed = repository.removeAgenda(agendaId, user.id);
  recordHistory({ meetingId: id, actor: user, action: "AGENDA_UPDATED", oldValues, newValues: removed });
  return { oldValues, record: removed };
}

function upsertMinutes(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_MINUTES);
  if (!payload.content) {
    throw createHttpError(400, "Meeting minutes content is required.", "MINUTES_CONTENT_REQUIRED");
  }

  const existing = repository.listMinutes(id)[0] || null;
  const record = existing
    ? repository.updateMinutes(existing.id, { content: payload.content, updatedBy: user.id })
    : repository.createMinutes({ meetingId: id, content: payload.content, createdBy: user.id });
  recordHistory({ meetingId: id, actor: user, action: "MINUTES_UPDATED", oldValues: existing, newValues: record });
  return { oldValues: existing, record };
}

function createActionItem(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_ACTION_ITEMS);
  if (!payload.title) {
    throw createHttpError(400, "Action item title is required.", "ACTION_ITEM_TITLE_REQUIRED");
  }

  let taskId = payload.taskId || payload.task_id || null;
  if (!taskId && payload.createTask !== false) {
    const task = repository.createTask({
      title: payload.title,
      description: payload.description || null,
      assignedBy: user.id,
      assignedTo: payload.assignedTo || payload.assigned_to || null,
      departmentId: meeting.departmentId,
      meetingId: id,
      priority: payload.priority || "normal",
      status: "pending",
      dueDate: payload.dueDate || payload.due_date || null,
      progress: 0,
    });
    taskId = task.id;
  }

  const actionItem = repository.createActionItem({
    meetingId: id,
    taskId,
    title: payload.title,
    description: payload.description || null,
    assignedTo: payload.assignedTo || payload.assigned_to || null,
    dueDate: payload.dueDate || payload.due_date || null,
    status: payload.status || "pending",
    createdBy: user.id,
  });
  recordHistory({ meetingId: id, actor: user, action: "ACTION_ITEM_CREATED", oldValues: null, newValues: actionItem });
  return actionItem;
}

function upsertAttendance(id, payload, user) {
  const meeting = getMeetingOrThrow(id);
  assertCanManageMeeting(meeting, user, MEETING_PERMISSIONS.MANAGE_ATTENDANCE);
  const rows = Array.isArray(payload.records) ? payload.records : [payload];
  const updated = rows.map((row) => {
    const userId = row.userId || row.user_id;
    assertActiveUser(userId, "Attendance user");
    const status = normalizeStatus(row.status || ATTENDANCE_STATUS.PRESENT);
    if (!Object.values(ATTENDANCE_STATUS).includes(status)) {
      throw createHttpError(400, "Attendance status is invalid.", "INVALID_ATTENDANCE_STATUS");
    }
    const existing = repository.findAttendance(id, userId);
    const values = {
      meetingId: id,
      userId,
      status,
      joinedAt: row.joinedAt || row.joined_at || null,
      leftAt: row.leftAt || row.left_at || null,
      attendanceMinutes: Number(row.attendanceMinutes || row.attendance_minutes || 0),
      notes: row.notes || null,
      updatedBy: user.id,
    };
    return existing ? repository.updateAttendance(existing.id, values) : repository.createAttendance(values);
  });
  recordHistory({ meetingId: id, actor: user, action: "ATTENDANCE_UPDATED", oldValues: null, newValues: updated });
  return updated;
}

function getCalendar(user, query = {}) {
  const result = listMeetings(user, {
    ...query,
    dateFrom: query.start || query.dateFrom || query.date_from,
    dateTo: query.end || query.dateTo || query.date_to,
    limit: query.limit || 100,
  });
  return result.data.map((meeting) => ({
    id: meeting.id,
    title: meeting.title,
    startAt: meeting.startAt,
    endAt: meeting.endAt,
    status: meeting.status,
    departmentId: meeting.departmentId,
    organizerId: meeting.organizerId,
  }));
}

function getHistory(user, query = {}) {
  assertPermission(user, MEETING_PERMISSIONS.VIEW);
  if (can(user, MEETING_PERMISSIONS.VIEW_ALL)) {
    return repository.listHistory(query);
  }

  const visibleMeetingIds = new Set(repository.listAllMeetings({}).filter((meeting) => canAccessMeeting(meeting, user)).map((meeting) => meeting.id));
  const history = repository.listHistory({ ...query, limit: 100 }).data.filter((item) => visibleMeetingIds.has(item.meetingId));
  return paginate(history, query);
}

function getReports(user, query = {}) {
  assertPermission(user, MEETING_PERMISSIONS.VIEW_REPORTS);
  const meetings = repository.listAllMeetings(query);
  const attendance = meetings.flatMap((meeting) => repository.listAttendance(meeting.id));
  const actionItems = meetings.flatMap((meeting) => repository.listActionItems(meeting.id));
  const completed = meetings.filter((meeting) => normalizeStatus(meeting.status) === MEETING_STATUS.COMPLETED);
  const byStatus = meetings.reduce((summary, meeting) => {
    const status = normalizeStatus(meeting.status);
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});

  return {
    totalMeetings: meetings.length,
    completedMeetings: completed.length,
    cancelledMeetings: byStatus[MEETING_STATUS.CANCELLED] || 0,
    postponedMeetings: byStatus[MEETING_STATUS.POSTPONED] || 0,
    companyWideMeetings: meetings.filter((meeting) => meeting.visibility === MEETING_VISIBILITY.COMPANY_WIDE).length,
    departmentMeetings: meetings.filter((meeting) => meeting.departmentId).length,
    meetingHours: meetings.reduce((total, meeting) => total + Number(meeting.durationMinutes || 0), 0) / 60,
    attendanceRate: attendance.length
      ? attendance.filter((record) => record.status === ATTENDANCE_STATUS.PRESENT || record.status === ATTENDANCE_STATUS.LATE).length /
        attendance.length
      : 0,
    outstandingActionItems: actionItems.filter((item) => !["completed", "done"].includes(String(item.status || "").toLowerCase())).length,
    byStatus,
  };
}

function listMeetingTypes(query = {}) {
  return repository.listMeetingTypes(query);
}

function createMeetingType(payload, user) {
  assertPermission(user, MEETING_PERMISSIONS.MANAGE_TYPES);
  return repository.createMeetingType(payload, user.id);
}

function updateMeetingType(id, payload, user) {
  assertPermission(user, MEETING_PERMISSIONS.MANAGE_TYPES);
  return repository.updateMeetingType(id, payload);
}

function removeMeetingType(id, user) {
  assertPermission(user, MEETING_PERMISSIONS.MANAGE_TYPES);
  return repository.removeMeetingType(id, user.id);
}

function listMeetingRooms(query = {}) {
  return repository.listMeetingRooms(query);
}

function createMeetingRoom(payload, user) {
  assertPermission(user, MEETING_PERMISSIONS.MANAGE_ROOMS);
  return repository.createMeetingRoom(payload, user.id);
}

function updateMeetingRoom(id, payload, user) {
  assertPermission(user, MEETING_PERMISSIONS.MANAGE_ROOMS);
  return repository.updateMeetingRoom(id, payload);
}

function deactivateMeetingRoom(id, user) {
  assertPermission(user, MEETING_PERMISSIONS.MANAGE_ROOMS);
  return repository.updateMeetingRoom(id, { status: "inactive", deactivatedAt: new Date().toISOString(), deactivatedBy: user.id });
}

module.exports = {
  addAgenda,
  addParticipants,
  cancelMeeting,
  createActionItem,
  createMeeting,
  createMeetingRoom,
  createMeetingType,
  deactivateMeetingRoom,
  getCalendar,
  getHistory,
  getMeetingDetails,
  getReports,
  listMeetingRooms,
  listMeetingTypes,
  listMeetings,
  postponeMeeting,
  removeAgenda,
  removeMeetingType,
  removeParticipant,
  respondToInvitation,
  setMeetingStatus,
  updateAgenda,
  updateMeeting,
  updateMeetingRoom,
  updateMeetingType,
  upsertAttendance,
  upsertMinutes,
};
