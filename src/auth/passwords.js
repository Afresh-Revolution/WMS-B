const crypto = require("crypto");

const HASH_ALGORITHM = "sha256";
const KEY_LENGTH = 64;
const ITERATIONS = 310000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, HASH_ALGORITHM)
    .toString("base64url");

  return `pbkdf2_${HASH_ALGORITHM}$${ITERATIONS}$${salt}$${hash}`;
}

function firstNameFromIdentity(payload = {}) {
  const explicit = String(payload.firstName || payload.first_name || payload.givenName || "").trim();
  if (explicit) {
    return explicit;
  }
  const fullName = String(payload.fullName || payload.full_name || payload.name || "").trim();
  return fullName.split(/\s+/).filter(Boolean)[0] || "";
}

function generateFirstNameTemporaryPassword(payload = {}) {
  return firstNameFromIdentity(payload) || "Welcome";
}

function verifyPassword(password, storedPasswordHash) {
  const parts = String(storedPasswordHash || "").split("$");
  if (parts.length !== 4) {
    return false;
  }

  const [algorithmName, iterationsValue, salt, expectedHash] = parts;
  const algorithm = algorithmName.replace("pbkdf2_", "");
  const iterations = Number(iterationsValue);

  if (algorithm !== HASH_ALGORITHM || !Number.isInteger(iterations) || iterations < 1) {
    return false;
  }

  const actualHash = crypto
    .pbkdf2Sync(password, salt, iterations, KEY_LENGTH, algorithm)
    .toString("base64url");

  const expectedBuffer = Buffer.from(expectedHash);
  const actualBuffer = Buffer.from(actualHash);

  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

module.exports = {
  firstNameFromIdentity,
  generateFirstNameTemporaryPassword,
  hashPassword,
  verifyPassword,
};
