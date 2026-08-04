const { verifyAccessToken } = require("./tokens");
const { getUserById, sanitizeUser } = require("./userStore");

function authenticate(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  const user = getUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: "User no longer exists." });
  }

  req.user = sanitizeUser(user);
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden." });
    }

    return next();
  };
}

module.exports = { authenticate, requireRole };
