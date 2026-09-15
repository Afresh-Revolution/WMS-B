const crypto = require("crypto");
const { hashToken } = require("./tokens");
const { readCollection, writeCollection } = require("../database/jsonStore");

const SESSION_COLLECTION = "sessions";
const LOGIN_HISTORY_COLLECTION = "login_history";
const FAILED_LOGIN_COLLECTION = "failed_logins";

function now() {
  return new Date().toISOString();
}

function getRequestContext(req) {
  const userAgent = req.get("user-agent") || null;
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent,
    device: req.get("sec-ch-ua-platform") || null,
    browser: userAgent,
    operatingSystem: req.get("sec-ch-ua-platform") || null,
    location: null,
  };
}

function getRememberMeTtlMinutes() {
  const configuredDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS);
  const days = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 30;
  return days * 24 * 60;
}

function createSession({ user, refreshToken, req, rememberMe = false }) {
  const { getActiveSecuritySettings } = require("../modules/security/securityService");
  const securitySettings = getActiveSecuritySettings();
  const keepSignedIn = Boolean(rememberMe && securitySettings.allowRememberDevice);
  const ttlMinutes = keepSignedIn ? getRememberMeTtlMinutes() : securitySettings.sessionTimeoutMinutes;
  const timestamp = now();
  const session = {
    id: crypto.randomUUID(),
    userId: user.id,
    refreshTokenHash: hashToken(refreshToken),
    status: "active",
    rememberMe: keepSignedIn,
    remember_me: keepSignedIn,
    ...getRequestContext(req),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
    lastUsedAt: timestamp,
    expiresAt: new Date(Date.now() + 1000 * 60 * ttlMinutes).toISOString(),
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    revoke_reason: null,
  };

  const sessions = readCollection(SESSION_COLLECTION);
  sessions.push(session);
  writeCollection(SESSION_COLLECTION, sessions);
  mirrorSessionToPostgres(session);
  return session;
}

function getActiveSession(id) {
  const { isSessionExpired } = require("../modules/security/securityService");
  const session =
    readCollection(SESSION_COLLECTION).find(
      (candidate) => candidate.id === id && candidate.status === "active" && !candidate.revokedAt
    ) || null;
  if (!session) {
    return null;
  }
  if (isSessionExpired(session)) {
    revokeSession(id, session.userId, "expired_or_timed_out");
    return null;
  }

  return session;
}

function touchSession(id) {
  const sessions = readCollection(SESSION_COLLECTION);
  const index = sessions.findIndex((session) => session.id === id);

  if (index === -1) {
    return null;
  }

  sessions[index] = { ...sessions[index], lastSeenAt: now(), lastUsedAt: now(), updatedAt: now() };
  writeCollection(SESSION_COLLECTION, sessions);
  mirrorSessionActivityToPostgres(sessions[index]);
  return sessions[index];
}

function revokeSession(id, actorId, reason) {
  const sessions = readCollection(SESSION_COLLECTION);
  const index = sessions.findIndex((session) => session.id === id);

  if (index === -1) {
    return null;
  }

  sessions[index] = {
    ...sessions[index],
    status: "revoked",
    revokedAt: now(),
    revokedBy: actorId || null,
    revokeReason: reason || "revoked",
    revoke_reason: reason || "revoked",
    updatedAt: now(),
  };
  writeCollection(SESSION_COLLECTION, sessions);
  mirrorSessionRevocationToPostgres(sessions[index]);
  return sessions[index];
}

function revokeUserSessions(userId, actorId, reason) {
  const sessions = readCollection(SESSION_COLLECTION);
  const timestamp = now();
  const updated = sessions.map((session) => {
    if (session.userId !== userId || session.status !== "active") {
      return session;
    }

    return {
      ...session,
      status: "revoked",
      revokedAt: timestamp,
      revokedBy: actorId || null,
      revokeReason: reason || "revoked_all",
      revoke_reason: reason || "revoked_all",
      updatedAt: timestamp,
    };
  });

  writeCollection(SESSION_COLLECTION, updated);
  updated
    .filter((session) => session.userId === userId && session.revokedAt === timestamp)
    .forEach(mirrorSessionRevocationToPostgres);
  return updated.filter((session) => session.userId === userId && session.revokedAt === timestamp);
}

function mirrorSessionToPostgres(session) {
  try {
    const { isDatabaseConfigured, query } = require("../modules/_shared/postgres");
    if (!isDatabaseConfigured()) return;
    query(
      `insert into user_sessions
        (id, user_id, session_token_hash, ip_address, device, browser, user_agent, last_activity, expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (session_token_hash)
       do update set last_activity = excluded.last_activity,
                     expires_at = excluded.expires_at,
                     user_agent = excluded.user_agent`,
      [
        session.id,
        session.userId,
        session.refreshTokenHash,
        session.ipAddress || null,
        session.device || null,
        session.browser || null,
        session.userAgent || null,
        session.lastUsedAt || session.lastSeenAt || session.createdAt,
        session.expiresAt,
        session.createdAt,
      ]
    ).catch(() => null);
  } catch (_error) {
    // Session persistence in the primary auth store must not depend on Postgres availability.
  }
}

function mirrorSessionActivityToPostgres(session) {
  try {
    const { isDatabaseConfigured, query } = require("../modules/_shared/postgres");
    if (!isDatabaseConfigured()) return;
    query(`update user_sessions set last_activity = $2 where id = $1`, [
      session.id,
      session.lastUsedAt || session.lastSeenAt || now(),
    ]).catch(() => null);
  } catch (_error) {
    // Best effort mirror only.
  }
}

function mirrorSessionRevocationToPostgres(session) {
  try {
    const { isDatabaseConfigured, query } = require("../modules/_shared/postgres");
    if (!isDatabaseConfigured()) return;
    query(`update user_sessions set expires_at = now(), last_activity = now() where id = $1`, [session.id]).catch(() => null);
  } catch (_error) {
    // Best effort mirror only.
  }
}

function findSessionByRefreshToken(refreshToken) {
  const refreshTokenHash = hashToken(refreshToken);
  return (
    readCollection(SESSION_COLLECTION).find(
      (session) =>
        session.refreshTokenHash === refreshTokenHash &&
        session.status === "active" &&
        !session.revokedAt
    ) || null
  );
}

function listSessions(query = {}) {
  const sessions = readCollection(SESSION_COLLECTION).filter((session) => !session.deletedAt);
  if (!query.userId) {
    return sessions;
  }

  return sessions.filter((session) => session.userId === query.userId);
}

function recordLoginHistory({ userId, status, req, reason }) {
  const timestamp = now();
  const events = readCollection(LOGIN_HISTORY_COLLECTION);
  const event = {
    id: crypto.randomUUID(),
    userId,
    status,
    reason: reason || null,
    ...getRequestContext(req),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  events.push(event);
  writeCollection(LOGIN_HISTORY_COLLECTION, events);
  return event;
}

function recordFailedLogin({ email, userId, req, reason }) {
  const timestamp = now();
  const attempts = readCollection(FAILED_LOGIN_COLLECTION);
  const attempt = {
    id: crypto.randomUUID(),
    email: String(email || "").toLowerCase(),
    userId: userId || null,
    reason: reason || "invalid_credentials",
    ...getRequestContext(req),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  attempts.push(attempt);
  writeCollection(FAILED_LOGIN_COLLECTION, attempts);
  return attempt;
}

module.exports = {
  createSession,
  findSessionByRefreshToken,
  getActiveSession,
  listSessions,
  recordFailedLogin,
  recordLoginHistory,
  revokeSession,
  revokeUserSessions,
  touchSession,
};
