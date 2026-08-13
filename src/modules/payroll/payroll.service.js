const { hasPermission } = require("../../constants/rbac");
const { queueNotification } = require("../_shared/notificationService");
const { APPROVAL_STATUS, COMPONENT_TYPE, PAYMENT_STATUS, PAYROLL_PERIOD_STATUS, PAYROLL_PERMISSIONS, PAYROLL_RUN_STATUS } = require("./constants");
const { calculatePayrollForEmployee, roundMoney } = require("./payroll-calculation.service");
const { validatePayrollReadiness } = require("./payroll-validation.service");
const repository = require("./payroll.repository");

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

function normalizeStatus(value, fallback) {
  return String(value || fallback || "").toUpperCase();
}

function assertDateRange(startDate, endDate) {
  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw createHttpError(400, "Start date and end date must use YYYY-MM-DD.", "INVALID_DATE_RANGE");
  }
  if (startDate > endDate) {
    throw createHttpError(400, "Start date cannot be after end date.", "INVALID_DATE_RANGE");
  }
}

function getEmployeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || employee?.email || null;
}

function getEmployeeNumber(employee) {
  return employee?.employeeId || employee?.employee_id || employee?.employeeNumber || employee?.employee_number || null;
}

function getDepartmentName(employee) {
  if (employee?.department) {
    return employee.department;
  }
  const departmentId = employee?.departmentId || employee?.department_id;
  const department = departmentId ? repository.findDepartment(departmentId) : null;
  return department?.name || null;
}

function getActorEmployee(user) {
  return repository.findEmployeeByUserId(user?.id);
}

function assertCanViewEmployeePayroll(employeeId, user) {
  if (can(user, PAYROLL_PERMISSIONS.VIEW_ALL)) {
    return;
  }
  const employee = getActorEmployee(user);
  if (!employee || employee.id !== employeeId) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function recordHistory({ payrollRunId, actor, action, oldValues, newValues, reason }) {
  return repository.createHistory({
    payrollRunId,
    actorId: actor?.id || null,
    action,
    oldValues: oldValues || null,
    newValues: newValues || null,
    reason: reason || null,
  });
}

function createSalaryStructure(payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.MANAGE_SALARY);
  if (!payload.name || String(payload.name).trim().length < 2) {
    throw createHttpError(400, "Salary structure name is required.", "INVALID_SALARY_STRUCTURE");
  }
  const structure = repository.createSalaryStructure({
    name: String(payload.name).trim(),
    description: payload.description || null,
    currency: payload.currency || "NGN",
    status: payload.status || "ACTIVE",
    createdBy: user.id,
  });

  const createdComponents = [];
  for (const component of payload.components || []) {
    const salaryComponent = repository.createSalaryComponent({
      name: component.name,
      code: String(component.code || component.name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
      componentType: normalizeStatus(component.componentType || component.component_type, COMPONENT_TYPE.EARNING),
      calculationType: normalizeStatus(component.calculationType || component.calculation_type, "FIXED"),
      defaultValue: Number(component.defaultValue ?? component.default_value ?? component.amount ?? 0),
      isTaxable: component.isTaxable !== false && component.is_taxable !== false,
      isPensionable: Boolean(component.isPensionable ?? component.is_pensionable),
      isActive: component.isActive !== false && component.is_active !== false,
      category: component.category || null,
      createdBy: user.id,
    });
    repository.assignComponentToStructure({
      salaryStructureId: structure.id,
      componentId: salaryComponent.id,
      overrideValue: component.overrideValue ?? component.override_value ?? null,
      sortOrder: createdComponents.length + 1,
    });
    createdComponents.push(salaryComponent);
  }

  return { ...structure, components: createdComponents };
}

function listSalaryStructures(query) {
  return repository.listSalaryStructures(query);
}

function updateSalaryStructure(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.MANAGE_SALARY);
  return repository.updateSalaryStructure(id, {
    name: payload.name,
    description: payload.description,
    currency: payload.currency,
    status: payload.status,
  });
}

function getEmployeeSalary(employeeId, user) {
  assertCanViewEmployeePayroll(employeeId, user);
  const employee = repository.findEmployee(employeeId);
  if (!employee) {
    throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  }
  return {
    employee,
    assignments: repository.listSalaryAssignments(employeeId),
    history: repository.listSalaryHistory(employeeId),
    deductions: repository.listEmployeeDeductions(employeeId, "9999-12-31"),
  };
}

function assignEmployeeSalary(employeeId, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.MANAGE_SALARY);
  const employee = repository.findEmployee(employeeId);
  if (!employee) {
    throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  }
  const structure = repository.findSalaryStructure(payload.salaryStructureId || payload.salary_structure_id);
  if (!structure) {
    throw createHttpError(404, "Salary structure was not found.", "SALARY_STRUCTURE_NOT_FOUND");
  }
  const baseSalary = Number(payload.baseSalary ?? payload.base_salary);
  if (!Number.isFinite(baseSalary) || baseSalary <= 0) {
    throw createHttpError(400, "Base salary must be greater than zero.", "INVALID_BASE_SALARY");
  }

  const existing = repository.findActiveSalaryAssignment(employeeId, payload.effectiveFrom || payload.effective_from || "9999-12-31");
  if (existing) {
    repository.updateSalaryAssignment(existing.id, { status: "INACTIVE", effectiveTo: payload.effectiveFrom || payload.effective_from || null });
  }

  const assignment = repository.createSalaryAssignment({
    employeeId,
    employeeName: getEmployeeName(employee),
    salaryStructureId: structure.id,
    salaryStructureName: structure.name,
    effectiveFrom: payload.effectiveFrom || payload.effective_from,
    effectiveTo: payload.effectiveTo || payload.effective_to || null,
    baseSalary,
    currency: payload.currency || structure.currency || "NGN",
    status: "ACTIVE",
    createdBy: user.id,
  });
  repository.createSalaryHistory({
    employeeId,
    previousSalary: existing?.baseSalary || null,
    newSalary: baseSalary,
    reason: payload.reason || "Salary assignment",
    effectiveFrom: assignment.effectiveFrom,
    approvedBy: user.id,
  });
  queueNotification({
    recipientUserId: employee.userId || employee.user_id || null,
    type: "salary_changed",
    title: "Salary updated",
    body: "Your salary information has been updated.",
    data: { employeeId, salaryAssignmentId: assignment.id },
  });
  return assignment;
}

function createPayrollPeriod(payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.CREATE);
  assertDateRange(payload.startDate || payload.start_date, payload.endDate || payload.end_date);
  return repository.createPayrollPeriod({
    name: payload.name,
    startDate: payload.startDate || payload.start_date,
    endDate: payload.endDate || payload.end_date,
    payDate: payload.payDate || payload.pay_date || payload.endDate || payload.end_date,
    status: payload.status || PAYROLL_PERIOD_STATUS.OPEN,
    createdBy: user.id,
  });
}

function listPayrollPeriods(query) {
  return repository.listPayrollPeriods(query);
}

function updatePayrollPeriod(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.UPDATE);
  return repository.updatePayrollPeriod(id, {
    name: payload.name,
    startDate: payload.startDate || payload.start_date,
    endDate: payload.endDate || payload.end_date,
    payDate: payload.payDate || payload.pay_date,
    status: payload.status,
  });
}

function getReadiness(periodId) {
  const period = periodId ? repository.findPayrollPeriod(periodId) : repository.listPayrollPeriods({ limit: 1 }).data[0] || null;
  return validatePayrollReadiness({
    employees: repository.listEmployees(),
    period,
    getSalaryAssignment: (employee) => repository.findActiveSalaryAssignment(employee.id, period?.endDate || "9999-12-31"),
  });
}

function getDashboard() {
  const readiness = getReadiness();
  const runs = repository.listRuns({ limit: 100 }).data;
  const currentRun = runs[0] || null;
  return {
    readiness: readiness.readiness,
    totalPayable: currentRun?.netAmount || 0,
    staffOnPayroll: readiness.readyEmployees,
    vendorBillsDue: repository.listVendorBillsDue().length,
    currentPeriod: currentRun?.periodName || null,
    readinessReport: readiness,
  };
}

function buildRunReference() {
  const count = repository.listRuns({ limit: 100 }).meta.total + 1;
  return `PR-${String(count).padStart(4, "0")}`;
}

function calculateEmployeePayroll(employee, period) {
  const assignment = repository.findActiveSalaryAssignment(employee.id, period.endDate);
  const structureComponents = assignment ? repository.listStructureComponents(assignment.salaryStructureId) : [];
  return calculatePayrollForEmployee({
    employee,
    assignment,
    structureComponents,
    employeeDeductions: repository.listEmployeeDeductions(employee.id, period.endDate),
    loans: repository.listEmployeeLoans(employee.id),
    advances: repository.listEmployeeAdvances(employee.id),
    taxRules: repository.listTaxRules(period.endDate),
    statutoryRules: repository.listStatutoryDeductions(period.endDate),
  });
}

function createPayslipForItem({ run, period, employee, item, calculation }) {
  return repository.createPayslip({
    payrollRunItemId: item.id,
    employeeId: employee.id,
    employeeName: getEmployeeName(employee),
    employeeNumber: getEmployeeNumber(employee),
    departmentName: getDepartmentName(employee),
    payrollRunId: run.id,
    payslipNumber: `PS-${run.reference}-${getEmployeeNumber(employee) || employee.id.slice(0, 8)}`,
    grossSalary: calculation.grossSalary,
    totalEarnings: calculation.totalEarnings,
    totalDeductions: calculation.totalDeductions,
    netSalary: calculation.netSalary,
    currency: item.currency,
    fileUrl: null,
    status: "GENERATED",
    generatedAt: new Date().toISOString(),
    content: {
      period: period.name,
      payDate: period.payDate,
      earnings: calculation.earnings,
      deductions: calculation.deductions,
    },
  });
}

function createPayrollRun(payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.CALCULATE);
  const period = repository.findPayrollPeriod(payload.payrollPeriodId || payload.payroll_period_id);
  if (!period || period.status === PAYROLL_PERIOD_STATUS.CANCELLED || period.status === PAYROLL_PERIOD_STATUS.LOCKED) {
    throw createHttpError(404, "Payroll period was not found or is not runnable.", "PAYROLL_PERIOD_NOT_FOUND");
  }

  const readiness = getReadiness(period.id);
  if (!readiness.canRunPayroll) {
    throw createHttpError(409, "Payroll readiness validation failed.", "PAYROLL_NOT_READY");
  }

  const run = repository.createRun({
    reference: buildRunReference(),
    payrollPeriodId: period.id,
    periodName: period.name,
    runDate: new Date().toISOString().slice(0, 10),
    startedAt: new Date().toISOString(),
    completedAt: null,
    employeeCount: 0,
    grossAmount: 0,
    totalDeductions: 0,
    netAmount: 0,
    status: PAYROLL_RUN_STATUS.PROCESSING,
    createdBy: user.id,
    approvedBy: null,
  });

  const items = [];
  let grossAmount = 0;
  let totalDeductions = 0;
  let netAmount = 0;

  for (const employee of repository.listEmployees().filter((entry) => String(entry.status || "active").toLowerCase() === "active")) {
    const assignment = repository.findActiveSalaryAssignment(employee.id, period.endDate);
    const calculation = calculateEmployeePayroll(employee, period);
    const item = repository.createRunItem({
      payrollRunId: run.id,
      employeeId: employee.id,
      employeeName: getEmployeeName(employee),
      employeeNumber: getEmployeeNumber(employee),
      departmentId: employee.departmentId || employee.department_id || null,
      departmentName: getDepartmentName(employee),
      salaryAssignmentId: assignment.id,
      grossSalary: calculation.grossSalary,
      totalEarnings: calculation.totalEarnings,
      totalDeductions: calculation.totalDeductions,
      netSalary: calculation.netSalary,
      currency: assignment.currency,
      status: "CALCULATED",
      basicSalary: calculation.basicSalary,
      allowances: calculation.allowances,
      bonuses: calculation.bonuses,
      overtime: calculation.overtime,
      tax: calculation.tax,
      pension: calculation.pension,
      loans: calculation.loans,
      advances: calculation.advances,
    });

    for (const earning of calculation.earnings) {
      repository.createEarning({ payrollRunItemId: item.id, ...earning });
    }
    for (const deduction of calculation.deductions) {
      repository.createDeduction({ payrollRunItemId: item.id, ...deduction });
    }
    createPayslipForItem({ run, period, employee, item, calculation });
    items.push(item);
    grossAmount += calculation.grossSalary;
    totalDeductions += calculation.totalDeductions;
    netAmount += calculation.netSalary;
  }

  const updatedRun = repository.updateRun(run.id, {
    completedAt: new Date().toISOString(),
    employeeCount: items.length,
    grossAmount: roundMoney(grossAmount),
    totalDeductions: roundMoney(totalDeductions),
    netAmount: roundMoney(netAmount),
    status: PAYROLL_RUN_STATUS.PENDING_APPROVAL,
  });
  repository.updatePayrollPeriod(period.id, { status: PAYROLL_PERIOD_STATUS.PROCESSING });
  recordHistory({ payrollRunId: run.id, actor: user, action: "CALCULATED", oldValues: run, newValues: updatedRun });
  queueNotification({
    type: "payroll_requires_approval",
    title: "Payroll ready for approval",
    body: `${updatedRun.reference} is ready for approval.`,
    data: { payrollRunId: updatedRun.id },
  });

  return { record: { ...updatedRun, items }, readiness };
}

function listRuns(query) {
  return repository.listRuns(query);
}

function getRunDetails(id, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.VIEW);
  const run = repository.findRun(id);
  if (!run) {
    throw createHttpError(404, "Payroll run was not found.", "PAYROLL_RUN_NOT_FOUND");
  }
  const items = repository.listRunItems(id).map((item) => ({
    ...item,
    earnings: repository.listEarnings(item.id),
    deductions: repository.listDeductions(item.id),
  }));
  return {
    ...run,
    items,
    payments: repository.listPayments(id),
    history: repository.listHistory(id),
  };
}

function calculateRun(id, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.CALCULATE);
  const run = repository.findRun(id);
  if (!run) {
    return null;
  }
  return { record: getRunDetails(id, user) };
}

function approveRun(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.APPROVE);
  const run = repository.findRun(id);
  if (!run) {
    return null;
  }
  if (run.status !== PAYROLL_RUN_STATUS.PENDING_APPROVAL) {
    throw createHttpError(409, "Only payroll runs pending approval can be approved.", "PAYROLL_NOT_PENDING_APPROVAL");
  }
  const oldValues = run;
  repository.createApproval({
    payrollRunId: id,
    approverId: user.id,
    status: APPROVAL_STATUS.APPROVED,
    comment: payload.comment || null,
    approvedAt: new Date().toISOString(),
  });
  const updated = repository.updateRun(id, { status: PAYROLL_RUN_STATUS.APPROVED, approvedBy: user.id });
  recordHistory({ payrollRunId: id, actor: user, action: "APPROVED", oldValues, newValues: updated });
  return { oldValues, record: updated };
}

function rejectRun(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.REJECT);
  if (!payload.reason && !payload.rejectionReason) {
    throw createHttpError(400, "Rejection reason is required.", "REJECTION_REASON_REQUIRED");
  }
  const run = repository.findRun(id);
  if (!run) {
    return null;
  }
  const oldValues = run;
  repository.createApproval({
    payrollRunId: id,
    approverId: user.id,
    status: APPROVAL_STATUS.REJECTED,
    comment: payload.reason || payload.rejectionReason,
    rejectedAt: new Date().toISOString(),
  });
  const updated = repository.updateRun(id, { status: PAYROLL_RUN_STATUS.REJECTED, rejectionReason: payload.reason || payload.rejectionReason });
  recordHistory({ payrollRunId: id, actor: user, action: "REJECTED", oldValues, newValues: updated, reason: payload.reason || payload.rejectionReason });
  return { oldValues, record: updated };
}

function processPayment(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.PROCESS_PAYMENT);
  const run = repository.findRun(id);
  if (!run) {
    return null;
  }
  if (run.status !== PAYROLL_RUN_STATUS.APPROVED) {
    throw createHttpError(409, "Only approved payroll runs can be processed for payment.", "PAYROLL_NOT_APPROVED");
  }
  const oldValues = run;
  repository.updateRun(id, { status: PAYROLL_RUN_STATUS.PAYMENT_PROCESSING });
  const payments = repository.listRunItems(id).map((item) =>
    repository.createPayment({
      payrollRunId: id,
      employeeId: item.employeeId,
      payrollRunItemId: item.id,
      amount: item.netSalary,
      currency: item.currency,
      paymentMethod: payload.paymentMethod || "MANUAL",
      paymentReference: `${run.reference}-${item.employeeNumber || item.employeeId.slice(0, 8)}`,
      status: PAYMENT_STATUS.SUCCESS,
      processedAt: new Date().toISOString(),
      failureReason: null,
    })
  );
  const updated = repository.updateRun(id, { status: PAYROLL_RUN_STATUS.PAID, paidAt: new Date().toISOString() });
  recordHistory({ payrollRunId: id, actor: user, action: "PAYMENT_COMPLETED", oldValues, newValues: { run: updated, payments } });
  return { oldValues, record: updated, payments };
}

function lockRun(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.LOCK);
  const run = repository.findRun(id);
  if (!run) {
    return null;
  }
  if (run.status !== PAYROLL_RUN_STATUS.PAID) {
    throw createHttpError(409, "Only paid payroll runs can be locked.", "PAYROLL_NOT_PAID");
  }
  const oldValues = run;
  const updated = repository.updateRun(id, { status: PAYROLL_RUN_STATUS.LOCKED, lockedAt: new Date().toISOString(), lockedBy: user.id });
  recordHistory({ payrollRunId: id, actor: user, action: "LOCKED", oldValues, newValues: updated, reason: payload.reason });
  return { oldValues, record: updated };
}

function cancelRun(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.CANCEL);
  const run = repository.findRun(id);
  if (!run) {
    return null;
  }
  if ([PAYROLL_RUN_STATUS.PAID, PAYROLL_RUN_STATUS.LOCKED].includes(run.status)) {
    throw createHttpError(409, "Paid or locked payroll cannot be cancelled.", "PAYROLL_FINALIZED");
  }
  const oldValues = run;
  const updated = repository.updateRun(id, { status: PAYROLL_RUN_STATUS.CANCELLED, cancelledAt: new Date().toISOString(), cancelledBy: user.id, cancellationReason: payload.reason || null });
  recordHistory({ payrollRunId: id, actor: user, action: "CANCELLED", oldValues, newValues: updated, reason: payload.reason });
  return { oldValues, record: updated };
}

function listRunItems(id, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.VIEW);
  return repository.listRunItems(id);
}

function listPayslips(query, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.VIEW_PAYSLIPS);
  if (can(user, PAYROLL_PERMISSIONS.VIEW_ALL)) {
    return repository.listPayslips(query);
  }
  const employee = getActorEmployee(user);
  if (!employee) {
    return { data: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } };
  }
  return repository.listPayslips({ ...query, employeeId: employee.id });
}

function getPayslip(id, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.VIEW_PAYSLIPS);
  const payslip = repository.findPayslip(id);
  if (!payslip) {
    return null;
  }
  if (!can(user, PAYROLL_PERMISSIONS.VIEW_ALL)) {
    assertCanViewEmployeePayroll(payslip.employeeId, user);
  }
  const item = repository.findRunItem(payslip.payrollRunItemId);
  return {
    ...payslip,
    item,
    earnings: item ? repository.listEarnings(item.id) : [],
    deductions: item ? repository.listDeductions(item.id) : [],
  };
}

function generatePayslip(id, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.UPDATE);
  const payslip = repository.findPayslip(id);
  if (!payslip) {
    return null;
  }
  return repository.updatePayslip(id, { status: "GENERATED", generatedAt: new Date().toISOString() });
}

function addEmployeeDeduction(employeeId, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS);
  const employee = repository.findEmployee(employeeId);
  if (!employee) {
    throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  }
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError(400, "Deduction amount must be greater than zero.", "INVALID_DEDUCTION_AMOUNT");
  }
  return repository.createEmployeeDeduction({
    employeeId,
    name: payload.name || "Employee Deduction",
    amount,
    category: normalizeStatus(payload.category, "OTHER"),
    effectiveFrom: payload.effectiveFrom || payload.effective_from || new Date().toISOString().slice(0, 10),
    effectiveTo: payload.effectiveTo || payload.effective_to || null,
    status: "ACTIVE",
    createdBy: user.id,
  });
}

function removeEmployeeDeduction(employeeId, deductionId, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS);
  const deduction = repository.findEmployeeDeduction(deductionId);
  if (!deduction || deduction.employeeId !== employeeId) {
    return null;
  }
  return repository.updateEmployeeDeduction(deductionId, { status: "INACTIVE", deletedAt: new Date().toISOString(), deletedBy: user.id });
}

function listDeductions(query) {
  return repository.listSalaryComponents({ ...query, componentType: COMPONENT_TYPE.DEDUCTION });
}

function createDeduction(payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS);
  return repository.createSalaryComponent({
    name: payload.name,
    code: String(payload.code || payload.name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
    componentType: COMPONENT_TYPE.DEDUCTION,
    calculationType: normalizeStatus(payload.calculationType || payload.calculation_type, "FIXED"),
    defaultValue: Number(payload.defaultValue ?? payload.default_value ?? payload.amount ?? 0),
    category: normalizeStatus(payload.category, "OTHER"),
    isTaxable: false,
    isPensionable: false,
    isActive: true,
    createdBy: user.id,
  });
}

function updateDeduction(id, payload, user) {
  assertPermission(user, PAYROLL_PERMISSIONS.MANAGE_DEDUCTIONS);
  return repository.updateSalaryComponent(id, {
    name: payload.name,
    calculationType: payload.calculationType || payload.calculation_type,
    defaultValue: payload.defaultValue ?? payload.default_value ?? payload.amount,
    category: payload.category,
    isActive: payload.isActive ?? payload.is_active,
  });
}

function getReports(user, query = {}) {
  assertPermission(user, PAYROLL_PERMISSIONS.VIEW_REPORTS);
  const runs = repository.listRuns({ ...query, limit: 100 }).data;
  const items = runs.flatMap((run) => repository.listRunItems(run.id));
  const byDepartment = new Map();
  for (const item of items) {
    const key = item.departmentId || "unassigned";
    const current = byDepartment.get(key) || {
      departmentId: item.departmentId || null,
      departmentName: item.departmentName || "Unassigned",
      employees: 0,
      gross: 0,
      deductions: 0,
      net: 0,
    };
    current.employees += 1;
    current.gross = roundMoney(current.gross + Number(item.grossSalary || 0));
    current.deductions = roundMoney(current.deductions + Number(item.totalDeductions || 0));
    current.net = roundMoney(current.net + Number(item.netSalary || 0));
    byDepartment.set(key, current);
  }
  return {
    runCount: runs.length,
    employeeCount: items.length,
    grossAmount: roundMoney(items.reduce((total, item) => total + Number(item.grossSalary || 0), 0)),
    totalDeductions: roundMoney(items.reduce((total, item) => total + Number(item.totalDeductions || 0), 0)),
    netAmount: roundMoney(items.reduce((total, item) => total + Number(item.netSalary || 0), 0)),
    failedPayments: runs.flatMap((run) => repository.listPayments(run.id)).filter((payment) => payment.status === PAYMENT_STATUS.FAILED).length,
    departments: [...byDepartment.values()],
  };
}

function exportPayroll(user, query = {}) {
  assertPermission(user, PAYROLL_PERMISSIONS.EXPORT);
  const runs = repository.listRuns({ ...query, limit: 100 }).data;
  const rows = [["reference", "period", "employee", "employee_id", "gross", "deductions", "net", "status"]];
  for (const run of runs) {
    for (const item of repository.listRunItems(run.id)) {
      rows.push([run.reference, run.periodName, item.employeeName, item.employeeNumber, item.grossSalary, item.totalDeductions, item.netSalary, run.status]);
    }
  }
  return rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

module.exports = {
  addEmployeeDeduction,
  approveRun,
  assignEmployeeSalary,
  cancelRun,
  calculateRun,
  createDeduction,
  createPayrollPeriod,
  createPayrollRun,
  createSalaryStructure,
  exportPayroll,
  generatePayslip,
  getDashboard,
  getEmployeeSalary,
  getPayslip,
  getReadiness,
  getReports,
  getRunDetails,
  listDeductions,
  listPayslips,
  listPayrollPeriods,
  listRunItems,
  listRuns,
  listSalaryStructures,
  lockRun,
  processPayment,
  rejectRun,
  removeEmployeeDeduction,
  updateDeduction,
  updatePayrollPeriod,
  updateSalaryStructure,
};
