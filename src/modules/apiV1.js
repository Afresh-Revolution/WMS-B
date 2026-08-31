const express = require("express");
const { authenticate, requireRole } = require("../auth/middleware");
const { superadminRouter } = require("../routes/superadminAuth");
const { ROLE_DEFINITIONS, PERMISSIONS } = require("../constants/rbac");
const { RESOURCE_MODULES } = require("./_shared/moduleCatalog");
const { createResourceRouter } = require("./_shared/resourceRouter");
const { announcementsRouter } = require("./announcements/routes");
const { authRouter } = require("./auth/routes");
const { auditLogsRouter } = require("./auditLogs/routes");
const { billsRouter } = require("./bills/routes");
const { dashboardRouter } = require("./dashboard/routes");
const { departmentsRouter } = require("./departments/routes");
const { disciplineRouter, employeeDisciplineRouter } = require("./discipline/routes");
const { employersRouter } = require("./employers/routes");
const { eventsRouter } = require("./events/routes");
const { expensePoliciesRouter, expensesRouter } = require("./expenses/routes");
const { emailConfigRouter } = require("./email/email.routes");
const { leaveRouter } = require("./leave/routes");
const { meetingRoomsRouter, meetingTypesRouter, meetingsRouter } = require("./meetings/routes");
const { integrationsRouter, paystackPaymentsRouter, paystackWebhookRouter } = require("./integrations/integration.routes");
const { notificationConfigRouter, notificationsRouter } = require("./notifications/notification.routes");
const { nyscInternRouter } = require("./nyscIntern/routes");
const { employeePayrollRouter, payrollRouter, salariesRouter } = require("./payroll/routes");
const { purchaseOrdersRouter, purchaseRequestsRouter, receiptsRouter } = require("./procurement/routes");
const { reportsRouter } = require("./reports/routes");
const { permissionsRouter, rolesRouter } = require("./roles/routes");
const { searchRouter } = require("./search/routes");
const { profileRouter } = require("./profile/routes");
const { superAdminRouter } = require("./superAdmin/routes");
const { hrRouter } = require("./hr/routes");
const { managerRouter } = require("./manager/routes");
const { secretaryRouter } = require("./secretary/routes");
const { accountantRouter } = require("./accountant/routes");
const { securityRouter } = require("./security/routes");
const { backupsRouter } = require("./backups/routes");
const { systemHealthRouter } = require("./systemHealth/routes");
const { technicalAuditRouter } = require("./technicalAudit/routes");
const { systemRouter } = require("./system/routes");
const { targetsRouter } = require("./targets/routes");
const { usersRouter } = require("./users/routes");

function createApiV1Router() {
  const router = express.Router();

  router.use("/auth", authRouter);
  router.use("/profile", profileRouter);
  router.use("/super-admin", superAdminRouter);
  router.use("/hr", hrRouter);
  router.use("/manager", managerRouter);
  router.use("/secretary", secretaryRouter);
  router.use("/accountant", accountantRouter);
  router.use("/dashboard", dashboardRouter);
  router.use("/security", securityRouter);
  router.use("/integrations", integrationsRouter);
  router.use("/payments/paystack", paystackPaymentsRouter);
  router.use("/webhooks", paystackWebhookRouter);
  router.use("/email-config", emailConfigRouter);
  router.use("/email-configurations", emailConfigRouter);
  router.use("/email", emailConfigRouter);
  router.use("/notification-config", notificationConfigRouter);
  router.use("/notification-configurations", notificationConfigRouter);
  router.use("/notifications", notificationsRouter);
  router.use("/system", systemRouter);
  router.use("/system-health", systemHealthRouter);
  router.use("/backups", backupsRouter);
  router.use("/technical-audit-logs", technicalAuditRouter);
  router.use("/system-management", systemRouter);
  router.use("/users", usersRouter);
  router.use("/employers", employersRouter);
  router.use("/departments", departmentsRouter);
  router.use("/leave", leaveRouter);
  router.use("/meetings", meetingsRouter);
  router.use("/meeting-types", meetingTypesRouter);
  router.use("/meeting-rooms", meetingRoomsRouter);
  router.use("/targets", targetsRouter);
  router.use("/payroll", payrollRouter);
  router.use("/salaries", salariesRouter);
  router.use("/employees", employeeDisciplineRouter);
  router.use("/employees", employeePayrollRouter);
  router.use("/purchase-requests", purchaseRequestsRouter);
  router.use("/purchase-orders", purchaseOrdersRouter);
  router.use("/receipts", receiptsRouter);
  router.use("/bills", billsRouter);
  router.use("/expenses", expensesRouter);
  router.use("/expense-policies", expensePoliciesRouter);
  router.use("/events", eventsRouter);
  router.use("/discipline", disciplineRouter);
  router.use("/nysc-interns", nyscInternRouter);
  router.use("/announcements", announcementsRouter);
  router.use("/reports", reportsRouter);
  router.use("/audit-logs", auditLogsRouter);
  router.use("/roles", rolesRouter);
  router.use("/permissions", permissionsRouter);
  router.use("/search", searchRouter);
  router.use("/global-search", searchRouter);
  router.use("/purchases", purchaseRequestsRouter);
  router.use("/vendors", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "vendors")));
  router.get("/health", authenticate, requireRole("superadmin"), (req, res) => {
    const systemService = require("./system/service");
    return res.json({ success: true, message: "System health loaded.", data: systemService.getHealth(), meta: {} });
  });
  router.use("/settings", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "system-settings")));
  router.use("/documents", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "document-templates")));

  router.get("/roles/catalog", authenticate, requireRole("superadmin"), (req, res) => {
    return res.json({
      success: true,
      message: "Role catalog loaded.",
      data: ROLE_DEFINITIONS,
      meta: {},
    });
  });

  router.get("/permissions/catalog", authenticate, requireRole("superadmin"), (req, res) => {
    return res.json({
      success: true,
      message: "Permission catalog loaded.",
      data: PERMISSIONS,
      meta: {},
    });
  });

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
        "events",
        "discipline",
        "announcements",
        "reports",
        "roles",
        "permissions",
        "vendors",
        "system-settings",
        "email-configurations",
        "notification-configurations",
        "document-templates",
      ].includes(moduleDefinition.key)
    ) {
      continue;
    }

    router.use(moduleDefinition.route, createResourceRouter(moduleDefinition));
  }

  router.use("/audit/operational", auditLogsRouter);
  router.use("/audit/technical", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "technical-audit")));

  return router;
}

module.exports = { createApiV1Router };
