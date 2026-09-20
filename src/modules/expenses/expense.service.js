const { hasPermission } = require("../../constants/rbac");
const { paginate } = require("../../utils/query");
const { queueNotification } = require("../_shared/notificationService");
const {
  EXPENSE_APPROVAL_STATUS,
  EXPENSE_PERMISSIONS,
  EXPENSE_POLICY_RESULT,
  EXPENSE_STATUS,
  REIMBURSEMENT_STATUS,
} = require("./constants");
const repository = require("./expense.repository");

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

function isValidDate(value) {
  const date = new Date(value);
  return Boolean(value) && !Number.isNaN(date.getTime());
}

function employeeName(employee) {
  return employee?.fullName || employee?.name || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || null;
}

function buildReference() {
  const count = repository.listAllExpenses({ limit: 1 }).length + 1;
  return `EXP-${String(count).padStart(4, "0")}`;
}

function normalizeItems(payload = {}) {
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return {
      amount: roundMoney(payload.amount),
      items: [],
    };
  }

  const items = payload.items.map((item) => {
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.amount);
    if (!item.description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw createHttpError(400, "Each expense item requires description, positive quantity, and a valid unit price.", "INVALID_EXPENSE_ITEM");
    }
    return {
      description: item.description,
      quantity,
      unitPrice: roundMoney(unitPrice),
      total: roundMoney(quantity * unitPrice),
    };
  });

  return {
    amount: roundMoney(items.reduce((total, item) => total + item.total, 0)),
    items,
  };
}

function getActorEmployee(user) {
  const employee = repository.findEmployeeByUserId(user?.id);
  if (!employee) {
    throw createHttpError(403, "Authenticated user is not linked to an employee record.", "EMPLOYEE_PROFILE_REQUIRED");
  }
  return employee;
}

function resolveClaimEmployee(payload, user) {
  const actorEmployee = getActorEmployee(user);
  const requestedEmployeeId = payload.employeeId || payload.employee_id;
  if (!requestedEmployeeId || requestedEmployeeId === actorEmployee.id) {
    return actorEmployee;
  }
  if (!can(user, EXPENSE_PERMISSIONS.CREATE_FOR_EMPLOYEE)) {
    throw createHttpError(403, "Cannot create expense claims for another employee.", "CREATE_FOR_EMPLOYEE_FORBIDDEN");
  }
  const employee = repository.findEmployee(requestedEmployeeId);
  if (!employee) {
    throw createHttpError(404, "Employee was not found.", "EMPLOYEE_NOT_FOUND");
  }
  return employee;
}

function getRequiredApprovalLevels(policy, amount) {
  let levels = 0;
  if (policy?.requiresManagerApproval !== false) {
    levels += 1;
  }
  if (policy?.requiresFinanceApproval !== false || amount > 75000) {
    levels += 1;
  }
  if (amount > 500000) {
    levels += 1;
  }
  return Math.max(1, levels);
}

function evaluatePolicy({ expense, category, receipts = [] }) {
  const policy = repository.findBestPolicy({
    categoryId: expense.categoryId,
    departmentId: expense.departmentId,
    currency: expense.currency,
  });
  const violations = [];
  const warnings = [];
  const maxAmount = policy?.maxAmount ?? category?.maxAmount ?? category?.max_amount ?? null;
  const reimbursementAllowed = policy?.reimbursementAllowed !== false;
  const receiptThreshold = policy?.receiptRequiredAmount ?? policy?.receipt_required_amount ?? null;
  const requiresReceipt =
    policy?.requiresReceipt === true ||
    category?.requiresReceipt === true ||
    category?.requires_receipt === true ||
    (receiptThreshold !== null && Number(expense.amount || 0) >= Number(receiptThreshold));

  if (maxAmount !== null && maxAmount !== undefined && Number(expense.amount || 0) > Number(maxAmount)) {
    violations.push({
      code: "EXPENSE_LIMIT_EXCEEDED",
      message: "Expense amount exceeds the configured policy limit.",
      maxAmount: Number(maxAmount),
    });
  }
  if (requiresReceipt && receipts.length === 0) {
    violations.push({
      code: "RECEIPT_REQUIRED",
      message: "A receipt is required for this expense.",
    });
  }
  if (!reimbursementAllowed) {
    warnings.push({
      code: "REIMBURSEMENT_NOT_ALLOWED",
      message: "This policy marks reimbursement as not allowed.",
    });
  }

  return {
    policy,
    requiresReceipt,
    reimbursementAllowed,
    result: violations.length ? EXPENSE_POLICY_RESULT.POLICY_VIOLATION : warnings.length ? EXPENSE_POLICY_RESULT.REQUIRES_REVIEW : EXPENSE_POLICY_RESULT.VALID,
    violations,
    warnings,
    requiredApprovalLevels: getRequiredApprovalLevels(policy, Number(expense.amount || 0)),
  };
}

function recordHistory({ expenseId, actor, action, oldStatus, newStatus, comment, metadata }) {
  return repository.createHistory({
    expenseId,
    actorId: actor?.id || null,
    action,
    oldStatus: oldStatus || null,
    newStatus: newStatus || null,
    comment: comment || null,
    metadata: metadata || {},
  });
}

function canAccessExpense(user, expense) {
  if (can(user, EXPENSE_PERMISSIONS.VIEW_ALL)) {
    return true;
  }
  const employee = repository.findEmployeeByUserId(user?.id);
  if (!employee) {
    return false;
  }
  if (expense.employeeId === employee.id) {
    return true;
  }
  return Boolean(can(user, EXPENSE_PERMISSIONS.VIEW_TEAM) && expense.departmentId && expense.departmentId === (employee.departmentId || employee.department_id));
}

function assertExpenseAccess(user, expense) {
  if (!canAccessExpense(user, expense)) {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

function listAccessibleExpenses(user, query = {}) {
  return repository.listAllExpenses(query).filter((expense) => canAccessExpense(user, expense));
}

function createReceiptRecord(expenseId, payload, user) {
  const fileName = payload.fileName || payload.name;
  const fileUrl = payload.fileUrl || payload.url;
  if (!fileName || !fileUrl) {
    throw createHttpError(400, "Receipt file name and URL are required.", "INVALID_RECEIPT");
  }
  return repository.createReceipt({
    expenseId,
    uploadedBy: user.id,
    fileName,
    fileUrl,
    fileType: payload.fileType || payload.type || null,
    fileSize: Number(payload.fileSize || payload.size || 0),
    receiptNumber: payload.receiptNumber || payload.receipt_number || null,
    receiptDate: payload.receiptDate || payload.receipt_date || null,
  });
}

function createExpense(payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.CREATE);
  const employee = resolveClaimEmployee(payload, user);
  const department = employee.departmentId || employee.department_id ? repository.findDepartment(employee.departmentId || employee.department_id) : null;
  const category = repository.findCategory(payload.categoryId || payload.category_id || payload.category);
  if (!category) {
    throw createHttpError(404, "Expense category was not found.", "CATEGORY_NOT_FOUND");
  }
  const normalizedItems = normalizeItems(payload);
  const amount = normalizedItems.amount;
  if (amount <= 0) {
    throw createHttpError(400, "Expense amount must be greater than zero.", "INVALID_EXPENSE_AMOUNT");
  }
  const expenseDate = payload.expenseDate || payload.expense_date || payload.date;
  if (!isValidDate(expenseDate)) {
    throw createHttpError(400, "Expense date is required.", "EXPENSE_DATE_REQUIRED");
  }
  if (!payload.description) {
    throw createHttpError(400, "Expense description is required.", "DESCRIPTION_REQUIRED");
  }

  const draft = payload.draft === true;
  const receiptPayloads = Array.isArray(payload.receipts) ? payload.receipts : [];
  const duplicate = repository.findPossibleDuplicate({
    employeeId: employee.id,
    expenseDate,
    amount,
    categoryId: category.id,
    receiptNumber: receiptPayloads.find((receipt) => receipt.receiptNumber || receipt.receipt_number)?.receiptNumber,
  });
  const policyPreview = evaluatePolicy({
    expense: {
      categoryId: category.id,
      departmentId: department?.id || null,
      amount,
      currency: payload.currency || "NGN",
    },
    category,
    receipts: receiptPayloads,
  });
  if (!draft && policyPreview.violations.length) {
    const blocking = policyPreview.violations.filter((violation) => violation.code !== "RECEIPT_REQUIRED");
    if (blocking.length) {
      throw createHttpError(409, blocking[0].message, blocking[0].code);
    }
  }

  const status = draft ? EXPENSE_STATUS.DRAFT : EXPENSE_STATUS.SUBMITTED;
  const expense = repository.createExpense({
    reference: buildReference(),
    source: "expense_claim",
    expenseType: "CLAIM",
    employeeId: employee.id,
    employeeName: employeeName(employee),
    departmentId: department?.id || employee.departmentId || employee.department_id || null,
    departmentName: department?.name || employee.department || null,
    description: payload.description,
    expenseDate,
    expense_date: expenseDate,
    categoryId: category.id,
    categoryName: category.name,
    category: category.name,
    amount,
    originalAmount: amount,
    approvedAmount: null,
    currency: payload.currency || "NGN",
    notes: payload.notes || null,
    status,
    approvalStatus: EXPENSE_APPROVAL_STATUS.PENDING,
    reimbursementStatus: draft ? REIMBURSEMENT_STATUS.NOT_REQUIRED : REIMBURSEMENT_STATUS.PENDING,
    submittedAt: draft ? null : new Date().toISOString(),
    currentApprovalLevel: draft ? 0 : 1,
    requiredApprovalLevels: policyPreview.requiredApprovalLevels,
    policyStatus: policyPreview.result,
    policyViolations: policyPreview.violations,
    possibleDuplicate: Boolean(duplicate),
    duplicateExpenseId: duplicate?.id || null,
    createdBy: user.id,
  });
  const items = normalizedItems.items.map((item) => repository.createItem({ expenseId: expense.id, ...item }));
  const receipts = receiptPayloads.map((receipt) => createReceiptRecord(expense.id, receipt, user));
  if (!draft) {
    repository.createApproval({ expenseId: expense.id, approverId: null, approvalLevel: 1, status: EXPENSE_APPROVAL_STATUS.PENDING });
    queueNotification({ type: "expense_submitted", title: "Expense submitted", body: `${expense.reference} requires review.`, data: { expenseId: expense.id } });
  }
  recordHistory({
    expenseId: expense.id,
    actor: user,
    action: "CREATED",
    oldStatus: null,
    newStatus: expense.status,
    metadata: { policy: policyPreview.result, duplicateExpenseId: duplicate?.id || null },
  });
  return { record: { ...expense, items, receipts } };
}

function getExpenseDetails(id, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.VIEW);
  const expense = repository.findExpense(id);
  if (!expense) {
    throw createHttpError(404, "Expense was not found.", "EXPENSE_NOT_FOUND");
  }
  assertExpenseAccess(user, expense);
  return {
    ...expense,
    employee: expense.employeeId ? repository.findEmployee(expense.employeeId) : null,
    department: expense.departmentId ? repository.findDepartment(expense.departmentId) : null,
    category: expense.categoryId ? repository.findCategory(expense.categoryId) : null,
    items: repository.listItems(id),
    approvals: repository.listApprovals(id),
    receipts: repository.listReceipts(id),
    comments: repository.listComments(id),
    reimbursements: repository.listReimbursements(id),
    history: repository.listHistory(id),
  };
}

function listExpenses(user, query = {}) {
  assertPermission(user, EXPENSE_PERMISSIONS.VIEW);
  return paginate(listAccessibleExpenses(user, query), query);
}

function listMyExpenses(user, query = {}) {
  assertPermission(user, EXPENSE_PERMISSIONS.VIEW);
  const employee = getActorEmployee(user);
  return repository.listExpenses({ ...query, employeeId: employee.id });
}

function listTeamExpenses(user, query = {}) {
  assertPermission(user, EXPENSE_PERMISSIONS.VIEW_TEAM);
  if (can(user, EXPENSE_PERMISSIONS.VIEW_ALL)) {
    return repository.listExpenses(query);
  }
  const employee = getActorEmployee(user);
  return repository.listExpenses({ ...query, departmentId: employee.departmentId || employee.department_id });
}

function updateExpense(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.UPDATE);
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  if (expense.status !== EXPENSE_STATUS.DRAFT) {
    throw createHttpError(409, "Only draft expenses can be updated.", "EXPENSE_LOCKED");
  }
  const category = payload.categoryId || payload.category_id || payload.category ? repository.findCategory(payload.categoryId || payload.category_id || payload.category) : null;
  const amount = payload.amount === undefined ? expense.amount : roundMoney(payload.amount);
  if (amount <= 0) {
    throw createHttpError(400, "Expense amount must be greater than zero.", "INVALID_EXPENSE_AMOUNT");
  }
  const expenseDate = payload.expenseDate || payload.expense_date || payload.date || expense.expenseDate;
  if (!isValidDate(expenseDate)) {
    throw createHttpError(400, "Expense date is required.", "EXPENSE_DATE_REQUIRED");
  }
  const updated = repository.updateExpense(id, {
    description: payload.description ?? expense.description,
    amount,
    originalAmount: amount,
    expenseDate,
    expense_date: expenseDate,
    categoryId: category?.id || expense.categoryId,
    categoryName: category?.name || expense.categoryName,
    category: category?.name || expense.category,
    notes: payload.notes ?? expense.notes,
  });
  recordHistory({ expenseId: id, actor: user, action: "UPDATED", oldStatus: expense.status, newStatus: updated.status, metadata: { payload } });
  return { oldValues: expense, record: updated };
}

function submitExpense(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.SUBMIT);
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  if (expense.status !== EXPENSE_STATUS.DRAFT) {
    throw createHttpError(409, "Only draft expenses can be submitted.", "EXPENSE_NOT_DRAFT");
  }
  const category = repository.findCategory(expense.categoryId);
  const receipts = repository.listReceipts(id);
  const policy = evaluatePolicy({ expense, category, receipts });
  if (policy.violations.length) {
    throw createHttpError(409, policy.violations[0].message, policy.violations[0].code);
  }
  const updated = repository.updateExpense(id, {
    status: EXPENSE_STATUS.SUBMITTED,
    reimbursementStatus: policy.reimbursementAllowed ? REIMBURSEMENT_STATUS.PENDING : REIMBURSEMENT_STATUS.NOT_REQUIRED,
    submittedAt: new Date().toISOString(),
    currentApprovalLevel: 1,
    requiredApprovalLevels: policy.requiredApprovalLevels,
    policyStatus: policy.result,
    policyViolations: policy.violations,
  });
  repository.createApproval({ expenseId: id, approverId: null, approvalLevel: 1, status: EXPENSE_APPROVAL_STATUS.PENDING });
  recordHistory({ expenseId: id, actor: user, action: "SUBMITTED", oldStatus: expense.status, newStatus: updated.status, comment: payload.comment });
  queueNotification({ type: "expense_submitted", title: "Expense submitted", body: `${updated.reference} requires review.`, data: { expenseId: id } });
  return { oldValues: expense, record: updated };
}

function approveExpense(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.APPROVE);
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  const actorEmployee = repository.findEmployeeByUserId(user.id);
  if (actorEmployee && expense.employeeId === actorEmployee.id) {
    throw createHttpError(403, "Expense owner cannot approve their own claim.", "SELF_APPROVAL_FORBIDDEN");
  }
  if (![EXPENSE_STATUS.SUBMITTED, EXPENSE_STATUS.UNDER_REVIEW].includes(expense.status)) {
    throw createHttpError(409, "Only submitted expenses can be approved.", "EXPENSE_NOT_APPROVABLE");
  }

  let approvedAmount = payload.approvedAmount === undefined ? expense.approvedAmount || expense.amount : roundMoney(payload.approvedAmount);
  if (approvedAmount <= 0 || approvedAmount > Number(expense.amount || 0)) {
    throw createHttpError(400, "Approved amount must be greater than zero and cannot exceed the claimed amount.", "INVALID_APPROVED_AMOUNT");
  }
  const amountAdjusted = approvedAmount !== Number(expense.amount || 0);
  if (amountAdjusted && !can(user, EXPENSE_PERMISSIONS.ADJUST)) {
    throw createHttpError(403, "Adjusting approved expense amount requires permission.", "EXPENSE_ADJUST_FORBIDDEN");
  }
  if (amountAdjusted && !payload.adjustmentReason && !payload.adjustment_reason) {
    throw createHttpError(400, "Adjustment reason is required.", "ADJUSTMENT_REASON_REQUIRED");
  }

  const level = Number(expense.currentApprovalLevel || 1);
  const approval = repository.findPendingApproval(id, level) || repository.createApproval({ expenseId: id, approverId: null, approvalLevel: level, status: EXPENSE_APPROVAL_STATUS.PENDING });
  repository.updateApproval(approval.id, {
    approverId: user.id,
    status: EXPENSE_APPROVAL_STATUS.APPROVED,
    comment: payload.comment || null,
    approvedAt: new Date().toISOString(),
  });

  const requiredLevels = Number(expense.requiredApprovalLevels || 1);
  let updated;
  if (level < requiredLevels) {
    repository.createApproval({ expenseId: id, approverId: null, approvalLevel: level + 1, status: EXPENSE_APPROVAL_STATUS.PENDING });
    updated = repository.updateExpense(id, {
      status: EXPENSE_STATUS.UNDER_REVIEW,
      currentApprovalLevel: level + 1,
      approvedAmount,
      adjustmentReason: amountAdjusted ? payload.adjustmentReason || payload.adjustment_reason : expense.adjustmentReason || null,
      adjustedBy: amountAdjusted ? user.id : expense.adjustedBy || null,
      adjustedAt: amountAdjusted ? new Date().toISOString() : expense.adjustedAt || null,
    });
  } else {
    updated = repository.updateExpense(id, {
      status: EXPENSE_STATUS.APPROVED,
      approvalStatus: EXPENSE_APPROVAL_STATUS.APPROVED,
      reimbursementStatus: expense.reimbursementStatus === REIMBURSEMENT_STATUS.NOT_REQUIRED ? REIMBURSEMENT_STATUS.NOT_REQUIRED : REIMBURSEMENT_STATUS.PENDING,
      approvedAmount,
      approvedBy: user.id,
      approvedAt: new Date().toISOString(),
      adjustmentReason: amountAdjusted ? payload.adjustmentReason || payload.adjustment_reason : expense.adjustmentReason || null,
      adjustedBy: amountAdjusted ? user.id : expense.adjustedBy || null,
      adjustedAt: amountAdjusted ? new Date().toISOString() : expense.adjustedAt || null,
    });
    queueNotification({ type: "expense_approved", title: "Expense approved", body: `${expense.reference} is approved.`, data: { expenseId: id } });
  }
  recordHistory({ expenseId: id, actor: user, action: amountAdjusted ? "ADJUSTED_APPROVED" : "APPROVED", oldStatus: expense.status, newStatus: updated.status, comment: payload.comment, metadata: { approvalLevel: level, approvedAmount } });
  return { oldValues: expense, record: updated };
}

function rejectExpense(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.REJECT);
  if (!payload.reason && !payload.comment) {
    throw createHttpError(400, "Rejection reason is required.", "REJECTION_REASON_REQUIRED");
  }
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  const updated = repository.updateExpense(id, {
    status: EXPENSE_STATUS.REJECTED,
    approvalStatus: EXPENSE_APPROVAL_STATUS.REJECTED,
    reimbursementStatus: REIMBURSEMENT_STATUS.NOT_REQUIRED,
    rejectedBy: user.id,
    rejectedAt: new Date().toISOString(),
    rejectionReason: payload.reason || payload.comment,
  });
  recordHistory({ expenseId: id, actor: user, action: "REJECTED", oldStatus: expense.status, newStatus: updated.status, comment: payload.reason || payload.comment });
  queueNotification({ type: "expense_rejected", title: "Expense rejected", body: `${expense.reference} was rejected.`, data: { expenseId: id } });
  return { oldValues: expense, record: updated };
}

function cancelExpense(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.CANCEL);
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  if ([EXPENSE_STATUS.COMPLETED, EXPENSE_STATUS.CANCELLED].includes(expense.status)) {
    throw createHttpError(409, "Completed or cancelled expenses cannot be cancelled.", "EXPENSE_FINALIZED");
  }
  const updated = repository.updateExpense(id, {
    status: EXPENSE_STATUS.CANCELLED,
    reimbursementStatus: REIMBURSEMENT_STATUS.NOT_REQUIRED,
    cancelledBy: user.id,
    cancelledAt: new Date().toISOString(),
    cancellationReason: payload.reason || null,
  });
  recordHistory({ expenseId: id, actor: user, action: "CANCELLED", oldStatus: expense.status, newStatus: updated.status, comment: payload.reason });
  return { oldValues: expense, record: updated };
}

function addComment(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.COMMENT);
  if (!payload.comment) {
    throw createHttpError(400, "Comment is required.", "COMMENT_REQUIRED");
  }
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  const comment = repository.createComment({ expenseId: id, userId: user.id, comment: payload.comment });
  recordHistory({ expenseId: id, actor: user, action: "COMMENT_ADDED", oldStatus: expense.status, newStatus: expense.status, comment: payload.comment });
  return comment;
}

function addReceipt(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.UPLOAD_RECEIPT);
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  const receipt = createReceiptRecord(id, payload, user);
  recordHistory({ expenseId: id, actor: user, action: "RECEIPT_UPLOADED", oldStatus: expense.status, newStatus: expense.status, metadata: { receiptId: receipt.id } });
  return receipt;
}

function processReimbursement(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.REIMBURSE);
  const expense = repository.findExpense(id);
  if (!expense) {
    return null;
  }
  assertExpenseAccess(user, expense);
  const actorEmployee = repository.findEmployeeByUserId(user.id);
  if (actorEmployee && actorEmployee.id === expense.employeeId) {
    throw createHttpError(403, "Expense owner cannot reimburse their own claim.", "SELF_REIMBURSEMENT_FORBIDDEN");
  }
  if (expense.status !== EXPENSE_STATUS.APPROVED && expense.status !== EXPENSE_STATUS.PROCESSING) {
    throw createHttpError(409, "Only approved expenses can be reimbursed.", "EXPENSE_NOT_APPROVED");
  }
  if (expense.reimbursementStatus === REIMBURSEMENT_STATUS.NOT_REQUIRED) {
    throw createHttpError(409, "This expense does not require reimbursement.", "REIMBURSEMENT_NOT_REQUIRED");
  }
  const reimbursements = repository.listReimbursements(id);
  const reimbursedAmount = reimbursements
    .filter((payment) => payment.status === REIMBURSEMENT_STATUS.PAID)
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const approvedAmount = Number(expense.approvedAmount || expense.amount || 0);
  const amount = roundMoney(payload.amount ?? approvedAmount - reimbursedAmount);
  if (amount <= 0) {
    throw createHttpError(400, "Reimbursement amount must be greater than zero.", "INVALID_REIMBURSEMENT_AMOUNT");
  }
  if (amount > approvedAmount - reimbursedAmount) {
    throw createHttpError(409, "Reimbursement amount exceeds the approved remaining amount.", "EXPENSE_OVER_REIMBURSEMENT_BLOCKED");
  }
  const accountId = payload.accountId || payload.account_id || null;
  if (accountId && !repository.findAccount(accountId)) {
    throw createHttpError(404, "Payment account was not found.", "PAYMENT_ACCOUNT_NOT_FOUND");
  }
  const status = String(payload.status || REIMBURSEMENT_STATUS.PAID).toUpperCase();
  const allowedStatus = [REIMBURSEMENT_STATUS.PROCESSING, REIMBURSEMENT_STATUS.PAID, REIMBURSEMENT_STATUS.FAILED];
  if (!allowedStatus.includes(status)) {
    throw createHttpError(400, "Invalid reimbursement status.", "INVALID_REIMBURSEMENT_STATUS");
  }
  const reimbursement = repository.createReimbursement({
    expenseId: id,
    employeeId: expense.employeeId,
    amount,
    paymentMethod: payload.paymentMethod || payload.payment_method || "BANK_TRANSFER",
    accountId,
    transactionReference: payload.transactionReference || payload.transaction_reference || null,
    paymentDate: payload.paymentDate || payload.payment_date || today(),
    status,
    processedBy: user.id,
    notes: payload.notes || null,
  });
  const nextTotal = reimbursedAmount + (status === REIMBURSEMENT_STATUS.PAID ? amount : 0);
  const paid = nextTotal >= approvedAmount;
  const nextStatus = status === REIMBURSEMENT_STATUS.FAILED ? REIMBURSEMENT_STATUS.FAILED : paid ? REIMBURSEMENT_STATUS.PAID : REIMBURSEMENT_STATUS.PROCESSING;
  const updated = repository.updateExpense(id, {
    status: paid ? EXPENSE_STATUS.COMPLETED : EXPENSE_STATUS.PROCESSING,
    reimbursementStatus: nextStatus,
    reimbursementAmount: roundMoney(nextTotal),
    reimbursementPaidAt: paid ? new Date().toISOString() : expense.reimbursementPaidAt || null,
  });
  recordHistory({
    expenseId: id,
    actor: user,
    action: status === REIMBURSEMENT_STATUS.FAILED ? "REIMBURSEMENT_FAILED" : paid ? "REIMBURSEMENT_PAID" : "REIMBURSEMENT_PROCESSING",
    oldStatus: expense.status,
    newStatus: updated.status,
    metadata: { reimbursementId: reimbursement.id, amount },
  });
  queueNotification({ type: "expense_reimbursement", title: "Expense reimbursement updated", body: `${expense.reference} reimbursement is ${nextStatus}.`, data: { expenseId: id } });
  return { oldValues: expense, record: updated, reimbursement };
}

function getDashboard(user) {
  assertPermission(user, EXPENSE_PERMISSIONS.VIEW);
  const month = today().slice(0, 7);
  const expenses = listAccessibleExpenses(user, {});
  const submittedThisMonth = expenses
    .filter((expense) => String(expense.submittedAt || expense.createdAt || "").startsWith(month))
    .reduce((total, expense) => total + Number(expense.amount || 0), 0);
  return {
    submittedThisMonth: roundMoney(submittedThisMonth),
    awaitingReview: expenses.filter((expense) => [EXPENSE_STATUS.SUBMITTED, EXPENSE_STATUS.UNDER_REVIEW].includes(expense.status)).length,
    rejected: expenses.filter((expense) => expense.status === EXPENSE_STATUS.REJECTED).length,
    approved: expenses.filter((expense) => expense.status === EXPENSE_STATUS.APPROVED).length,
    paid: expenses.filter((expense) => expense.reimbursementStatus === REIMBURSEMENT_STATUS.PAID).length,
    pendingReimbursement: roundMoney(
      expenses
        .filter((expense) => [EXPENSE_STATUS.APPROVED, EXPENSE_STATUS.PROCESSING].includes(expense.status))
        .reduce((total, expense) => total + Number(expense.approvedAmount || expense.amount || 0) - Number(expense.reimbursementAmount || 0), 0)
    ),
    totalClaims: expenses.length,
  };
}

function getReports(user, query = {}) {
  assertPermission(user, EXPENSE_PERMISSIONS.VIEW);
  const expenses = listAccessibleExpenses(user, query);
  const byStatus = expenses.reduce((summary, expense) => {
    summary[expense.status] = (summary[expense.status] || 0) + 1;
    return summary;
  }, {});
  const groupBy = (idKey, nameKey) => {
    const map = new Map();
    for (const expense of expenses) {
      const key = expense[idKey] || "unassigned";
      const current = map.get(key) || { id: expense[idKey] || null, name: expense[nameKey] || "Unassigned", amount: 0, claims: 0 };
      current.amount = roundMoney(current.amount + Number(expense.amount || 0));
      current.claims += 1;
      map.set(key, current);
    }
    return [...map.values()];
  };
  return {
    totalExpenses: expenses.length,
    totalAmount: roundMoney(expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0)),
    pendingClaims: expenses.filter((expense) => [EXPENSE_STATUS.SUBMITTED, EXPENSE_STATUS.UNDER_REVIEW].includes(expense.status)).length,
    approvedClaims: expenses.filter((expense) => expense.status === EXPENSE_STATUS.APPROVED).length,
    rejectedClaims: expenses.filter((expense) => expense.status === EXPENSE_STATUS.REJECTED).length,
    reimbursements: roundMoney(expenses.reduce((total, expense) => total + Number(expense.reimbursementAmount || 0), 0)),
    departmentSpending: groupBy("departmentId", "departmentName"),
    employeeSpending: groupBy("employeeId", "employeeName"),
    categorySpending: groupBy("categoryId", "categoryName"),
    policyViolations: expenses.filter((expense) => Array.isArray(expense.policyViolations) && expense.policyViolations.length > 0).length,
    overLimitExpenses: expenses.filter((expense) => (expense.policyViolations || []).some((violation) => violation.code === "EXPENSE_LIMIT_EXCEEDED")).length,
    byStatus,
  };
}

function exportExpenses(user, query = {}) {
  assertPermission(user, EXPENSE_PERMISSIONS.EXPORT);
  const rows = listAccessibleExpenses(user, query);
  const headers = ["reference", "employeeName", "departmentName", "description", "expenseDate", "categoryName", "amount", "currency", "status", "reimbursementStatus"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function listCategories(query) {
  return repository.listCategories(query);
}

function listPolicies(user, query) {
  assertPermission(user, EXPENSE_PERMISSIONS.VIEW);
  return repository.listPolicies(query);
}

function createPolicy(payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.MANAGE_POLICIES);
  const category = payload.categoryId || payload.category_id || payload.category ? repository.findCategory(payload.categoryId || payload.category_id || payload.category) : null;
  const policy = repository.createPolicy({
    categoryId: category?.id || payload.categoryId || payload.category_id || null,
    departmentId: payload.departmentId || payload.department_id || null,
    maxAmount: payload.maxAmount ?? payload.max_amount ?? null,
    requiresReceipt: payload.requiresReceipt ?? payload.requires_receipt ?? false,
    receiptRequiredAmount: payload.receiptRequiredAmount ?? payload.receipt_required_amount ?? null,
    requiresManagerApproval: payload.requiresManagerApproval ?? payload.requires_manager_approval ?? true,
    requiresFinanceApproval: payload.requiresFinanceApproval ?? payload.requires_finance_approval ?? true,
    reimbursementAllowed: payload.reimbursementAllowed ?? payload.reimbursement_allowed ?? true,
    currency: payload.currency || "NGN",
    active: payload.active !== false,
    createdBy: user.id,
  });
  return { record: policy };
}

function updatePolicy(id, payload, user) {
  assertPermission(user, EXPENSE_PERMISSIONS.MANAGE_POLICIES);
  const policy = repository.findPolicy(id);
  if (!policy) {
    return null;
  }
  const updated = repository.updatePolicy(id, {
    maxAmount: payload.maxAmount ?? payload.max_amount ?? policy.maxAmount,
    requiresReceipt: payload.requiresReceipt ?? payload.requires_receipt ?? policy.requiresReceipt,
    receiptRequiredAmount: payload.receiptRequiredAmount ?? payload.receipt_required_amount ?? policy.receiptRequiredAmount,
    requiresManagerApproval: payload.requiresManagerApproval ?? payload.requires_manager_approval ?? policy.requiresManagerApproval,
    requiresFinanceApproval: payload.requiresFinanceApproval ?? payload.requires_finance_approval ?? policy.requiresFinanceApproval,
    reimbursementAllowed: payload.reimbursementAllowed ?? payload.reimbursement_allowed ?? policy.reimbursementAllowed,
    active: payload.active ?? policy.active,
  });
  return { oldValues: policy, record: updated };
}

module.exports = {
  addComment,
  addReceipt,
  approveExpense,
  cancelExpense,
  createExpense,
  createPolicy,
  exportExpenses,
  getDashboard,
  getExpenseDetails,
  getReports,
  listCategories,
  listExpenses,
  listMyExpenses,
  listPolicies,
  listTeamExpenses,
  processReimbursement,
  rejectExpense,
  submitExpense,
  updateExpense,
  updatePolicy,
};
