const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { hasPermission } = require("../../constants/rbac");
const { createRepository } = require("../../repositories/resourceRepository");
const { recordOperationalAudit } = require("../_shared/auditService");

const vendorsRouter = express.Router();
const repository = createRepository("vendors", {
  searchableFields: ["name", "vendorName", "vendor_name", "email", "phone", "category", "location", "status"],
});

function can(user, permission) {
  return user?.role === "superadmin" || hasPermission(user, permission) || hasPermission(user, "vendors.manage");
}

function requireVendorPermission(permission, extraPermissions = []) {
  return (req, res, next) => {
    if (can(req.user, permission) || extraPermissions.some((item) => can(req.user, item))) {
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
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res) {
  return res.status(404).json({
    success: false,
    message: "Operation failed",
    error: { code: "VENDOR_NOT_FOUND", details: {} },
  });
}

function normalizeVendorPayload(payload = {}) {
  const name = String(payload.name || payload.vendorName || payload.vendor_name || "").trim();
  if (!name) {
    const error = new Error("Vendor name is required.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    error.code = "VENDOR_NAME_REQUIRED";
    throw error;
  }
  return {
    name,
    vendorName: name,
    vendor_name: name,
    category: payload.category || payload.vendorCategory || payload.vendor_category || null,
    location: payload.location || payload.address || payload.city || null,
    email: payload.email || payload.contactEmail || payload.contact_email || null,
    phone: payload.phone || payload.contactPhone || payload.contact_phone || null,
    status: payload.status || "active",
    notes: payload.notes || payload.description || null,
  };
}

vendorsRouter.use(authenticate);

vendorsRouter.get(
  "/",
  requireVendorPermission("vendors.view", ["accountant.vendors.view"]),
  handle((req, res) => {
    const result = repository.list(req.query);
    return send(res, "Vendors loaded.", result.data, result.meta);
  })
);

vendorsRouter.post(
  "/",
  requireVendorPermission("vendors.create"),
  handle((req, res) => {
    const record = repository.create(normalizeVendorPayload(req.body || {}), req.user.id);
    recordOperationalAudit({
      user: req.user,
      action: "VENDOR_CREATED",
      module: "vendors",
      recordId: record.id,
      newValue: record,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    return res.status(201).json({ success: true, message: "Vendor created.", data: record, meta: {} });
  })
);

vendorsRouter.get(
  "/:id",
  requireVendorPermission("vendors.view", ["accountant.vendors.view"]),
  handle((req, res) => {
    const record = repository.getById(req.params.id);
    return record ? send(res, "Vendor loaded.", record) : notFound(res);
  })
);

vendorsRouter.patch(
  "/:id",
  requireVendorPermission("vendors.update"),
  handle((req, res) => {
    const existing = repository.getById(req.params.id);
    if (!existing) {
      return notFound(res);
    }
    const record = repository.update(req.params.id, normalizeVendorPayload({ ...existing, ...(req.body || {}) }));
    recordOperationalAudit({
      user: req.user,
      action: "VENDOR_UPDATED",
      module: "vendors",
      recordId: record.id,
      oldValue: existing,
      newValue: record,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    return send(res, "Vendor updated.", record);
  })
);

module.exports = { vendorsRouter, normalizeVendorPayload };
