const { hasPermission } = require("../../constants/rbac");
const { paginate } = require("../../utils/query");
const { queueNotification } = require("../_shared/notificationService");
const {
  APPROVAL_STATUS,
  PURCHASE_ORDER_STATUS,
  PURCHASE_PERMISSIONS,
  PURCHASE_PRIORITY,
  PURCHASE_REQUEST_STATUS,
  RECEIPT_STATUS,
  VENDOR_QUOTE_STATUS,
} = require("./constants");
const repository = require("./procurement.repository");

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

function normalizeStatus(value, allowed, fallback) {
  const normalized = String(value || fallback || "").toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function roundMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function getEmployeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || employee?.email || null;
}

function getDepartmentName(department) {
  return department?.name || department?.title || null;
}

function getActorEmployee(user) {
  return repository.findEmployeeByUserId(user?.id);
}

function requireActorEmployee(user) {
  const employee = getActorEmployee(user);
  if (!employee) {
    throw createHttpError(404, "Authenticated user is not linked to an employee profile.", "EMPLOYEE_NOT_FOUND");
  }
  if (String(employee.status || "active").toLowerCase() !== "active") {
    throw createHttpError(403, "Employee is not active.", "EMPLOYEE_INACTIVE");
  }
  return employee;
}

function assertTitle(title) {
  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 180) {
    throw createHttpError(400, "Purchase request title must be between 3 and 180 characters.", "INVALID_PURCHASE_TITLE");
  }
}

function normalizeItems(payload = {}) {
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : [
        {
          description: payload.itemDescription || payload.description || payload.title,
          quantity: payload.quantity,
          unit: payload.unit,
          estimatedUnitPrice: payload.estimatedUnitPrice || payload.estimated_unit_price,
          category: payload.category,
        },
      ];

  const items = rawItems.map((item) => {
    const quantity = Number(item.quantity);
    const estimatedUnitPrice = Number(item.estimatedUnitPrice ?? item.estimated_unit_price ?? item.unitPrice ?? item.unit_price);
    if (!item.description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(estimatedUnitPrice) || estimatedUnitPrice < 0) {
      throw createHttpError(400, "Each purchase item requires description, positive quantity, and a valid estimated unit price.", "INVALID_PURCHASE_ITEM");
    }

    return {
      description: String(item.description).trim(),
      quantity,
      unit: item.unit || null,
      estimatedUnitPrice: roundMoney(estimatedUnitPrice),
      estimatedTotal: roundMoney(quantity * estimatedUnitPrice),
      category: item.category || null,
    };
  });

  if (!items.length) {
    throw createHttpError(400, "At least one purchase request item is required.", "PURCHASE_ITEMS_REQUIRED");
  }

  return items;
}

function getRequiredApprovalLevels(amount) {
  if (amount <= 100000) {
    return 1;
  }
  if (amount <= 500000) {
    return 2;
  }
  return 3;
}

function buildReference(prefix, count) {
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

function recordHistory({ requestId, actor, action, oldStatus, newStatus, comment, metadata }) {
  return repository.createHistory({
    purchaseRequestId: requestId,
    actorId: actor?.id || null,
    action,
    oldStatus: oldStatus || null,
    newStatus: newStatus || null,
    comment: comment || null,
    metadata: metadata || {},
  });
}

function canAccessRequest(request, user) {
  if (can(user, PURCHASE_PERMISSIONS.VIEW_ALL)) {
    return true;
  }
  const employee = getActorEmployee(user);
  if (!employee) {
    return false;
  }
  if (request.requesterId === employee.id) {
    return true;
  }
  return Boolean(can(user, PURCHASE_PERMISSIONS.REVIEW) && request.departmentId && request.departmentId === (employee.departmentId || employee.department_id));
}

function assertCanManageRequest(request, user, permission) {
  if (can(user, permission)) {
    return;
  }
  const employee = getActorEmployee(user);
  if (employee && request.requesterId === employee.id && [PURCHASE_REQUEST_STATUS.DRAFT, PURCHASE_REQUEST_STATUS.SUBMITTED].includes(request.status)) {
    return;
  }
  throw createHttpError(403, "Forbidden.", "FORBIDDEN");
}

function getRequestDetails(id, user) {
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    throw createHttpError(404, "Purchase request was not found.", "PURCHASE_REQUEST_NOT_FOUND");
  }
  if (!canAccessRequest(request, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  const purchaseOrder = repository.findPurchaseOrderForRequest(id);
  return {
    ...request,
    requester: repository.findEmployee(request.requesterId),
    department: repository.findDepartment(request.departmentId),
    vendor: request.vendorId ? repository.findVendor(request.vendorId) : null,
    items: repository.listPurchaseRequestItems(id),
    approvals: repository.listApprovals(id),
    comments: repository.listComments(id),
    attachments: repository.listAttachments(id),
    quotes: repository.listVendorQuotes(id),
    purchaseOrder,
    purchaseOrderItems: purchaseOrder ? repository.listPurchaseOrderItems(purchaseOrder.id) : [],
    receipts: purchaseOrder ? repository.listReceipts(purchaseOrder.id) : [],
    vendorBills: purchaseOrder ? repository.listVendorBills({ purchaseOrderId: purchaseOrder.id }) : [],
    history: repository.listHistory(id),
  };
}

function createPurchaseRequest(payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.CREATE);
  const requester = requireActorEmployee(user);
  assertTitle(payload.title);
  const departmentId = payload.departmentId || payload.department_id || requester.departmentId || requester.department_id;
  const department = repository.findDepartment(departmentId);
  if (!department) {
    throw createHttpError(404, "Department was not found.", "DEPARTMENT_NOT_FOUND");
  }
  if (!can(user, PURCHASE_PERMISSIONS.VIEW_ALL) && departmentId !== (requester.departmentId || requester.department_id)) {
    throw createHttpError(403, "Requester is not associated with the selected department.", "DEPARTMENT_ACCESS_DENIED");
  }

  const items = normalizeItems(payload);
  const estimatedAmount = roundMoney(items.reduce((total, item) => total + item.estimatedTotal, 0));
  if (estimatedAmount > 100000 && !payload.reason) {
    throw createHttpError(400, "Reason is required for purchase requests above the configured threshold.", "PURCHASE_REASON_REQUIRED");
  }

  const status = payload.draft ? PURCHASE_REQUEST_STATUS.DRAFT : PURCHASE_REQUEST_STATUS.SUBMITTED;
  const request = repository.createPurchaseRequest({
    reference: buildReference("PRQ", repository.listPurchaseRequests({ limit: 1 }).meta.total),
    requestNumber: null,
    requesterId: requester.id,
    requesterName: getEmployeeName(requester),
    departmentId: department.id,
    departmentName: getDepartmentName(department),
    title: payload.title.trim(),
    description: payload.description || null,
    reason: payload.reason || null,
    estimatedAmount,
    amount: estimatedAmount,
    currency: payload.currency || "NGN",
    priority: normalizeStatus(payload.priority, Object.values(PURCHASE_PRIORITY), PURCHASE_PRIORITY.NORMAL),
    requiredDate: payload.requiredDate || payload.required_date || null,
    status,
    currentApprovalLevel: status === PURCHASE_REQUEST_STATUS.DRAFT ? 0 : 1,
    requiredApprovalLevels: getRequiredApprovalLevels(estimatedAmount),
    submittedAt: status === PURCHASE_REQUEST_STATUS.SUBMITTED ? new Date().toISOString() : null,
    approvedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    vendorId: null,
    vendorName: null,
    createdBy: user.id,
  });

  const createdItems = items.map((item) => repository.createPurchaseRequestItem({ purchaseRequestId: request.id, ...item }));
  if (status === PURCHASE_REQUEST_STATUS.SUBMITTED) {
    repository.createApproval({
      purchaseRequestId: request.id,
      approverId: null,
      approvalLevel: 1,
      status: APPROVAL_STATUS.PENDING,
      comment: null,
    });
  }
  recordHistory({
    requestId: request.id,
    actor: user,
    action: "CREATED",
    oldStatus: null,
    newStatus: request.status,
    metadata: { estimatedAmount, itemCount: createdItems.length },
  });
  queueNotification({
    type: "purchase_request_submitted",
    title: "Purchase request submitted",
    body: `${request.title} requires review.`,
    data: { purchaseRequestId: request.id },
  });

  return { record: { ...request, items: createdItems } };
}

function listPurchaseRequests(user, query = {}) {
  assertPermission(user, PURCHASE_PERMISSIONS.VIEW);
  if (can(user, PURCHASE_PERMISSIONS.VIEW_ALL)) {
    return repository.listPurchaseRequests(query);
  }
  const requests = repository.listAllPurchaseRequests(query).filter((request) => canAccessRequest(request, user));
  return paginate(requests, query);
}

function submitRequest(id, payload, user) {
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  assertCanManageRequest(request, user, PURCHASE_PERMISSIONS.SUBMIT);
  if (request.status !== PURCHASE_REQUEST_STATUS.DRAFT) {
    throw createHttpError(409, "Only draft purchase requests can be submitted.", "PURCHASE_REQUEST_NOT_DRAFT");
  }
  const updated = repository.updatePurchaseRequest(id, {
    status: PURCHASE_REQUEST_STATUS.SUBMITTED,
    currentApprovalLevel: 1,
    submittedAt: new Date().toISOString(),
  });
  repository.createApproval({ purchaseRequestId: id, approverId: null, approvalLevel: 1, status: APPROVAL_STATUS.PENDING });
  recordHistory({ requestId: id, actor: user, action: "SUBMITTED", oldStatus: request.status, newStatus: updated.status, comment: payload.comment });
  return { oldValues: request, record: updated };
}

function updatePurchaseRequest(id, payload, user) {
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  assertCanManageRequest(request, user, PURCHASE_PERMISSIONS.UPDATE);
  if (![PURCHASE_REQUEST_STATUS.DRAFT, PURCHASE_REQUEST_STATUS.SUBMITTED].includes(request.status)) {
    throw createHttpError(409, "Only draft or submitted purchase requests can be updated.", "PURCHASE_REQUEST_LOCKED");
  }
  const oldValues = request;
  const updates = {
    title: payload.title || request.title,
    description: payload.description ?? request.description,
    reason: payload.reason ?? request.reason,
    priority: payload.priority ? normalizeStatus(payload.priority, Object.values(PURCHASE_PRIORITY), request.priority) : request.priority,
    requiredDate: payload.requiredDate || payload.required_date || request.requiredDate,
  };
  if (payload.title) {
    assertTitle(payload.title);
  }
  const updated = repository.updatePurchaseRequest(id, updates);
  recordHistory({ requestId: id, actor: user, action: "UPDATED", oldStatus: oldValues.status, newStatus: updated.status, metadata: { updates } });
  return { oldValues, record: updated };
}

function approveRequest(id, payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.APPROVE);
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  if (![PURCHASE_REQUEST_STATUS.SUBMITTED, PURCHASE_REQUEST_STATUS.UNDER_REVIEW, PURCHASE_REQUEST_STATUS.PENDING_APPROVAL].includes(request.status)) {
    throw createHttpError(409, "Only submitted or pending purchase requests can be approved.", "PURCHASE_REQUEST_NOT_APPROVABLE");
  }
  const actorEmployee = getActorEmployee(user);
  if (actorEmployee && actorEmployee.id === request.requesterId) {
    throw createHttpError(403, "Requester cannot approve their own purchase request.", "SELF_APPROVAL_FORBIDDEN");
  }
  const level = Number(request.currentApprovalLevel || 1);
  const approval = repository.findPendingApproval(id, level) || repository.createApproval({ purchaseRequestId: id, approverId: null, approvalLevel: level, status: APPROVAL_STATUS.PENDING });
  repository.updateApproval(approval.id, {
    approverId: user.id,
    status: APPROVAL_STATUS.APPROVED,
    comment: payload.comment || null,
    approvedAt: new Date().toISOString(),
  });

  const oldStatus = request.status;
  const requiredLevels = Number(request.requiredApprovalLevels || getRequiredApprovalLevels(request.estimatedAmount));
  let updated;
  if (level < requiredLevels) {
    repository.createApproval({ purchaseRequestId: id, approverId: null, approvalLevel: level + 1, status: APPROVAL_STATUS.PENDING });
    updated = repository.updatePurchaseRequest(id, {
      status: PURCHASE_REQUEST_STATUS.PENDING_APPROVAL,
      currentApprovalLevel: level + 1,
    });
  } else {
    updated = repository.updatePurchaseRequest(id, {
      status: PURCHASE_REQUEST_STATUS.APPROVED,
      approvedBy: user.id,
      approvedAt: new Date().toISOString(),
    });
  }
  recordHistory({ requestId: id, actor: user, action: "APPROVED", oldStatus, newStatus: updated.status, comment: payload.comment, metadata: { approvalLevel: level } });
  queueNotification({
    recipientEmployeeId: request.requesterId,
    type: "purchase_request_approved",
    title: "Purchase request approved",
    body: `${request.title} approval status changed to ${updated.status}.`,
    data: { purchaseRequestId: id },
  });
  return { oldValues: request, record: updated };
}

function rejectRequest(id, payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.REJECT);
  if (!payload.reason && !payload.comment) {
    throw createHttpError(400, "Rejection reason is required.", "REJECTION_REASON_REQUIRED");
  }
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  const oldStatus = request.status;
  const updated = repository.updatePurchaseRequest(id, {
    status: PURCHASE_REQUEST_STATUS.REJECTED,
    rejectedBy: user.id,
    rejectedAt: new Date().toISOString(),
    rejectionReason: payload.reason || payload.comment,
  });
  repository.createApproval({ purchaseRequestId: id, approverId: user.id, approvalLevel: request.currentApprovalLevel || 1, status: APPROVAL_STATUS.REJECTED, comment: payload.reason || payload.comment, rejectedAt: new Date().toISOString() });
  recordHistory({ requestId: id, actor: user, action: "REJECTED", oldStatus, newStatus: updated.status, comment: payload.reason || payload.comment });
  return { oldValues: request, record: updated };
}

function cancelRequest(id, payload, user) {
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  assertCanManageRequest(request, user, PURCHASE_PERMISSIONS.CANCEL);
  if (![PURCHASE_REQUEST_STATUS.DRAFT, PURCHASE_REQUEST_STATUS.SUBMITTED].includes(request.status)) {
    throw createHttpError(409, "Only draft or submitted purchase requests can be cancelled.", "PURCHASE_REQUEST_NOT_CANCELLABLE");
  }
  const updated = repository.updatePurchaseRequest(id, {
    status: PURCHASE_REQUEST_STATUS.CANCELLED,
    cancelledBy: user.id,
    cancelledAt: new Date().toISOString(),
    cancellationReason: payload.reason || null,
  });
  recordHistory({ requestId: id, actor: user, action: "CANCELLED", oldStatus: request.status, newStatus: updated.status, comment: payload.reason });
  return { oldValues: request, record: updated };
}

function addComment(id, payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.COMMENT);
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  if (!canAccessRequest(request, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  if (!payload.comment) {
    throw createHttpError(400, "Comment is required.", "COMMENT_REQUIRED");
  }
  const comment = repository.createComment({ purchaseRequestId: id, userId: user.id, comment: payload.comment });
  recordHistory({ requestId: id, actor: user, action: "COMMENT_ADDED", oldStatus: request.status, newStatus: request.status, comment: payload.comment });
  return comment;
}

function addAttachment(id, payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.UPLOAD);
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  if (!canAccessRequest(request, user)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
  return repository.createAttachment({
    purchaseRequestId: id,
    uploadedBy: user.id,
    fileName: payload.fileName || payload.name,
    fileUrl: payload.fileUrl || payload.url,
    fileType: payload.fileType || payload.type || null,
    fileSize: Number(payload.fileSize || payload.size || 0),
  });
}

function assignVendor(id, payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.ASSIGN_VENDOR);
  const request = repository.findPurchaseRequest(id);
  if (!request) {
    return null;
  }
  if (request.status !== PURCHASE_REQUEST_STATUS.APPROVED) {
    throw createHttpError(409, "Vendor can only be selected for approved purchase requests.", "PURCHASE_REQUEST_NOT_APPROVED");
  }
  const vendor = repository.findVendor(payload.vendorId || payload.vendor_id);
  if (!vendor || !["active", "ACTIVE"].includes(String(vendor.status || "active"))) {
    throw createHttpError(404, "Vendor was not found or is inactive.", "VENDOR_NOT_FOUND");
  }
  const oldValues = request;
  const updated = repository.updatePurchaseRequest(id, { vendorId: vendor.id, vendorName: vendor.businessName || vendor.business_name || vendor.name });
  if (payload.quoteReference || payload.amount) {
    repository.createVendorQuote({
      purchaseRequestId: id,
      vendorId: vendor.id,
      quoteReference: payload.quoteReference || payload.quote_reference || null,
      amount: roundMoney(payload.amount || request.estimatedAmount),
      currency: payload.currency || request.currency,
      validUntil: payload.validUntil || payload.valid_until || null,
      fileUrl: payload.fileUrl || payload.file_url || null,
      status: VENDOR_QUOTE_STATUS.SELECTED,
    });
  }
  recordHistory({ requestId: id, actor: user, action: "VENDOR_SELECTED", oldStatus: request.status, newStatus: updated.status, metadata: { vendorId: vendor.id } });
  return { oldValues, record: updated };
}

function normalizeOrderItems(requestItems, payloadItems = []) {
  const items = payloadItems.length ? payloadItems : requestItems;
  return items.map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.estimatedUnitPrice ?? item.estimated_unit_price);
    const tax = roundMoney(item.tax || 0);
    const discount = roundMoney(item.discount || 0);
    if (!item.description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw createHttpError(400, "Each purchase order item requires description, positive quantity, and a valid unit price.", "INVALID_PURCHASE_ORDER_ITEM");
    }
    return {
      purchaseRequestItemId: item.purchaseRequestItemId || item.purchase_request_item_id || item.id || null,
      description: item.description,
      quantity,
      unitPrice: roundMoney(unitPrice),
      tax,
      discount,
      total: roundMoney(quantity * unitPrice + tax - discount),
    };
  });
}

function createPurchaseOrder(payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.CREATE_ORDER);
  const request = repository.findPurchaseRequest(payload.purchaseRequestId || payload.purchase_request_id);
  if (!request) {
    throw createHttpError(404, "Purchase request was not found.", "PURCHASE_REQUEST_NOT_FOUND");
  }
  if (request.status !== PURCHASE_REQUEST_STATUS.APPROVED) {
    throw createHttpError(409, "Purchase order can only be created from an approved request.", "PURCHASE_REQUEST_NOT_APPROVED");
  }
  const vendor = repository.findVendor(payload.vendorId || payload.vendor_id || request.vendorId);
  if (!vendor) {
    throw createHttpError(404, "Vendor is required before creating a purchase order.", "VENDOR_REQUIRED");
  }
  const existing = repository.findPurchaseOrderForRequest(request.id);
  if (existing) {
    throw createHttpError(409, "A purchase order already exists for this purchase request.", "PURCHASE_ORDER_EXISTS");
  }
  const orderItems = normalizeOrderItems(repository.listPurchaseRequestItems(request.id), payload.items || []);
  const subtotal = roundMoney(orderItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0));
  const tax = roundMoney(orderItems.reduce((total, item) => total + item.tax, 0));
  const discount = roundMoney(orderItems.reduce((total, item) => total + item.discount, 0));
  const total = roundMoney(subtotal + tax - discount);
  const order = repository.createPurchaseOrder({
    purchaseRequestId: request.id,
    vendorId: vendor.id,
    vendorName: vendor.businessName || vendor.business_name || vendor.name,
    reference: buildReference("PO", repository.listPurchaseOrders({ limit: 1 }).meta.total),
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDeliveryDate: payload.expectedDeliveryDate || payload.expected_delivery_date || request.requiredDate || null,
    subtotal,
    tax,
    discount,
    total,
    currency: payload.currency || request.currency,
    status: PURCHASE_ORDER_STATUS.DRAFT,
    createdBy: user.id,
    approvedBy: request.approvedBy || null,
  });
  const createdItems = orderItems.map((item) => repository.createPurchaseOrderItem({ purchaseOrderId: order.id, ...item }));
  const updatedRequest = repository.updatePurchaseRequest(request.id, { status: PURCHASE_REQUEST_STATUS.ORDERED, purchaseOrderId: order.id });
  recordHistory({ requestId: request.id, actor: user, action: "ORDER_CREATED", oldStatus: request.status, newStatus: updatedRequest.status, metadata: { purchaseOrderId: order.id } });
  return { record: { ...order, items: createdItems }, request: updatedRequest };
}

function listPurchaseOrders(query) {
  return repository.listPurchaseOrders(query);
}

function getPurchaseOrder(id) {
  const order = repository.findPurchaseOrder(id);
  if (!order) {
    throw createHttpError(404, "Purchase order was not found.", "PURCHASE_ORDER_NOT_FOUND");
  }
  return {
    ...order,
    items: repository.listPurchaseOrderItems(id),
    receipts: repository.listReceipts(id),
  };
}

function updatePurchaseOrder(id, payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.CREATE_ORDER);
  const order = repository.findPurchaseOrder(id);
  if (!order) {
    return null;
  }
  if ([PURCHASE_ORDER_STATUS.DELIVERED, PURCHASE_ORDER_STATUS.CLOSED, PURCHASE_ORDER_STATUS.CANCELLED].includes(order.status)) {
    throw createHttpError(409, "Finalized purchase orders cannot be updated.", "PURCHASE_ORDER_FINALIZED");
  }
  return repository.updatePurchaseOrder(id, {
    expectedDeliveryDate: payload.expectedDeliveryDate || payload.expected_delivery_date || order.expectedDeliveryDate,
    status: payload.status ? normalizeStatus(payload.status, Object.values(PURCHASE_ORDER_STATUS), order.status) : order.status,
  });
}

function setPurchaseOrderStatus(id, status, payload, user) {
  assertPermission(user, status === PURCHASE_ORDER_STATUS.CANCELLED ? PURCHASE_PERMISSIONS.CANCEL : PURCHASE_PERMISSIONS.CREATE_ORDER);
  const order = repository.findPurchaseOrder(id);
  if (!order) {
    return null;
  }
  return repository.updatePurchaseOrder(id, {
    status,
    ...(status === PURCHASE_ORDER_STATUS.SENT ? { sentAt: new Date().toISOString(), sentBy: user.id } : {}),
    ...(status === PURCHASE_ORDER_STATUS.CANCELLED ? { cancelledAt: new Date().toISOString(), cancelledBy: user.id, cancellationReason: payload.reason || null } : {}),
  });
}

function receivePurchaseOrder(id, payload, user) {
  assertPermission(user, PURCHASE_PERMISSIONS.RECEIVE);
  const order = repository.findPurchaseOrder(id);
  if (!order) {
    throw createHttpError(404, "Purchase order was not found.", "PURCHASE_ORDER_NOT_FOUND");
  }
  if ([PURCHASE_ORDER_STATUS.CANCELLED, PURCHASE_ORDER_STATUS.CLOSED].includes(order.status)) {
    throw createHttpError(409, "Cancelled or closed purchase orders cannot be received.", "PURCHASE_ORDER_NOT_RECEIVABLE");
  }
  const orderItems = repository.listPurchaseOrderItems(id);
  const receivedRows = Array.isArray(payload.items) ? payload.items : orderItems;
  const receiptItems = [];
  let complete = true;
  for (const orderItem of orderItems) {
    const row = receivedRows.find((item) => (item.purchaseOrderItemId || item.purchase_order_item_id || item.id) === orderItem.id) || {};
    const quantityReceived = Number(row.quantityReceived ?? row.quantity_received ?? row.quantity ?? orderItem.quantity);
    const quantityRejected = Number(row.quantityRejected ?? row.quantity_rejected ?? 0);
    if (quantityReceived < orderItem.quantity) {
      complete = false;
    }
    receiptItems.push({
      purchaseOrderItemId: orderItem.id,
      quantityOrdered: orderItem.quantity,
      quantityReceived,
      quantityRejected,
      condition: row.condition || "ACCEPTABLE",
      notes: row.notes || null,
    });
  }
  const status = payload.status ? normalizeStatus(payload.status, Object.values(RECEIPT_STATUS), complete ? RECEIPT_STATUS.COMPLETE : RECEIPT_STATUS.PARTIAL) : complete ? RECEIPT_STATUS.COMPLETE : RECEIPT_STATUS.PARTIAL;
  const receipt = repository.createReceipt({
    purchaseOrderId: id,
    receivedBy: user.id,
    receivedDate: payload.receivedDate || payload.received_date || new Date().toISOString().slice(0, 10),
    status,
    notes: payload.notes || null,
  });
  const createdItems = receiptItems.map((item) => repository.createReceiptItem({ purchaseReceiptId: receipt.id, ...item }));
  const orderStatus = status === RECEIPT_STATUS.COMPLETE ? PURCHASE_ORDER_STATUS.DELIVERED : PURCHASE_ORDER_STATUS.PARTIALLY_DELIVERED;
  const requestStatus = status === RECEIPT_STATUS.COMPLETE ? PURCHASE_REQUEST_STATUS.DELIVERED : PURCHASE_REQUEST_STATUS.PARTIALLY_DELIVERED;
  const updatedOrder = repository.updatePurchaseOrder(id, { status: orderStatus });
  const request = repository.findPurchaseRequest(order.purchaseRequestId);
  if (request) {
    repository.updatePurchaseRequest(request.id, { status: requestStatus });
    recordHistory({ requestId: request.id, actor: user, action: status === RECEIPT_STATUS.COMPLETE ? "DELIVERED" : "PARTIALLY_DELIVERED", oldStatus: request.status, newStatus: requestStatus, metadata: { receiptId: receipt.id } });
  }
  return { record: { ...receipt, items: createdItems }, order: updatedOrder };
}

function getReceipt(id) {
  const receipt = repository.findReceipt(id);
  if (!receipt) {
    throw createHttpError(404, "Purchase receipt was not found.", "RECEIPT_NOT_FOUND");
  }
  return { ...receipt, items: repository.listReceiptItems(id) };
}

function getDashboard(user) {
  assertPermission(user, PURCHASE_PERMISSIONS.VIEW);
  const requests = repository.listAllPurchaseRequests({});
  const monthPrefix = new Date().toISOString().slice(0, 7);
  return {
    totalThisMonth: requests.filter((request) => String(request.createdAt || "").startsWith(monthPrefix)).length,
    pending: requests.filter((request) => [PURCHASE_REQUEST_STATUS.SUBMITTED, PURCHASE_REQUEST_STATUS.UNDER_REVIEW, PURCHASE_REQUEST_STATUS.PENDING_APPROVAL].includes(request.status)).length,
    totalValue: roundMoney(requests.reduce((total, request) => total + Number(request.estimatedAmount || 0), 0)),
    approved: requests.filter((request) => request.status === PURCHASE_REQUEST_STATUS.APPROVED || request.status === PURCHASE_REQUEST_STATUS.ORDERED || request.status === PURCHASE_REQUEST_STATUS.DELIVERED).length,
  };
}

function getReports(user, query = {}) {
  assertPermission(user, PURCHASE_PERMISSIONS.VIEW_REPORTS);
  const requests = repository.listAllPurchaseRequests(query);
  const orders = repository.listPurchaseOrders({ limit: 100 }).data;
  const bills = repository.listVendorBills({});
  const byStatus = requests.reduce((summary, request) => {
    summary[request.status] = (summary[request.status] || 0) + 1;
    return summary;
  }, {});
  const departmentSpending = new Map();
  for (const request of requests) {
    const current = departmentSpending.get(request.departmentId) || {
      departmentId: request.departmentId,
      departmentName: request.departmentName,
      totalRequests: 0,
      totalValue: 0,
    };
    current.totalRequests += 1;
    current.totalValue = roundMoney(current.totalValue + Number(request.estimatedAmount || 0));
    departmentSpending.set(request.departmentId, current);
  }
  return {
    totalRequests: requests.length,
    pendingRequests: (byStatus[PURCHASE_REQUEST_STATUS.SUBMITTED] || 0) + (byStatus[PURCHASE_REQUEST_STATUS.PENDING_APPROVAL] || 0),
    approvedRequests: byStatus[PURCHASE_REQUEST_STATUS.APPROVED] || 0,
    rejectedRequests: byStatus[PURCHASE_REQUEST_STATUS.REJECTED] || 0,
    cancelledRequests: byStatus[PURCHASE_REQUEST_STATUS.CANCELLED] || 0,
    totalRequestedValue: roundMoney(requests.reduce((total, request) => total + Number(request.estimatedAmount || 0), 0)),
    totalApprovedValue: roundMoney(requests.filter((request) => [PURCHASE_REQUEST_STATUS.APPROVED, PURCHASE_REQUEST_STATUS.ORDERED, PURCHASE_REQUEST_STATUS.DELIVERED].includes(request.status)).reduce((total, request) => total + Number(request.estimatedAmount || 0), 0)),
    totalPurchasedValue: roundMoney(orders.reduce((total, order) => total + Number(order.total || 0), 0)),
    pendingDeliveries: orders.filter((order) => [PURCHASE_ORDER_STATUS.SENT, PURCHASE_ORDER_STATUS.ACKNOWLEDGED, PURCHASE_ORDER_STATUS.PARTIALLY_DELIVERED].includes(order.status)).length,
    outstandingVendorBills: bills.filter((bill) => !["PAID", "CANCELLED"].includes(String(bill.status || "").toUpperCase())).length,
    departmentSpending: [...departmentSpending.values()],
    byStatus,
  };
}

module.exports = {
  addAttachment,
  addComment,
  approveRequest,
  assignVendor,
  cancelRequest,
  createPurchaseOrder,
  createPurchaseRequest,
  getDashboard,
  getPurchaseOrder,
  getReceipt,
  getReports,
  getRequestDetails,
  listPurchaseOrders,
  listPurchaseRequests,
  receivePurchaseOrder,
  rejectRequest,
  setPurchaseOrderStatus,
  submitRequest,
  updatePurchaseOrder,
  updatePurchaseRequest,
};
