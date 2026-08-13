const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { recordOperationalAudit } = require("../_shared/auditService");
const { BILL_PERMISSIONS } = require("./constants");
const billService = require("./bill.service");

const billsRouter = express.Router();

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission);
}

function requireBillPermission(permission) {
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

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code: "BILL_NOT_FOUND", details: {} },
  });
}

function auditBill(req, action, result) {
  if (!result) {
    return;
  }
  recordOperationalAudit({
    user: req.user,
    action,
    module: "bills",
    recordId: result.record?.id || result.id || req.params.id || null,
    oldValue: result.oldValues || null,
    newValue: result.record || result,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

billsRouter.use(authenticate);

billsRouter.get(
  "/dashboard",
  requireBillPermission(BILL_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Bills dashboard loaded.", data: billService.getDashboard(req.user), meta: {} }))
);

billsRouter.get(
  "/reports",
  requireBillPermission(BILL_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Bills reports loaded.", data: billService.getReports(req.user, req.query), meta: {} }))
);

billsRouter.get(
  "/categories",
  requireBillPermission(BILL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = billService.listCategories(req.query);
    return res.json({ success: true, message: "Bill categories loaded.", data: result.data, meta: result.meta });
  })
);

billsRouter.post(
  "/",
  requireBillPermission(BILL_PERMISSIONS.CREATE),
  handle((req, res) => {
    const result = billService.createBill(req.body || {}, req.user);
    auditBill(req, "BILL_CREATED", result);
    return res.status(201).json({ success: true, message: "Bill created.", data: result.record, meta: {} });
  })
);

billsRouter.get(
  "/",
  requireBillPermission(BILL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const result = billService.listBills(req.user, req.query);
    return res.json({ success: true, message: "Bills loaded.", data: result.data, meta: result.meta });
  })
);

billsRouter.get(
  "/:id",
  requireBillPermission(BILL_PERMISSIONS.VIEW),
  handle((req, res) => res.json({ success: true, message: "Bill loaded.", data: billService.getBillDetails(req.params.id, req.user), meta: {} }))
);

billsRouter.patch(
  "/:id",
  requireBillPermission(BILL_PERMISSIONS.UPDATE),
  handle((req, res) => {
    const result = billService.updateBill(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "BILL_UPDATED", result);
    return res.json({ success: true, message: "Bill updated.", data: result.record, meta: {} });
  })
);

billsRouter.post(
  "/:id/submit",
  requireBillPermission(BILL_PERMISSIONS.SUBMIT),
  handle((req, res) => {
    const result = billService.submitBill(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "BILL_SUBMITTED", result);
    return res.json({ success: true, message: "Bill submitted.", data: result.record, meta: {} });
  })
);

billsRouter.post(
  "/:id/approve",
  requireBillPermission(BILL_PERMISSIONS.APPROVE),
  handle((req, res) => {
    const result = billService.approveBill(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "BILL_APPROVED", result);
    return res.json({ success: true, message: "Bill approved.", data: result.record, meta: {} });
  })
);

billsRouter.post(
  "/:id/reject",
  requireBillPermission(BILL_PERMISSIONS.REJECT),
  handle((req, res) => {
    const result = billService.rejectBill(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "BILL_REJECTED", result);
    return res.json({ success: true, message: "Bill rejected.", data: result.record, meta: {} });
  })
);

billsRouter.post(
  "/:id/dispute",
  requireBillPermission(BILL_PERMISSIONS.DISPUTE),
  handle((req, res) => {
    const result = billService.disputeBill(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "BILL_DISPUTED", result);
    return res.json({ success: true, message: "Bill disputed.", data: result.record, meta: {} });
  })
);

billsRouter.post(
  "/:id/schedule",
  requireBillPermission(BILL_PERMISSIONS.SCHEDULE_PAYMENT),
  handle((req, res) => {
    const result = billService.schedulePayment(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "BILL_SCHEDULED", result);
    return res.json({ success: true, message: "Bill payment scheduled.", data: result.record, meta: {} });
  })
);

billsRouter.post(
  "/:id/cancel",
  requireBillPermission(BILL_PERMISSIONS.DELETE),
  handle((req, res) => {
    const result = billService.cancelBill(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "BILL_CANCELLED", result);
    return res.json({ success: true, message: "Bill cancelled.", data: result.record, meta: {} });
  })
);

billsRouter.post(
  "/:id/comments",
  requireBillPermission(BILL_PERMISSIONS.COMMENT),
  handle((req, res) => {
    const comment = billService.addComment(req.params.id, req.body || {}, req.user);
    if (!comment) {
      return notFound(res);
    }
    auditBill(req, "BILL_COMMENT_ADDED", comment);
    return res.status(201).json({ success: true, message: "Bill comment added.", data: comment, meta: {} });
  })
);

billsRouter.post(
  "/:id/attachments",
  requireBillPermission(BILL_PERMISSIONS.UPLOAD),
  handle((req, res) => {
    const attachment = billService.addAttachment(req.params.id, req.body || {}, req.user);
    if (!attachment) {
      return notFound(res);
    }
    auditBill(req, "BILL_ATTACHMENT_ADDED", attachment);
    return res.status(201).json({ success: true, message: "Bill attachment added.", data: attachment, meta: {} });
  })
);

billsRouter.post(
  "/:id/payments",
  requireBillPermission(BILL_PERMISSIONS.PAY),
  handle((req, res) => {
    const result = billService.recordPayment(req.params.id, req.body || {}, req.user);
    if (!result) {
      return notFound(res);
    }
    auditBill(req, "PAYMENT_COMPLETED", result);
    return res.status(201).json({ success: true, message: "Bill payment recorded.", data: result.payment, meta: { bill: result.record } });
  })
);

billsRouter.get(
  "/:id/payments",
  requireBillPermission(BILL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const bill = billService.getBillDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Bill payments loaded.", data: bill.payments, meta: { billId: bill.id } });
  })
);

billsRouter.get(
  "/:id/history",
  requireBillPermission(BILL_PERMISSIONS.VIEW),
  handle((req, res) => {
    const bill = billService.getBillDetails(req.params.id, req.user);
    return res.json({ success: true, message: "Bill history loaded.", data: bill.history, meta: { billId: bill.id } });
  })
);

module.exports = { billsRouter };
