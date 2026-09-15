const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { RESOURCE_MODULES, SUPER_ADMIN_NAVIGATION } = require("../_shared/moduleCatalog");
const { createResourceRouter } = require("../_shared/resourceRouter");
const { announcementsRouter } = require("../announcements/routes");
const { auditLogsRouter } = require("../auditLogs/routes");
const { backupsRouter } = require("../backups/routes");
const { billsRouter } = require("../bills/routes");
const { buildDashboardOverview } = require("../dashboard/dashboardService");
const { departmentsRouter } = require("../departments/routes");
const { disciplineRouter, employeeDisciplineRouter } = require("../discipline/routes");
const { employeesRouter } = require("../employees/routes");
const { emailConfigRouter } = require("../email/email.routes");
const { employersRouter } = require("../employers/routes");
const { eventsRouter } = require("../events/routes");
const { expensePoliciesRouter, expensesRouter } = require("../expenses/routes");
const { integrationsRouter, paystackPaymentsRouter, paystackWebhookRouter } = require("../integrations/integration.routes");
const { lookupsRouter } = require("../lookups/routes");
const { leaveRouter } = require("../leave/routes");
const { meetingRoomsRouter, meetingTypesRouter, meetingsRouter } = require("../meetings/routes");
const { notificationConfigRouter, notificationsRouter } = require("../notifications/notification.routes");
const { nyscInternRouter } = require("../nyscIntern/routes");
const { employeePayrollRouter, payrollRouter, salariesRouter } = require("../payroll/routes");
const { purchaseOrdersRouter, purchaseRequestsRouter, receiptsRouter } = require("../procurement/routes");
const { profileRouter } = require("../profile/routes");
const { reportsRouter } = require("../reports/routes");
const { salaryIncrementsRouter } = require("../salaryIncrements/routes");
const { permissionsRouter, rolesRouter } = require("../roles/routes");
const { searchRouter } = require("../search/routes");
const { securityRouter } = require("../security/routes");
const { systemRouter } = require("../system/routes");
const systemService = require("../system/service");
const { systemHealthRouter } = require("../systemHealth/routes");
const { targetsRouter } = require("../targets/routes");
const { technicalAuditRouter } = require("../technicalAudit/routes");
const { usersRouter } = require("../users/routes");

const superAdminRouter = express.Router();

function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function buildModuleDirectory(req) {
  const base = `${req.baseUrl || "/api/v1/super-admin"}`;
  const directRoutes = [
    { key: "dashboard", label: "Dashboard", route: "/dashboard", endpoints: ["GET /dashboard", "GET /dashboard/stats"] },
    { key: "navigation", label: "Navigation", route: "/navigation", endpoints: ["GET /navigation", "GET /modules", "GET /modules/:key"] },
    { key: "system-management", label: "System Management", route: "/system-management", endpoints: ["GET /system-management/overview", "GET /system-management/settings", "PATCH /system-management/settings"] },
    { key: "profile", label: "Profile", route: "/profile", endpoints: ["GET /profile", "PUT /profile", "PUT /profile/password", "GET /profile/sessions"] },
    { key: "settings", label: "Settings", route: "/settings", endpoints: ["GET /settings", "PATCH /settings"] },
    { key: "health", label: "Health", route: "/health", endpoints: ["GET /health", "GET /system-health", "GET /system-health/services", "GET /system-health/metrics"] },
  ];
  const catalogRoutes = RESOURCE_MODULES.map((moduleDefinition) => ({
    key: moduleDefinition.key,
    label: moduleDefinition.label,
    route: moduleDefinition.route,
    url: `${base}${moduleDefinition.route}`,
    actions: moduleDefinition.actions || moduleDefinition.collectionActions || [],
    sensitive: Boolean(moduleDefinition.sensitive),
    immutable: Boolean(moduleDefinition.immutable),
  }));
  return [...directRoutes.map((route) => ({ ...route, url: `${base}${route.route}` })), ...catalogRoutes];
}

superAdminRouter.use(authenticate, requireRole("superadmin"));

superAdminRouter.get("/dashboard", handle((req, res) => send(res, "Super Admin dashboard loaded.", buildDashboardOverview(req.query))));
superAdminRouter.get("/dashboard/stats", handle((req, res) => {
  const overview = buildDashboardOverview(req.query);
  return send(res, "Super Admin dashboard stats loaded.", overview.metrics, { filters: overview.filters });
}));
superAdminRouter.get("/navigation", handle((_req, res) => send(res, "Super Admin navigation loaded.", SUPER_ADMIN_NAVIGATION)));
superAdminRouter.get("/modules", handle((req, res) => send(res, "Super Admin module directory loaded.", buildModuleDirectory(req))));
superAdminRouter.get("/modules/:key", handle((req, res) => {
  const moduleDefinition = buildModuleDirectory(req).find((item) => item.key === req.params.key);
  if (!moduleDefinition) {
    return res.status(404).json({ success: false, message: "Operation failed", error: { code: "MODULE_NOT_FOUND", details: {} } });
  }
  return send(res, "Super Admin module loaded.", moduleDefinition);
}));

superAdminRouter.get("/settings", handle((req, res) => {
  const result = systemService.listSystemSettings(req.query);
  return send(res, "Super Admin settings loaded.", result.data, result.meta);
}));
superAdminRouter.patch("/settings", handle((req, res) => send(res, "Super Admin settings updated.", systemService.updateSettings(req.body || {}, req))));
superAdminRouter.get("/status", handle((_req, res) => send(res, "Super Admin status loaded.", systemService.getMaintenanceStatus())));
superAdminRouter.get("/health", handle((_req, res) => send(res, "Super Admin health loaded.", systemService.getHealth())));

superAdminRouter.use("/profile", profileRouter);
superAdminRouter.use("/lookups", lookupsRouter);
superAdminRouter.use("/system-management", systemRouter);
superAdminRouter.use("/system", systemRouter);
superAdminRouter.use("/system-health", systemHealthRouter);
superAdminRouter.use("/backups", backupsRouter);
superAdminRouter.use("/technical-audit-logs", technicalAuditRouter);
superAdminRouter.use("/security", securityRouter);
superAdminRouter.use("/integrations", integrationsRouter);
superAdminRouter.use("/payments/paystack", paystackPaymentsRouter);
superAdminRouter.use("/webhooks", paystackWebhookRouter);
superAdminRouter.use("/email-config", emailConfigRouter);
superAdminRouter.use("/email-configurations", emailConfigRouter);
superAdminRouter.use("/email", emailConfigRouter);
superAdminRouter.use("/notification-config", notificationConfigRouter);
superAdminRouter.use("/notification-configurations", notificationConfigRouter);
superAdminRouter.use("/notifications", notificationsRouter);
superAdminRouter.use("/users", usersRouter);
superAdminRouter.use("/employers", employersRouter);
superAdminRouter.use("/departments", departmentsRouter);
superAdminRouter.use("/leave", leaveRouter);
superAdminRouter.use("/meetings", meetingsRouter);
superAdminRouter.use("/meeting-types", meetingTypesRouter);
superAdminRouter.use("/meeting-rooms", meetingRoomsRouter);
superAdminRouter.use("/targets", targetsRouter);
superAdminRouter.use("/payroll", payrollRouter);
superAdminRouter.use("/salary-increments", salaryIncrementsRouter);
superAdminRouter.use("/salaries", salariesRouter);
superAdminRouter.use("/employees", employeesRouter);
superAdminRouter.use("/employees", employeeDisciplineRouter);
superAdminRouter.use("/employees", employeePayrollRouter);
superAdminRouter.use("/purchase-requests", purchaseRequestsRouter);
superAdminRouter.use("/purchase-orders", purchaseOrdersRouter);
superAdminRouter.use("/receipts", receiptsRouter);
superAdminRouter.use("/purchases", purchaseRequestsRouter);
superAdminRouter.use("/bills", billsRouter);
superAdminRouter.use("/expenses", expensesRouter);
superAdminRouter.use("/expense-policies", expensePoliciesRouter);
superAdminRouter.use("/vendors", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "vendors")));
superAdminRouter.use("/events", eventsRouter);
superAdminRouter.use("/discipline", disciplineRouter);
superAdminRouter.use("/nysc-interns", nyscInternRouter);
superAdminRouter.use("/announcements", announcementsRouter);
superAdminRouter.use("/reports", reportsRouter);
superAdminRouter.use("/audit-logs", auditLogsRouter);
superAdminRouter.use("/roles", rolesRouter);
superAdminRouter.use("/permissions", permissionsRouter);
superAdminRouter.use("/search", searchRouter);
superAdminRouter.use("/global-search", searchRouter);
superAdminRouter.use("/audit/operational", auditLogsRouter);
superAdminRouter.use("/audit/technical", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "technical-audit")));
superAdminRouter.use("/documents", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "document-templates")));

for (const moduleDefinition of RESOURCE_MODULES) {
  if (
    [
      "users",
      "employers",
      "employees",
      "departments",
      "branches",
      "leave",
      "leave-types",
      "meetings",
      "targets",
      "payroll",
      "purchases",
      "bills",
      "expenses",
      "vendors",
      "events",
      "discipline",
      "announcements",
      "reports",
      "roles",
      "permissions",
      "salary-increments",
      "integrations",
      "email-configurations",
      "notification-configurations",
      "document-templates",
      "backups",
      "system-health",
      "system-settings",
      "technical-audit",
      "operational-audit",
    ].includes(moduleDefinition.key)
  ) {
    continue;
  }

  superAdminRouter.use(moduleDefinition.route, createResourceRouter(moduleDefinition));
}

module.exports = { superAdminRouter };
