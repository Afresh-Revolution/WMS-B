function validatePayrollReadiness({ employees, period, getSalaryAssignment }) {
  const issues = [];
  const activeEmployees = employees.filter((employee) => String(employee.status || "active").toLowerCase() === "active");

  for (const employee of activeEmployees) {
    const employeeIssues = [];
    const assignment = getSalaryAssignment(employee);
    if (!assignment) {
      employeeIssues.push("Missing active salary assignment.");
    }
    if (assignment && Number(assignment.baseSalary || assignment.base_salary || 0) <= 0) {
      employeeIssues.push("Salary assignment has no positive base salary.");
    }
    if (!assignment?.currency) {
      employeeIssues.push("Salary currency is missing.");
    }
    const bankInformation = employee.bankInformation || employee.bank_information || {};
    if (employee.requireBankInformation && (!bankInformation.accountNumber || !bankInformation.bankName)) {
      employeeIssues.push("Bank information is incomplete.");
    }

    if (employeeIssues.length > 0) {
      issues.push({
        employeeId: employee.id,
        employeeName: employee.fullName || employee.name || employee.email || employee.employeeId,
        issues: employeeIssues,
      });
    }
  }

  const readyEmployees = activeEmployees.length - issues.length;
  return {
    periodId: period?.id || null,
    totalEmployees: activeEmployees.length,
    readyEmployees,
    issueCount: issues.length,
    readiness: activeEmployees.length ? Number(((readyEmployees / activeEmployees.length) * 100).toFixed(2)) : 0,
    canRunPayroll: issues.length === 0 && activeEmployees.length > 0,
    issues,
  };
}

module.exports = { validatePayrollReadiness };
