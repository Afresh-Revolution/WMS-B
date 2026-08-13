const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { PURCHASE_ORDER_STATUS, PURCHASE_PERMISSIONS } = require("./constants");
const procurementService = require("./procurement.service");

const purchaseRequestsRouter = express.Router();
const purchaseOrdersRouter = express.Router();
const receiptsRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requirePurchasePermission(permission) {
  return (req, res, next) => {
    if (can(req.user, permission)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: "Operation failed",
      error: { code: "FORBIDDEN", details: {} },
    });
  };
}

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function notFound(res, code) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code, details: {} },
  });
}

function auditPurchase(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "procurement",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

purchaseRequestsRouter.use(authenticate);
purchaseOrdersRouter.use(authenticate);
receiptsRouter.use(authenticate);

purchaseRequestsRouter.get(
  "/dashboard",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Purchase request dashboard loaded.", data: procurementService.getDashboard(req.user), meta: {} }))
);

purchaseRequestsRouter.get(
  "/reports",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW_REPORTS),
  handle((req, res) => res.json({ success: true, message: "Purchase request reports loaded.", data: procurementService.getReports(req.user, req.query), meta: {} }))
);

purchaseRequestsRouter.post(
  "/",
  requirePurchasePermission(PURCHASE_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = procurementService.createPurchaseRequest(req.body || {}, req.user);
    auditPurchase(req, "PURCHASE_REQUEST_CREATED", result);
    return res.status(201).json({ success: true, message: "Purchase request created.", data: result.record, meta: {} });
  })
);

purchaseRequestsRouter.get(
  "/",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = procurementService.listPurchaseRequests(req.user, req.query);
    return res.json({ success: true, message: "Purchase requests loaded.", data: result.data, meta: result.meta });
  })
);

purchaseRequestsRouter.get(
  "/:id",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Purchase request loaded.", data: procurementService.getRequestDetails(req.params.id, req.user), meta: {} }))
);

purchaseRequestsRouter.patch(
  "/:id",
  requirePurchasePermission(PURCHASE_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = procurementService.updatePurchaseRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_REQUEST_UPDATED", result);
    return res.json({ success: true, message: "Purchase request updated.", data: result.record, meta: {} });
  })
);

purchaseRequestsRouter.post(
  "/:id/submit",
  requirePurchasePermission(PURCHASE_PERMISSIONS.SUBMIT),
  handle((req, res) => {
    const result = procurementService.submitRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_REQUEST_SUBMITTED", result);
    return res.json({ success: true, message: "Purchase request submitted.", data: result.record, meta: {} });
  })
);

purchaseRequestsRouter.post(
  "/:id/approve",
  requirePurchasePermission(PURCHASE_PERMISSIONS.APPROVE),
  handle((req, res) => {
    const result = procurementService.approveRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_REQUEST_APPROVED", result);
    return res.json({ success: true, message: "Purchase request approved.", data: result.record, meta: {} });
  })
);

purchaseRequestsRouter.post(
  "/:id/reject",
  requirePurchasePermission(PURCHASE_PERMISSIONS.REJECT),
  handle((req, res) => {
    const result = procurementService.rejectRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_REQUEST_REJECTED", result);
    return res.json({ success: true, message: "Purchase request rejected.", data: result.record, meta: {} });
  })
);

purchaseRequestsRouter.post(
  "/:id/cancel",
  requirePurchasePermission(PURCHASE_PERMISSIONS.CANCEL),
  handle((req, res) => {
    const result = procurementService.cancelRequest(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_REQUEST_CANCELLED", result);
    return res.json({ success: true, message: "Purchase request cancelled.", data: result.record, meta: {} });
  })
);

purchaseRequestsRouter.post(
  "/:id/comments",
  requirePurchasePermission(PURCHASE_PERMISSIONS.COMMENT),
  handle((req, res) => {
    const comment = procurementService.addComment(req.params.id, req.body || {}, req.user);
    if (!comment) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_REQUEST_COMMENTED", { record: comment });
    return res.status(201).json({ success: true, message: "Purchase request comment added.", data: comment, meta: {} });
  })
);

purchaseRequestsRouter.post(
  "/:id/attachments",
  requirePurchasePermission(PURCHASE_PERMISSIONS.UPLOAD),
  handle((req, res) => {
    const attachment = procurementService.addAttachment(req.params.id, req.body || {}, req.user);
    if (!attachment) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_REQUEST_ATTACHMENT_ADDED", { record: attachment });
    return res.status(201).json({ success: true, message: "Purchase request attachment added.", data: attachment, meta: {} });
  })
);

purchaseRequestsRouter.post(
  "/:id/vendor",
  requirePurchasePermission(PURCHASE_PERMISSIONS.ASSIGN_VENDOR),
  handle((req, res) => {
    const result = procurementService.assignVendor(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res, "PURCHASE_REQUEST_NOT_FOUND");
    }
    auditPurchase(req, "VENDOR_SELECTED", result);
    return res.json({ success: true, message: "Purchase request vendor selected.", data: result.record, meta: {} });
  })
);

purchaseRequestsRouter.get(
  "/:id/history",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const details = procurementService.getRequestDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Purchase request history loaded.", data: details.history, meta: {} });
  })
);

purchaseOrdersRouter.post(
  "/",
  requirePurchasePermission(PURCHASE_PERMISSIONS.CREATE_ORDER),
  handle((req, res) => {
    const result = procurementService.createPurchaseOrder(req.body || {}, req.user);
    auditPurchase(req, "PURCHASE_ORDER_CREATED", result);
    return res.status(201).json({ success: true, message: "Purchase order created.", data: result.record, meta: { request: result.request } });
  })
);

purchaseOrdersRouter.get(
  "/",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = procurementService.listPurchaseOrders(req.query);
    return res.json({ success: true, message: "Purchase orders loaded.", data: result.data, meta: result.meta });
  })
);

purchaseOrdersRouter.get(
  "/:id",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Purchase order loaded.", data: procurementService.getPurchaseOrder(req.params.id), meta: {} }))
);

purchaseOrdersRouter.patch(
  "/:id",
  requirePurchasePermission(PURCHASE_PERMISSIONS.CREATE_ORDER),
  handle((req, res) => {
    const order = procurementService.updatePurchaseOrder(req.params.id, req.body || {}, req.user);
    if (!order) {
      return notFound(res, "PURCHASE_ORDER_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_ORDER_UPDATED", { record: order });
    return res.json({ success: true, message: "Purchase order updated.", data: order, meta: {} });
  })
);

purchaseOrdersRouter.post(
  "/:id/send",
  requirePurchasePermission(PURCHASE_PERMISSIONS.CREATE_ORDER),
  handle((req, res) => {
    const order = procurementService.setPurchaseOrderStatus(req.params.id, PURCHASE_ORDER_STATUS.SENT, req.body || {}, req.user);
    if (!order) {
      return notFound(res, "PURCHASE_ORDER_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_ORDER_SENT", { record: order });
    return res.json({ success: true, message: "Purchase order sent.", data: order, meta: {} });
  })
);

purchaseOrdersRouter.post(
  "/:id/cancel",
  requirePurchasePermission(PURCHASE_PERMISSIONS.CANCEL),
  handle((req, res) => {
    const order = procurementService.setPurchaseOrderStatus(req.params.id, PURCHASE_ORDER_STATUS.CANCELLED, req.body || {}, req.user);
    if (!order) {
      return notFound(res, "PURCHASE_ORDER_NOT_FOUND");
    }
    auditPurchase(req, "PURCHASE_ORDER_CANCELLED", { record: order });
    return res.json({ success: true, message: "Purchase order cancelled.", data: order, meta: {} });
  })
);

purchaseOrdersRouter.post(
  "/:id/receive",
  requirePurchasePermission(PURCHASE_PERMISSIONS.RECEIVE),
  handle((req, res) => {
    const result = procurementService.receivePurchaseOrder(req.params.id, req.body || {}, req.user);
    auditPurchase(req, "DELIVERY_RECEIVED", result);
    return res.status(201).json({ success: true, message: "Purchase order receipt recorded.", data: result.record, meta: { order: result.order } });
  })
);

purchaseOrdersRouter.get(
  "/:id/receipts",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => {
    const order = procurementService.getPurchaseOrder(req.params.id);
    return res.json({ success: true, message: "Purchase order receipts loaded.", data: order.receipts, meta: {} });
  })
);

receiptsRouter.get(
  "/:id",
  requirePurchasePermission(PURCHASE_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Purchase receipt loaded.", data: procurementService.getReceipt(req.params.id), meta: {} }))
);

module.exports = { purchaseOrdersRouter, purchaseRequestsRouter, receiptsRouter };
