const crypto = require("crypto");
const { getUserById } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate } = require("../../utils/query");
const { DEFAULT_EXPENSE_CATEGORIES } = require("./constants");

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

function ensureDefaultCategories() {
  const records = readCollection("expense_categories");
  const active = records.filter((record) => !record.deletedAt);
  const missing = DEFAULT_EXPENSE_CATEGORIES.filter(
    (category) => !active.some((record) => String(record.name || "").toLowerCase() === category.name.toLowerCase())
  );
  if (!missing.length) {
    return active;
  }

  const timestamp = now();
  const created = missing.map((category) => ({
    id: crypto.randomUUID(),
    name: category.name,
    description: null,
    status: "ACTIVE",
    requiresReceipt: category.requiresReceipt,
    requires_receipt: category.requiresReceipt,
    maxAmount: category.maxAmount,
    max_amount: category.maxAmount,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  writeCollection("expense_categories", [...records, ...created]);
  return [...active, ...created];
}

function listCategories(query = {}) {
  return paginate(applyBasicFilters(ensureDefaultCategories(), query, ["name", "description"]), query);
}

function findCategory(idOrName) {
  return (
    ensureDefaultCategories().find(
      (category) =>
        category.id === idOrName ||
        String(category.name || "").toLowerCase() === String(idOrName || "").toLowerCase()
    ) || null
  );
}

function ensureDefaultPolicies() {
  const records = readCollection("expense_policies");
  if (records.some((record) => !record.deletedAt)) {
    return records.filter((record) => !record.deletedAt);
  }

  const policies = ensureDefaultCategories().map((category) => ({
    id: crypto.randomUUID(),
    categoryId: category.id,
    departmentId: null,
    maxAmount: category.maxAmount ?? category.max_amount ?? null,
    requiresReceipt: Boolean(category.requiresReceipt ?? category.requires_receipt),
    receiptRequiredAmount: Boolean(category.requiresReceipt ?? category.requires_receipt) ? 10000 : null,
    requiresManagerApproval: true,
    requiresFinanceApproval: Number(category.maxAmount ?? category.max_amount ?? 0) > 75000,
    reimbursementAllowed: true,
    currency: "NGN",
    active: true,
    createdAt: now(),
    updatedAt: now(),
  }));
  writeCollection("expense_policies", policies);
  return policies;
}

function listPolicies(query = {}) {
  return paginate(applyBasicFilters(ensureDefaultPolicies(), query, ["currency"]), query);
}

function listAllPolicies(query = {}) {
  return applyBasicFilters(ensureDefaultPolicies(), query, ["currency"]);
}

function findPolicy(id) {
  return activeRecords("expense_policies").find((policy) => policy.id === id) || null;
}

function createPolicy(payload) {
  ensureDefaultPolicies();
  return createRecord("expense_policies", payload);
}

function updatePolicy(id, payload) {
  return updateRecord("expense_policies", id, payload);
}

function findBestPolicy({ categoryId, departmentId, currency }) {
  const policies = ensureDefaultPolicies().filter((policy) => policy.active !== false);
  return (
    policies.find(
      (policy) =>
        policy.categoryId === categoryId &&
        (policy.departmentId || null) === (departmentId || null) &&
        String(policy.currency || currency || "NGN").toUpperCase() === String(currency || "NGN").toUpperCase()
    ) ||
    policies.find((policy) => policy.categoryId === categoryId && !policy.departmentId) ||
    policies.find((policy) => !policy.categoryId && !policy.departmentId) ||
    null
  );
}

function isExpenseClaim(record) {
  return record.source === "expense_claim" || record.expenseType === "CLAIM" || Boolean(record.reference);
}

function applyExpenseFilters(expenses, query = {}) {
  const normalized = {
    q: query.q || query.search,
    employeeId: query.employeeId || query.employee_id || query.employee,
    departmentId: query.departmentId || query.department_id || query.department,
    status: query.status,
    reimbursementStatus: query.reimbursementStatus || query.reimbursement_status,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
  let filtered = applyBasicFilters(expenses, normalized, [
    "reference",
    "description",
    "notes",
    "employeeName",
    "departmentName",
    "categoryName",
    "status",
    "approvalStatus",
    "reimbursementStatus",
  ]);

  const category = query.categoryId || query.category_id || query.category;
  if (category) {
    filtered = filtered.filter(
      (expense) =>
        expense.categoryId === category ||
        String(expense.categoryName || expense.category || "").toLowerCase() === String(category).toLowerCase()
    );
  }
  const date = query.date || query.expenseDate || query.expense_date;
  if (date) {
    filtered = filtered.filter((expense) => expense.expenseDate === date || expense.expense_date === date);
  }
  const dateFrom = query.dateFrom || query.date_from;
  const dateTo = query.dateTo || query.date_to;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((expense) => {
      const value = expense.expenseDate || expense.expense_date || expense.createdAt || "";
      if (dateFrom && value < dateFrom) {
        return false;
      }
      if (dateTo && value > dateTo) {
        return false;
      }
      return true;
    });
  }
  const minAmount = query.minAmount || query.min_amount;
  const maxAmount = query.maxAmount || query.max_amount || query.amount;
  if (minAmount) {
    filtered = filtered.filter((expense) => Number(expense.amount || 0) >= Number(minAmount));
  }
  if (maxAmount) {
    filtered = filtered.filter((expense) => Number(expense.amount || 0) <= Number(maxAmount));
  }
  return filtered;
}

function listExpenses(query = {}) {
  return paginate(applyExpenseFilters(activeRecords("expenses").filter(isExpenseClaim), query), query);
}

function listAllExpenses(query = {}) {
  return applyExpenseFilters(activeRecords("expenses").filter(isExpenseClaim), query);
}

function findExpense(id) {
  return activeRecords("expenses").find((expense) => expense.id === id && isExpenseClaim(expense)) || null;
}

function findPossibleDuplicate({ employeeId, expenseDate, amount, categoryId, receiptNumber }, ignoredId) {
  return (
    activeRecords("expenses")
      .filter(isExpenseClaim)
      .find(
        (expense) =>
          expense.id !== ignoredId &&
          expense.employeeId === employeeId &&
          expense.expenseDate === expenseDate &&
          Number(expense.amount || 0) === Number(amount || 0) &&
          expense.categoryId === categoryId &&
          (!receiptNumber || repositoryReceiptNumbers(expense.id).includes(String(receiptNumber).toLowerCase()))
      ) || null
  );
}

function repositoryReceiptNumbers(expenseId) {
  return activeRecords("expense_receipts")
    .filter((receipt) => receipt.expenseId === expenseId && receipt.receiptNumber)
    .map((receipt) => String(receipt.receiptNumber).toLowerCase());
}

function createExpense(payload) {
  return createRecord("expenses", payload);
}

function updateExpense(id, payload) {
  return updateRecord("expenses", id, payload);
}

function createItem(payload) {
  return createRecord("expense_items", payload);
}

function listItems(expenseId) {
  return activeRecords("expense_items").filter((item) => item.expenseId === expenseId);
}

function createApproval(payload) {
  return createRecord("expense_approvals", payload);
}

function updateApproval(id, payload) {
  return updateRecord("expense_approvals", id, payload);
}

function listApprovals(expenseId) {
  return activeRecords("expense_approvals").filter((approval) => approval.expenseId === expenseId);
}

function findPendingApproval(expenseId, level) {
  return (
    activeRecords("expense_approvals").find(
      (approval) => approval.expenseId === expenseId && Number(approval.approvalLevel) === Number(level) && approval.status === "PENDING"
    ) || null
  );
}

function createReceipt(payload) {
  return createRecord("expense_receipts", payload);
}

function listReceipts(expenseId) {
  return activeRecords("expense_receipts").filter((receipt) => receipt.expenseId === expenseId);
}

function createComment(payload) {
  return createRecord("expense_comments", payload);
}

function listComments(expenseId) {
  return activeRecords("expense_comments").filter((comment) => comment.expenseId === expenseId);
}

function createHistory(payload) {
  return createRecord("expense_history", payload);
}

function listHistory(expenseId) {
  return activeRecords("expense_history").filter((history) => history.expenseId === expenseId);
}

function createReimbursement(payload) {
  return createRecord("expense_reimbursements", payload);
}

function listReimbursements(expenseId) {
  return activeRecords("expense_reimbursements").filter((reimbursement) => reimbursement.expenseId === expenseId);
}

function findEmployee(id) {
  return activeRecords("employees").find((employee) => employee.id === id) || null;
}

function findEmployeeByUserId(userId) {
  const { resolveEmployeeForUserId } = require("../employees/employeeProfile");
  return resolveEmployeeForUserId(userId);
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function findUser(id) {
  return getUserById(id);
}

function findAccount(id) {
  return activeRecords("accounts").find((account) => account.id === id) || null;
}

module.exports = {
  createApproval,
  createComment,
  createExpense,
  createHistory,
  createItem,
  createPolicy,
  createReceipt,
  createReimbursement,
  findAccount,
  findBestPolicy,
  findCategory,
  findDepartment,
  findEmployee,
  findEmployeeByUserId,
  findExpense,
  findPendingApproval,
  findPolicy,
  findPossibleDuplicate,
  findUser,
  listAllExpenses,
  listAllPolicies,
  listApprovals,
  listCategories,
  listComments,
  listExpenses,
  listHistory,
  listItems,
  listPolicies,
  listReceipts,
  listReimbursements,
  updateApproval,
  updateExpense,
  updatePolicy,
};
