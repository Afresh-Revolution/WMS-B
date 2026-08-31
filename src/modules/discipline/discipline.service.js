const { hasPermission } = require("../../constants/rbac");
const { paginate } = require("../../utils/query");
const {
  ACKNOWLEDGEMENT_STATUS,
  ACTION_STATUS,
  ACTION_TYPE,
  APPEAL_STATUS,
  CASE_STATUS,
  DISCIPLINE_PERMISSIONS,
  HEARING_STATUS,
  SEVERITY,
} = require("./constants");
const repository = require("./discipline.repository");

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

function now() {
  return new Date().toISOString();
}

function currentYear() {
  return new Date().getUTCFullYear();
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function employeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || null;
}

function buildCaseNumber() {
  const year = currentYear();
  const count = repository.listAllCases({}).filter((disciplineCase) => String(disciplineCase.caseNumber || "").startsWith(`DISC-${year}-`)).length + 1;
  return `DISC-${year}-${String(count).padStart(4, "0")}`;
}

function recordHistory({ caseId, actor, action, description, oldStatus, newStatus, metadata }) {
  return repository.createHistory({
    caseId,
    actorId: actor?.id || null,
    action,
    description: description || null,
    oldStatus: oldStatus || null,
    newStatus: newStatus || null,
    metadata: metadata || {},
  });
}

function notifyEmployee(disciplineCase, type, title) {
  const employee = repository.findEmployee(disciplineCase.employeeId);
  const userId = employee?.userId || employee?.user_id || null;
  if (!userId) {
    return null;
  }
  return repository.createNotification({
    userId,
    recipientUserId: userId,
    recipientEmployeeId: employee.id,
    type,
    title,
    message: "An official disciplinary update has been recorded on your employee profile.",
    body: "An official disciplinary update has been recorded on your employee profile.",
    entityType: "DISCIPLINARY_CASE",
    entityId: disciplineCase.id,
    isRead: false,
    status: "queued",
    data: { caseId: disciplineCase.id, caseNumber: disciplineCase.caseNumber },
  });
}

function canAccessCase(user, disciplineCase) {
  if (can(user, DISCIPLINE_PERMISSIONS.VIEW_ALL)) {
    return true;
  }
  const employee = repository.findEmployeeByUserId(user?.id);
  if (employee && disciplineCase.employeeId === employee.id && can(user, DISCIPLINE_PERMISSIONS.VIEW)) {
    return true;
  }
  if (employee && can(user, DISCIPLINE_PERMISSIONS.VIEW_TEAM)) {
    return disciplineCase.departmentId && disciplineCase.departmentId === (employee.departmentId || employee.department_id);
  }
  return disciplineCase.openedBy === user?.id || disciplineCase.assignedTo === user?.id;
}

function assertCaseAccess(user, disciplineCase) {
  if (!canAccessCase(user, disciplineCase)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function canSeeConfidential(user) {
  return can(user, DISCIPLINE_PERMISSIONS.VIEW_ALL) || can(user, DISCIPLINE_PERMISSIONS.VIEW_EVIDENCE) || can(user, DISCIPLINE_PERMISSIONS.INVESTIGATE);
}

function canSeeInternalNotes(user) {
  return can(user, DISCIPLINE_PERMISSIONS.VIEW_ALL) || can(user, DISCIPLINE_PERMISSIONS.INVESTIGATE) || can(user, DISCIPLINE_PERMISSIONS.UPDATE);
}

function decorateCase(disciplineCase, user, detail = false) {
  const employee = disciplineCase.employeeId ? repository.findEmployee(disciplineCase.employeeId) : null;
  const department = disciplineCase.departmentId ? repository.findDepartment(disciplineCase.departmentId) : null;
  const actions = repository.listActions(disciplineCase.id);
  const publicShape = {
    ...disciplineCase,
    employee: employee
      ? {
          id: employee.id,
          fullName: employeeName(employee),
          employeeId: employee.employeeId,
          departmentId: employee.departmentId || employee.department_id,
        }
      : null,
    department: department ? { id: department.id, name: department.name, code: department.code } : null,
    actions,
  };
  if (!detail) {
    return publicShape;
  }
  return {
    ...publicShape,
    incidents: repository.listIncidents(disciplineCase.id),
    evidence: canSeeConfidential(user) ? repository.listEvidence(disciplineCase.id) : [],
    notes: canSeeInternalNotes(user) ? repository.listNotes(disciplineCase.id) : [],
    hearings: canSeeInternalNotes(user) ? repository.listHearings(disciplineCase.id).map((hearing) => ({ ...hearing, participants: repository.listHearingParticipants(hearing.id) })) : [],
    witnesses: canSeeConfidential(user) ? repository.listWitnesses(disciplineCase.id) : [],
    appeals: repository.listAppeals(disciplineCase.id).map((appeal) => (canSeeInternalNotes(user) ? appeal : { ...appeal, decisionNotes: undefined })),
    acknowledgements: repository.listAcknowledgements(disciplineCase.id),
    timeline: repository.listHistory(disciplineCase.id),
    history: repository.listHistory(disciplineCase.id),
  };
}

function createCase(payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.CREATE);
  const employee = repository.findEmployee(payload.employeeId || payload.employee_id);
  if (!employee) {
    throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  }
  const departmentId = employee.departmentId || employee.department_id || payload.departmentId || payload.department_id || null;
  const department = departmentId ? repository.findDepartment(departmentId) : null;
  const actionType = normalizeEnum(payload.actionType || payload.action_type, Object.values(ACTION_TYPE), null);
  if (!actionType) {
    throw createHttpError(400, "Valid disciplinary action type is required.", "INVALID_ACTION_TYPE");
  }
  if (!payload.description && !payload.summary) {
    throw createHttpError(400, "Case description is required.", "DESCRIPTION_REQUIRED");
  }
  const incidentDate = payload.incidentDate || payload.incident_date || payload.date;
  if (!incidentDate) {
    throw createHttpError(400, "Incident date is required.", "INCIDENT_DATE_REQUIRED");
  }
  const severity = normalizeEnum(payload.severity, Object.values(SEVERITY), SEVERITY.MEDIUM);
  const disciplineCase = repository.createCase({
    caseNumber: buildCaseNumber(),
    case_number: null,
    employeeId: employee.id,
    employeeName: employeeName(employee),
    employeeCode: employee.employeeId || employee.employee_id || null,
    departmentId: department?.id || departmentId,
    departmentName: department?.name || employee.department || null,
    title: payload.title || `${actionType.replace(/_/g, " ")} case`,
    summary: payload.summary || payload.description,
    description: payload.description || payload.summary,
    incidentDate,
    reportedDate: payload.reportedDate || payload.reported_date || now().slice(0, 10),
    caseType: payload.caseType || payload.case_type || actionType,
    severity,
    status: CASE_STATUS.OPEN,
    confidentialityLevel: payload.confidentialityLevel || "strict",
    openedBy: user.id,
    assignedTo: payload.assignedTo || payload.assigned_to || null,
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
    closedAt: null,
  });
  const incident = repository.createIncident({
    caseId: disciplineCase.id,
    incidentType: payload.incidentType || payload.incident_type || disciplineCase.caseType,
    title: payload.incidentTitle || disciplineCase.title,
    description: payload.incidentDescription || payload.description || payload.summary,
    incidentDate,
    location: payload.location || null,
    reportedBy: user.id,
  });
  const action = repository.createAction({
    caseId: disciplineCase.id,
    employeeId: employee.id,
    actionType,
    action_type: actionType,
    action: actionType,
    severity,
    description: payload.description || payload.summary,
    effectiveDate: payload.effectiveDate || payload.effective_date || incidentDate,
    endDate: payload.endDate || payload.end_date || null,
    issuedBy: user.id,
    approvedBy: null,
    approvedAt: null,
    status: ACTION_STATUS.ACTIVE,
    evidence: [],
    resolution: null,
  });
  repository.createAcknowledgement({
    actionId: action.id,
    employeeId: employee.id,
    acknowledged: false,
    status: ACKNOWLEDGEMENT_STATUS.PENDING,
    acknowledgedAt: null,
    signature: null,
    comment: null,
  });
  recordHistory({ caseId: disciplineCase.id, actor: user, action: "CASE_CREATED", oldStatus: null, newStatus: disciplineCase.status, metadata: { actionId: action.id, incidentId: incident.id } });
  recordHistory({ caseId: disciplineCase.id, actor: user, action: "ACTION_ISSUED", oldStatus: disciplineCase.status, newStatus: disciplineCase.status, metadata: { actionType } });
  notifyEmployee(disciplineCase, "DISCIPLINARY_ACTION", "Disciplinary action recorded");
  return { record: decorateCase(disciplineCase, user, true), meta: { incident, action } };
}

function listCases(user, query = {}) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.VIEW);
  const cases = repository.listAllCases(query).filter((disciplineCase) => canAccessCase(user, disciplineCase)).map((disciplineCase) => decorateCase(disciplineCase, user));
  return paginate(cases, query);
}

function getCaseDetails(id, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.VIEW);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    throw createHttpError(404, "Disciplinary case was not found.", "DISCIPLINE_CASE_NOT_FOUND");
  }
  assertCaseAccess(user, disciplineCase);
  return decorateCase(disciplineCase, user, true);
}

function updateCase(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.UPDATE);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  assertCaseAccess(user, disciplineCase);
  if ([CASE_STATUS.CLOSED, CASE_STATUS.ARCHIVED].includes(disciplineCase.status)) {
    throw createHttpError(409, "Closed or archived cases cannot be updated.", "CASE_LOCKED");
  }
  const updated = repository.updateCase(id, {
    title: payload.title ?? disciplineCase.title,
    summary: payload.summary ?? disciplineCase.summary,
    description: payload.description ?? disciplineCase.description,
    severity: payload.severity ? normalizeEnum(payload.severity, Object.values(SEVERITY), disciplineCase.severity) : disciplineCase.severity,
  });
  recordHistory({ caseId: id, actor: user, action: "CASE_UPDATED", oldStatus: disciplineCase.status, newStatus: updated.status, metadata: { payload } });
  return { oldValues: disciplineCase, record: decorateCase(updated, user, true) };
}

function assignCase(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.ASSIGN);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  const assigneeId = payload.assignedTo || payload.assigned_to || payload.userId || payload.user_id;
  if (!assigneeId || !repository.findUser(assigneeId)) {
    throw createHttpError(404, "Assignee user was not found.", "ASSIGNEE_NOT_FOUND");
  }
  const updated = repository.updateCase(id, { assignedTo: assigneeId });
  recordHistory({ caseId: id, actor: user, action: "CASE_ASSIGNED", oldStatus: disciplineCase.status, newStatus: updated.status, metadata: { assignedTo: assigneeId } });
  return { oldValues: disciplineCase, record: decorateCase(updated, user, true) };
}

function startInvestigation(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.INVESTIGATE);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  const updated = repository.updateCase(id, { status: CASE_STATUS.UNDER_INVESTIGATION, assignedTo: disciplineCase.assignedTo || user.id });
  recordHistory({ caseId: id, actor: user, action: "INVESTIGATION_STARTED", description: payload.note || null, oldStatus: disciplineCase.status, newStatus: updated.status });
  return { oldValues: disciplineCase, record: decorateCase(updated, user, true) };
}

function issueAction(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.ISSUE_ACTION);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  if ([CASE_STATUS.CLOSED, CASE_STATUS.CANCELLED, CASE_STATUS.ARCHIVED].includes(disciplineCase.status)) {
    throw createHttpError(409, "Cannot issue action on a closed, cancelled, or archived case.", "CASE_FINALIZED");
  }
  const actionType = normalizeEnum(payload.actionType || payload.action_type, Object.values(ACTION_TYPE), null);
  if (!actionType) {
    throw createHttpError(400, "Valid disciplinary action type is required.", "INVALID_ACTION_TYPE");
  }
  const action = repository.createAction({
    caseId: id,
    employeeId: disciplineCase.employeeId,
    actionType,
    action_type: actionType,
    action: actionType,
    severity: normalizeEnum(payload.severity, Object.values(SEVERITY), disciplineCase.severity || SEVERITY.MEDIUM),
    description: payload.description || null,
    effectiveDate: payload.effectiveDate || payload.effective_date || now().slice(0, 10),
    endDate: payload.endDate || payload.end_date || null,
    issuedBy: user.id,
    approvedBy: null,
    approvedAt: null,
    status: payload.requireApproval ? ACTION_STATUS.PENDING : ACTION_STATUS.ACTIVE,
    evidence: [],
    resolution: null,
  });
  repository.createAcknowledgement({ actionId: action.id, employeeId: disciplineCase.employeeId, acknowledged: false, status: ACKNOWLEDGEMENT_STATUS.PENDING, acknowledgedAt: null });
  const updated = repository.updateCase(id, { status: CASE_STATUS.ACTION_ISSUED });
  recordHistory({ caseId: id, actor: user, action: "ACTION_ISSUED", oldStatus: disciplineCase.status, newStatus: updated.status, metadata: { actionId: action.id, actionType } });
  notifyEmployee(updated, "DISCIPLINARY_ACTION", "Disciplinary action recorded");
  return { oldValues: disciplineCase, record: action, meta: { case: updated } };
}

function listActions(id, user) {
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  assertCaseAccess(user, disciplineCase);
  return repository.listActions(id);
}

function revokeAction(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.ISSUE_ACTION);
  if (!payload.reason) {
    throw createHttpError(400, "Revocation reason is required.", "REVOCATION_REASON_REQUIRED");
  }
  const action = repository.findAction(id);
  if (!action) {
    return null;
  }
  const disciplineCase = repository.findCase(action.caseId || action.case_id);
  assertCaseAccess(user, disciplineCase);
  const updated = repository.updateAction(id, { status: ACTION_STATUS.REVOKED, revokedBy: user.id, revokedAt: now(), revocationReason: payload.reason });
  recordHistory({ caseId: disciplineCase.id, actor: user, action: "ACTION_REVOKED", oldStatus: disciplineCase.status, newStatus: disciplineCase.status, description: payload.reason, metadata: { actionId: id } });
  return { oldValues: action, record: updated };
}

function resolveCase(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.RESOLVE);
  if (!payload.resolution) {
    throw createHttpError(400, "Resolution is required.", "RESOLUTION_REQUIRED");
  }
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  const updated = repository.updateCase(id, { status: CASE_STATUS.RESOLVED, resolution: payload.resolution, resolvedBy: user.id, resolvedAt: now() });
  recordHistory({ caseId: id, actor: user, action: "CASE_RESOLVED", oldStatus: disciplineCase.status, newStatus: updated.status, description: payload.resolution });
  return { oldValues: disciplineCase, record: decorateCase(updated, user, true) };
}

function closeCase(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.CLOSE);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  if (![CASE_STATUS.RESOLVED, CASE_STATUS.CANCELLED].includes(disciplineCase.status)) {
    throw createHttpError(409, "Only resolved or cancelled cases can be closed.", "CASE_NOT_RESOLVED");
  }
  const updated = repository.updateCase(id, { status: CASE_STATUS.CLOSED, closedAt: now(), closeNote: payload.note || null });
  recordHistory({ caseId: id, actor: user, action: "CASE_CLOSED", oldStatus: disciplineCase.status, newStatus: updated.status, description: payload.note });
  return { oldValues: disciplineCase, record: decorateCase(updated, user, true) };
}

function reopenCase(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.REOPEN);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  const updated = repository.updateCase(id, { status: CASE_STATUS.UNDER_INVESTIGATION, reopenedBy: user.id, reopenedAt: now(), reopenReason: payload.reason || null });
  recordHistory({ caseId: id, actor: user, action: "CASE_REOPENED", oldStatus: disciplineCase.status, newStatus: updated.status, description: payload.reason });
  return { oldValues: disciplineCase, record: decorateCase(updated, user, true) };
}

function addEvidence(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.UPLOAD_EVIDENCE);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  if (!payload.fileName && !payload.name) {
    throw createHttpError(400, "Evidence file name is required.", "EVIDENCE_FILE_REQUIRED");
  }
  if (!payload.fileUrl && !payload.url) {
    throw createHttpError(400, "Evidence file URL is required.", "EVIDENCE_URL_REQUIRED");
  }
  const evidence = repository.createEvidence({
    caseId: id,
    fileName: payload.fileName || payload.name,
    fileUrl: payload.fileUrl || payload.url,
    fileType: payload.fileType || payload.type || null,
    fileSize: Number(payload.fileSize || payload.size || 0),
    description: payload.description || null,
    uploadedBy: user.id,
    uploadedAt: now(),
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
  });
  recordHistory({ caseId: id, actor: user, action: "EVIDENCE_ADDED", oldStatus: disciplineCase.status, newStatus: disciplineCase.status, metadata: { evidenceId: evidence.id } });
  return evidence;
}

function listEvidence(id, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.VIEW_EVIDENCE);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  assertCaseAccess(user, disciplineCase);
  return repository.listEvidence(id);
}

function downloadEvidence(id, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.VIEW_EVIDENCE);
  const evidence = repository.findEvidence(id);
  if (!evidence) {
    return null;
  }
  const disciplineCase = repository.findCase(evidence.caseId);
  assertCaseAccess(user, disciplineCase);
  repository.updateEvidence(id, { lastViewedBy: user.id, lastViewedAt: now() });
  recordHistory({ caseId: evidence.caseId, actor: user, action: "EVIDENCE_VIEWED", oldStatus: disciplineCase.status, newStatus: disciplineCase.status, metadata: { evidenceId: id } });
  return { ...evidence, downloadUrl: evidence.fileUrl };
}

function addNote(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.INVESTIGATE);
  if (!payload.note) {
    throw createHttpError(400, "Note is required.", "NOTE_REQUIRED");
  }
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  const note = repository.createNote({
    caseId: id,
    authorId: user.id,
    note: payload.note,
    visibility: normalizeEnum(payload.visibility, ["INTERNAL", "RESTRICTED"], "INTERNAL"),
  });
  recordHistory({ caseId: id, actor: user, action: "NOTE_ADDED", oldStatus: disciplineCase.status, newStatus: disciplineCase.status });
  return note;
}

function listNotes(id, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.INVESTIGATE);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  return repository.listNotes(id);
}

function createHearing(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.MANAGE_HEARINGS);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  const hearing = repository.createHearing({
    caseId: id,
    scheduledDate: payload.scheduledDate || payload.scheduled_date,
    location: payload.location || null,
    virtualLink: payload.virtualLink || payload.virtual_link || null,
    chairpersonId: payload.chairpersonId || payload.chairperson_id || user.id,
    status: normalizeEnum(payload.status, Object.values(HEARING_STATUS), HEARING_STATUS.SCHEDULED),
    notes: payload.notes || null,
  });
  for (const participant of Array.isArray(payload.participants) ? payload.participants : []) {
    repository.createHearingParticipant({
      hearingId: hearing.id,
      userId: participant.userId || participant.user_id,
      participantType: participant.participantType || participant.participant_type || "HR",
      attendanceStatus: participant.attendanceStatus || participant.attendance_status || "INVITED",
    });
  }
  recordHistory({ caseId: id, actor: user, action: "HEARING_CREATED", oldStatus: disciplineCase.status, newStatus: disciplineCase.status, metadata: { hearingId: hearing.id } });
  return { ...hearing, participants: repository.listHearingParticipants(hearing.id) };
}

function listHearings(id, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.MANAGE_HEARINGS);
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  return repository.listHearings(id).map((hearing) => ({ ...hearing, participants: repository.listHearingParticipants(hearing.id) }));
}

function submitAppeal(id, payload, user) {
  if (!payload.reason) {
    throw createHttpError(400, "Appeal reason is required.", "APPEAL_REASON_REQUIRED");
  }
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  assertCaseAccess(user, disciplineCase);
  const actorEmployee = repository.findEmployeeByUserId(user.id);
  if (actorEmployee && actorEmployee.id !== disciplineCase.employeeId && !can(user, DISCIPLINE_PERMISSIONS.MANAGE_APPEALS)) {
    throw createHttpError(403, "Cannot appeal another employee's disciplinary case.", "APPEAL_SCOPE_FORBIDDEN");
  }
  const appeal = repository.createAppeal({
    caseId: id,
    employeeId: disciplineCase.employeeId,
    reason: payload.reason,
    submittedAt: now(),
    reviewedBy: null,
    reviewedAt: null,
    decision: null,
    decisionNotes: null,
    status: APPEAL_STATUS.SUBMITTED,
  });
  const updated = repository.updateCase(id, { status: CASE_STATUS.APPEAL_PENDING });
  recordHistory({ caseId: id, actor: user, action: "APPEAL_SUBMITTED", oldStatus: disciplineCase.status, newStatus: updated.status, metadata: { appealId: appeal.id } });
  return { record: appeal, meta: { case: updated } };
}

function listAppeals(id, user) {
  const disciplineCase = repository.findCase(id);
  if (!disciplineCase) {
    return null;
  }
  assertCaseAccess(user, disciplineCase);
  return repository.listAppeals(id).map((appeal) => (canSeeInternalNotes(user) ? appeal : { ...appeal, decisionNotes: undefined }));
}

function reviewAppeal(id, payload, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.MANAGE_APPEALS);
  const appeal = repository.findAppeal(id);
  if (!appeal) {
    return null;
  }
  const disciplineCase = repository.findCase(appeal.caseId);
  const decision = normalizeEnum(payload.decision, [APPEAL_STATUS.APPROVED, APPEAL_STATUS.REJECTED], null);
  if (!decision) {
    throw createHttpError(400, "Appeal decision must be APPROVED or REJECTED.", "INVALID_APPEAL_DECISION");
  }
  const updated = repository.updateAppeal(id, {
    status: decision,
    decision,
    decisionNotes: payload.decisionNotes || payload.decision_notes || null,
    reviewedBy: user.id,
    reviewedAt: now(),
  });
  const nextStatus = decision === APPEAL_STATUS.APPROVED ? CASE_STATUS.UNDER_INVESTIGATION : CASE_STATUS.ACTION_ISSUED;
  repository.updateCase(disciplineCase.id, { status: nextStatus });
  recordHistory({ caseId: disciplineCase.id, actor: user, action: "APPEAL_REVIEWED", oldStatus: disciplineCase.status, newStatus: nextStatus, metadata: { appealId: id, decision } });
  return { oldValues: appeal, record: updated };
}

function acknowledgeAction(id, payload, user) {
  const action = repository.findAction(id);
  if (!action) {
    return null;
  }
  const disciplineCase = repository.findCase(action.caseId || action.case_id);
  assertCaseAccess(user, disciplineCase);
  const actorEmployee = repository.findEmployeeByUserId(user.id);
  if (!actorEmployee || actorEmployee.id !== disciplineCase.employeeId) {
    throw createHttpError(403, "Only the employee on the case can acknowledge this action.", "ACKNOWLEDGEMENT_SCOPE_FORBIDDEN");
  }
  const status = payload.refused ? ACKNOWLEDGEMENT_STATUS.REFUSED : ACKNOWLEDGEMENT_STATUS.ACKNOWLEDGED;
  const existing = repository.findAcknowledgement(id, actorEmployee.id);
  const update = {
    acknowledged: status === ACKNOWLEDGEMENT_STATUS.ACKNOWLEDGED,
    status,
    acknowledgedAt: status === ACKNOWLEDGEMENT_STATUS.ACKNOWLEDGED ? now() : existing?.acknowledgedAt || null,
    refusedAt: status === ACKNOWLEDGEMENT_STATUS.REFUSED ? now() : null,
    signature: payload.signature || null,
    comment: payload.comment || null,
  };
  const acknowledgement = existing ? repository.updateAcknowledgement(existing.id, update) : repository.createAcknowledgement({ actionId: id, employeeId: actorEmployee.id, ...update });
  recordHistory({ caseId: disciplineCase.id, actor: user, action: "ACKNOWLEDGED", oldStatus: disciplineCase.status, newStatus: disciplineCase.status, metadata: { actionId: id, acknowledgementId: acknowledgement.id, status } });
  return acknowledgement;
}

function getDashboard(user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.VIEW_REPORTS);
  const cases = repository.listAllCases({}).filter((disciplineCase) => canAccessCase(user, disciplineCase));
  const actions = cases.flatMap((disciplineCase) => repository.listActions(disciplineCase.id));
  const openStatuses = [CASE_STATUS.OPEN, CASE_STATUS.UNDER_INVESTIGATION, CASE_STATUS.PENDING_REVIEW, CASE_STATUS.ACTION_ISSUED, CASE_STATUS.APPEAL_PENDING];
  const year = String(currentYear());
  return {
    openCases: cases.filter((disciplineCase) => openStatuses.includes(disciplineCase.status)).length,
    closedThisYear: cases.filter((disciplineCase) => disciplineCase.status === CASE_STATUS.CLOSED && String(disciplineCase.closedAt || "").startsWith(year)).length,
    activeCases: cases.filter((disciplineCase) => ![CASE_STATUS.CLOSED, CASE_STATUS.CANCELLED, CASE_STATUS.ARCHIVED].includes(disciplineCase.status)).length,
    totalCases: cases.length,
    warnings: actions.filter((action) => String(action.actionType || "").includes("WARNING")).length,
    strikes: actions.filter((action) => action.actionType === ACTION_TYPE.STRIKE).length,
    suspensions: actions.filter((action) => action.actionType === ACTION_TYPE.SUSPENSION).length,
  };
}

function getEmployeeHistory(employeeId, user) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.VIEW_EMPLOYEE_HISTORY);
  const employee = repository.findEmployee(employeeId);
  if (!employee) {
    throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  }
  const cases = repository.listAllCases({ employeeId }).filter((disciplineCase) => canAccessCase(user, disciplineCase));
  const actions = cases.flatMap((disciplineCase) => repository.listActions(disciplineCase.id));
  return {
    employee: { id: employee.id, fullName: employeeName(employee), employeeId: employee.employeeId },
    totalCases: cases.length,
    activeCases: cases.filter((disciplineCase) => ![CASE_STATUS.CLOSED, CASE_STATUS.CANCELLED, CASE_STATUS.ARCHIVED].includes(disciplineCase.status)).length,
    closedCases: cases.filter((disciplineCase) => disciplineCase.status === CASE_STATUS.CLOSED).length,
    warnings: actions.filter((action) => String(action.actionType || "").includes("WARNING")).length,
    strikes: actions.filter((action) => action.actionType === ACTION_TYPE.STRIKE).length,
    suspensions: actions.filter((action) => action.actionType === ACTION_TYPE.SUSPENSION).length,
    otherActions: actions.filter((action) => !String(action.actionType || "").includes("WARNING") && ![ACTION_TYPE.STRIKE, ACTION_TYPE.SUSPENSION].includes(action.actionType)).length,
    cases: cases.map((disciplineCase) => decorateCase(disciplineCase, user, true)),
  };
}

function exportCases(user, query = {}) {
  assertPermission(user, DISCIPLINE_PERMISSIONS.EXPORT);
  const cases = repository.listAllCases(query).filter((disciplineCase) => canAccessCase(user, disciplineCase));
  const headers = ["caseNumber", "employeeName", "employeeCode", "departmentName", "caseType", "severity", "status", "incidentDate", "reportedDate"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...cases.map((disciplineCase) => headers.map((header) => escape(disciplineCase[header])).join(","))].join("\n");
}

module.exports = {
  acknowledgeAction,
  addEvidence,
  addNote,
  assignCase,
  closeCase,
  createCase,
  createHearing,
  downloadEvidence,
  exportCases,
  getCaseDetails,
  getDashboard,
  getEmployeeHistory,
  issueAction,
  listActions,
  listAppeals,
  listCases,
  listEvidence,
  listHearings,
  listNotes,
  reopenCase,
  resolveCase,
  reviewAppeal,
  revokeAction,
  startInvestigation,
  submitAppeal,
  updateCase,
};
