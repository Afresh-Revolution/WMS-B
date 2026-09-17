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

function applyCaseFilters(cases, query = {}) {
  const normalized = {
    q: query.q || query.search,
    status: query.status,
    employeeId: query.employeeId || query.employee_id || query.employee,
    departmentId: query.departmentId || query.department_id || query.department,
    assignedTo: query.assignedTo || query.assigned_to,
    openedBy: query.openedBy || query.opened_by || query.issuedBy || query.issued_by,
    severity: query.severity,
    caseType: query.caseType || query.case_type || query.actionType || query.action_type,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
  let filtered = applyBasicFilters(cases, normalized, [
    "caseNumber",
    "case_number",
    "employeeName",
    "employeeCode",
    "departmentName",
    "title",
    "summary",
    "caseType",
    "severity",
    "status",
  ]);
  const dateFrom = query.dateFrom || query.date_from;
  const dateTo = query.dateTo || query.date_to;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((disciplineCase) => {
      const value = disciplineCase.incidentDate || disciplineCase.reportedDate || disciplineCase.createdAt || "";
      if (dateFrom && value < dateFrom) {
        return false;
      }
      if (dateTo && value > `${dateTo}T23:59:59.999Z`) {
        return false;
      }
      return true;
    });
  }
  const actionType = query.actionType || query.action_type;
  if (actionType) {
    const caseIds = activeRecords("disciplinary_actions")
      .filter((action) => action.actionType === actionType || action.action_type === actionType || action.action === actionType)
      .map((action) => action.caseId || action.case_id);
    filtered = filtered.filter((disciplineCase) => caseIds.includes(disciplineCase.id));
  }
  return filtered;
}

function listCases(query = {}) {
  return paginate(applyCaseFilters(activeRecords("disciplinary_cases"), query), query);
}

function listAllCases(query = {}) {
  return applyCaseFilters(activeRecords("disciplinary_cases"), query);
}

function findCase(id) {
  return activeRecords("disciplinary_cases").find((disciplineCase) => disciplineCase.id === id) || null;
}

function createCase(payload) {
  return createRecord("disciplinary_cases", payload);
}

function updateCase(id, payload) {
  return updateRecord("disciplinary_cases", id, payload);
}

function createAction(payload) {
  return createRecord("disciplinary_actions", payload);
}

function updateAction(id, payload) {
  return updateRecord("disciplinary_actions", id, payload);
}

function findAction(id) {
  return activeRecords("disciplinary_actions").find((action) => action.id === id) || null;
}

function listActions(caseId) {
  return activeRecords("disciplinary_actions").filter((action) => (action.caseId || action.case_id) === caseId);
}

function createIncident(payload) {
  return createRecord("disciplinary_incidents", payload);
}

function listIncidents(caseId) {
  return activeRecords("disciplinary_incidents").filter((incident) => incident.caseId === caseId);
}

function createEvidence(payload) {
  return createRecord("disciplinary_evidence", payload);
}

function findEvidence(id) {
  return activeRecords("disciplinary_evidence").find((evidence) => evidence.id === id) || null;
}

function updateEvidence(id, payload) {
  return updateRecord("disciplinary_evidence", id, payload);
}

function listEvidence(caseId) {
  return activeRecords("disciplinary_evidence").filter((evidence) => evidence.caseId === caseId);
}

function createNote(payload) {
  return createRecord("disciplinary_notes", payload);
}

function listNotes(caseId) {
  return activeRecords("disciplinary_notes").filter((note) => note.caseId === caseId);
}

function createHearing(payload) {
  return createRecord("disciplinary_hearings", payload);
}

function listHearings(caseId) {
  return activeRecords("disciplinary_hearings").filter((hearing) => hearing.caseId === caseId);
}

function createHearingParticipant(payload) {
  return createRecord("disciplinary_hearing_participants", payload);
}

function listHearingParticipants(hearingId) {
  return activeRecords("disciplinary_hearing_participants").filter((participant) => participant.hearingId === hearingId);
}

function createWitness(payload) {
  return createRecord("disciplinary_witnesses", payload);
}

function listWitnesses(caseId) {
  return activeRecords("disciplinary_witnesses").filter((witness) => witness.caseId === caseId);
}

function createAcknowledgement(payload) {
  return createRecord("disciplinary_acknowledgements", payload);
}

function updateAcknowledgement(id, payload) {
  return updateRecord("disciplinary_acknowledgements", id, payload);
}

function findAcknowledgement(actionId, employeeId) {
  return activeRecords("disciplinary_acknowledgements").find((ack) => ack.actionId === actionId && ack.employeeId === employeeId) || null;
}

function listAcknowledgements(caseId) {
  const actionIds = listActions(caseId).map((action) => action.id);
  return activeRecords("disciplinary_acknowledgements").filter((ack) => actionIds.includes(ack.actionId));
}

function createAppeal(payload) {
  return createRecord("disciplinary_appeals", payload);
}

function updateAppeal(id, payload) {
  return updateRecord("disciplinary_appeals", id, payload);
}

function findAppeal(id) {
  return activeRecords("disciplinary_appeals").find((appeal) => appeal.id === id) || null;
}

function listAppeals(caseId) {
  return activeRecords("disciplinary_appeals").filter((appeal) => appeal.caseId === caseId);
}

function createHistory(payload) {
  return createRecord("disciplinary_case_history", payload);
}

function listHistory(caseId) {
  return activeRecords("disciplinary_case_history").filter((history) => history.caseId === caseId);
}

function createNotification(payload) {
  return createRecord("notifications", payload);
}

function findEmployee(id) {
  return activeRecords("employees").find((employee) => employee.id === id) || null;
}

function findEmployeeByUserId(userId) {
  const { resolveEmployeeForUserId } = require("../employees/employeeProfile");
  return resolveEmployeeForUserId(userId);
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function findUser(id) {
  return getUserById(id) || activeRecords("users").find((user) => user.id === id) || null;
}

module.exports = {
  createAcknowledgement,
  createAction,
  createAppeal,
  createCase,
  createEvidence,
  createHearing,
  createHearingParticipant,
  createHistory,
  createIncident,
  createNote,
  createNotification,
  createWitness,
  findAcknowledgement,
  findAction,
  findAppeal,
  findCase,
  findDepartment,
  findEmployee,
  findEmployeeByUserId,
  findEvidence,
  findUser,
  listAcknowledgements,
  listActions,
  listAllCases,
  listAppeals,
  listCases,
  listEvidence,
  listHearings,
  listHearingParticipants,
  listHistory,
  listIncidents,
  listNotes,
  listWitnesses,
  updateAcknowledgement,
  updateAction,
  updateAppeal,
  updateCase,
  updateEvidence,
};
