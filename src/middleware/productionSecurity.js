function securityHeadersMiddleware(_config = {}) {
  return (_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("cross-origin-resource-policy", "same-site");
    res.setHeader("cache-control", "no-store");
    return next();
  };
}

function corsMiddleware(config = {}) {
  const allowedOrigins = new Set(config.cors?.origins || []);
  const allowCredentials = config.cors?.allowCredentials !== false;

  return (req, res, next) => {
    const origin = req.get("origin");

    if (origin && (allowedOrigins.size === 0 || allowedOrigins.has(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      if (allowCredentials) {
        res.setHeader("access-control-allow-credentials", "true");
      }
    } else if (origin && allowedOrigins.size > 0 && req.path.startsWith("/api")) {
      return res.status(403).json({
        success: false,
        message: "Operation failed",
        error: { code: "CORS_ORIGIN_NOT_ALLOWED", details: { origin } },
      });
    }

    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("access-control-allow-headers", req.get("access-control-request-headers") || "authorization,content-type,x-request-id");
      res.setHeader("access-control-max-age", "600");
      return res.status(204).end();
    }

    return next();
  };
}

function rateLimitMiddleware(config = {}) {
  const buckets = new Map();
  const windowMs = config.windowMs || 15 * 60 * 1000;
  const defaultMax = config.max || 600;
  const authMax = config.authMax || 30;

  return (req, res, next) => {
    if (req.method === "OPTIONS" || req.path.startsWith("/health") || req.path === "/live" || req.path === "/ready") {
      return next();
    }

    const now = Date.now();
    const isAuthPath = req.path.includes("/auth/") || req.path.includes("/superadmin/login") || req.path.includes("/superadmin/bootstrap");
    const max = isAuthPath ? authMax : defaultMax;
    const identity = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${identity}:${isAuthPath ? "auth" : "api"}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      setRateLimitHeaders(res, max, max - 1, Math.ceil((now + windowMs) / 1000));
      return next();
    }

    bucket.count += 1;
    const remaining = Math.max(max - bucket.count, 0);
    setRateLimitHeaders(res, max, remaining, Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message: "Operation failed",
        error: { code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) } },
      });
    }

    return next();
  };
}

function setRateLimitHeaders(res, limit, remaining, reset) {
  res.setHeader("ratelimit-limit", String(limit));
  res.setHeader("ratelimit-remaining", String(remaining));
  res.setHeader("ratelimit-reset", String(reset));
}

module.exports = { securityHeadersMiddleware, corsMiddleware, rateLimitMiddleware };
