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
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get("user-agent") || null,
    device: req.get("sec-ch-ua-platform") || null,
  };
}

function createSession({ user, refreshToken, req }) {
  const timestamp = now();
  const session = {
    id: crypto.randomUUID(),
    userId: user.id,
    refreshTokenHash: hashToken(refreshToken),
    status: "active",
    ...getRequestContext(req),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
    revokedAt: null,
    revokedBy: null,
  };

  const sessions = readCollection(SESSION_COLLECTION);
  sessions.push(session);
  writeCollection(SESSION_COLLECTION, sessions);
  return session;
}

function getActiveSession(id) {
  return (
    readCollection(SESSION_COLLECTION).find(
      (session) => session.id === id && session.status === "active" && !session.revokedAt
    ) || null
  );
}

function touchSession(id) {
  const sessions = readCollection(SESSION_COLLECTION);
  const index = sessions.findIndex((session) => session.id === id);

  if (index === -1) {
    return null;
  }

  sessions[index] = { ...sessions[index], lastSeenAt: now(), updatedAt: now() };
  writeCollection(SESSION_COLLECTION, sessions);
  return sessions[index];
}

function revokeSession(id, actorId) {
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
    updatedAt: now(),
  };
  writeCollection(SESSION_COLLECTION, sessions);
  return sessions[index];
}

function revokeUserSessions(userId, actorId) {
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
      updatedAt: timestamp,
    };
  });

  writeCollection(SESSION_COLLECTION, updated);
  return updated.filter((session) => session.userId === userId && session.revokedAt === timestamp);
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
