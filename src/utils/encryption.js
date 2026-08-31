const crypto = require("crypto");

const PREFIX = "enc:v1";

function getKeyMaterial() {
  const raw = process.env.ENCRYPTION_KEY || process.env.AUTH_TOKEN_SECRET || "development-only-encryption-key";
  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encryptSecret(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (String(value).startsWith(`${PREFIX}:`)) {
    return String(value);
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKeyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptSecret(value) {
  if (!value) {
    return null;
  }
  const serialized = String(value);
  if (!serialized.startsWith(`${PREFIX}:`)) {
    return serialized;
  }

  const [, , ivValue, tagValue, encryptedValue] = serialized.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKeyMaterial(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function redactSecret(value) {
  return value ? "[REDACTED]" : null;
}

module.exports = { decryptSecret, encryptSecret, redactSecret };
