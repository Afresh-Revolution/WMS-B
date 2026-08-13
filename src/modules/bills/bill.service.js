const { hasPermission } = require("../../constants/rbac");
const { queueNotification } = require("../_shared/notificationService");
const { paginate } = require("../../utils/query");
const {
  BILL_APPROVAL_STATUS,
  BILL_MATCH_STATUS,
  BILL_PAYMENT_RECORD_STATUS,
  BILL_PAYMENT_STATUS,
  BILL_PERMISSIONS,
  BILL_STATUS,
} = require("./constants");
const repository = require("./bill.repository");

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

function roundMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function getVendorName(vendor) {
  return vendor?.businessName || vendor?.business_name || vendor?.name || null;
}

function buildReference() {
  const count = repository.listBills({ limit: 1 }).meta.total + 1;
  return `BILL-${String(count).padStart(4, "0")}`;
}

function getRequiredApprovalLevels(amount) {
  if (amount <= 500000) {
    return 1;
  }
  if (amount <= 2000000) {
    return 2;
  }
  return 3;
}

function normalizeItems(payload = {}) {
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : [
        {
          description: payload.description || payload.invoiceNumber || "Bill amount",
          quantity: 1,
          unitPrice: payload.amount ?? payload.totalAmount ?? payload.total_amount,
          taxRate: 0,
          discount: 0,
        },
      ];

  const items = rawItems.map((item) => {
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.unitPrice ?? item.unit_price);
    const taxRate = Number(item.taxRate ?? item.tax_rate ?? 0);
    const discount = roundMoney(item.discount || 0);
    if (!item.description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw createHttpError(400, "Each bill item requires description, positive quantity, and a valid unit price.", "INVALID_BILL_ITEM");
    }
    const base = roundMoney(quantity * unitPrice);
    const taxAmount = roundMoney((base * taxRate) / 100);
    return {
      description: item.description,
      quantity,
      unitPrice: roundMoney(unitPrice),
      taxRate,
      taxAmount,
      discount,
      total: roundMoney(base + taxAmount - discount),
    };
  });

  if (!items.length) {
    throw createHttpError(400, "At least one bill item is required.", "BILL_ITEMS_REQUIRED");
  }
  return items;
}

function calculateTotals(items) {
  const subtotal = roundMoney(items.reduce((total, item) => total + item.quantity * item.unitPrice, 0));
  const taxAmount = roundMoney(items.reduce((total, item) => total + item.taxAmount, 0));
  const discountAmount = roundMoney(items.reduce((total, item) => total + item.discount, 0));
  const totalAmount = roundMoney(subtotal + taxAmount - discountAmount);
  return { subtotal, taxAmount, discountAmount, totalAmount };
}

function calculatePaymentState(totalAmount, amountPaid) {
  const amountDue = roundMoney(totalAmount - amountPaid);
  if (amountPaid <= 0) {
    return { amountPaid: 0, amountDue: totalAmount, paymentStatus: BILL_PAYMENT_STATUS.UNPAID };
  }
  if (amountPaid < totalAmount) {
    return { amountPaid: roundMoney(amountPaid), amountDue, paymentStatus: BILL_PAYMENT_STATUS.PARTIALLY_PAID };
  }
  if (amountPaid === totalAmount) {
    return { amountPaid: roundMoney(amountPaid), amountDue: 0, paymentStatus: BILL_PAYMENT_STATUS.PAID };
  }
  return { amountPaid: roundMoney(amountPaid), amountDue: roundMoney(totalAmount - amountPaid), paymentStatus: BILL_PAYMENT_STATUS.OVERPAID };
}

function getDueStatus(bill) {
  if (bill.paymentStatus === BILL_PAYMENT_STATUS.PAID) {
    return bill.status;
  }
  if (bill.dueDate && bill.dueDate < today()) {
    return BILL_STATUS.OVERDUE;
  }
  return bill.status;
}

function getDueState(bill) {
  if (bill.paymentStatus === BILL_PAYMENT_STATUS.PAID) {
    return "PAID";
  }
  if (!bill.dueDate) {
    return "DUE";
  }
  const now = new Date(`${today()}T00:00:00.000Z`);
  const due = new Date(`${bill.dueDate}T00:00:00.000Z`);
  const daysUntilDue = Math.ceil((due - now) / 86400000);
  if (daysUntilDue < 0) {
    return "OVERDUE";
  }
  if (daysUntilDue <= 7) {
    return "DUE_SOON";
  }
  return "DUE";
}

function decorateBill(bill) {
  return {
    ...bill,
    status: getDueStatus(bill),
    dueState: getDueState(bill),
  };
}

function canAccessBill(user, bill) {
  if (can(user, BILL_PERMISSIONS.VIEW_ALL)) {
    return true;
  }
  if (bill.createdBy === user?.id) {
    return true;
  }
  const employee = repository.findEmployeeByUserId(user?.id);
  if (!employee || !bill.departmentId) {
    return false;
  }
  return can(user, BILL_PERMISSIONS.REVIEW) && bill.departmentId === (employee.departmentId || employee.department_id);
}

function assertBillAccess(user, bill) {
  if (!canAccessBill(user, bill)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function listAccessibleBills(user, query = {}) {
  const normalizedQuery = { ...query };
  const requestedStatus = normalizedQuery.status ? String(normalizedQuery.status).toUpperCase() : null;
  if (requestedStatus) {
    delete normalizedQuery.status;
  }

  let bills = repository.listAllBills(normalizedQuery).filter((bill) => canAccessBill(user, bill)).map(decorateBill);
  if (requestedStatus) {
    bills = bills.filter((bill) => bill.status === requestedStatus || bill.dueState === requestedStatus || bill.paymentStatus === requestedStatus);
  }
  return bills;
}

function matchPurchaseOrder(purchaseOrder, billItems, totalAmount, vendorId) {
  if (!purchaseOrder) {
    return BILL_MATCH_STATUS.NOT_APPLICABLE;
  }
  if (purchaseOrder.vendorId !== vendorId) {
    return BILL_MATCH_STATUS.MISMATCH;
  }
  const orderTotal = roundMoney(purchaseOrder.total || 0);
  if (orderTotal !== totalAmount) {
    return BILL_MATCH_STATUS.MISMATCH;
  }
  const orderItems = repository.listPurchaseOrderItems(purchaseOrder.id);
  if (orderItems.length && billItems.length && orderItems.length !== billItems.length) {
    return BILL_MATCH_STATUS.MISMATCH;
  }
  return BILL_MATCH_STATUS.MATCHED;
}

function recordHistory({ billId, actor, action, oldStatus, newStatus, comment, metadata }) {
  return repository.createHistory({
    billId,
    actorId: actor?.id || null,
    action,
    oldStatus: oldStatus || null,
    newStatus: newStatus || null,
    comment: comment || null,
    metadata: metadata || {},
  });
}

function createBill(payload, user) {
  assertPermission(user, BILL_PERMISSIONS.CREATE);
  const vendor = repository.findVendor(payload.vendorId || payload.vendor_id);
  if (!vendor || !["active", "ACTIVE"].includes(String(vendor.status || "active"))) {
    throw createHttpError(404, "Vendor was not found or is inactive.", "VENDOR_NOT_FOUND");
  }
  const invoiceNumber = payload.invoiceNumber || payload.invoice_number;
  if (!invoiceNumber) {
    throw createHttpError(400, "Invoice number is required.", "INVOICE_NUMBER_REQUIRED");
  }
  if (repository.findDuplicateBill(vendor.id, invoiceNumber)) {
    throw createHttpError(409, "An invoice with this number already exists for this vendor.", "DUPLICATE_VENDOR_INVOICE");
  }
  if (!payload.dueDate && !payload.due_date) {
    throw createHttpError(400, "Due date is required.", "DUE_DATE_REQUIRED");
  }
  const category = repository.findCategory(payload.categoryId || payload.category_id || payload.category);
  if (!category) {
    throw createHttpError(404, "Bill category was not found.", "CATEGORY_NOT_FOUND");
  }
  const department = payload.departmentId || payload.department_id ? repository.findDepartment(payload.departmentId || payload.department_id) : null;
  const purchaseOrder = payload.purchaseOrderId || payload.purchase_order_id ? repository.findPurchaseOrder(payload.purchaseOrderId || payload.purchase_order_id) : null;
  if ((payload.purchaseOrderId || payload.purchase_order_id) && !purchaseOrder) {
    throw createHttpError(404, "Purchase order was not found.", "PURCHASE_ORDER_NOT_FOUND");
  }
  if (purchaseOrder && purchaseOrder.status === "CANCELLED") {
    throw createHttpError(409, "Cancelled purchase orders cannot be matched to bills.", "PURCHASE_ORDER_CANCELLED");
  }

  const items = normalizeItems(payload);
  const totals = calculateTotals(items);
  if (totals.totalAmount <= 0) {
    throw createHttpError(400, "Bill total must be greater than zero.", "INVALID_BILL_AMOUNT");
  }
  const poMatchStatus = matchPurchaseOrder(purchaseOrder, items, totals.totalAmount, vendor.id);
  const initialStatus = payload.draft ? BILL_STATUS.DRAFT : BILL_STATUS.SUBMITTED;
  const bill = repository.createBill({
    reference: buildReference(),
    billNumber: null,
    vendorId: vendor.id,
    vendorName: getVendorName(vendor),
    purchaseOrderId: purchaseOrder?.id || null,
    invoiceNumber,
    invoiceDate: payload.invoiceDate || payload.invoice_date || today(),
    dueDate: payload.dueDate || payload.due_date,
    description: payload.description || null,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount,
    amount: totals.totalAmount,
    amountPaid: 0,
    amountDue: totals.totalAmount,
    currency: payload.currency || "NGN",
    categoryId: category.id,
    categoryName: category.name,
    category: category.name,
    departmentId: department?.id || purchaseOrder?.departmentId || null,
    departmentName: department?.name || purchaseOrder?.departmentName || null,
    status: initialStatus,
    paymentStatus: BILL_PAYMENT_STATUS.UNPAID,
    payment_status: BILL_PAYMENT_STATUS.UNPAID,
    approvalStatus: initialStatus === BILL_STATUS.DRAFT ? BILL_APPROVAL_STATUS.PENDING : BILL_APPROVAL_STATUS.PENDING,
    currentApprovalLevel: initialStatus === BILL_STATUS.DRAFT ? 0 : 1,
    requiredApprovalLevels: getRequiredApprovalLevels(totals.totalAmount),
    poMatchStatus,
    createdBy: user.id,
    approvedBy: null,
    approvedAt: null,
  });
  const createdItems = items.map((item) => repository.createBillItem({ billId: bill.id, ...item }));
  if (initialStatus !== BILL_STATUS.DRAFT) {
    repository.createApproval({ billId: bill.id, approverId: null, approvalLevel: 1, status: BILL_APPROVAL_STATUS.PENDING });
  }
  recordHistory({ billId: bill.id, actor: user, action: "CREATED", oldStatus: null, newStatus: bill.status, metadata: { totals, poMatchStatus } });
  queueNotification({ type: "bill_submitted", title: "Bill submitted", body: `${bill.reference} requires review.`, data: { billId: bill.id } });
  return { record: { ...bill, items: createdItems } };
}

function listBills(user, query = {}) {
  assertPermission(user, BILL_PERMISSIONS.VIEW);
  return paginate(listAccessibleBills(user, query), query);
}

function getBillDetails(id, user) {
  assertPermission(user, BILL_PERMISSIONS.VIEW);
  const bill = repository.findBill(id);
  if (!bill) {
    throw createHttpError(404, "Bill was not found.", "BILL_NOT_FOUND");
  }
  assertBillAccess(user, bill);
  return {
    ...decorateBill(bill),
    vendor: bill.vendorId ? repository.findVendor(bill.vendorId) : null,
    category: bill.categoryId ? repository.findCategory(bill.categoryId) : null,
    department: bill.departmentId ? repository.findDepartment(bill.departmentId) : null,
    purchaseOrder: bill.purchaseOrderId ? repository.findPurchaseOrder(bill.purchaseOrderId) : null,
    items: repository.listBillItems(id),
    approvals: repository.listApprovals(id),
    payments: repository.listPayments(id),
    attachments: repository.listAttachments(id),
    comments: repository.listComments(id),
    history: repository.listHistory(id),
  };
}

function updateBill(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.UPDATE);
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  assertBillAccess(user, bill);
  if (![BILL_STATUS.DRAFT, BILL_STATUS.SUBMITTED, BILL_STATUS.UNDER_REVIEW].includes(bill.status)) {
    throw createHttpError(409, "Only draft, submitted, or under-review bills can be updated.", "BILL_LOCKED");
  }
  const updated = repository.updateBill(id, {
    description: payload.description ?? bill.description,
    dueDate: payload.dueDate || payload.due_date || bill.dueDate,
  });
  recordHistory({ billId: id, actor: user, action: "UPDATED", oldStatus: bill.status, newStatus: updated.status, metadata: { payload } });
  return { oldValues: bill, record: updated };
}

function submitBill(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.SUBMIT);
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  assertBillAccess(user, bill);
  if (bill.status !== BILL_STATUS.DRAFT) {
    throw createHttpError(409, "Only draft bills can be submitted.", "BILL_NOT_DRAFT");
  }
  const updated = repository.updateBill(id, { status: BILL_STATUS.SUBMITTED, currentApprovalLevel: 1 });
  repository.createApproval({ billId: id, approverId: null, approvalLevel: 1, status: BILL_APPROVAL_STATUS.PENDING });
  recordHistory({ billId: id, actor: user, action: "SUBMITTED", oldStatus: bill.status, newStatus: updated.status, comment: payload.comment });
  return { oldValues: bill, record: updated };
}

function approveBill(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.APPROVE);
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  if (![BILL_STATUS.SUBMITTED, BILL_STATUS.UNDER_REVIEW, BILL_STATUS.PENDING_APPROVAL].includes(bill.status)) {
    throw createHttpError(409, "Only submitted or pending bills can be approved.", "BILL_NOT_APPROVABLE");
  }
  if (bill.createdBy === user.id) {
    throw createHttpError(403, "Bill creator cannot approve their own bill.", "SELF_APPROVAL_FORBIDDEN");
  }
  const level = Number(bill.currentApprovalLevel || 1);
  const approval = repository.findPendingApproval(id, level) || repository.createApproval({ billId: id, approverId: null, approvalLevel: level, status: BILL_APPROVAL_STATUS.PENDING });
  repository.updateApproval(approval.id, {
    approverId: user.id,
    status: BILL_APPROVAL_STATUS.APPROVED,
    comment: payload.comment || null,
    approvedAt: new Date().toISOString(),
  });
  const requiredLevels = Number(bill.requiredApprovalLevels || getRequiredApprovalLevels(bill.totalAmount));
  let updated;
  if (level < requiredLevels) {
    repository.createApproval({ billId: id, approverId: null, approvalLevel: level + 1, status: BILL_APPROVAL_STATUS.PENDING });
    updated = repository.updateBill(id, {
      status: BILL_STATUS.PENDING_APPROVAL,
      currentApprovalLevel: level + 1,
      approvalStatus: BILL_APPROVAL_STATUS.PENDING,
    });
  } else {
    updated = repository.updateBill(id, {
      status: BILL_STATUS.APPROVED,
      approvalStatus: BILL_APPROVAL_STATUS.APPROVED,
      approvedBy: user.id,
      approvedAt: new Date().toISOString(),
    });
  }
  recordHistory({ billId: id, actor: user, action: "APPROVED", oldStatus: bill.status, newStatus: updated.status, comment: payload.comment, metadata: { approvalLevel: level } });
  return { oldValues: bill, record: updated };
}

function rejectBill(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.REJECT);
  if (!payload.reason && !payload.comment) {
    throw createHttpError(400, "Rejection reason is required.", "REJECTION_REASON_REQUIRED");
  }
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  const updated = repository.updateBill(id, {
    status: BILL_STATUS.REJECTED,
    approvalStatus: BILL_APPROVAL_STATUS.REJECTED,
    rejectedBy: user.id,
    rejectedAt: new Date().toISOString(),
    rejectionReason: payload.reason || payload.comment,
  });
  recordHistory({ billId: id, actor: user, action: "REJECTED", oldStatus: bill.status, newStatus: updated.status, comment: payload.reason || payload.comment });
  return { oldValues: bill, record: updated };
}

function disputeBill(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.DISPUTE);
  if (!payload.reason && !payload.disputeReason) {
    throw createHttpError(400, "Dispute reason is required.", "DISPUTE_REASON_REQUIRED");
  }
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  const updated = repository.updateBill(id, {
    status: BILL_STATUS.DISPUTED,
    disputeReason: payload.reason || payload.disputeReason,
    disputedBy: user.id,
    disputedAt: new Date().toISOString(),
  });
  recordHistory({ billId: id, actor: user, action: "DISPUTED", oldStatus: bill.status, newStatus: updated.status, comment: payload.reason || payload.disputeReason });
  return { oldValues: bill, record: updated };
}

function cancelBill(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.DELETE);
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  if ([BILL_STATUS.PAID, BILL_STATUS.CANCELLED].includes(bill.status)) {
    throw createHttpError(409, "Paid or cancelled bills cannot be cancelled.", "BILL_FINALIZED");
  }
  const updated = repository.updateBill(id, {
    status: BILL_STATUS.CANCELLED,
    cancelledBy: user.id,
    cancelledAt: new Date().toISOString(),
    cancellationReason: payload.reason || null,
  });
  recordHistory({ billId: id, actor: user, action: "CANCELLED", oldStatus: bill.status, newStatus: updated.status, comment: payload.reason });
  return { oldValues: bill, record: updated };
}

function addComment(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.COMMENT);
  if (!payload.comment) {
    throw createHttpError(400, "Comment is required.", "COMMENT_REQUIRED");
  }
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  assertBillAccess(user, bill);
  const comment = repository.createComment({ billId: id, userId: user.id, comment: payload.comment });
  recordHistory({ billId: id, actor: user, action: "COMMENT_ADDED", oldStatus: bill.status, newStatus: bill.status, comment: payload.comment });
  return comment;
}

function addAttachment(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.UPLOAD);
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  assertBillAccess(user, bill);
  return repository.createAttachment({
    billId: id,
    uploadedBy: user.id,
    fileName: payload.fileName || payload.name,
    fileUrl: payload.fileUrl || payload.url,
    fileType: payload.fileType || payload.type || null,
    fileSize: Number(payload.fileSize || payload.size || 0),
  });
}

function recordPayment(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.PAY);
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  assertBillAccess(user, bill);
  if (bill.approvalStatus !== BILL_APPROVAL_STATUS.APPROVED || bill.status !== BILL_STATUS.APPROVED && bill.status !== BILL_STATUS.PARTIALLY_PAID && bill.status !== BILL_STATUS.SCHEDULED) {
    throw createHttpError(409, "Only approved bills can be paid.", "BILL_NOT_APPROVED");
  }
  if (bill.createdBy === user.id) {
    throw createHttpError(403, "Bill creator cannot pay their own bill.", "SELF_PAYMENT_FORBIDDEN");
  }
  const amount = roundMoney(payload.amount);
  if (amount <= 0) {
    throw createHttpError(400, "Payment amount must be greater than zero.", "INVALID_PAYMENT_AMOUNT");
  }
  if (amount > Number(bill.amountDue || 0)) {
    throw createHttpError(409, "Payment amount exceeds amount due.", "BILL_OVERPAYMENT_BLOCKED");
  }
  const paymentMethodId = payload.paymentMethodId || payload.payment_method_id || null;
  const bankAccountId = payload.bankAccountId || payload.accountId || payload.account_id || null;
  if (paymentMethodId && !repository.findPaymentMethod(paymentMethodId)) {
    throw createHttpError(404, "Payment method was not found.", "PAYMENT_METHOD_NOT_FOUND");
  }
  if (bankAccountId && !repository.findAccount(bankAccountId)) {
    throw createHttpError(404, "Payment account was not found.", "PAYMENT_ACCOUNT_NOT_FOUND");
  }
  const nextPaid = roundMoney(Number(bill.amountPaid || 0) + amount);
  const paymentState = calculatePaymentState(Number(bill.totalAmount), nextPaid);
  const payment = repository.createPayment({
    billId: id,
    paymentReference: payload.paymentReference || `PAY-${bill.reference}-${repository.listPayments(id).length + 1}`,
    amount,
    paymentDate: payload.paymentDate || payload.payment_date || today(),
    paymentMethodId,
    bankAccountId,
    transactionReference: payload.transactionReference || payload.transaction_reference || null,
    notes: payload.notes || null,
    status: BILL_PAYMENT_RECORD_STATUS.SUCCESSFUL,
    processedBy: user.id,
    paidBy: user.id,
    paidAt: new Date().toISOString(),
  });
  const nextStatus = paymentState.paymentStatus === BILL_PAYMENT_STATUS.PAID ? BILL_STATUS.PAID : BILL_STATUS.PARTIALLY_PAID;
  const updated = repository.updateBill(id, {
    amountPaid: paymentState.amountPaid,
    amountDue: paymentState.amountDue,
    paymentStatus: paymentState.paymentStatus,
    payment_status: paymentState.paymentStatus,
    status: nextStatus,
    paymentDate: payment.paymentDate,
  });
  recordHistory({ billId: id, actor: user, action: "PAYMENT_COMPLETED", oldStatus: bill.status, newStatus: updated.status, metadata: { paymentId: payment.id, amount } });
  if (paymentState.paymentStatus === BILL_PAYMENT_STATUS.PAID && !repository.findExpenseForBill(id)) {
    repository.createExpense({
      billId: id,
      vendorBillId: id,
      purchaseOrderId: bill.purchaseOrderId || null,
      departmentId: bill.departmentId || null,
      categoryId: bill.categoryId || null,
      amount: bill.totalAmount,
      currency: bill.currency,
      expenseDate: payment.paymentDate,
      createdBy: user.id,
      status: "recorded",
    });
  }
  return { oldValues: bill, record: updated, payment };
}

function schedulePayment(id, payload, user) {
  assertPermission(user, BILL_PERMISSIONS.SCHEDULE_PAYMENT);
  const bill = repository.findBill(id);
  if (!bill) {
    return null;
  }
  assertBillAccess(user, bill);
  if (bill.approvalStatus !== BILL_APPROVAL_STATUS.APPROVED || ![BILL_STATUS.APPROVED, BILL_STATUS.SCHEDULED].includes(bill.status)) {
    throw createHttpError(409, "Only approved bills can be scheduled for payment.", "BILL_NOT_APPROVED");
  }
  const scheduledPaymentDate = payload.scheduledPaymentDate || payload.scheduled_payment_date || payload.paymentDate || payload.payment_date;
  if (!scheduledPaymentDate) {
    throw createHttpError(400, "Scheduled payment date is required.", "SCHEDULED_PAYMENT_DATE_REQUIRED");
  }
  const paymentMethodId = payload.paymentMethodId || payload.payment_method_id || null;
  const bankAccountId = payload.bankAccountId || payload.accountId || payload.account_id || null;
  if (paymentMethodId && !repository.findPaymentMethod(paymentMethodId)) {
    throw createHttpError(404, "Payment method was not found.", "PAYMENT_METHOD_NOT_FOUND");
  }
  if (bankAccountId && !repository.findAccount(bankAccountId)) {
    throw createHttpError(404, "Payment account was not found.", "PAYMENT_ACCOUNT_NOT_FOUND");
  }
  const updated = repository.updateBill(id, {
    status: BILL_STATUS.SCHEDULED,
    scheduledPaymentDate,
    paymentMethodId,
    bankAccountId,
  });
  recordHistory({ billId: id, actor: user, action: "SCHEDULED", oldStatus: bill.status, newStatus: updated.status, comment: payload.comment });
  queueNotification({ type: "bill_payment_scheduled", title: "Bill payment scheduled", body: `${bill.reference} is scheduled for payment.`, data: { billId: id, scheduledPaymentDate } });
  return { oldValues: bill, record: updated };
}

function getDashboard(user) {
  assertPermission(user, BILL_PERMISSIONS.VIEW);
  const bills = listAccessibleBills(user, {});
  const month = today().slice(0, 7);
  const paidThisMonth = bills.filter((bill) => bill.paymentStatus === BILL_PAYMENT_STATUS.PAID && String(bill.paymentDate || bill.updatedAt || "").startsWith(month));
  return {
    overdueBills: bills.filter((bill) => getDueStatus(bill) === BILL_STATUS.OVERDUE).length,
    outstandingAmount: roundMoney(bills.filter((bill) => bill.paymentStatus !== BILL_PAYMENT_STATUS.PAID).reduce((total, bill) => total + Number(bill.amountDue || 0), 0)),
    paidThisMonth: paidThisMonth.length,
    paidAmountThisMonth: roundMoney(paidThisMonth.reduce((total, bill) => total + Number(bill.amountPaid || 0), 0)),
  };
}

function getReports(user, query = {}) {
  assertPermission(user, BILL_PERMISSIONS.VIEW);
  const bills = listAccessibleBills(user, query);
  const byStatus = bills.reduce((summary, bill) => {
    const status = getDueStatus(bill);
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
  const vendorSpending = new Map();
  const departmentSpending = new Map();
  const categorySpending = new Map();
  for (const bill of bills) {
    for (const [map, idKey, nameKey] of [
      [vendorSpending, "vendorId", "vendorName"],
      [departmentSpending, "departmentId", "departmentName"],
      [categorySpending, "categoryId", "categoryName"],
    ]) {
      const key = bill[idKey] || "unassigned";
      const current = map.get(key) || { id: bill[idKey] || null, name: bill[nameKey] || "Unassigned", amount: 0, bills: 0 };
      current.amount = roundMoney(current.amount + Number(bill.totalAmount || 0));
      current.bills += 1;
      map.set(key, current);
    }
  }
  return {
    totalBills: bills.length,
    totalOutstanding: roundMoney(bills.filter((bill) => bill.paymentStatus !== BILL_PAYMENT_STATUS.PAID).reduce((total, bill) => total + Number(bill.amountDue || 0), 0)),
    totalOverdue: byStatus[BILL_STATUS.OVERDUE] || 0,
    totalPaid: bills.filter((bill) => bill.paymentStatus === BILL_PAYMENT_STATUS.PAID).length,
    totalPaidAmount: roundMoney(bills.reduce((total, bill) => total + Number(bill.amountPaid || 0), 0)),
    totalPayable: roundMoney(bills.reduce((total, bill) => total + Number(bill.totalAmount || 0), 0)),
    vendorSpending: [...vendorSpending.values()],
    departmentSpending: [...departmentSpending.values()],
    categorySpending: [...categorySpending.values()],
    aging: getAgingBuckets(bills),
    byStatus,
  };
}

function getAgingBuckets(bills) {
  const buckets = { current: 0, oneToThirty: 0, thirtyOneToSixty: 0, sixtyOneToNinety: 0, ninetyPlus: 0 };
  const todayDate = new Date(`${today()}T00:00:00.000Z`);
  for (const bill of bills.filter((entry) => entry.paymentStatus !== BILL_PAYMENT_STATUS.PAID)) {
    const due = bill.dueDate ? new Date(`${bill.dueDate}T00:00:00.000Z`) : todayDate;
    const days = Math.floor((todayDate - due) / 86400000);
    const amount = Number(bill.amountDue || 0);
    if (days <= 0) {
      buckets.current = roundMoney(buckets.current + amount);
    } else if (days <= 30) {
      buckets.oneToThirty = roundMoney(buckets.oneToThirty + amount);
    } else if (days <= 60) {
      buckets.thirtyOneToSixty = roundMoney(buckets.thirtyOneToSixty + amount);
    } else if (days <= 90) {
      buckets.sixtyOneToNinety = roundMoney(buckets.sixtyOneToNinety + amount);
    } else {
      buckets.ninetyPlus = roundMoney(buckets.ninetyPlus + amount);
    }
  }
  return buckets;
}

function listCategories(query) {
  return repository.listCategories(query);
}

module.exports = {
  addAttachment,
  addComment,
  approveBill,
  cancelBill,
  createBill,
  disputeBill,
  getBillDetails,
  getDashboard,
  getReports,
  listBills,
  listCategories,
  recordPayment,
  rejectBill,
  schedulePayment,
  submitBill,
  updateBill,
};
