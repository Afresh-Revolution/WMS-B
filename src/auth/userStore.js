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
    status: user.status || "active",
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    forcePasswordReset: Boolean(user.forcePasswordReset),
    passwordExpiresAt: user.passwordExpiresAt || null,
    lockedAt: user.lockedAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function listUsers() {
  return readUsers().map(sanitizeUser);
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
    status: "active",
    permissions: [],
    failedLoginCount: 0,
    forcePasswordReset: false,
    passwordChangedAt: now,
    passwordExpiresAt: null,
    lockedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  users.push(user);
  writeUsers(users);

  return user;
}

function createUser({ name, email, passwordHash, role = "employee", permissions = [], status = "active" }) {
  const users = readUsers();
  const normalizedEmail = email.toLowerCase();

  if (users.some((user) => user.email === normalizedEmail)) {
    const error = new Error("A user with this email already exists.");
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
    role,
    status,
    permissions,
    failedLoginCount: 0,
    forcePasswordReset: false,
    passwordChangedAt: now,
    passwordExpiresAt: null,
    lockedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  users.push(user);
  writeUsers(users);
  return user;
}

function updateUser(id, payload) {
  const users = readUsers();
  const userIndex = users.findIndex((user) => user.id === id);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex] = {
    ...users[userIndex],
    ...payload,
    id: users[userIndex].id,
    email: payload.email ? String(payload.email).toLowerCase() : users[userIndex].email,
    updatedAt: new Date().toISOString(),
  };
  writeUsers(users);

  return users[userIndex];
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
    forcePasswordReset: false,
    passwordChangedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeUsers(users);

  return users[userIndex];
}

module.exports = {
  createUser,
  createSuperadmin,
  getUserByEmail,
  getUserById,
  hasSuperadmin,
  listUsers,
  sanitizeUser,
  updateUser,
  updateUserPassword,
};
