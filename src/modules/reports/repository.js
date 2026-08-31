const crypto = require("crypto");
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

function listCollection(collection) {
  return activeRecords(collection);
}

function createSavedReport(payload) {
  return createRecord("saved_reports", payload);
}

function updateSavedReport(id, payload) {
  return updateRecord("saved_reports", id, payload);
}

function deleteSavedReport(id, actorId) {
  return updateRecord("saved_reports", id, { deletedAt: now(), deletedBy: actorId || null });
}

function findSavedReport(id) {
  return activeRecords("saved_reports").find((report) => report.id === id) || null;
}

function listSavedReports(query = {}) {
  return paginate(applyBasicFilters(activeRecords("saved_reports"), query, ["name", "description", "reportType"]), query);
}

function createExport(payload) {
  return createRecord("report_exports", payload);
}

function updateExport(id, payload) {
  return updateRecord("report_exports", id, payload);
}

function listExports(query = {}) {
  return paginate(applyBasicFilters(activeRecords("report_exports"), query, ["reportType", "format", "status"]), query);
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

module.exports = {
  createExport,
  createSavedReport,
  deleteSavedReport,
  findDepartment,
  findSavedReport,
  listCollection,
  listExports,
  listSavedReports,
  updateExport,
  updateSavedReport,
};
