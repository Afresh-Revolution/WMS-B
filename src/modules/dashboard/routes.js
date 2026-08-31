const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { buildDashboardOverview } = require("./dashboardService");

const dashboardRouter = express.Router();

dashboardRouter.use(authenticate, requireRole("superadmin"));

dashboardRouter.get("/overview", (req, res) => {
  return res.json({
    success: true,
    message: "Super Admin dashboard overview loaded.",
    data: buildDashboardOverview(req.query),
    meta: {},
  });
});

dashboardRouter.get("/super-admin", (req, res) => {
  const overview = buildDashboardOverview(req.query);
  return res.json({
    success: true,
    message: "Super Admin dashboard loaded.",
    data: {
      total_users: overview.metrics.totalUsers,
      active_users: overview.metrics.activeUsers,
      inactive_users: overview.metrics.inactiveUsers,
      locked_accounts: overview.metrics.lockedAccounts,
      failed_logins_today: overview.metrics.failedLogins,
      admin_accounts: overview.metrics.adminAccounts,
      departments: overview.metrics.totalDepartments,
      total_employees: overview.metrics.totalEmployees,
      pending_leave_requests: overview.metrics.pendingLeaveRequests,
      pending_purchase_requests: overview.metrics.pendingPurchases,
      pending_expenses: overview.metrics.expenses,
      pending_approvals:
        overview.metrics.pendingLeaveRequests +
        overview.metrics.pendingPurchases +
        overview.metrics.pendingPayroll +
        overview.metrics.pendingTasks,
      payroll_status: overview.metrics.payrollStatus,
      system_health: overview.systemStatus,
      email_service_status: overview.systemStatus.emailService,
      notification_service_status: overview.systemStatus.notificationService,
      backup_status: overview.systemStatus.backupStatus,
    },
    meta: { filters: overview.filters },
  });
});

module.exports = { dashboardRouter };
