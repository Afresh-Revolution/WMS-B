const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

function getDataDir() {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.cwd(), process.env.DATA_DIR)
    : DEFAULT_DATA_DIR;

  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function getCollectionPath(collection) {
  return path.join(getDataDir(), `${collection}.json`);
}

function readCollection(collection) {
  const filePath = getCollectionPath(collection);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const rawData = fs.readFileSync(filePath, "utf8").trim();
  if (!rawData) {
    return [];
  }

  const parsed = JSON.parse(rawData);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  return Array.isArray(parsed[collection]) ? parsed[collection] : [];
}

function writeCollection(collection, records) {
  const filePath = getCollectionPath(collection);
  const payload = JSON.stringify({ [collection]: records }, null, 2);
  fs.writeFileSync(filePath, `${payload}\n`, { mode: 0o600 });
}

function appendRecord(collection, record) {
  const records = readCollection(collection);
  records.push(record);
  writeCollection(collection, records);
  return record;
}

module.exports = { appendRecord, getCollectionPath, getDataDir, readCollection, writeCollection };
