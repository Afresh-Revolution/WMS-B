const crypto = require("crypto");
const { getUserById } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");

function now() {
  return new Date().toISOString();
}

function activeRecords(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt);
}

function createRecord(collection, payload) {
  const timestamp = now();
  const records = readCollection(collection);
  const record = {
    id: crypto.randomUUID(),
    ...payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  records.push(record);
  writeCollection(collection, records);
  return record;
}

function updateRecord(collection, id, payload) {
  const records = readCollection(collection);
  const index = records.findIndex((record) => record.id === id && !record.deletedAt);
  if (index === -1) {
    return null;
  }

  records[index] = {
    ...records[index],
    ...payload,
    id: records[index].id,
    updatedAt: now(),
  };
  writeCollection(collection, records);
  return records[index];
}

function listEmployees() {
  return activeRecords("employees");
}

function findEmployee(id) {
  return activeRecords("employees").find((employee) => employee.id === id) || null;
}

function findEmployeeByUserId(userId) {
  return activeRecords("employees").find((employee) => employee.userId === userId || employee.user_id === userId) || null;
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function findUser(id) {
  return getUserById(id);
}

function listSalaryStructures(query = {}) {
  return paginate(applyBasicFilters(activeRecords("salary_structures"), query, ["name", "description", "currency"]), query);
}

function findSalaryStructure(id) {
  return activeRecords("salary_structures").find((structure) => structure.id === id) || null;
}

function createSalaryStructure(payload) {
  return createRecord("salary_structures", payload);
}

function updateSalaryStructure(id, payload) {
  return updateRecord("salary_structures", id, payload);
}

function createSalaryComponent(payload) {
  return createRecord("salary_components", payload);
}

function updateSalaryComponent(id, payload) {
  return updateRecord("salary_components", id, payload);
}

function listSalaryComponents(query = {}) {
  return paginate(applyBasicFilters(activeRecords("salary_components"), query, ["name", "code", "componentType"]), query);
}

function findSalaryComponent(id) {
  return activeRecords("salary_components").find((component) => component.id === id) || null;
}

function listStructureComponents(salaryStructureId) {
  const links = activeRecords("salary_structure_components").filter((link) => link.salaryStructureId === salaryStructureId);
  return links
    .map((link) => {
      const component = findSalaryComponent(link.componentId);
      return component ? { ...component, overrideValue: link.overrideValue, sortOrder: link.sortOrder || 0 } : null;
    })
    .filter(Boolean)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
}

function assignComponentToStructure(payload) {
  return createRecord("salary_structure_components", payload);
}

function createSalaryAssignment(payload) {
  return createRecord("employee_salary_assignments", payload);
}

function updateSalaryAssignment(id, payload) {
  return updateRecord("employee_salary_assignments", id, payload);
}

function listSalaryAssignments(employeeId) {
  return activeRecords("employee_salary_assignments").filter((assignment) => assignment.employeeId === employeeId);
}

function findActiveSalaryAssignment(employeeId, periodEndDate) {
  return (
    activeRecords("employee_salary_assignments")
      .filter((assignment) => {
        if (assignment.employeeId !== employeeId || assignment.status !== "ACTIVE") {
          return false;
        }
        if (assignment.effectiveFrom && assignment.effectiveFrom > periodEndDate) {
          return false;
        }
        if (assignment.effectiveTo && assignment.effectiveTo < periodEndDate) {
          return false;
        }
        return true;
      })
      .sort((left, right) => String(right.effectiveFrom || "").localeCompare(String(left.effectiveFrom || "")))[0] || null
  );
}

function createSalaryHistory(payload) {
  return createRecord("salary_history", payload);
}

function listSalaryHistory(employeeId) {
  return activeRecords("salary_history").filter((history) => history.employeeId === employeeId);
}

function createPayrollPeriod(payload) {
  return createRecord("payroll_periods", payload);
}

function updatePayrollPeriod(id, payload) {
  return updateRecord("payroll_periods", id, payload);
}

function findPayrollPeriod(id) {
  return activeRecords("payroll_periods").find((period) => period.id === id) || null;
}

function listPayrollPeriods(query = {}) {
  return paginate(applyBasicFilters(activeRecords("payroll_periods"), query, ["name", "status"]), query);
}

function listRuns(query = {}) {
  const normalized = {
    q: query.q || query.search,
    status: query.status,
    payrollPeriodId: query.payrollPeriodId || query.payroll_period_id || query.period,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
  let runs = applyBasicFilters(activeRecords("payroll_runs"), normalized, ["reference", "periodName", "status"]);
  const dateFrom = query.dateFrom || query.date_from;
  const dateTo = query.dateTo || query.date_to;
  if (dateFrom || dateTo) {
    runs = runs.filter((run) => {
      const value = run.runDate || run.createdAt;
      if (dateFrom && value < dateFrom) {
        return false;
      }
      if (dateTo && value > dateTo) {
        return false;
      }
      return true;
    });
  }
  return paginate(runs, query);
}

function findRun(id) {
  return activeRecords("payroll_runs").find((run) => run.id === id) || null;
}

function createRun(payload) {
  const run = createRecord("payroll_runs", payload);
  createRecord("payroll", {
    id: run.id,
    period: run.periodName || run.payrollPeriodId,
    payrollPeriodId: run.payrollPeriodId,
    reference: run.reference,
    status: run.status,
    grossAmount: run.grossAmount || 0,
    totalDeductions: run.totalDeductions || 0,
    netSalary: run.netAmount || 0,
    netAmount: run.netAmount || 0,
    createdBy: run.createdBy || null,
  });
  return run;
}

function updateRun(id, payload) {
  const run = updateRecord("payroll_runs", id, payload);
  if (run) {
    updateRecord("payroll", id, {
      period: run.periodName || run.payrollPeriodId,
      payrollPeriodId: run.payrollPeriodId,
      reference: run.reference,
      status: run.status,
      grossAmount: run.grossAmount || 0,
      totalDeductions: run.totalDeductions || 0,
      netSalary: run.netAmount || 0,
      netAmount: run.netAmount || 0,
      approvedBy: run.approvedBy || null,
      processedAt: run.completedAt || run.processedAt || null,
    });
  }
  return run;
}

function createRunItem(payload) {
  const item = createRecord("payroll_run_items", payload);
  createRecord("payroll_items", {
    id: item.id,
    payrollId: item.payrollRunId,
    payroll_id: item.payrollRunId,
    employeeId: item.employeeId,
    employee_id: item.employeeId,
    basicSalary: item.basicSalary || 0,
    basic_salary: item.basicSalary || 0,
    allowances: item.allowances || 0,
    bonuses: item.bonuses || 0,
    deductions: item.totalDeductions || 0,
    tax: item.tax || 0,
    pension: item.pension || 0,
    overtime: item.overtime || 0,
    loans: item.loans || 0,
    netSalary: item.netSalary || 0,
    net_salary: item.netSalary || 0,
    departmentId: item.departmentId || null,
  });
  return item;
}

function listRunItems(payrollRunId) {
  return activeRecords("payroll_run_items").filter((item) => item.payrollRunId === payrollRunId);
}

function findRunItem(id) {
  return activeRecords("payroll_run_items").find((item) => item.id === id) || null;
}

function createEarning(payload) {
  return createRecord("earnings", payload);
}

function listEarnings(payrollRunItemId) {
  return activeRecords("earnings").filter((earning) => earning.payrollRunItemId === payrollRunItemId);
}

function createDeduction(payload) {
  return createRecord("deductions", payload);
}

function listDeductions(payrollRunItemId) {
  return activeRecords("deductions").filter((deduction) => deduction.payrollRunItemId === payrollRunItemId);
}

function createEmployeeDeduction(payload) {
  return createRecord("employee_deductions", payload);
}

function updateEmployeeDeduction(id, payload) {
  return updateRecord("employee_deductions", id, payload);
}

function listEmployeeDeductions(employeeId, periodEndDate) {
  return activeRecords("employee_deductions").filter((deduction) => {
    if (deduction.employeeId !== employeeId || deduction.status !== "ACTIVE") {
      return false;
    }
    if (deduction.effectiveFrom && deduction.effectiveFrom > periodEndDate) {
      return false;
    }
    if (deduction.effectiveTo && deduction.effectiveTo < periodEndDate) {
      return false;
    }
    return true;
  });
}

function findEmployeeDeduction(id) {
  return activeRecords("employee_deductions").find((deduction) => deduction.id === id) || null;
}

function listEmployeeLoans(employeeId) {
  return activeRecords("employee_loans").filter((loan) => loan.employeeId === employeeId && loan.status === "ACTIVE");
}

function updateEmployeeLoan(id, payload) {
  return updateRecord("employee_loans", id, payload);
}

function listEmployeeAdvances(employeeId) {
  return activeRecords("employee_advances").filter((advance) => advance.employeeId === employeeId && advance.status === "APPROVED");
}

function updateEmployeeAdvance(id, payload) {
  return updateRecord("employee_advances", id, payload);
}

function listTaxRules(periodEndDate) {
  return activeRecords("tax_rules").filter((rule) => {
    if (rule.status !== "ACTIVE") {
      return false;
    }
    if (rule.effectiveFrom && rule.effectiveFrom > periodEndDate) {
      return false;
    }
    if (rule.effectiveTo && rule.effectiveTo < periodEndDate) {
      return false;
    }
    return true;
  });
}

function listStatutoryDeductions(periodEndDate) {
  return activeRecords("statutory_deductions").filter((item) => {
    if (item.isActive === false || item.status === "inactive") {
      return false;
    }
    if (item.effectiveFrom && item.effectiveFrom > periodEndDate) {
      return false;
    }
    if (item.effectiveTo && item.effectiveTo < periodEndDate) {
      return false;
    }
    return true;
  });
}

function createPayslip(payload) {
  return createRecord("payslips", payload);
}

function updatePayslip(id, payload) {
  return updateRecord("payslips", id, payload);
}

function listPayslips(query = {}) {
  const normalized = {
    q: query.q || query.search,
    employeeId: query.employeeId || query.employee_id,
    payrollRunId: query.payrollRunId || query.payroll_run_id,
    status: query.status,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
  return paginate(applyBasicFilters(activeRecords("payslips"), normalized, ["payslipNumber", "employeeName", "periodName", "status"]), query);
}

function findPayslip(id) {
  return activeRecords("payslips").find((payslip) => payslip.id === id) || null;
}

function createPayment(payload) {
  return createRecord("payroll_payments", payload);
}

function updatePayment(id, payload) {
  return updateRecord("payroll_payments", id, payload);
}

function listPayments(payrollRunId) {
  return activeRecords("payroll_payments").filter((payment) => payment.payrollRunId === payrollRunId);
}

function createApproval(payload) {
  return createRecord("payroll_approvals", payload);
}

function createAdjustment(payload) {
  return createRecord("payroll_adjustments", payload);
}

function createHistory(payload) {
  return createRecord("payroll_history", payload);
}

function listHistory(payrollRunId) {
  return activeRecords("payroll_history").filter((history) => history.payrollRunId === payrollRunId);
}

function listVendorBillsDue() {
  return activeRecords("vendor_bills").filter((bill) => ["PENDING", "DUE", "OVERDUE"].includes(String(bill.status || "").toUpperCase()));
}

module.exports = {
  assignComponentToStructure,
  createAdjustment,
  createApproval,
  createDeduction,
  createEarning,
  createEmployeeDeduction,
  createHistory,
  createPayment,
  createPayrollPeriod,
  createPayslip,
  createRun,
  createRunItem,
  createSalaryAssignment,
  createSalaryComponent,
  createSalaryHistory,
  createSalaryStructure,
  findActiveSalaryAssignment,
  findDepartment,
  findEmployee,
  findEmployeeByUserId,
  findEmployeeDeduction,
  findPayrollPeriod,
  findPayslip,
  findRun,
  findRunItem,
  findSalaryComponent,
  findSalaryStructure,
  findUser,
  listDeductions,
  listEarnings,
  listEmployeeAdvances,
  listEmployeeDeductions,
  listEmployeeLoans,
  listEmployees,
  listHistory,
  listPayslips,
  listPayments,
  listPayrollPeriods,
  listRunItems,
  listRuns,
  listSalaryAssignments,
  listSalaryComponents,
  listSalaryHistory,
  listSalaryStructures,
  listStatutoryDeductions,
  listStructureComponents,
  listTaxRules,
  listVendorBillsDue,
  updateEmployeeAdvance,
  updateEmployeeDeduction,
  updateEmployeeLoan,
  updatePayrollPeriod,
  updatePayslip,
  updatePayment,
  updateRun,
  updateSalaryAssignment,
  updateSalaryComponent,
  updateSalaryStructure,
};
