const systemHealthService = require("../modules/systemHealth/service");

function apiMetricsMiddleware(req, res, next) {
  res.on("finish", () => {
    if (!req.startedAt) {
      return;
    }
    const elapsedNs = process.hrtime.bigint() - req.startedAt;
    const responseTimeMs = Number(elapsedNs / 1000000n);
    systemHealthService.recordApiMetric({
      route: req.route?.path ? `${req.baseUrl || ""}${req.route.path}` : req.originalUrl.split("?")[0],
      method: req.method,
      statusCode: res.statusCode,
      responseTimeMs,
    });
  });
  return next();
}

module.exports = { apiMetricsMiddleware };
