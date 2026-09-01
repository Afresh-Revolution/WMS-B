const crypto = require("crypto");
const { verifyPassword } = require("../../auth/passwords");
const { listSessions, revokeSession, revokeUserSessions } = require("../../auth/sessionStore");
const { getUserById, listUsers, sanitizeUser, updateUser } = require("../../auth/userStore");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { recordTechnicalAuditEvent, redactSensitiveData } = require("../_shared/auditService");

function envNumber(name, fallback, min = 1) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

const DEFAULT_MAX_LOGIN_ATTEMPTS = envNumber("MAX_LOGIN_ATTEMPTS", 10);
const DEFAULT_LOCKOUT_DURATION_MINUTES = envNumber("LOCKOUT_DURATION_MINUTES", 15);

const DEFAULT_SECURITY_SETTINGS = Object.freeze({
  minimumPasswordLength: 10,
  minimum_password_length: 10,
  requireUppercase: true,
  require_uppercase: true,
  requireLowercase: true,
  require_lowercase: true,
  requireNumber: true,
  require_number: true,
  requireSymbol: true,
  require_symbol: true,
  passwordExpiryEnabled: false,
  password_expiry_enabled: false,
  passwordExpiryDays: 90,
  password_expiry_days: 90,
  passwordHistoryEnabled: true,
  password_history_enabled: true,
  passwordHistoryCount: 5,
  password_history_count: 5,
  requireMfa: false,
  require_mfa: false,
  allowEmailMfa: true,
  allow_email_mfa: true,
  allowAuthenticatorMfa: true,
  allow_authenticator_mfa: true,
  maxLoginAttempts: DEFAULT_MAX_LOGIN_ATTEMPTS,
  max_login_attempts: DEFAULT_MAX_LOGIN_ATTEMPTS,
  lockoutDurationMinutes: DEFAULT_LOCKOUT_DURATION_MINUTES,
  lockout_duration_minutes: DEFAULT_LOCKOUT_DURATION_MINUTES,
  sessionTimeoutMinutes: 60,
  session_timeout_minutes: 60,
  maxConcurrentSessions: 5,
  max_concurrent_sessions: 5,
  allowRememberDevice: true,
  allow_remember_device: true,
  maintenanceMode: false,
  maintenance_mode: false,
  maintenanceMessage: "System is currently under maintenance.",
  maintenance_message: "System is currently under maintenance.",
});

function now() {
  return new Date().toISOString();
}

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Boolean(value);
}

function normalizeNumber(value, fallback, min = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function normalizeSecuritySettings(payload = {}) {
  return {
    minimumPasswordLength: normalizeNumber(payload.minimumPasswordLength ?? payload.minimum_password_length, 10, 1),
    minimum_password_length: normalizeNumber(payload.minimumPasswordLength ?? payload.minimum_password_length, 10, 1),
    requireUppercase: normalizeBoolean(payload.requireUppercase ?? payload.require_uppercase, true),
    require_uppercase: normalizeBoolean(payload.requireUppercase ?? payload.require_uppercase, true),
    requireLowercase: normalizeBoolean(payload.requireLowercase ?? payload.require_lowercase, true),
    require_lowercase: normalizeBoolean(payload.requireLowercase ?? payload.require_lowercase, true),
    requireNumber: normalizeBoolean(payload.requireNumber ?? payload.require_number, true),
    require_number: normalizeBoolean(payload.requireNumber ?? payload.require_number, true),
    requireSymbol: normalizeBoolean(payload.requireSymbol ?? payload.require_symbol, true),
    require_symbol: normalizeBoolean(payload.requireSymbol ?? payload.require_symbol, true),
    passwordExpiryEnabled: normalizeBoolean(payload.passwordExpiryEnabled ?? payload.password_expiry_enabled, false),
    password_expiry_enabled: normalizeBoolean(payload.passwordExpiryEnabled ?? payload.password_expiry_enabled, false),
    passwordExpiryDays: normalizeNumber(payload.passwordExpiryDays ?? payload.password_expiry_days, 90, 1),
    password_expiry_days: normalizeNumber(payload.passwordExpiryDays ?? payload.password_expiry_days, 90, 1),
    passwordHistoryEnabled: normalizeBoolean(payload.passwordHistoryEnabled ?? payload.password_history_enabled, true),
    password_history_enabled: normalizeBoolean(payload.passwordHistoryEnabled ?? payload.password_history_enabled, true),
    passwordHistoryCount: normalizeNumber(payload.passwordHistoryCount ?? payload.password_history_count, 5, 0),
    password_history_count: normalizeNumber(payload.passwordHistoryCount ?? payload.password_history_count, 5, 0),
    requireMfa: normalizeBoolean(payload.requireMfa ?? payload.require_mfa, false),
    require_mfa: normalizeBoolean(payload.requireMfa ?? payload.require_mfa, false),
    allowEmailMfa: normalizeBoolean(payload.allowEmailMfa ?? payload.allow_email_mfa, true),
    allow_email_mfa: normalizeBoolean(payload.allowEmailMfa ?? payload.allow_email_mfa, true),
    allowAuthenticatorMfa: normalizeBoolean(payload.allowAuthenticatorMfa ?? payload.allow_authenticator_mfa, true),
    allow_authenticator_mfa: normalizeBoolean(payload.allowAuthenticatorMfa ?? payload.allow_authenticator_mfa, true),
    maxLoginAttempts: normalizeNumber(payload.maxLoginAttempts ?? payload.max_login_attempts, DEFAULT_MAX_LOGIN_ATTEMPTS, 1),
    max_login_attempts: normalizeNumber(payload.maxLoginAttempts ?? payload.max_login_attempts, DEFAULT_MAX_LOGIN_ATTEMPTS, 1),
    lockoutDurationMinutes: normalizeNumber(payload.lockoutDurationMinutes ?? payload.lockout_duration_minutes, DEFAULT_LOCKOUT_DURATION_MINUTES, 1),
    lockout_duration_minutes: normalizeNumber(payload.lockoutDurationMinutes ?? payload.lockout_duration_minutes, DEFAULT_LOCKOUT_DURATION_MINUTES, 1),
    sessionTimeoutMinutes: normalizeNumber(payload.sessionTimeoutMinutes ?? payload.session_timeout_minutes, 60, 1),
    session_timeout_minutes: normalizeNumber(payload.sessionTimeoutMinutes ?? payload.session_timeout_minutes, 60, 1),
    maxConcurrentSessions: normalizeNumber(payload.maxConcurrentSessions ?? payload.max_concurrent_sessions, 5, 1),
    max_concurrent_sessions: normalizeNumber(payload.maxConcurrentSessions ?? payload.max_concurrent_sessions, 5, 1),
    allowRememberDevice: normalizeBoolean(payload.allowRememberDevice ?? payload.allow_remember_device, true),
    allow_remember_device: normalizeBoolean(payload.allowRememberDevice ?? payload.allow_remember_device, true),
    maintenanceMode: normalizeBoolean(payload.maintenanceMode ?? payload.maintenance_mode, false),
    maintenance_mode: normalizeBoolean(payload.maintenanceMode ?? payload.maintenance_mode, false),
    maintenanceMessage:
      payload.maintenanceMessage ??
      payload.maintenance_message ??
      "System is currently under maintenance.",
    maintenance_message:
      payload.maintenanceMessage ??
      payload.maintenance_message ??
      "System is currently under maintenance.",
  };
}

function getActiveSecuritySettings() {
  const active = readCollection("security_settings").find((record) => !record.deletedAt && record.active !== false);
  if (!active) {
    return {
      id: null,
      active: true,
      ...DEFAULT_SECURITY_SETTINGS,
      createdAt: null,
      updatedAt: null,
      updatedBy: null,
    };
  }

  return {
    ...DEFAULT_SECURITY_SETTINGS,
    ...active,
    ...normalizeSecuritySettings(active),
  };
}

function audit(req, action, targetType, targetId, oldValue, newValue, reason, outcome = "SUCCESS") {
  return recordTechnicalAuditEvent({
    user: req.user,
    action,
    module: "Security",
    targetType,
    targetId,
    description: reason || action,
    beforeData: redactSensitiveData(oldValue || null),
    afterData: redactSensitiveData(newValue || null),
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
    status: outcome,
    severity: action.includes("FAILED") || action.includes("LOCKED") ? "WARNING" : "INFO",
    service: "security",
  });
}

function upsertSecuritySettings(partial, req, action, allowedKeys) {
  const current = getActiveSecuritySettings();
  const selected = {};
  for (const key of allowedKeys) {
    if (partial[key] !== undefined) selected[key] = partial[key];
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (partial[snake] !== undefined) selected[snake] = partial[snake];
  }

  const normalized = normalizeSecuritySettings({ ...current, ...selected });
  const records = readCollection("security_settings");
  const timestamp = now();
  const payload = {
    ...current,
    ...normalized,
    active: true,
    updatedBy: req.user.id,
    updated_by: req.user.id,
    updatedAt: timestamp,
    updated_at: timestamp,
  };

  let saved;
  const index = records.findIndex((record) => !record.deletedAt && record.active !== false);
  if (index === -1) {
    saved = {
      id: crypto.randomUUID(),
      ...payload,
      createdAt: timestamp,
      created_at: timestamp,
    };
    records.push(saved);
  } else {
    saved = { ...records[index], ...payload };
    records[index] = saved;
  }

  writeCollection("security_settings", records);
  audit(req, action, "SecuritySettings", saved.id, current, saved, action);
  appendSecurityEvent(action, req.user, saved.id, { changedKeys: allowedKeys }, req, "success");
  return saved;
}

function getDashboardData(query = {}) {
  const settings = getActiveSecuritySettings();
  const failedLogins = readCollection("failed_logins").filter((record) => !record.deletedAt);
  const loginAttempts = readCollection("login_attempts").filter((record) => !record.deletedAt);
  const sessions = listSessions(query);
  const users = listUsers();
  const securityEvents = readCollection("security_events").filter((record) => !record.deletedAt);

  return {
    passwordRules: {
      minimumPasswordLength: settings.minimumPasswordLength,
      requireSymbol: settings.requireSymbol,
      requireNumber: settings.requireNumber,
      requireUppercase: settings.requireUppercase,
      requireLowercase: settings.requireLowercase,
      passwordExpiryEnabled: settings.passwordExpiryEnabled,
      passwordExpiryDays: settings.passwordExpiryDays,
      passwordHistoryEnabled: settings.passwordHistoryEnabled,
      passwordHistoryCount: settings.passwordHistoryCount,
    },
    authentication: {
      requireMfa: settings.requireMfa,
      methods: {
        email: settings.allowEmailMfa,
        authenticator: settings.allowAuthenticatorMfa,
      },
      maxLoginAttempts: settings.maxLoginAttempts,
      lockoutDurationMinutes: settings.lockoutDurationMinutes,
    },
    sessions: {
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      maxConcurrentSessions: settings.maxConcurrentSessions,
      allowRememberDevice: settings.allowRememberDevice,
      activeSessions: sessions.filter((session) => session.status === "active" && !session.revokedAt).length,
    },
    systemSecurity: {
      maintenanceMode: settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMessage,
    },
    securityActivity: {
      failedLoginAttempts: failedLogins.slice(-20),
      loginAttempts: loginAttempts.slice(-20),
      lockedAccounts: users.filter((user) => user.status === "locked" || user.lockedAt),
      recentSecurityEvents: securityEvents.slice(-20),
      activeSessions: sessions.filter((session) => session.status === "active" && !session.revokedAt).slice(-20),
    },
    settings,
  };
}

function validatePasswordAgainstPolicy(password, userId = null) {
  const settings = getActiveSecuritySettings();
  const errors = [];
  if (typeof password !== "string") errors.push("Password is required.");
  if (String(password || "").length < settings.minimumPasswordLength) {
    errors.push(`Password must be at least ${settings.minimumPasswordLength} characters.`);
  }
  if (settings.requireUppercase && !/[A-Z]/.test(password || "")) errors.push("Password must include an uppercase letter.");
  if (settings.requireLowercase && !/[a-z]/.test(password || "")) errors.push("Password must include a lowercase letter.");
  if (settings.requireNumber && !/[0-9]/.test(password || "")) errors.push("Password must include a number.");
  if (settings.requireSymbol && !/[^A-Za-z0-9]/.test(password || "")) errors.push("Password must include a symbol.");

  if (userId && settings.passwordHistoryEnabled) {
    const history = readCollection("password_history")
      .filter((record) => record.userId === userId || record.user_id === userId)
      .slice(-settings.passwordHistoryCount);
    if (history.some((record) => verifyPassword(password, record.passwordHash || record.password_hash))) {
      errors.push("Password was used recently and cannot be reused.");
    }
  }

  if (errors.length > 0) {
    throw createHttpError(400, "Password does not meet security policy.", "PASSWORD_POLICY_VIOLATION", { errors });
  }

  return true;
}

function recordPasswordHistory(user) {
  if (!user?.passwordHash) return null;
  return appendRecord("password_history", {
    id: crypto.randomUUID(),
    userId: user.id,
    user_id: user.id,
    passwordHash: user.passwordHash,
    password_hash: user.passwordHash,
    createdAt: now(),
    created_at: now(),
  });
}

function recordLoginAttempt({ userId, email, req, successful, failureReason }) {
  return appendRecord("login_attempts", {
    id: crypto.randomUUID(),
    userId: userId || null,
    user_id: userId || null,
    email: String(email || "").toLowerCase(),
    ipAddress: req?.ip || null,
    ip_address: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
    user_agent: req?.get ? req.get("user-agent") : null,
    successful: Boolean(successful),
    failureReason: failureReason || null,
    failure_reason: failureReason || null,
    createdAt: now(),
    created_at: now(),
  });
}

function appendSecurityEvent(action, user, targetId, metadata, req, outcome = "success") {
  return appendRecord("security_events", {
    id: crypto.randomUUID(),
    action,
    actorUserId: user?.id || null,
    actor_user_id: user?.id || null,
    targetId: targetId || null,
    target_id: targetId || null,
    metadata: redactSensitiveData(metadata || {}),
    ipAddress: req?.ip || null,
    ip_address: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
    user_agent: req?.get ? req.get("user-agent") : null,
    outcome,
    createdAt: now(),
    created_at: now(),
  });
}

function getUserMfa(userId) {
  return readCollection("user_mfa").filter((record) => !record.deletedAt && (record.userId === userId || record.user_id === userId));
}

function isMfaRequiredForUser(user) {
  const settings = getActiveSecuritySettings();
  if (!settings.requireMfa) return false;
  if (user.role === "superadmin") return true;
  return true;
}

function encryptSecret(value) {
  return `enc:${Buffer.from(String(value)).toString("base64url")}`;
}

function createMfaChallenge(user, req, method = "email") {
  const settings = getActiveSecuritySettings();
  if (method === "email" && !settings.allowEmailMfa) {
    throw createHttpError(400, "Email MFA is not allowed.", "MFA_METHOD_DISABLED");
  }
  if (method === "authenticator" && !settings.allowAuthenticatorMfa) {
    throw createHttpError(400, "Authenticator MFA is not allowed.", "MFA_METHOD_DISABLED");
  }

  const code = String(crypto.randomInt(100000, 999999));
  const challenge = appendRecord("mfa_challenges", {
    id: crypto.randomUUID(),
    userId: user.id,
    user_id: user.id,
    method,
    otpHash: crypto.createHash("sha256").update(code).digest("base64url"),
    otp_hash: crypto.createHash("sha256").update(code).digest("base64url"),
    status: "pending",
    expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
    createdAt: now(),
    created_at: now(),
  });

  appendRecord("notifications", {
    id: crypto.randomUUID(),
    userId: user.id,
    user_id: user.id,
    type: "mfa_challenge",
    title: "Your security verification code",
    message: "Use the verification code sent through your configured channel.",
    channel: method === "email" ? "email" : "in_app",
    status: "pending",
    metadata: { challengeId: challenge.id },
    createdAt: now(),
    created_at: now(),
  });

  appendSecurityEvent("MFA_CHALLENGE_CREATED", user, challenge.id, { method }, req);
  return {
    challengeId: challenge.id,
    method,
    expiresAt: challenge.expiresAt,
    expires_at: challenge.expires_at,
  };
}

function verifyMfaChallenge(challengeId, code, req) {
  const challenges = readCollection("mfa_challenges");
  const index = challenges.findIndex((challenge) => challenge.id === challengeId && challenge.status === "pending");
  if (index === -1) {
    throw createHttpError(400, "MFA challenge is invalid.", "MFA_CHALLENGE_INVALID");
  }

  const challenge = challenges[index];
  if (new Date(challenge.expiresAt || challenge.expires_at).getTime() < Date.now()) {
    challenges[index] = { ...challenge, status: "expired", updatedAt: now(), updated_at: now() };
    writeCollection("mfa_challenges", challenges);
    throw createHttpError(400, "MFA challenge expired.", "MFA_CHALLENGE_EXPIRED");
  }

  const actual = crypto.createHash("sha256").update(String(code || "")).digest("base64url");
  const expected = challenge.otpHash || challenge.otp_hash;
  if (actual !== expected) {
    challenges[index] = { ...challenge, failedAttempts: Number(challenge.failedAttempts || 0) + 1, updatedAt: now(), updated_at: now() };
    writeCollection("mfa_challenges", challenges);
    appendSecurityEvent("MFA_FAILED", getUserById(challenge.userId || challenge.user_id), challenge.id, {}, req, "failed");
    throw createHttpError(401, "MFA verification failed.", "MFA_FAILED");
  }

  challenges[index] = { ...challenge, status: "verified", verifiedAt: now(), verified_at: now(), updatedAt: now(), updated_at: now() };
  writeCollection("mfa_challenges", challenges);
  const user = getUserById(challenge.userId || challenge.user_id);
  appendSecurityEvent("MFA_SUCCESS", user, challenge.id, {}, req);
  return user;
}

function upsertMfa(userId, payload, req) {
  const user = getUserById(userId);
  if (!user) return null;
  const records = readCollection("user_mfa");
  const method = payload.method || "email";
  const index = records.findIndex((record) => !record.deletedAt && (record.userId === userId || record.user_id === userId) && record.method === method);
  const data = {
    userId,
    user_id: userId,
    method,
    secretEncrypted: payload.secret ? encryptSecret(payload.secret) : undefined,
    secret_encrypted: payload.secret ? encryptSecret(payload.secret) : undefined,
    enabled: Boolean(payload.enabled),
    verified: Boolean(payload.verified),
    updatedAt: now(),
    updated_at: now(),
  };
  let record;
  if (index === -1) {
    record = { id: crypto.randomUUID(), ...data, createdAt: now(), created_at: now(), lastUsedAt: null, last_used_at: null };
    records.push(record);
  } else {
    record = { ...records[index], ...data };
    records[index] = record;
  }
  writeCollection("user_mfa", records);
  appendSecurityEvent(payload.enabled ? "MFA_ENABLED" : "MFA_DISABLED", req.user, userId, { method }, req);
  audit(req, payload.enabled ? "MFA_ENABLED" : "MFA_DISABLED", "UserMfa", record.id, null, sanitizeMfa(record), "MFA configuration changed.");
  return sanitizeMfa(record);
}

function sanitizeMfa(record) {
  if (!record) return null;
  const { secretEncrypted, secret_encrypted, ...safe } = record;
  return { ...safe, hasSecret: Boolean(secretEncrypted || secret_encrypted) };
}

function sanitizeSession(session) {
  if (!session) return null;
  const { refreshTokenHash, sessionTokenHash, session_token_hash, refresh_token_hash, ...safe } = session;
  return safe;
}

function enforceSessionPolicy(userId, currentSessionId, req) {
  const settings = getActiveSecuritySettings();
  const sessions = listSessions({ userId })
    .filter((session) => session.status === "active" && !session.revokedAt)
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const overflow = Math.max(0, sessions.length - settings.maxConcurrentSessions);
  for (const session of sessions.slice(0, overflow)) {
    if (session.id !== currentSessionId) {
      revokeSession(session.id, userId, "concurrent_session_limit");
      appendSecurityEvent("SESSION_REVOKED", getUserById(userId), session.id, { reason: "concurrent_session_limit" }, req);
    }
  }
}

function isSessionExpired(session) {
  if (!session) return true;
  const settings = getActiveSecuritySettings();
  const expiresAt = session.expiresAt || session.expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return true;
  const lastActivity = session.lastActivityAt || session.last_activity_at || session.lastUsedAt || session.last_used_at || session.lastSeenAt;
  if (!lastActivity) return false;
  return Date.now() - new Date(lastActivity).getTime() > settings.sessionTimeoutMinutes * 60 * 1000;
}

function createTrustedDevice(userId, payload, req) {
  const settings = getActiveSecuritySettings();
  if (!settings.allowRememberDevice) {
    throw createHttpError(400, "Remember device is disabled.", "REMEMBER_DEVICE_DISABLED");
  }
  const identifier = payload.deviceIdentifier || payload.device_identifier || req.get("user-agent") || crypto.randomUUID();
  const record = appendRecord("trusted_devices", {
    id: crypto.randomUUID(),
    userId,
    user_id: userId,
    deviceIdentifierHash: crypto.createHash("sha256").update(String(identifier)).digest("base64url"),
    device_identifier_hash: crypto.createHash("sha256").update(String(identifier)).digest("base64url"),
    deviceName: payload.deviceName || payload.device_name || req.get("user-agent") || "Unknown device",
    device_name: payload.deviceName || payload.device_name || req.get("user-agent") || "Unknown device",
    createdAt: now(),
    created_at: now(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
    revokedAt: null,
    revoked_at: null,
    lastUsedAt: now(),
    last_used_at: now(),
  });
  appendSecurityEvent("TRUSTED_DEVICE_ADDED", getUserById(userId), record.id, {}, req);
  return record;
}

function listTrustedDevices(query = {}) {
  const devices = applyBasicFilters(readCollection("trusted_devices"), query, ["userId", "deviceName", "device_name"]);
  return paginate(devices, query);
}

function revokeTrustedDevice(id, req) {
  const records = readCollection("trusted_devices");
  const index = records.findIndex((record) => record.id === id && !record.revokedAt && !record.revoked_at);
  if (index === -1) return null;
  records[index] = { ...records[index], revokedAt: now(), revoked_at: now(), updatedAt: now(), updated_at: now() };
  writeCollection("trusted_devices", records);
  appendSecurityEvent("TRUSTED_DEVICE_REVOKED", req.user, id, {}, req);
  audit(req, "TRUSTED_DEVICE_REVOKED", "TrustedDevice", id, null, records[index], "Trusted device revoked.");
  return records[index];
}

function listLoginAttempts(query = {}) {
  const attempts = applyBasicFilters(readCollection("login_attempts"), { ...query, q: query.q || query.search }, [
    "email",
    "failureReason",
    "failure_reason",
    "ipAddress",
    "ip_address",
  ]);
  return paginate(attempts, query);
}

function listSecurityEvents(query = {}) {
  const events = applyBasicFilters(readCollection("security_events"), { ...query, q: query.q || query.search }, [
    "action",
    "outcome",
  ]);
  return paginate(events, query);
}

function unlockAccount(userId, req) {
  const user = getUserById(userId);
  if (!user) return null;
  const oldValue = sanitizeUser(user);
  const updated = updateUser(userId, {
    status: "active",
    lockedAt: null,
    lockedUntil: null,
    failedLoginAttempts: 0,
    failedLoginCount: 0,
    updatedBy: req.user.id,
  });
  appendSecurityEvent("ACCOUNT_UNLOCKED", req.user, userId, { targetUserId: userId }, req);
  audit(req, "ACCOUNT_UNLOCKED", "User", userId, oldValue, sanitizeUser(updated), "Account unlocked.");
  return sanitizeUser(updated);
}

function revokeAllSessionsForUser(userId, req) {
  const revoked = revokeUserSessions(userId, req.user.id);
  appendSecurityEvent("ALL_SESSIONS_REVOKED", req.user, userId, { revokedSessionCount: revoked.length }, req);
  audit(req, "ALL_SESSIONS_REVOKED", "UserSession", userId, null, { revokedSessionCount: revoked.length }, "All sessions revoked.");
  return revoked.map(sanitizeSession);
}

function revokeOneSession(sessionId, req) {
  const session = revokeSession(sessionId, req.user.id, req.body?.reason || "admin_revoked");
  if (!session) return null;
  appendSecurityEvent("SESSION_REVOKED", req.user, sessionId, { reason: req.body?.reason || "admin_revoked" }, req);
  audit(req, "SESSION_REVOKED", "UserSession", sessionId, null, sanitizeSession(session), "Session revoked.");
  return sanitizeSession(session);
}

module.exports = {
  appendSecurityEvent,
  createMfaChallenge,
  createTrustedDevice,
  DEFAULT_SECURITY_SETTINGS,
  enforceSessionPolicy,
  getActiveSecuritySettings,
  getDashboardData,
  getUserMfa,
  isMfaRequiredForUser,
  isSessionExpired,
  listLoginAttempts,
  listSecurityEvents,
  listTrustedDevices,
  recordLoginAttempt,
  recordPasswordHistory,
  revokeAllSessionsForUser,
  revokeOneSession,
  revokeTrustedDevice,
  sanitizeSession,
  unlockAccount,
  upsertMfa,
  upsertSecuritySettings,
  validatePasswordAgainstPolicy,
  verifyMfaChallenge,
};
