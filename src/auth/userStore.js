const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

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
    fullName: user.fullName || user.name,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    roleId: user.roleId || null,
    departmentId: user.departmentId || null,
    employeeId: user.employeeId || null,
    organizationId: user.organizationId || user.organization_id || null,
    organization_id: user.organization_id || user.organizationId || null,
    employerId: user.employerId || user.employer_id || null,
    employer_id: user.employer_id || user.employerId || null,
    accountType: user.accountType || (user.role === "superadmin" ? "SUPER_ADMIN" : user.role === "admin" ? "ADMIN" : "STAFF"),
    status: user.status || "active",
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    mustChangePassword: Boolean(user.mustChangePassword || user.forcePasswordReset),
    forcePasswordReset: Boolean(user.forcePasswordReset || user.mustChangePassword),
    emailVerified: Boolean(user.emailVerified),
    phoneVerified: Boolean(user.phoneVerified),
    failedLoginAttempts: Number(user.failedLoginAttempts || user.failedLoginCount || 0),
    lockedUntil: user.lockedUntil || null,
    lastLoginAt: user.lastLoginAt || null,
    lastLoginIp: user.lastLoginIp || null,
    lastActivityAt: user.lastActivityAt || null,
    passwordChangedAt: user.passwordChangedAt || null,
    passwordExpiresAt: user.passwordExpiresAt || null,
    lockedAt: user.lockedAt || null,
    createdBy: user.createdBy || null,
    updatedBy: user.updatedBy || null,
    deactivatedAt: user.deactivatedAt || null,
    deactivatedBy: user.deactivatedBy || null,
    deletedAt: user.deletedAt || null,
    deletedBy: user.deletedBy || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function listUsers() {
  return readUsers().map(sanitizeUser);
}

function listRawUsers() {
  return readUsers().filter((user) => user.status !== "deleted" && !user.deletedAt);
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
    roleId: "superadmin",
    accountType: "SUPER_ADMIN",
    status: "active",
    permissions: [],
    failedLoginCount: 0,
    failedLoginAttempts: 0,
    forcePasswordReset: false,
    mustChangePassword: false,
    emailVerified: true,
    phoneVerified: false,
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

function createUser({
  id,
  name,
  fullName,
  email,
  phone,
  passwordHash,
  role = "employee",
  roleId,
  permissions = [],
  status = "active",
  accountType,
  department,
  departmentId,
  employeeId,
  jobTitle,
  organizationId,
  employerId,
  createdBy,
  mustChangePassword = false,
  activationTokenHash,
  activationTokenExpiresAt,
}) {
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
    id: isUuid(id) ? id : crypto.randomUUID(),
    name: name || fullName,
    fullName: fullName || name,
    email: normalizedEmail,
    phone: phone || null,
    passwordHash,
    role,
    roleId: roleId || role,
    department: department || null,
    departmentId: departmentId || null,
    employeeId: employeeId || null,
    jobTitle: jobTitle || null,
    organizationId: organizationId || null,
    organization_id: organizationId || null,
    employerId: employerId || null,
    employer_id: employerId || null,
    accountType: accountType || (role === "superadmin" ? "SUPER_ADMIN" : role === "admin" ? "ADMIN" : "STAFF"),
    status,
    permissions,
    failedLoginCount: 0,
    failedLoginAttempts: 0,
    forcePasswordReset: Boolean(mustChangePassword),
    mustChangePassword: Boolean(mustChangePassword),
    emailVerified: false,
    phoneVerified: false,
    passwordChangedAt: now,
    passwordExpiresAt: null,
    lockedAt: null,
    lockedUntil: null,
    activationTokenHash: activationTokenHash || null,
    activationTokenExpiresAt: activationTokenExpiresAt || null,
    createdBy: createdBy || null,
    updatedBy: null,
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
    updatedBy: payload.updatedBy || users[userIndex].updatedBy || null,
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
    mustChangePassword: false,
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
  listRawUsers,
  listUsers,
  sanitizeUser,
  updateUser,
  updateUserPassword,
};
