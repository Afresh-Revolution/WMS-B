const { hasPermission } = require("../../constants/rbac");
const { EXPORT_FORMATS, EXPORT_STATUS, REPORT_PERMISSIONS } = require("./constants");
const repository = require("./repository");

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function assertPermission(user, permission) {
  if (!can(user, permission)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function requireReportPermission(user, permission) {
  assertPermission(user, REPORT_PERMISSIONS.VIEW);
  if (permission) {
    assertPermission(user, permission);
  }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  return Number(number(value).toFixed(digits));
}

function statusOf(record) {
  return String(record.status || record.employmentStatus || record.placementStatus || "").toLowerCase();
}

function isActiveEmployee(employee) {
  const status = statusOf(employee) || "active";
  return !["inactive", "terminated", "archived", "deleted", "suspended"].includes(status);
}

function dateValue(record) {
  return record.createdAt || record.date || record.startDate || record.start_date || record.expenseDate || record.expense_date || record.dueDate || record.incidentDate;
}

function normalizeRange(query = {}) {
  const end = query.endDate ? new Date(`${query.endDate}T23:59:59.999Z`) : new Date();
  const start = query.startDate ? new Date(`${query.startDate}T00:00:00.000Z`) : new Date(end.getTime() - 30 * 86400000);
  return {
    start: Number.isNaN(start.getTime()) ? new Date(end.getTime() - 30 * 86400000) : start,
    end: Number.isNaN(end.getTime()) ? new Date() : end,
  };
}

function inDateRange(record, query = {}) {
  if (!query.startDate && !query.endDate) {
    return true;
  }
  const value = dateValue(record);
  if (!value) {
    return false;
  }
  const timestamp = new Date(value).getTime();
  const range = normalizeRange(query);
  return timestamp >= range.start.getTime() && timestamp <= range.end.getTime();
}

function employeeDepartmentId(employee) {
  return employee?.departmentId || employee?.department_id || null;
}

function recordDepartmentId(record) {
  if (record.departmentId || record.department_id) {
    return record.departmentId || record.department_id;
  }
  if (record.employeeId || record.employee_id) {
    return employeeDepartmentId(findEmployee(record.employeeId || record.employee_id));
  }
  return null;
}

function applyCommonFilters(records, query = {}) {
  return records.filter((record) => {
    if (!inDateRange(record, query)) {
      return false;
    }
    if (query.departmentId && recordDepartmentId(record) !== query.departmentId) {
      return false;
    }
    if (query.employeeId && String(record.employeeId || record.employee_id || record.id || "") !== String(query.employeeId)) {
      return false;
    }
    if (query.employmentType && String(record.employmentType || record.employment_type || "").toLowerCase() !== String(query.employmentType).toLowerCase()) {
      return false;
    }
    if (query.employmentStatus && statusOf(record) !== String(query.employmentStatus).toLowerCase()) {
      return false;
    }
    return true;
  });
}

function employees(query = {}) {
  return applyCommonFilters(repository.listCollection("employees"), query);
}

function findEmployee(id) {
  return repository.listCollection("employees").find((employee) => employee.id === id) || null;
}

function groupBy(records, keyFn, buildInitial, update) {
  const map = new Map();
  for (const record of records) {
    const key = keyFn(record) || "unassigned";
    if (!map.has(key)) {
      map.set(key, buildInitial(record, key));
    }
    update(map.get(key), record);
  }
  return [...map.values()];
}

function countByStatus(records) {
  return records.reduce((summary, record) => {
    const status = statusOf(record) || "unknown";
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
}

function departmentName(departmentId) {
  if (!departmentId) {
    return "Unassigned";
  }
  return repository.findDepartment(departmentId)?.name || "Unassigned";
}

function monthKey(value) {
  return String(value || new Date().toISOString()).slice(0, 7);
}

function periodKey(date, interval) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    return "unknown";
  }
  if (interval === "yearly") {
    return String(value.getUTCFullYear());
  }
  if (interval === "daily") {
    return value.toISOString().slice(0, 10);
  }
  if (interval === "weekly") {
    const firstDay = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((value - firstDay) / 86400000 + firstDay.getUTCDay() + 1) / 7);
    return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return value.toISOString().slice(0, 7);
}

function getHeadcount(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA);
  const allEmployees = employees(query);
  return {
    total: allEmployees.length,
    active: allEmployees.filter(isActiveEmployee).length,
    inactive: allEmployees.filter((employee) => statusOf(employee) === "inactive").length,
    terminated: allEmployees.filter((employee) => statusOf(employee) === "terminated").length,
    byDepartment: groupBy(
      allEmployees,
      employeeDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), total: 0, active: 0 }),
      (summary, employee) => {
        summary.total += 1;
        if (isActiveEmployee(employee)) {
          summary.active += 1;
        }
      }
    ),
  };
}

function getHeadcountGrowth(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA);
  const interval = ["daily", "weekly", "monthly", "yearly"].includes(query.interval) ? query.interval : "monthly";
  const sorted = employees(query).sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const buckets = new Map();
  let running = 0;
  for (const employee of sorted) {
    running += isActiveEmployee(employee) ? 1 : 0;
    buckets.set(periodKey(employee.createdAt, interval), running);
  }
  return {
    interval,
    data: [...buckets.entries()].map(([period, headcount]) => ({ period, headcount })),
  };
}

function getAttendance(user, query = {}) {
  const role = String(user?.role || "").trim().toLowerCase();
  if (!["superadmin", "hr", "manager"].includes(role)) {
    throw createHttpError(403, "Attendance monitoring is limited to Super Admin, HR, and managers.", "ATTENDANCE_MONITOR_FORBIDDEN");
  }
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ATTENDANCE);
  const attendance = applyCommonFilters(
    [...repository.listCollection("attendance"), ...repository.listCollection("placement_attendance")],
    query
  );
  const activeEmployees = employees(query).filter(isActiveEmployee).length;
  const byDate = groupBy(
    attendance,
    (record) => String(record.date || record.createdAt || "").slice(0, 10),
    (_, key) => ({ date: key, present: 0, expected: 0, attendanceRate: 0 }),
    (summary, record) => {
      const status = statusOf(record);
      if (["present", "late", "remote"].includes(status)) {
        summary.present += 1;
      }
      summary.expected += 1;
      summary.attendanceRate = summary.expected ? round((summary.present / summary.expected) * 100) : 0;
    }
  ).sort((left, right) => left.date.localeCompare(right.date));
  const present = attendance.filter((record) => ["present", "late", "remote"].includes(statusOf(record))).length;
  const expected = attendance.length || activeEmployees;
  return {
    averageAttendance: expected ? round((present / expected) * 100) : 0,
    expectedEmployees: expected,
    present,
    data: byDate,
  };
}

function getAttrition(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA);
  const allEmployees = employees(query);
  const left = allEmployees.filter((employee) => ["terminated", "inactive", "archived"].includes(statusOf(employee)));
  const active = allEmployees.filter(isActiveEmployee).length;
  const averageHeadcount = round((active + allEmployees.length) / 2);
  return {
    attritionRate: averageHeadcount ? round((left.length / averageHeadcount) * 100) : 0,
    employeesLeft: left.length,
    averageHeadcount,
    byReason: groupBy(
      left,
      (employee) => employee.exitReason || employee.terminationReason || "unspecified",
      (_, key) => ({ reason: key, count: 0 }),
      (summary) => {
        summary.count += 1;
      }
    ),
  };
}

function getDepartmentReports(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const departments = repository.listCollection("departments");
  const targetReport = getTargets(user, query);
  const attendance = getAttendance(user, query);
  return {
    departments: departments.map((department) => {
      const departmentEmployees = employees({ ...query, departmentId: department.id });
      const left = departmentEmployees.filter((employee) => !isActiveEmployee(employee)).length;
      const departmentTarget = targetReport.departmentPerformance.find((item) => item.departmentId === department.id);
      return {
        id: department.id,
        name: department.name,
        headcount: departmentEmployees.filter(isActiveEmployee).length,
        attendanceRate: attendance.averageAttendance,
        targetCompletion: departmentTarget?.achievementRate || 0,
        attritionRate: departmentEmployees.length ? round((left / departmentEmployees.length) * 100) : 0,
      };
    }),
  };
}

function getLeave(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const requests = applyCommonFilters(repository.listCollection("leave_requests"), query);
  const byStatus = countByStatus(requests);
  return {
    totalRequests: requests.length,
    approved: byStatus.approved || 0,
    pending: byStatus.pending || 0,
    rejected: byStatus.rejected || 0,
    cancelled: byStatus.cancelled || 0,
    daysUsed: round(requests.filter((request) => statusOf(request) === "approved").reduce((sum, request) => sum + number(request.durationDays || request.days || request.totalDays), 0)),
    daysRemaining: round(repository.listCollection("leave_balances").reduce((sum, balance) => sum + number(balance.remainingDays || balance.balance), 0)),
    leaveByDepartment: groupBy(
      requests,
      recordDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), requests: 0, days: 0 }),
      (summary, request) => {
        summary.requests += 1;
        summary.days = round(summary.days + number(request.durationDays || request.days || request.totalDays));
      }
    ),
    leaveByType: groupBy(
      requests,
      (request) => request.leaveType || request.leaveTypeName || request.type,
      (_, key) => ({ type: key, requests: 0, days: 0 }),
      (summary, request) => {
        summary.requests += 1;
        summary.days = round(summary.days + number(request.durationDays || request.days || request.totalDays));
      }
    ),
  };
}

function getPayroll(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_PAYROLL);
  const payrollRuns = applyCommonFilters(repository.listCollection("payroll_runs"), query);
  const payslips = applyCommonFilters(repository.listCollection("payslips"), query);
  const payroll = applyCommonFilters(repository.listCollection("payroll"), query);
  const source = payslips.length ? payslips : payrollRuns.length ? payrollRuns : payroll;
  const grossPay = round(source.reduce((sum, item) => sum + number(item.grossSalary || item.gross_salary || item.grossAmount || item.gross_amount), 0));
  const deductions = round(source.reduce((sum, item) => sum + number(item.totalDeductions || item.total_deductions || item.deductions), 0));
  const netPay = round(source.reduce((sum, item) => sum + number(item.netSalary || item.net_salary || item.netAmount || item.net_amount), 0));
  return {
    totalPayroll: netPay,
    staffPaid: new Set(source.map((item) => item.employeeId || item.employee_id).filter(Boolean)).size || source.reduce((sum, item) => sum + number(item.employeeCount || item.employee_count), 0),
    grossPay,
    deductions,
    netPay,
    outstandingPayments: source.filter((item) => ["pending", "approved", "processing"].includes(statusOf(item))).length,
    payrollStatus: countByStatus(source),
    payrollByMonth: groupBy(
      source,
      (item) => monthKey(item.payDate || item.pay_date || item.createdAt),
      (_, key) => ({ month: key, grossPay: 0, deductions: 0, netPay: 0, staffPaid: 0 }),
      (summary, item) => {
        summary.grossPay = round(summary.grossPay + number(item.grossSalary || item.gross_salary || item.grossAmount || item.gross_amount));
        summary.deductions = round(summary.deductions + number(item.totalDeductions || item.total_deductions || item.deductions));
        summary.netPay = round(summary.netPay + number(item.netSalary || item.net_salary || item.netAmount || item.net_amount));
        summary.staffPaid += item.employeeId || item.employee_id ? 1 : number(item.employeeCount || item.employee_count);
      }
    ),
  };
}

function getTasks(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const tasks = applyCommonFilters(repository.listCollection("tasks"), query);
  const completed = tasks.filter((task) => statusOf(task) === "completed").length;
  return {
    total: tasks.length,
    open: tasks.filter((task) => ["open", "pending", "todo"].includes(statusOf(task))).length,
    inProgress: tasks.filter((task) => ["in_progress", "in progress", "active"].includes(statusOf(task))).length,
    completed,
    overdue: tasks.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < Date.now() && statusOf(task) !== "completed").length,
    completionRate: tasks.length ? round((completed / tasks.length) * 100) : 0,
    tasksByDepartment: groupBy(
      tasks,
      recordDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), total: 0, completed: 0 }),
      (summary, task) => {
        summary.total += 1;
        if (statusOf(task) === "completed") {
          summary.completed += 1;
        }
      }
    ),
    tasksByEmployee: groupBy(
      tasks,
      (task) => task.employeeId || task.assignedTo || task.assigneeId,
      (_, key) => ({ employeeId: key === "unassigned" ? null : key, total: 0, completed: 0 }),
      (summary, task) => {
        summary.total += 1;
        if (statusOf(task) === "completed") {
          summary.completed += 1;
        }
      }
    ),
  };
}

function getTargets(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const targets = applyCommonFilters(repository.listCollection("targets"), query);
  const completed = targets.filter((target) => ["completed", "achieved"].includes(statusOf(target))).length;
  return {
    totalTargets: targets.length,
    completed,
    active: targets.filter((target) => ["active", "in_progress", "pending"].includes(statusOf(target))).length,
    overdue: targets.filter((target) => target.dueDate && new Date(target.dueDate).getTime() < Date.now() && !["completed", "achieved"].includes(statusOf(target))).length,
    achievementRate: targets.length ? round(targets.reduce((sum, target) => sum + number(target.progress || target.achievementRate || target.progressPercentage), 0) / targets.length) : 0,
    departmentPerformance: groupBy(
      targets,
      recordDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), targets: 0, achievementRate: 0 }),
      (summary, target) => {
        summary.targets += 1;
        summary.achievementRate = round(((summary.achievementRate * (summary.targets - 1)) + number(target.progress || target.achievementRate || target.progressPercentage)) / summary.targets);
      }
    ),
  };
}

function getPromotions(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EMPLOYEE_DATA);
  const promotions = applyCommonFilters(repository.listCollection("promotions"), query);
  return {
    totalPromotions: promotions.length,
    employeesPromoted: new Set(promotions.map((promotion) => promotion.employeeId || promotion.staffId).filter(Boolean)).size,
    pendingPromotions: promotions.filter((promotion) => ["pending", "submitted"].includes(statusOf(promotion))).length,
    promotionsByDepartment: groupBy(
      promotions,
      recordDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), total: 0 }),
      (summary) => {
        summary.total += 1;
      }
    ),
    promotionsByMonth: countByMonth(promotions),
  };
}

function getSalaryIncrements(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_SALARY);
  const increments = applyCommonFilters(repository.listCollection("salary_increments"), query);
  const totalIncrementAmount = round(increments.reduce((sum, item) => sum + number(item.incrementAmount || item.increment_amount || number(item.newSalary || item.new_salary) - number(item.currentSalary || item.current_salary)), 0));
  return {
    totalIncrements: increments.length,
    totalIncrementAmount,
    averageIncrement: increments.length ? round(totalIncrementAmount / increments.length) : 0,
    incrementsByDepartment: groupBy(
      increments,
      recordDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), total: 0, amount: 0 }),
      (summary, item) => {
        summary.total += 1;
        summary.amount = round(summary.amount + number(item.incrementAmount || item.increment_amount || number(item.newSalary || item.new_salary) - number(item.currentSalary || item.current_salary)));
      }
    ),
    incrementsByPeriod: countByMonth(increments),
  };
}

function getExpenses(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EXPENSES);
  const expenses = applyCommonFilters(repository.listCollection("expenses"), query);
  const byStatus = countByStatus(expenses);
  return {
    total: round(expenses.reduce((sum, expense) => sum + number(expense.totalAmount || expense.amount), 0)),
    totalExpenses: expenses.length,
    approved: round(expenses.filter((expense) => statusOf(expense) === "approved").reduce((sum, expense) => sum + number(expense.totalAmount || expense.amount), 0)),
    pending: round(expenses.filter((expense) => ["pending", "submitted", "under_review"].includes(statusOf(expense))).reduce((sum, expense) => sum + number(expense.totalAmount || expense.amount), 0)),
    rejected: round(expenses.filter((expense) => statusOf(expense) === "rejected").reduce((sum, expense) => sum + number(expense.totalAmount || expense.amount), 0)),
    byStatus,
    expensesByCategory: amountGroup(expenses, (expense) => expense.categoryName || expense.category || expense.categoryId, "category"),
    expensesByDepartment: amountGroup(expenses, recordDepartmentId, "departmentId"),
    expensesByMonth: amountGroup(expenses, (expense) => monthKey(expense.expenseDate || expense.createdAt), "month"),
  };
}

function getPurchases(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EXPENSES);
  const requests = applyCommonFilters(repository.listCollection("purchase_requests"), query);
  const orders = applyCommonFilters(repository.listCollection("purchase_orders"), query);
  return {
    totalRequests: requests.length,
    pending: requests.filter((request) => ["submitted", "pending_approval", "under_review", "pending"].includes(statusOf(request))).length,
    approved: requests.filter((request) => ["approved", "ordered", "delivered"].includes(statusOf(request))).length,
    rejected: requests.filter((request) => statusOf(request) === "rejected").length,
    delivered: requests.filter((request) => statusOf(request) === "delivered").length + orders.filter((order) => statusOf(order) === "delivered").length,
    totalPurchaseValue: round([...requests, ...orders].reduce((sum, item) => sum + number(item.total || item.totalAmount || item.estimatedAmount || item.amount), 0)),
    purchasesByDepartment: amountGroup(requests, recordDepartmentId, "departmentId", "estimatedAmount"),
    purchasesByVendor: amountGroup(orders, (order) => order.vendorId || order.vendorName, "vendorId", "total"),
  };
}

function getBills(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EXPENSES);
  const bills = applyCommonFilters(repository.listCollection("bills"), query);
  const today = new Date().toISOString().slice(0, 10);
  return {
    totalBills: bills.length,
    paid: bills.filter((bill) => statusOf(bill) === "paid" || String(bill.paymentStatus || "").toLowerCase() === "paid").length,
    unpaid: bills.filter((bill) => String(bill.paymentStatus || statusOf(bill)).toLowerCase() !== "paid").length,
    overdue: bills.filter((bill) => bill.dueDate && bill.dueDate < today && String(bill.paymentStatus || "").toLowerCase() !== "paid").length,
    dueSoon: bills.filter((bill) => bill.dueDate && bill.dueDate >= today && bill.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length,
    totalOutstanding: round(bills.filter((bill) => String(bill.paymentStatus || "").toLowerCase() !== "paid").reduce((sum, bill) => sum + number(bill.amountDue || bill.totalAmount || bill.amount), 0)),
    totalPaid: round(bills.reduce((sum, bill) => sum + number(bill.amountPaid), 0)),
    billsByVendor: amountGroup(bills, (bill) => bill.vendorName || bill.vendorId, "vendor"),
    billsByCategory: amountGroup(bills, (bill) => bill.categoryName || bill.categoryId || bill.category, "category"),
  };
}

function getVendors(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_EXPENSES);
  const vendors = applyCommonFilters(repository.listCollection("vendors"), query);
  const bills = applyCommonFilters(repository.listCollection("bills"), query);
  return {
    totalVendors: vendors.length,
    activeVendors: vendors.filter((vendor) => statusOf(vendor) === "active").length,
    inactiveVendors: vendors.filter((vendor) => ["inactive", "suspended"].includes(statusOf(vendor))).length,
    totalSpending: round(bills.reduce((sum, bill) => sum + number(bill.amountPaid || bill.totalAmount || bill.amount), 0)),
    spendingPerVendor: amountGroup(bills, (bill) => bill.vendorId || bill.vendorName, "vendor"),
    outstandingVendorBills: amountGroup(bills.filter((bill) => String(bill.paymentStatus || "").toLowerCase() !== "paid"), (bill) => bill.vendorId || bill.vendorName, "vendor", "amountDue"),
  };
}

function getNyscInterns(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const profiles = applyCommonFilters(repository.listCollection("nysc_intern_profiles"), query);
  const placements = applyCommonFilters(repository.listCollection("placements"), query);
  const nysc = profiles.filter((profile) => String(profile.type || "").toLowerCase() === "nysc");
  const interns = profiles.filter((profile) => String(profile.type || "").toLowerCase() === "intern");
  return {
    nysc: placementStatusSummary(nysc),
    interns: placementStatusSummary(interns),
    totalNyscMembers: nysc.length,
    totalInterns: interns.length,
    active: profiles.filter((profile) => statusOf(profile) === "active").length + placements.filter((placement) => ["active", "ongoing", "ending_soon"].includes(statusOf(placement))).length,
    completed: profiles.filter((profile) => statusOf(profile) === "completed").length + placements.filter((placement) => statusOf(placement) === "completed").length,
    exitingSoon: placements.filter((placement) => statusOf(placement) === "ending_soon").length,
    byDepartment: groupBy(
      placements,
      (placement) => placement.departmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), placements: 0, averageProgress: 0 }),
      (summary, placement) => {
        summary.placements += 1;
        summary.averageProgress = round(((summary.averageProgress * (summary.placements - 1)) + number(placement.placementProgress || placement.progress?.progressPercentage)) / summary.placements);
      }
    ),
    byInstitution: groupBy(
      profiles,
      (profile) => profile.institution,
      (_, key) => ({ institution: key, total: 0 }),
      (summary) => {
        summary.total += 1;
      }
    ),
    placementProgress: placements.map((placement) => ({ placementId: placement.id, profileId: placement.profileId, progress: number(placement.placementProgress || placement.progress?.progressPercentage) })),
  };
}

function placementStatusSummary(records) {
  return {
    total: records.length,
    active: records.filter((record) => statusOf(record) === "active").length,
    completed: records.filter((record) => statusOf(record) === "completed").length,
  };
}

function getDiscipline(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_DISCIPLINE);
  const cases = applyCommonFilters(repository.listCollection("disciplinary_cases"), query);
  const actions = applyCommonFilters(repository.listCollection("disciplinary_actions"), query);
  return {
    activeCases: cases.filter((item) => !["closed", "resolved"].includes(statusOf(item))).length,
    closedCases: cases.filter((item) => ["closed", "resolved"].includes(statusOf(item))).length,
    warnings: actions.filter((item) => String(item.actionType || item.action || "").toLowerCase().includes("warning")).length,
    strikes: actions.filter((item) => String(item.actionType || item.action || "").toLowerCase().includes("strike")).length,
    suspensions: actions.filter((item) => String(item.actionType || item.action || "").toLowerCase().includes("suspension")).length,
    actionsByDepartment: groupBy(
      actions,
      recordDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), actions: 0 }),
      (summary) => {
        summary.actions += 1;
      }
    ),
    actionsByPeriod: countByMonth(actions),
  };
}

function getMeetings(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const meetings = applyCommonFilters(repository.listCollection("meetings"), query);
  const attendance = repository.listCollection("meeting_attendance");
  return {
    totalMeetings: meetings.length,
    upcomingMeetings: meetings.filter((meeting) => new Date(meeting.startDate || meeting.date || 0).getTime() > Date.now()).length,
    completedMeetings: meetings.filter((meeting) => ["completed", "done"].includes(statusOf(meeting))).length,
    cancelledMeetings: meetings.filter((meeting) => statusOf(meeting) === "cancelled").length,
    meetingsByDepartment: groupBy(
      meetings,
      recordDepartmentId,
      (_, key) => ({ departmentId: key === "unassigned" ? null : key, departmentName: departmentName(key), meetings: 0 }),
      (summary) => {
        summary.meetings += 1;
      }
    ),
    attendanceRate: attendance.length ? round((attendance.filter((record) => ["present", "late"].includes(statusOf(record))).length / attendance.length) * 100) : 0,
  };
}

function getEvents(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const events = applyCommonFilters(repository.listCollection("events"), query);
  const attendees = repository.listCollection("event_attendees");
  return {
    totalEvents: events.length,
    upcoming: events.filter((event) => new Date(event.startDate || event.date || 0).getTime() > Date.now()).length,
    completed: events.filter((event) => ["completed", "archived"].includes(statusOf(event))).length,
    cancelled: events.filter((event) => statusOf(event) === "cancelled").length,
    participants: attendees.length,
    notifiedStaff: attendees.filter((attendee) => attendee.invitedAt || attendee.invited_at).length,
    eventEngagement: attendees.length ? round((attendees.filter((attendee) => ["attended", "going"].includes(statusOf(attendee) || String(attendee.rsvpStatus || "").toLowerCase())).length / attendees.length) * 100) : 0,
  };
}

function getAnnouncements(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const announcements = applyCommonFilters(repository.listCollection("announcements"), query);
  const recipients = repository.listCollection("announcement_recipients").filter((recipient) => announcements.some((announcement) => announcement.id === recipient.announcementId));
  const read = recipients.filter((recipient) => recipient.isRead || recipient.readAt).length;
  return {
    totalAnnouncements: announcements.length,
    published: announcements.filter((announcement) => statusOf(announcement) === "published").length,
    scheduled: announcements.filter((announcement) => statusOf(announcement) === "scheduled").length,
    draft: announcements.filter((announcement) => statusOf(announcement) === "draft").length,
    totalRecipients: recipients.length,
    recipients: recipients.length,
    read,
    unread: Math.max(0, recipients.length - read),
    readRate: recipients.length ? round((read / recipients.length) * 100) : 0,
    announcementsByCategory: groupBy(
      announcements,
      (announcement) => announcement.category,
      (_, key) => ({ category: key, total: 0 }),
      (summary) => {
        summary.total += 1;
      }
    ),
  };
}

function getDataQuality(user) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const issues = [];
  const allEmployees = repository.listCollection("employees");
  const departments = new Set(repository.listCollection("departments").map((department) => department.id));
  const employeeIds = new Set(allEmployees.map((employee) => employee.id));
  const employeeCodes = new Set();
  for (const employee of allEmployees) {
    if (!employee.firstName && !employee.lastName && !employee.fullName && !employee.name) {
      issues.push({ severity: "warning", code: "EMPLOYEE_NAME_MISSING", entityType: "employee", entityId: employee.id });
    }
    const departmentId = employeeDepartmentId(employee);
    if (departmentId && !departments.has(departmentId)) {
      issues.push({ severity: "critical", code: "EMPLOYEE_INVALID_DEPARTMENT", entityType: "employee", entityId: employee.id });
    }
    const code = employee.employeeId || employee.staffId;
    if (code && employeeCodes.has(code)) {
      issues.push({ severity: "warning", code: "EMPLOYEE_DUPLICATE_CODE", entityType: "employee", entityId: employee.id });
    }
    if (code) {
      employeeCodes.add(code);
    }
  }
  for (const payslip of repository.listCollection("payslips")) {
    if (payslip.employeeId && !employeeIds.has(payslip.employeeId)) {
      issues.push({ severity: "critical", code: "PAYSLIP_ORPHANED_EMPLOYEE", entityType: "payslip", entityId: payslip.id });
    }
    if (number(payslip.grossSalary || payslip.gross_salary) < number(payslip.netSalary || payslip.net_salary)) {
      issues.push({ severity: "warning", code: "PAYSLIP_NET_GREATER_THAN_GROSS", entityType: "payslip", entityId: payslip.id });
    }
  }
  for (const attendance of repository.listCollection("attendance")) {
    if (attendance.employeeId && !employeeIds.has(attendance.employeeId)) {
      issues.push({ severity: "warning", code: "ATTENDANCE_ORPHANED_EMPLOYEE", entityType: "attendance", entityId: attendance.id });
    }
  }
  const criticalIssues = issues.filter((issue) => issue.severity === "critical").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const sourceCount = Math.max(1, allEmployees.length + repository.listCollection("payslips").length + repository.listCollection("attendance").length);
  return {
    score: Math.max(0, round(100 - (issues.length / sourceCount) * 100, 0)),
    issues: issues.length,
    criticalIssues,
    warnings,
    details: issues,
  };
}

function getOverview(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW_ANALYTICS);
  const key = `overview:${JSON.stringify(query)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cache: { hit: true, ttlMs: Math.max(0, cached.expiresAt - Date.now()) } };
  }
  const headcount = getHeadcount(user, query);
  const attendance = getAttendance(user, query);
  const attrition = getAttrition(user, query);
  const dataQuality = getDataQuality(user);
  const value = {
    totalHeadcount: headcount.active,
    averageAttendance: attendance.averageAttendance,
    attritionRate: attrition.attritionRate,
    reportAccuracy: dataQuality.score,
    generatedAt: new Date().toISOString(),
  };
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...value, cache: { hit: false, ttlMs: CACHE_TTL_MS } };
}

function getCustomReport(user, payload = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.CREATE);
  const moduleKey = String(payload.module || payload.reportType || "").toLowerCase();
  const collection = moduleCollection(moduleKey);
  if (!collection) {
    throw createHttpError(400, "Unsupported report module.", "UNSUPPORTED_REPORT_MODULE");
  }
  const fields = Array.isArray(payload.fields) && payload.fields.length ? payload.fields : null;
  let data = applyCommonFilters(repository.listCollection(collection), payload.filters || {});
  if (payload.groupBy) {
    data = groupBy(
      data,
      (record) => record[payload.groupBy],
      (_, key) => ({ [payload.groupBy]: key, count: 0 }),
      (summary) => {
        summary.count += 1;
      }
    );
  } else if (fields) {
    data = data.map((record) =>
      fields.reduce((row, field) => {
        row[field] = record[field] ?? null;
        return row;
      }, {})
    );
  }
  return { module: moduleKey, fields, rows: data, count: data.length };
}

function createSavedReport(payload, user) {
  requireReportPermission(user, REPORT_PERMISSIONS.CREATE);
  if (!payload.name || !payload.reportType) {
    throw createHttpError(400, "Saved report name and reportType are required.", "SAVED_REPORT_REQUIRED_FIELDS");
  }
  return repository.createSavedReport({
    name: String(payload.name).trim(),
    description: payload.description || null,
    reportType: String(payload.reportType).trim(),
    filters: payload.filters || {},
    columns: Array.isArray(payload.columns) ? payload.columns : [],
    createdBy: user.id,
    isShared: Boolean(payload.isShared),
  });
}

function listSavedReports(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW);
  return repository.listSavedReports(query);
}

function getSavedReport(id, user) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW);
  return repository.findSavedReport(id);
}

function updateSavedReport(id, payload, user) {
  requireReportPermission(user, REPORT_PERMISSIONS.EDIT);
  const report = repository.findSavedReport(id);
  if (!report) {
    return null;
  }
  return {
    oldValues: report,
    record: repository.updateSavedReport(id, {
      name: payload.name !== undefined ? String(payload.name).trim() : report.name,
      description: payload.description !== undefined ? payload.description : report.description,
      reportType: payload.reportType !== undefined ? String(payload.reportType).trim() : report.reportType,
      filters: payload.filters !== undefined ? payload.filters : report.filters,
      columns: payload.columns !== undefined ? payload.columns : report.columns,
      isShared: payload.isShared !== undefined ? Boolean(payload.isShared) : Boolean(report.isShared),
    }),
  };
}

function deleteSavedReport(id, user) {
  requireReportPermission(user, REPORT_PERMISSIONS.DELETE);
  const report = repository.findSavedReport(id);
  if (!report) {
    return null;
  }
  return { oldValues: report, record: repository.deleteSavedReport(id, user.id) };
}

function runSavedReport(id, user) {
  requireReportPermission(user, REPORT_PERMISSIONS.VIEW);
  const report = repository.findSavedReport(id);
  if (!report) {
    return null;
  }
  return {
    savedReport: report,
    result: getReportByType(report.reportType, user, report.filters || {}),
  };
}

function getReportByType(reportType, user, filters = {}) {
  const key = String(reportType || "").toLowerCase();
  const registry = {
    overview: getOverview,
    workforce: getOverview,
    employees: getHeadcount,
    headcount: getHeadcount,
    "headcount-growth": getHeadcountGrowth,
    attendance: getAttendance,
    attrition: getAttrition,
    departments: getDepartmentReports,
    leave: getLeave,
    payroll: getPayroll,
    tasks: getTasks,
    targets: getTargets,
    promotions: getPromotions,
    "salary-increments": getSalaryIncrements,
    expenses: getExpenses,
    purchases: getPurchases,
    bills: getBills,
    vendors: getVendors,
    "nysc-interns": getNyscInterns,
    discipline: getDiscipline,
    meetings: getMeetings,
    events: getEvents,
    announcements: getAnnouncements,
    "data-quality": getDataQuality,
  };
  if (!registry[key]) {
    throw createHttpError(400, "Unsupported report type.", "UNSUPPORTED_REPORT_TYPE");
  }
  return registry[key](user, filters);
}

function exportReport(query = {}, user) {
  requireReportPermission(user, REPORT_PERMISSIONS.EXPORT);
  const reportType = query.reportType || query.type || "overview";
  const format = String(query.format || "csv").toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) {
    throw createHttpError(400, "Unsupported export format.", "UNSUPPORTED_EXPORT_FORMAT");
  }
  const filters = parseFilters(query.filters) || {
    startDate: query.startDate,
    endDate: query.endDate,
    departmentId: query.departmentId,
    employeeId: query.employeeId,
    employmentType: query.employmentType,
    employmentStatus: query.employmentStatus,
  };
  const exportJob = repository.createExport({
    reportType,
    format,
    requestedBy: user.id,
    filters,
    status: EXPORT_STATUS.PROCESSING,
    filePath: null,
    fileSize: 0,
    completedAt: null,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  const report = getReportByType(reportType, user, filters);
  const content = format === "csv" ? toCsv(report) : serializePseudoFile(format, reportType, report);
  const completed = repository.updateExport(exportJob.id, {
    status: EXPORT_STATUS.COMPLETED,
    filePath: `/exports/reports/${exportJob.id}.${format}`,
    fileSize: Buffer.byteLength(content, "utf8"),
    completedAt: new Date().toISOString(),
  });
  return { job: completed, content };
}

function listExports(user, query = {}) {
  requireReportPermission(user, REPORT_PERMISSIONS.EXPORT);
  return repository.listExports(query);
}

function parseFilters(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function moduleCollection(moduleKey) {
  return {
    employees: "employees",
    departments: "departments",
    attendance: "attendance",
    leave: "leave_requests",
    payroll: "payroll_runs",
    tasks: "tasks",
    targets: "targets",
    expenses: "expenses",
    purchases: "purchase_requests",
    bills: "bills",
    vendors: "vendors",
    events: "events",
    discipline: "disciplinary_cases",
    "nysc-interns": "nysc_intern_profiles",
    announcements: "announcements",
  }[moduleKey];
}

function amountGroup(records, keyFn, keyName, amountField) {
  return groupBy(
    records,
    keyFn,
    (_, key) => ({ [keyName]: key === "unassigned" ? null : key, name: keyName === "departmentId" ? departmentName(key) : key, count: 0, amount: 0 }),
    (summary, record) => {
      summary.count += 1;
      summary.amount = round(summary.amount + number(amountField ? record[amountField] : record.totalAmount || record.amount || record.total || record.estimatedAmount || record.amountDue));
    }
  );
}

function countByMonth(records) {
  return groupBy(
    records,
    (record) => monthKey(dateValue(record)),
    (_, key) => ({ month: key, count: 0 }),
    (summary) => {
      summary.count += 1;
    }
  );
}

function toCsv(report) {
  const rows = flattenReport(report);
  if (!rows.length) {
    return "";
  }
  const headers = [...rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set())];
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function flattenReport(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenReport(item, prefix));
  }
  if (!value || typeof value !== "object") {
    return [{ [prefix || "value"]: value }];
  }
  const scalar = {};
  const nestedRows = [];
  for (const [key, item] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(item)) {
      nestedRows.push(...item.flatMap((entry) => flattenReport(entry, nextKey)));
    } else if (item && typeof item === "object") {
      const nested = flattenReport(item, nextKey);
      if (nested.length === 1) {
        Object.assign(scalar, nested[0]);
      } else {
        nestedRows.push(...nested);
      }
    } else {
      scalar[nextKey] = item;
    }
  }
  return nestedRows.length ? nestedRows.map((row) => ({ ...scalar, ...row })) : [scalar];
}

function serializePseudoFile(format, reportType, report) {
  if (format === "pdf") {
    return `PDF Report: ${reportType}\n\n${JSON.stringify(report, null, 2)}`;
  }
  return `XLSX Report: ${reportType}\n\n${toCsv(report)}`;
}

module.exports = {
  createSavedReport,
  deleteSavedReport,
  exportReport,
  getAnnouncements,
  getAttendance,
  getAttrition,
  getBills,
  getCustomReport,
  getDataQuality,
  getDepartmentReports,
  getDiscipline,
  getEvents,
  getExpenses,
  getHeadcount,
  getHeadcountGrowth,
  getLeave,
  getMeetings,
  getNyscInterns,
  getOverview,
  getPayroll,
  getPromotions,
  getPurchases,
  getSalaryIncrements,
  getSavedReport,
  getTargets,
  getTasks,
  getVendors,
  listExports,
  listSavedReports,
  runSavedReport,
  updateSavedReport,
};
