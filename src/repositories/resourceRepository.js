const crypto = require("crypto");
const { readCollection, writeCollection } = require("../database/jsonStore");
const { applyBasicFilters, paginate } = require("../utils/query");

function now() {
  return new Date().toISOString();
}

function createRepository(collection, options = {}) {
  const searchableFields = options.searchableFields || ["name", "title", "description"];

  function list(query = {}) {
    const records = applyBasicFilters(readCollection(collection), query, searchableFields);
    return paginate(records, query);
  }

  function listAll(query = {}) {
    return applyBasicFilters(readCollection(collection), query, searchableFields);
  }

  function getById(id) {
    return readCollection(collection).find((record) => record.id === id && !record.deletedAt) || null;
  }

  function create(payload, actorId) {
    const timestamp = now();
    const records = readCollection(collection);
    const record = {
      id: crypto.randomUUID(),
      ...payload,
      createdBy: actorId || payload.createdBy || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    records.push(record);
    writeCollection(collection, records);
    return record;
  }

  function update(id, payload) {
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

  function remove(id, actorId) {
    return update(id, { deletedAt: now(), deletedBy: actorId || null });
  }

  return { create, getById, list, listAll, remove, update };
}

module.exports = { createRepository };
