const express = require("express");
const { authenticate, requireRole } = require("../../auth/middleware");
const { createRepository } = require("../../repositories/resourceRepository");
const { recordOperationalAudit } = require("./auditService");

function cleanPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const { id, createdAt, updatedAt, deletedAt, deletedBy, createdBy, ...safePayload } = payload;
  return safePayload;
}

function createResourceRouter(moduleDefinition) {
  const router = express.Router();
  const repository = createRepository(moduleDefinition.collection, {
    searchableFields: moduleDefinition.searchableFields,
  });

  router.use(authenticate, requireRole("superadmin"));

  router.get("/", (req, res) => {
    const result = repository.list(req.query);
    return res.json({
      success: true,
      message: `${moduleDefinition.label} list loaded.`,
      data: result.data,
      meta: result.meta,
    });
  });

  router.post("/", (req, res) => {
    if (moduleDefinition.immutable) {
      return res.status(405).json({
        success: false,
        message: "Operation failed",
        error: { code: "IMMUTABLE_RESOURCE", details: { module: moduleDefinition.key } },
      });
    }

    const payload = cleanPayload(req.body);
    if (!payload) {
      return res.status(400).json({
        success: false,
        message: "Operation failed",
        error: { code: "INVALID_PAYLOAD", details: { expected: "JSON object" } },
      });
    }

    const record = repository.create(payload, req.user.id);
    recordOperationalAudit({
      user: req.user,
      action: `${moduleDefinition.label} Created`,
      module: moduleDefinition.key,
      recordId: record.id,
      newValue: record,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: `${moduleDefinition.label} created.`,
      data: record,
      meta: {},
    });
  });

  router.post("/:collectionAction", (req, res, next) => {
    if (!Array.isArray(moduleDefinition.collectionActions) || !moduleDefinition.collectionActions.includes(req.params.collectionAction)) {
      return next();
    }

    const payload = cleanPayload(req.body) || {};
    const record = repository.create(
      {
        ...payload,
        status: payload.status || "pending",
        requestedAction: req.params.collectionAction,
      },
      req.user.id
    );

    recordOperationalAudit({
      user: req.user,
      action: `${moduleDefinition.label} ${req.params.collectionAction}`,
      module: moduleDefinition.key,
      recordId: record.id,
      newValue: record,
      ipAddress: req.ip,
    });

    return res.status(202).json({
      success: true,
      message: `${moduleDefinition.label} action queued.`,
      data: record,
      meta: { action: req.params.collectionAction },
    });
  });

  router.get("/:id", (req, res) => {
    const record = repository.getById(req.params.id);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Operation failed",
        error: { code: "NOT_FOUND", details: { id: req.params.id } },
      });
    }

    return res.json({
      success: true,
      message: `${moduleDefinition.label} loaded.`,
      data: record,
      meta: {},
    });
  });

  router.patch("/:id", (req, res) => {
    if (moduleDefinition.immutable) {
      return res.status(405).json({
        success: false,
        message: "Operation failed",
        error: { code: "IMMUTABLE_RESOURCE", details: { module: moduleDefinition.key } },
      });
    }

    const payload = cleanPayload(req.body);
    if (!payload) {
      return res.status(400).json({
        success: false,
        message: "Operation failed",
        error: { code: "INVALID_PAYLOAD", details: { expected: "JSON object" } },
      });
    }

    const oldValue = repository.getById(req.params.id);
    const record = repository.update(req.params.id, payload);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Operation failed",
        error: { code: "NOT_FOUND", details: { id: req.params.id } },
      });
    }

    recordOperationalAudit({
      user: req.user,
      action: `${moduleDefinition.label} Updated`,
      module: moduleDefinition.key,
      recordId: record.id,
      oldValue,
      newValue: record,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: `${moduleDefinition.label} updated.`,
      data: record,
      meta: {},
    });
  });

  router.delete("/:id", (req, res) => {
    if (moduleDefinition.immutable) {
      return res.status(405).json({
        success: false,
        message: "Operation failed",
        error: { code: "IMMUTABLE_RESOURCE", details: { module: moduleDefinition.key } },
      });
    }

    const oldValue = repository.getById(req.params.id);
    const record = repository.remove(req.params.id, req.user.id);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Operation failed",
        error: { code: "NOT_FOUND", details: { id: req.params.id } },
      });
    }

    recordOperationalAudit({
      user: req.user,
      action: `${moduleDefinition.label} Deleted`,
      module: moduleDefinition.key,
      recordId: record.id,
      oldValue,
      newValue: record,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: `${moduleDefinition.label} deleted.`,
      data: record,
      meta: {},
    });
  });

  function recordAction(req, res) {
    if (!moduleDefinition.actions.includes(req.params.action)) {
      return res.status(404).json({
        success: false,
        message: "Operation failed",
        error: {
          code: "UNSUPPORTED_ACTION",
          details: { action: req.params.action, module: moduleDefinition.key },
        },
      });
    }

    const oldValue = repository.getById(req.params.id);
    if (!oldValue) {
      return res.status(404).json({
        success: false,
        message: "Operation failed",
        error: { code: "NOT_FOUND", details: { id: req.params.id } },
      });
    }

    const actionPayload = cleanPayload(req.body) || {};
    const record = repository.update(req.params.id, {
      ...actionPayload,
      lastAction: req.params.action,
      lastActionAt: new Date().toISOString(),
      lastActionBy: req.user.id,
      status: actionPayload.status || oldValue.status || req.params.action,
    });

    recordOperationalAudit({
      user: req.user,
      action: `${moduleDefinition.label} ${req.params.action}`,
      module: moduleDefinition.key,
      recordId: record.id,
      oldValue,
      newValue: record,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: `${moduleDefinition.label} action completed.`,
      data: record,
      meta: {
        action: req.params.action,
        transactional: Boolean(moduleDefinition.transactional),
        requiresExplicitConfirmation: Boolean(moduleDefinition.sensitive),
      },
    });
  }

  router.post("/:id/:action", recordAction);
  router.get("/:id/:action", recordAction);

  return router;
}

module.exports = { createResourceRouter };
