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
  const existing = readCollection("expense_categories");
  if (existing.length > 0) {
    return existing.filter((record) => !record.deletedAt);
  }
  const records = DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
    id: crypto.randomUUID(),
    name,
    description: null,
    status: "ACTIVE",
    createdAt: now(),
    updatedAt: now(),
  }));
  writeCollection("expense_categories", records);
  return records;
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

function findVendor(id) {
  return activeRecords("vendors").find((vendor) => vendor.id === id) || null;
}

function findPurchaseOrder(id) {
  return activeRecords("purchase_orders").find((order) => order.id === id) || null;
}

function listPurchaseOrderItems(purchaseOrderId) {
  return activeRecords("purchase_order_items").filter((item) => item.purchaseOrderId === purchaseOrderId);
}

function findDepartment(id) {
  return activeRecords("departments").find((department) => department.id === id) || null;
}

function findEmployeeByUserId(userId) {
  return activeRecords("employees").find((employee) => employee.userId === userId || employee.user_id === userId) || null;
}

function findUser(id) {
  return getUserById(id);
}

function applyBillFilters(bills, query = {}) {
  const normalized = {
    q: query.q || query.search,
    vendorId: query.vendorId || query.vendor_id || query.vendor,
    status: query.status,
    paymentStatus: query.paymentStatus || query.payment_status,
    categoryId: query.categoryId || query.category_id,
    departmentId: query.departmentId || query.department_id || query.department,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
  let filtered = applyBasicFilters(bills, normalized, [
    "reference",
    "billNumber",
    "invoiceNumber",
    "vendorName",
    "description",
    "status",
    "paymentStatus",
  ]);
  const dueDate = query.dueDate || query.due_date;
  if (dueDate) {
    filtered = filtered.filter((bill) => bill.dueDate === dueDate);
  }
  const category = query.category;
  if (category) {
    filtered = filtered.filter(
      (bill) =>
        bill.categoryId === category ||
        String(bill.categoryName || bill.category || "").toLowerCase() === String(category).toLowerCase()
    );
  }
  const dateFrom = query.dateFrom || query.date_from;
  const dateTo = query.dateTo || query.date_to;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((bill) => {
      const value = bill.invoiceDate || bill.createdAt || "";
      if (dateFrom && value < dateFrom) {
        return false;
      }
      if (dateTo && value > dateTo) {
        return false;
      }
      return true;
    });
  }
  if (query.minAmount || query.min_amount) {
    filtered = filtered.filter((bill) => Number(bill.totalAmount || bill.amount || 0) >= Number(query.minAmount || query.min_amount));
  }
  if (query.maxAmount || query.max_amount) {
    filtered = filtered.filter((bill) => Number(bill.totalAmount || bill.amount || 0) <= Number(query.maxAmount || query.max_amount));
  }
  return filtered;
}

function listBills(query = {}) {
  return paginate(applyBillFilters(activeRecords("bills"), query), query);
}

function listAllBills(query = {}) {
  return applyBillFilters(activeRecords("bills"), query);
}

function findBill(id) {
  return activeRecords("bills").find((bill) => bill.id === id) || null;
}

function findDuplicateBill(vendorId, invoiceNumber, ignoredId) {
  return (
    activeRecords("bills").find(
      (bill) => bill.vendorId === vendorId && String(bill.invoiceNumber || "").toLowerCase() === String(invoiceNumber || "").toLowerCase() && bill.id !== ignoredId
    ) || null
  );
}

function createBill(payload) {
  return createRecord("bills", payload);
}

function updateBill(id, payload) {
  return updateRecord("bills", id, payload);
}

function createBillItem(payload) {
  return createRecord("bill_items", payload);
}

function listBillItems(billId) {
  return activeRecords("bill_items").filter((item) => item.billId === billId);
}

function createApproval(payload) {
  return createRecord("bill_approvals", payload);
}

function updateApproval(id, payload) {
  return updateRecord("bill_approvals", id, payload);
}

function listApprovals(billId) {
  return activeRecords("bill_approvals").filter((approval) => approval.billId === billId);
}

function findPendingApproval(billId, level) {
  return (
    activeRecords("bill_approvals").find(
      (approval) => approval.billId === billId && Number(approval.approvalLevel) === Number(level) && approval.status === "PENDING"
    ) || null
  );
}

function createPayment(payload) {
  return createRecord("bill_payments", payload);
}

function listPayments(billId) {
  return activeRecords("bill_payments").filter((payment) => payment.billId === billId);
}

function createAttachment(payload) {
  return createRecord("bill_attachments", payload);
}

function listAttachments(billId) {
  return activeRecords("bill_attachments").filter((attachment) => attachment.billId === billId);
}

function createComment(payload) {
  return createRecord("bill_comments", payload);
}

function listComments(billId) {
  return activeRecords("bill_comments").filter((comment) => comment.billId === billId);
}

function createHistory(payload) {
  return createRecord("bill_history", payload);
}

function listHistory(billId) {
  return activeRecords("bill_history").filter((history) => history.billId === billId);
}

function createExpense(payload) {
  return createRecord("expenses", payload);
}

function findExpenseForBill(billId) {
  return activeRecords("expenses").find((expense) => expense.billId === billId || expense.vendorBillId === billId) || null;
}

function createPaymentMethod(payload) {
  return createRecord("payment_methods", payload);
}

function findPaymentMethod(id) {
  return activeRecords("payment_methods").find((method) => method.id === id) || null;
}

function createAccount(payload) {
  return createRecord("accounts", payload);
}

function findAccount(id) {
  return activeRecords("accounts").find((account) => account.id === id) || null;
}

module.exports = {
  createAccount,
  createApproval,
  createAttachment,
  createBill,
  createBillItem,
  createComment,
  createExpense,
  createHistory,
  createPayment,
  createPaymentMethod,
  findAccount,
  findBill,
  findCategory,
  findDepartment,
  findDuplicateBill,
  findEmployeeByUserId,
  findExpenseForBill,
  findPaymentMethod,
  findPendingApproval,
  findPurchaseOrder,
  findUser,
  findVendor,
  listAllBills,
  listApprovals,
  listAttachments,
  listBillItems,
  listBills,
  listCategories,
  listComments,
  listHistory,
  listPayments,
  listPurchaseOrderItems,
  updateApproval,
  updateBill,
};
