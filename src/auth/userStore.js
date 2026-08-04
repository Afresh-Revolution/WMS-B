const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

function getDataFilePath() {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.cwd(), process.env.DATA_DIR)
    : DEFAULT_DATA_DIR;

  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "users.json");
}

function readUsers() {
  const filePath = getDataFilePath();

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const rawData = fs.readFileSync(filePath, "utf8").trim();
  if (!rawData) {
    return [];
  }

  const parsed = JSON.parse(rawData);
  return Array.isArray(parsed.users) ? parsed.users : [];
}

function writeUsers(users) {
  const filePath = getDataFilePath();
  const payload = JSON.stringify({ users }, null, 2);

  fs.writeFileSync(filePath, `${payload}\n`, { mode: 0o600 });
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
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function getUserByEmail(email) {
  const normalizedEmail = email.toLowerCase();
  return readUsers().find((user) => user.email === normalizedEmail) || null;
}

function getUserById(id) {
  return readUsers().find((user) => user.id === id) || null;
}

function hasSuperadmin() {
  return readUsers().some((user) => user.role === "superadmin");
}

function createSuperadmin({ name, email, passwordHash }) {
  const users = readUsers();
  const normalizedEmail = email.toLowerCase();

  if (users.some((user) => user.email === normalizedEmail)) {
    const error = new Error("A user with this email already exists.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }

  if (users.some((user) => user.role === "superadmin")) {
    const error = new Error("Superadmin has already been bootstrapped.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    name,
    email: normalizedEmail,
    passwordHash,
    role: "superadmin",
    createdAt: now,
    updatedAt: now,
  };

  users.push(user);
  writeUsers(users);

  return user;
}

function updateUserPassword(id, passwordHash) {
  const users = readUsers();
  const userIndex = users.findIndex((user) => user.id === id);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex] = {
    ...users[userIndex],
    passwordHash,
    updatedAt: new Date().toISOString(),
  };
  writeUsers(users);

  return users[userIndex];
}

module.exports = {
  createSuperadmin,
  getUserByEmail,
  getUserById,
  hasSuperadmin,
  sanitizeUser,
  updateUserPassword,
};
