const crypto = require("crypto");

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 8;
const REFRESH_TOKEN_BYTES = 48;

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function sign(input) {
  return crypto
    .createHmac("sha256", process.env.AUTH_TOKEN_SECRET)
    .update(input)
    .digest("base64url");
}

function issueAccessToken(user, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    sid: sessionId || null,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };

  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
  return `${unsignedToken}.${sign(unsignedToken)}`;
}

function issueRefreshToken() {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("base64url");
}

function verifyAccessToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(unsignedToken);

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  try {
    const header = base64UrlDecode(encodedHeader);
    const payload = base64UrlDecode(encodedPayload);
    const now = Math.floor(Date.now() / 1000);

    if (header.alg !== "HS256" || header.typ !== "JWT" || payload.exp <= now) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

module.exports = { hashToken, issueAccessToken, issueRefreshToken, verifyAccessToken };
