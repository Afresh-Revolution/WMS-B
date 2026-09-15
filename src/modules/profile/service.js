const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { hashPassword, verifyPassword } = require("../../auth/passwords");
const { getUserById, sanitizeUser, updateUser, updateUserPassword } = require("../../auth/userStore");
const postgresUserStore = require("../../auth/postgresUserStore");
const { listSessions, revokeSession, revokeUserSessions } = require("../../auth/sessionStore");
const { readCollection } = require("../../database/jsonStore");
const securityService = require("../security/securityService");
const technicalAuditRepository = require("../technicalAudit/repository");
const { upsertStaffEmploymentForUser } = require("../employers/staffDirectoryService");
const repository = require("./repository");

const ALLOWED_IMAGE_TYPES = Object.freeze({
  "image/jpeg": { ext: "jpg", magic: ["ffd8ff"] },
  "image/png": { ext: "png", magic: ["89504e47"] },
  "image/webp": { ext: "webp", magic: ["52494646"] },
});

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function usingPostgresUsers() {
  return postgresUserStore.isEnabled();
}

async function loadUser(id) {
  return usingPostgresUsers() ? postgresUserStore.getUserById(id) : getUserById(id);
}

async function saveUser(id, payload) {
  return usingPostgresUsers() ? postgresUserStore.updateUser(id, payload) : updateUser(id, payload);
}

async function saveUserPassword(id, passwordHash) {
  return usingPostgresUsers() ? postgresUserStore.updateUserPassword(id, passwordHash) : updateUserPassword(id, passwordHash);
}

async function getProfile(userId, requester) {
  const user = await loadUser(userId);
  if (!user) throw createHttpError(404, "Profile not found.", "PROFILE_NOT_FOUND");
  await repository.upsertUserProfile(user);
  const security = await repository.getSecurity(userId);
  const profile = sanitizeProfile(user, requester?.role === "superadmin");
  return {
    ...profile,
    department: resolveDepartment(profile.departmentId),
    roleDetails: resolveRole(profile.role, profile.roleId),
    mfa: {
      enabled: security.mfaEnabled,
      backupCodeCount: security.backupCodes.length,
      updatedAt: security.updatedAt,
    },
    sessions: listUserSessions(userId),
    loginHistory: listLoginHistory(userId, { limit: 10 }).data,
  };
}

async function updateProfile(userId, payload = {}, req) {
  const current = await loadUser(userId);
  if (!current) throw createHttpError(404, "Profile not found.", "PROFILE_NOT_FOUND");
  const allowed = {};
  if (payload.phone !== undefined) allowed.phone = payload.phone;
  if (payload.displayName !== undefined || payload.fullName !== undefined || payload.name !== undefined) {
    const name = String(payload.displayName || payload.fullName || payload.name || "").trim();
    if (name.length < 2) throw createHttpError(400, "Display name must be at least 2 characters.", "INVALID_DISPLAY_NAME");
    allowed.name = name;
    allowed.fullName = name;
  }
  if (payload.preferences !== undefined) {
    allowed.preferences = sanitizePreferences(payload.preferences);
  }
  if (payload.avatar !== undefined || payload.avatarUrl !== undefined || payload.avatar_url !== undefined) {
    allowed.avatarUrl = payload.avatar || payload.avatarUrl || payload.avatar_url;
    allowed.avatar_url = allowed.avatarUrl;
  }
  if (payload.jobTitle !== undefined || payload.job_title !== undefined || payload.roleTitle !== undefined) {
    allowed.jobTitle = payload.jobTitle || payload.job_title || payload.roleTitle;
    allowed.job_title = allowed.jobTitle;
  }
  const updated = Object.keys(allowed).length ? await saveUser(userId, allowed) : current;
  await repository.upsertUserProfile(updated);
  const employment = upsertStaffEmploymentForUser(updated || current, payload, req);
  await technicalAuditRepository.recordLog({
    req,
    action: "PROFILE_UPDATED",
    module: "Profile",
    target: userId,
    status: "success",
    metadata: { changedFields: Object.keys(allowed) },
  });
  const profile = sanitizeProfile(updated, req.user.role === "superadmin");
  return {
    ...profile,
    employment: employment?.record || null,
    department: employment?.record?.department || profile.departmentId,
    jobTitle: employment?.record?.jobPosition || profile.jobTitle,
    employmentType: employment?.record?.employmentType || null,
    startDate: employment?.record?.dateJoined || null,
    reportsTo: employment?.record?.manager || null,
  };
}

async function changePassword(userId, payload = {}, req) {
  const user = await loadUser(userId);
  if (!user || !verifyPassword(payload.currentPassword, user.passwordHash)) {
    await technicalAuditRepository.recordLog({ req, action: "PASSWORD_CHANGE_FAILED", module: "Profile", target: userId, status: "failed" });
    throw createHttpError(401, "Current password is incorrect.", "INVALID_CURRENT_PASSWORD");
  }
  securityService.validatePasswordAgainstPolicy(payload.newPassword, userId);
  securityService.recordPasswordHistory(user);
  const updated = await saveUserPassword(userId, hashPassword(payload.newPassword));
  if (payload.invalidateOtherSessions || payload.revokeOtherSessions) {
    revokeOtherSessions(userId, req.authSessionId, req);
  }
  await technicalAuditRepository.recordLog({ req, action: "PASSWORD_CHANGED", module: "Authentication", target: userId, status: "success" });
  return sanitizeProfile(updated, false);
}

async function uploadAvatar(userId, payload = {}, req) {
  const image = parseImagePayload(payload);
  const header = image.buffer.slice(0, 4).toString("hex");
  const type = ALLOWED_IMAGE_TYPES[image.mimeType];
  if (!type || !type.magic.some((magic) => header.startsWith(magic))) {
    throw createHttpError(400, "Avatar must be a JPG, PNG, or WEBP image.", "INVALID_AVATAR_TYPE");
  }
  if (image.buffer.length > 2 * 1024 * 1024) {
    throw createHttpError(400, "Avatar image must not exceed 2MB.", "AVATAR_TOO_LARGE");
  }
  const directory = path.resolve(process.env.PROFILE_AVATAR_DIR || path.join(process.cwd(), "data", "avatars"));
  await fs.mkdir(directory, { recursive: true });
  const filename = `${userId}-${Date.now()}.${type.ext}`;
  const filePath = path.join(directory, filename);
  await fs.writeFile(filePath, image.buffer, { mode: 0o600 });
  const avatarUrl = `/uploads/avatars/${filename}`;
  const updated = await saveUser(userId, { avatarUrl, avatar_url: avatarUrl });
  await repository.upsertUserProfile(updated);
  await technicalAuditRepository.recordLog({ req, action: "PROFILE_AVATAR_UPDATED", module: "Profile", target: userId, status: "success", metadata: { mimeType: image.mimeType, sizeBytes: image.buffer.length } });
  return { avatarUrl, profile: sanitizeProfile(updated, false) };
}

function listUserSessions(userId) {
  return listSessions({ userId })
    .filter((session) => session.status === "active" && !session.revokedAt && !session.revoked_at)
    .map(sanitizeSession);
}

function listLoginHistory(userId, query = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit || 25)));
  const page = Math.max(1, Number(query.page || 1));
  const records = readCollection("login_history")
    .filter((entry) => (entry.userId || entry.user_id) === userId)
    .sort((left, right) => String(right.createdAt || right.created_at || "").localeCompare(String(left.createdAt || left.created_at || "")))
    .map((entry) => ({
      id: entry.id,
      ipAddress: entry.ipAddress || entry.ip_address || null,
      location: entry.location || null,
      device: entry.device || null,
      browser: entry.browser || entry.userAgent || entry.user_agent || null,
      loginTime: entry.loginTime || entry.login_time || entry.createdAt || entry.created_at,
      status: entry.status === "logout" ? "success" : entry.status,
      reason: entry.reason || null,
    }));
  return {
    data: records.slice((page - 1) * limit, page * limit),
    meta: { page, limit, total: records.length, totalPages: Math.max(1, Math.ceil(records.length / limit)) },
  };
}

async function revokeOneUserSession(userId, sessionId, req) {
  const session = listSessions({ userId }).find((candidate) => candidate.id === sessionId);
  if (!session) return null;
  const revoked = revokeSession(sessionId, userId, "profile_revoked");
  await technicalAuditRepository.recordLog({ req, action: "SESSION_REVOKED", module: "Authentication", target: sessionId, status: "success" });
  return sanitizeSession(revoked);
}

async function revokeAllUserSessions(userId, req) {
  const currentSessionId = req.authSessionId;
  const sessions = listSessions({ userId }).filter((session) => session.id !== currentSessionId && session.status === "active");
  const revoked = [];
  for (const session of sessions) {
    const item = revokeSession(session.id, userId, "profile_revoked_all");
    if (item) revoked.push(sanitizeSession(item));
  }
  await technicalAuditRepository.recordLog({ req, action: "ALL_SESSIONS_REVOKED", module: "Authentication", target: userId, status: "success", metadata: { revokedSessionCount: revoked.length } });
  return revoked;
}

async function enableMfa(userId, req) {
  const otp = String(crypto.randomInt(100000, 999999));
  const pendingOtpHash = hashOtp(otp);
  const backupCodes = generateBackupCodes().map(hashOtp);
  const security = await repository.updateSecurity(userId, {
    mfaEnabled: false,
    backupCodes,
    pendingOtpHash,
    pendingOtpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  await technicalAuditRepository.recordLog({ req, action: "MFA_ENABLE_STARTED", module: "Security", target: userId, status: "success" });
  return {
    mfaEnabled: security.mfaEnabled,
    challenge: {
      expiresAt: security.pendingOtpExpiresAt,
      developmentOtp: process.env.NODE_ENV === "production" ? undefined : otp,
    },
  };
}

async function verifyMfa(userId, payload = {}, req) {
  const security = await repository.getSecurity(userId);
  if (!security.pendingOtpHash || !security.pendingOtpExpiresAt || new Date(security.pendingOtpExpiresAt).getTime() < Date.now()) {
    throw createHttpError(400, "MFA challenge is invalid or expired.", "MFA_CHALLENGE_INVALID");
  }
  if (hashOtp(payload.otp || payload.code) !== security.pendingOtpHash) {
    await technicalAuditRepository.recordLog({ req, action: "MFA_VERIFY_FAILED", module: "Security", target: userId, status: "failed" });
    throw createHttpError(401, "MFA verification failed.", "MFA_VERIFY_FAILED");
  }
  const updated = await repository.updateSecurity(userId, {
    mfaEnabled: true,
    backupCodes: security.backupCodes,
    pendingOtpHash: null,
    pendingOtpExpiresAt: null,
  });
  await technicalAuditRepository.recordLog({ req, action: "MFA_ENABLED", module: "Security", target: userId, status: "success" });
  return { mfaEnabled: updated.mfaEnabled, backupCodeCount: updated.backupCodes.length };
}

async function disableMfa(userId, payload = {}, req) {
  const user = await loadUser(userId);
  if (!user || !verifyPassword(payload.currentPassword, user.passwordHash)) {
    throw createHttpError(401, "Current password is incorrect.", "INVALID_CURRENT_PASSWORD");
  }
  const updated = await repository.updateSecurity(userId, {
    mfaEnabled: false,
    backupCodes: [],
    pendingOtpHash: null,
    pendingOtpExpiresAt: null,
  });
  await technicalAuditRepository.recordLog({ req, action: "MFA_DISABLED", module: "Security", target: userId, status: "success" });
  return { mfaEnabled: updated.mfaEnabled };
}

async function regenerateBackupCodes(userId, req) {
  const security = await repository.getSecurity(userId);
  const updated = await repository.updateSecurity(userId, {
    mfaEnabled: security.mfaEnabled,
    backupCodes: generateBackupCodes().map(hashOtp),
  });
  await technicalAuditRepository.recordLog({ req, action: "MFA_BACKUP_CODES_REGENERATED", module: "Security", target: userId, status: "success" });
  return { backupCodeCount: updated.backupCodes.length };
}

function sanitizeProfile(user, includeAdminFields) {
  const safe = sanitizeUser(user);
  return {
    id: safe.id,
    profilePhoto: user.avatarUrl || user.avatar_url || null,
    avatarUrl: user.avatarUrl || user.avatar_url || null,
    fullName: safe.fullName || safe.name,
    displayName: safe.name,
    email: safe.email,
    phone: safe.phone,
    departmentId: safe.departmentId,
    jobTitle: user.jobTitle || user.job_title || null,
    employeeId: safe.employeeId,
    role: safe.role,
    roleId: safe.roleId,
    accountStatus: user.accountStatus || user.account_status || safe.status,
    status: safe.status,
    lastLogin: user.lastLogin || user.last_login || safe.lastLoginAt,
    preferences: user.preferences || {},
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt,
    ...(includeAdminFields ? { permissions: safe.permissions, failedLoginAttempts: safe.failedLoginAttempts, lockedAt: safe.lockedAt } : {}),
  };
}

function sanitizeSession(session) {
  const { refreshTokenHash, sessionTokenHash, session_token_hash, refresh_token_hash, ...safe } = session || {};
  return {
    id: safe.id,
    userId: safe.userId || safe.user_id,
    ipAddress: safe.ipAddress || safe.ip_address || null,
    device: safe.device || null,
    browser: safe.browser || safe.userAgent || safe.user_agent || null,
    userAgent: safe.userAgent || safe.user_agent || null,
    lastActivity: safe.lastActivity || safe.last_activity || safe.lastSeenAt || safe.lastUsedAt || safe.last_seen_at || safe.last_used_at,
    expiresAt: safe.expiresAt || safe.expires_at || null,
    createdAt: safe.createdAt || safe.created_at || null,
    current: safe.id && safe.id === safe.currentSessionId,
  };
}

function revokeOtherSessions(userId, currentSessionId, req) {
  if (!currentSessionId) {
    return revokeUserSessions(userId, userId, "password_changed");
  }
  const revoked = [];
  for (const session of listSessions({ userId }).filter((candidate) => candidate.id !== currentSessionId && candidate.status === "active")) {
    const item = revokeSession(session.id, userId, "password_changed");
    if (item) revoked.push(item);
  }
  return revoked;
}

function sanitizePreferences(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    throw createHttpError(400, "Preferences must be an object.", "INVALID_PREFERENCES");
  }
  return preferences;
}

function parseImagePayload(payload = {}) {
  const mimeType = payload.mimeType || payload.contentType || null;
  const data = String(payload.data || payload.base64 || payload.file || "");
  const match = data.match(/^data:([^;]+);base64,(.+)$/);
  const effectiveMimeType = mimeType || match?.[1];
  const base64 = match ? match[2] : data;
  if (!effectiveMimeType || !base64) {
    throw createHttpError(400, "Avatar payload must include mimeType and base64 data.", "INVALID_AVATAR_PAYLOAD");
  }
  return { mimeType: effectiveMimeType, buffer: Buffer.from(base64, "base64") };
}

function hashOtp(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("base64url");
}

function generateBackupCodes() {
  return Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("base64url").toUpperCase());
}

function resolveDepartment(departmentId) {
  if (!departmentId) return null;
  const department = readCollection("departments").find((record) => record.id === departmentId && !record.deletedAt);
  return department ? { id: department.id, name: department.name, code: department.code || null } : null;
}

function resolveRole(role, roleId) {
  const roles = readCollection("roles");
  const found = roles.find((record) => record.id === roleId || record.key === role);
  return found ? { id: found.id, key: found.key || role, name: found.name || role } : { id: roleId || role, key: role, name: String(role || "").replace(/_/g, " ") };
}

module.exports = {
  changePassword,
  disableMfa,
  enableMfa,
  getProfile,
  listLoginHistory,
  listUserSessions,
  regenerateBackupCodes,
  revokeAllUserSessions,
  revokeOneUserSession,
  updateProfile,
  uploadAvatar,
  verifyMfa,
};
