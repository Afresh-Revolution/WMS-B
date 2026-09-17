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

function normalizePurchaseQuery(query = {}) {
  return {
    q: query.q || query.search,
    status: query.status,
    departmentId: query.departmentId || query.department_id || query.department,
    requesterId: query.requesterId || query.requester_id || query.requester,
    priority: query.priority,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
}

function applyPurchaseFilters(records, query = {}) {
  let filtered = applyBasicFilters(records, normalizePurchaseQuery(query), [
    "reference",
    "requestNumber",
    "title",
    "description",
    "reason",
    "requesterName",
    "departmentName",
    "vendorName",
    "status",
  ]);
  const dateFrom = query.dateFrom || query.date_from;
  const dateTo = query.dateTo || query.date_to;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((record) => {
      const value = record.submittedAt || record.createdAt || "";
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
    filtered = filtered.filter((record) => Number(record.estimatedAmount || record.amount || 0) >= Number(query.minAmount || query.min_amount));
  }
  if (query.maxAmount || query.max_amount) {
    filtered = filtered.filter((record) => Number(record.estimatedAmount || record.amount || 0) <= Number(query.maxAmount || query.max_amount));
  }
  return filtered;
}

function listPurchaseRequests(query = {}) {
  return paginate(applyPurchaseFilters(activeRecords("purchase_requests"), query), query);
}

function listAllPurchaseRequests(query = {}) {
  return applyPurchaseFilters(activeRecords("purchase_requests"), query);
}

function findPurchaseRequest(id) {
  return activeRecords("purchase_requests").find((request) => request.id === id) || null;
}

function createPurchaseRequest(payload) {
  return createRecord("purchase_requests", payload);
}

function updatePurchaseRequest(id, payload) {
  return updateRecord("purchase_requests", id, payload);
}

function createPurchaseRequestItem(payload) {
  return createRecord("purchase_request_items", payload);
}

function listPurchaseRequestItems(purchaseRequestId) {
  return activeRecords("purchase_request_items").filter((item) => item.purchaseRequestId === purchaseRequestId);
}

function updatePurchaseRequestItem(id, payload) {
  return updateRecord("purchase_request_items", id, payload);
}

function createApproval(payload) {
  return createRecord("purchase_request_approvals", payload);
}

function updateApproval(id, payload) {
  return updateRecord("purchase_request_approvals", id, payload);
}

function listApprovals(purchaseRequestId) {
  return activeRecords("purchase_request_approvals").filter((approval) => approval.purchaseRequestId === purchaseRequestId);
}

function findPendingApproval(purchaseRequestId, level) {
  return (
    activeRecords("purchase_request_approvals").find(
      (approval) => approval.purchaseRequestId === purchaseRequestId && Number(approval.approvalLevel) === Number(level) && approval.status === "PENDING"
    ) || null
  );
}

function createComment(payload) {
  return createRecord("purchase_request_comments", payload);
}

function listComments(purchaseRequestId) {
  return activeRecords("purchase_request_comments").filter((comment) => comment.purchaseRequestId === purchaseRequestId);
}

function createAttachment(payload) {
  return createRecord("purchase_request_attachments", payload);
}

function listAttachments(purchaseRequestId) {
  return activeRecords("purchase_request_attachments").filter((attachment) => attachment.purchaseRequestId === purchaseRequestId);
}

function createHistory(payload) {
  return createRecord("purchase_request_history", payload);
}

function listHistory(purchaseRequestId) {
  return activeRecords("purchase_request_history").filter((history) => history.purchaseRequestId === purchaseRequestId);
}

function createPurchaseOrder(payload) {
  return createRecord("purchase_orders", payload);
}

function updatePurchaseOrder(id, payload) {
  return updateRecord("purchase_orders", id, payload);
}

function listPurchaseOrders(query = {}) {
  return paginate(applyBasicFilters(activeRecords("purchase_orders"), query, ["reference", "status", "vendorName"]), query);
}

function findPurchaseOrder(id) {
  return activeRecords("purchase_orders").find((order) => order.id === id) || null;
}

function findPurchaseOrderForRequest(purchaseRequestId) {
  return activeRecords("purchase_orders").find((order) => order.purchaseRequestId === purchaseRequestId) || null;
}

function createPurchaseOrderItem(payload) {
  const item = createRecord("purchase_order_items", payload);
  createRecord("purchase_items", {
    id: item.id,
    purchaseOrderId: item.purchaseOrderId,
    purchase_order_id: item.purchaseOrderId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unit_price: item.unitPrice,
    tax: item.tax,
    discount: item.discount,
    total: item.total,
  });
  return item;
}

function listPurchaseOrderItems(purchaseOrderId) {
  return activeRecords("purchase_order_items").filter((item) => item.purchaseOrderId === purchaseOrderId);
}

function createVendorQuote(payload) {
  return createRecord("vendor_quotes", payload);
}

function listVendorQuotes(purchaseRequestId) {
  return activeRecords("vendor_quotes").filter((quote) => quote.purchaseRequestId === purchaseRequestId);
}

function createReceipt(payload) {
  return createRecord("purchase_receipts", payload);
}

function findReceipt(id) {
  return activeRecords("purchase_receipts").find((receipt) => receipt.id === id) || null;
}

function listReceipts(purchaseOrderId) {
  return activeRecords("purchase_receipts").filter((receipt) => receipt.purchaseOrderId === purchaseOrderId);
}

function createReceiptItem(payload) {
  return createRecord("purchase_receipt_items", payload);
}

function listReceiptItems(purchaseReceiptId) {
  return activeRecords("purchase_receipt_items").filter((item) => item.purchaseReceiptId === purchaseReceiptId);
}

function findVendor(id) {
  return activeRecords("vendors").find((vendor) => vendor.id === id) || null;
}

function createVendorBill(payload) {
  const bill = createRecord("vendor_bills", payload);
  createRecord("bills", {
    id: bill.id,
    billNumber: bill.billNumber,
    bill_number: bill.billNumber,
    vendorId: bill.vendorId,
    description: bill.description,
    category: "purchase",
    amount: bill.total,
    dueDate: bill.dueDate,
    paymentStatus: bill.status,
    payment_status: bill.status,
  });
  return bill;
}

function listVendorBills(query = {}) {
  return applyBasicFilters(activeRecords("vendor_bills"), query, ["billNumber", "invoiceNumber", "status"]);
}

function createExpense(payload) {
  return createRecord("expenses", payload);
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

module.exports = {
  createApproval,
  createAttachment,
  createComment,
  createExpense,
  createHistory,
  createPurchaseOrder,
  createPurchaseOrderItem,
  createPurchaseRequest,
  createPurchaseRequestItem,
  createReceipt,
  createReceiptItem,
  createVendorBill,
  createVendorQuote,
  findDepartment,
  findEmployee,
  findEmployeeByUserId,
  findPendingApproval,
  findPurchaseOrder,
  findPurchaseOrderForRequest,
  findPurchaseRequest,
  findReceipt,
  findUser,
  findVendor,
  listAllPurchaseRequests,
  listApprovals,
  listAttachments,
  listComments,
  listHistory,
  listPurchaseOrderItems,
  listPurchaseOrders,
  listPurchaseRequestItems,
  listPurchaseRequests,
  listReceiptItems,
  listReceipts,
  listVendorBills,
  listVendorQuotes,
  updateApproval,
  updatePurchaseOrder,
  updatePurchaseRequest,
  updatePurchaseRequestItem,
};
