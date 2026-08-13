const { readCollection } = require("../../database/jsonStore");
const { listUsers } = require("../../auth/userStore");
const { SUPER_ADMIN_NAVIGATION } = require("../_shared/moduleCatalog");

function count(records, predicate) {
  return records.filter(predicate).length;
}

function byStatus(records, status) {
  return count(records, (record) => String(record.status || "").toLowerCase() === status);
}

function isFuture(value) {
  return value && new Date(value).getTime() >= Date.now();
}

function isPast(value) {
  return value && new Date(value).getTime() < Date.now();
}

function getDateRange(preset = "this_month", customFrom, customTo) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (preset === "today") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (preset === "this_week") {
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (preset === "this_quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    start.setMonth(quarterStartMonth, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(quarterStartMonth + 3, 0);
    end.setHours(23, 59, 59, 999);
  } else if (preset === "this_year") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
  } else if (preset === "custom" && customFrom && customTo) {
    return { start: new Date(customFrom), end: new Date(customTo) };
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

function inRange(record, range) {
  const value = record.createdAt || record.date || record.startDate || record.dueDate;
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();
  return timestamp >= range.start.getTime() && timestamp <= range.end.getTime();
}

function buildSeries(records, range, valueField) {
  const buckets = new Map();

  for (const record of records.filter((item) => inRange(item, range))) {
    const date = new Date(record.createdAt || record.date || record.startDate || record.dueDate);
    const bucket = date.toISOString().slice(0, 10);
    const current = buckets.get(bucket) || 0;
    const value = valueField ? Number(record[valueField] || 0) : 1;
    buckets.set(bucket, current + value);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));
}

function getSystemStatus() {
  const healthRecords = readCollection("system_health").filter((record) => !record.deletedAt);
  const latestByService = new Map();

  for (const record of healthRecords) {
    const existing = latestByService.get(record.service);
    if (!existing || String(record.updatedAt || "").localeCompare(existing.updatedAt || "") > 0) {
      latestByService.set(record.service, record);
    }
  }

  return {
    api: {
      status: "healthy",
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
    },
    emailService: latestByService.get("email") || null,
    notificationService: latestByService.get("notifications") || null,
    databaseHealth: latestByService.get("database") || null,
    redisHealth: latestByService.get("redis") || null,
    backupStatus: latestByService.get("backups") || null,
    storageStatus: latestByService.get("storage") || null,
    recordedServices: [...latestByService.values()],
  };
}

function buildDashboardOverview(query = {}) {
  const range = getDateRange(query.period, query.dateFrom, query.dateTo);
  const users = listUsers();
  const employees = readCollection("employees").filter((record) => !record.deletedAt);
  const interns = readCollection("interns").filter((record) => !record.deletedAt);
  const nyscMembers = readCollection("nysc_members").filter((record) => !record.deletedAt);
  const departments = readCollection("departments").filter((record) => !record.deletedAt);
  const leaveRequests = readCollection("leave_requests").filter((record) => !record.deletedAt);
  const meetings = readCollection("meetings").filter((record) => !record.deletedAt);
  const tasks = readCollection("tasks").filter((record) => !record.deletedAt);
  const targets = readCollection("targets").filter((record) => !record.deletedAt);
  const payroll = readCollection("payroll").filter((record) => !record.deletedAt);
  const purchases = readCollection("purchase_requests").filter((record) => !record.deletedAt);
  const bills = readCollection("bills").filter((record) => !record.deletedAt);
  const expenses = readCollection("expenses").filter((record) => !record.deletedAt);
  const vendors = readCollection("vendors").filter((record) => !record.deletedAt);
  const events = readCollection("events").filter((record) => !record.deletedAt);
  const discipline = readCollection("disciplinary_cases").filter((record) => !record.deletedAt);
  const announcements = readCollection("announcements").filter((record) => !record.deletedAt);
  const failedLogins = readCollection("failed_logins").filter((record) => !record.deletedAt);
  const sessions = readCollection("sessions").filter((record) => !record.deletedAt);
  const technicalAudit = readCollection("technical_audit_logs").filter((record) => !record.deletedAt);

  return {
    filters: {
      period: query.period || "this_month",
      dateFrom: range.start.toISOString(),
      dateTo: range.end.toISOString(),
    },
    metrics: {
      totalUsers: users.length,
      activeUsers: count(users, (user) => user.status === "active"),
      inactiveUsers: count(users, (user) => user.status === "inactive"),
      lockedAccounts: count(users, (user) => user.status === "locked" || user.lockedAt),
      failedLogins: failedLogins.length,
      adminAccounts: count(users, (user) => ["superadmin", "admin"].includes(user.role)),
      totalEmployees: employees.length,
      totalInterns: interns.length,
      totalNyscMembers: nyscMembers.length,
      totalDepartments: departments.length,
      employeesOnLeave: byStatus(leaveRequests, "approved"),
      pendingLeaveRequests: byStatus(leaveRequests, "pending"),
      upcomingMeetings: count(meetings, (meeting) => isFuture(meeting.startDate || meeting.date)),
      pendingTasks: byStatus(tasks, "pending"),
      overdueTasks: count(tasks, (task) => isPast(task.dueDate) && task.status !== "completed"),
      completedTasks: byStatus(tasks, "completed"),
      targets: targets.length,
      payrollStatus: payroll.reduce((summary, item) => {
        const status = item.status || "unknown";
        summary[status] = (summary[status] || 0) + 1;
        return summary;
      }, {}),
      pendingPayroll: byStatus(payroll, "pending"),
      purchases: purchases.length,
      pendingPurchases: byStatus(purchases, "pending"),
      bills: bills.length,
      expenses: expenses.length,
      vendors: vendors.length,
      upcomingEvents: count(events, (event) => isFuture(event.startDate || event.date)),
      disciplinaryCases: discipline.length,
      announcements: announcements.length,
    },
    charts: {
      employeeGrowth: buildSeries(employees, range),
      taskPerformance: buildSeries(tasks, range),
      departmentPerformance: buildSeries(departments, range),
      leaveTrends: buildSeries(leaveRequests, range),
      payrollTrends: buildSeries(payroll, range, "netSalary"),
      expenses: buildSeries(expenses, range, "amount"),
      purchases: buildSeries(purchases, range, "amount"),
      targets: buildSeries(targets, range),
      attendance: buildSeries(readCollection("attendance"), range),
      recruitmentPlacement: buildSeries(readCollection("recruitment"), range),
      internship: buildSeries(interns, range),
      nysc: buildSeries(nyscMembers, range),
    },
    systemStatus: getSystemStatus(),
    security: {
      failedLoginAlerts: failedLogins.slice(-20),
      suspiciousActivities: technicalAudit.filter((record) => record.service === "security").slice(-20),
      lockedAccounts: users.filter((user) => user.status === "locked" || user.lockedAt),
      activeSessions: sessions.filter((session) => session.status === "active"),
      recentSecurityEvents: technicalAudit
        .filter((record) => record.service === "security" || record.statusCode >= 400)
        .slice(-20),
    },
    navigation: SUPER_ADMIN_NAVIGATION,
  };
}

module.exports = { buildDashboardOverview, getSystemStatus };
