const express = require("express");
const { authenticate, requireRole } = require("../auth/middleware");
const { superadminRouter } = require("../routes/superadminAuth");
const { ROLE_DEFINITIONS, PERMISSIONS } = require("../constants/rbac");
const { RESOURCE_MODULES } = require("./_shared/moduleCatalog");
const { createResourceRouter } = require("./_shared/resourceRouter");
const { billsRouter } = require("./bills/routes");
const { dashboardRouter } = require("./dashboard/routes");
const { departmentsRouter } = require("./departments/routes");
const { employersRouter } = require("./employers/routes");
const { leaveRouter } = require("./leave/routes");
const { meetingRoomsRouter, meetingTypesRouter, meetingsRouter } = require("./meetings/routes");
const { employeePayrollRouter, payrollRouter, salariesRouter } = require("./payroll/routes");
const { purchaseOrdersRouter, purchaseRequestsRouter, receiptsRouter } = require("./procurement/routes");
const { securityRouter } = require("./security/routes");
const { systemRouter } = require("./system/routes");
const { targetsRouter } = require("./targets/routes");
const { usersRouter } = require("./users/routes");

function createApiV1Router() {
  const router = express.Router();

  router.use("/auth", superadminRouter);
  router.use("/dashboard", dashboardRouter);
  router.use("/security", securityRouter);
  router.use("/system", systemRouter);
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
  router.use("/employees", employeePayrollRouter);
  router.use("/purchase-requests", purchaseRequestsRouter);
  router.use("/purchase-orders", purchaseOrdersRouter);
  router.use("/receipts", receiptsRouter);
  router.use("/bills", billsRouter);

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
      ["users", "employers", "employees", "departments", "branches", "leave", "leave-types", "meetings", "targets", "payroll", "purchases", "bills"].includes(
        moduleDefinition.key
      )
    ) {
      continue;
    }

    router.use(moduleDefinition.route, createResourceRouter(moduleDefinition));
  }

  router.use("/audit/operational", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "operational-audit")));
  router.use("/audit/technical", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "technical-audit")));
  router.use("/email", createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "email-configurations")));
  router.use(
    "/notifications",
    createResourceRouter(RESOURCE_MODULES.find((item) => item.key === "notification-configurations"))
  );

  return router;
}

module.exports = { createApiV1Router };
