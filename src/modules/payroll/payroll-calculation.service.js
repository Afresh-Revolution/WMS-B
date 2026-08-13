const { CALCULATION_TYPE, COMPONENT_TYPE, DEDUCTION_CATEGORY } = require("./constants");

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function normalizeCalculationType(value) {
  const normalized = String(value || CALCULATION_TYPE.FIXED).toUpperCase();
  return Object.values(CALCULATION_TYPE).includes(normalized) ? normalized : CALCULATION_TYPE.FIXED;
}

function calculateComponentAmount(component, baseSalary, grossSoFar) {
  const calculationType = normalizeCalculationType(component.calculationType || component.calculation_type);
  const value = toNumber(component.overrideValue ?? component.defaultValue ?? component.default_value ?? component.amount);

  if (calculationType === CALCULATION_TYPE.PERCENTAGE) {
    return roundMoney((baseSalary * value) / 100);
  }

  if (calculationType === CALCULATION_TYPE.FORMULA) {
    return 0;
  }

  return roundMoney(value);
}

function calculateTax(grossSalary, taxRules = []) {
  if (!taxRules.length) {
    return 0;
  }

  const rule = taxRules[0];
  const configuration = rule.configuration || {};
  const rate = toNumber(configuration.rate ?? configuration.percentage ?? rule.rate);
  const threshold = toNumber(configuration.threshold ?? rule.threshold);
  const taxable = Math.max(0, grossSalary - threshold);
  return roundMoney((taxable * rate) / 100);
}

function calculateStatutoryDeductions(grossSalary, statutoryRules = []) {
  return statutoryRules.map((rule) => ({
    componentId: rule.id,
    name: rule.name,
    amount: roundMoney((grossSalary * toNumber(rule.employeePercentage ?? rule.employee_percentage)) / 100),
    category: String(rule.code || rule.name || DEDUCTION_CATEGORY.OTHER).toUpperCase().includes("PENSION")
      ? DEDUCTION_CATEGORY.PENSION
      : DEDUCTION_CATEGORY.OTHER,
  }));
}

function calculatePayrollForEmployee({ employee, assignment, structureComponents = [], employeeDeductions = [], loans = [], advances = [], taxRules = [], statutoryRules = [] }) {
  const baseSalary = roundMoney(assignment.baseSalary ?? assignment.base_salary);
  const earnings = [
    {
      componentId: null,
      name: "Basic Salary",
      amount: baseSalary,
      isTaxable: true,
    },
  ];
  const deductions = [];

  for (const component of structureComponents) {
    const componentType = String(component.componentType || component.component_type || COMPONENT_TYPE.EARNING).toUpperCase();
    const amount = calculateComponentAmount(component, baseSalary, earnings.reduce((total, item) => total + item.amount, 0));
    if (amount <= 0) {
      continue;
    }

    if (componentType === COMPONENT_TYPE.DEDUCTION) {
      deductions.push({
        componentId: component.id,
        name: component.name,
        amount,
        category: component.category || DEDUCTION_CATEGORY.OTHER,
      });
    } else if (componentType === COMPONENT_TYPE.EARNING) {
      earnings.push({
        componentId: component.id,
        name: component.name,
        amount,
        isTaxable: component.isTaxable !== false && component.is_taxable !== false,
      });
    }
  }

  const totalEarnings = roundMoney(earnings.reduce((total, earning) => total + earning.amount, 0));
  const tax = calculateTax(totalEarnings, taxRules);
  if (tax > 0) {
    deductions.push({ componentId: null, name: "Tax", amount: tax, category: DEDUCTION_CATEGORY.TAX });
  }

  for (const deduction of calculateStatutoryDeductions(totalEarnings, statutoryRules)) {
    if (deduction.amount > 0) {
      deductions.push(deduction);
    }
  }

  for (const deduction of employeeDeductions) {
    deductions.push({
      componentId: deduction.componentId || null,
      name: deduction.name || "Employee Deduction",
      amount: roundMoney(deduction.amount),
      category: deduction.category || DEDUCTION_CATEGORY.OTHER,
    });
  }

  for (const loan of loans) {
    const repayment = Math.min(roundMoney(loan.monthlyRepayment ?? loan.monthly_repayment), roundMoney(loan.outstandingAmount ?? loan.outstanding_amount));
    if (repayment > 0) {
      deductions.push({
        componentId: null,
        name: "Loan Repayment",
        amount: repayment,
        category: DEDUCTION_CATEGORY.LOAN,
        sourceId: loan.id,
      });
    }
  }

  for (const advance of advances) {
    const repayment = Math.min(roundMoney(advance.repaymentAmount ?? advance.repayment_amount), roundMoney(advance.outstandingAmount ?? advance.outstanding_amount));
    if (repayment > 0) {
      deductions.push({
        componentId: null,
        name: "Salary Advance",
        amount: repayment,
        category: DEDUCTION_CATEGORY.ADVANCE,
        sourceId: advance.id,
      });
    }
  }

  const totalDeductions = roundMoney(deductions.reduce((total, deduction) => total + deduction.amount, 0));
  const allowances = roundMoney(earnings.filter((earning) => earning.name !== "Basic Salary").reduce((total, earning) => total + earning.amount, 0));

  return {
    employeeId: employee.id,
    basicSalary: baseSalary,
    allowances,
    bonuses: 0,
    overtime: 0,
    totalEarnings,
    grossSalary: totalEarnings,
    tax: roundMoney(deductions.filter((deduction) => deduction.category === DEDUCTION_CATEGORY.TAX).reduce((total, deduction) => total + deduction.amount, 0)),
    pension: roundMoney(deductions.filter((deduction) => deduction.category === DEDUCTION_CATEGORY.PENSION).reduce((total, deduction) => total + deduction.amount, 0)),
    loans: roundMoney(deductions.filter((deduction) => deduction.category === DEDUCTION_CATEGORY.LOAN).reduce((total, deduction) => total + deduction.amount, 0)),
    advances: roundMoney(deductions.filter((deduction) => deduction.category === DEDUCTION_CATEGORY.ADVANCE).reduce((total, deduction) => total + deduction.amount, 0)),
    totalDeductions,
    netSalary: roundMoney(totalEarnings - totalDeductions),
    earnings,
    deductions,
  };
}

module.exports = { calculatePayrollForEmployee, roundMoney };
