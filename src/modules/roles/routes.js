const express = require("express");
const { authenticate, requirePermission } = require("../../auth/middleware");
const rolePermissionService = require("./rolePermissionService");

const rolesRouter = express.Router();
const permissionsRouter = express.Router();

function handle(handler) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function send(res, message, data, meta = {}) {
  return res.json({ success: true, message, data, meta });
}

function notFound(res, code = "ROLE_NOT_FOUND") {
  return res.status(404).json({ success: false, message: "Operation failed", error: { code, details: {} } });
}

rolesRouter.use(authenticate);
permissionsRouter.use(authenticate);

rolesRouter.get("/", requirePermission("roles.view"), handle((req, res) => {
  const result = rolePermissionService.listRoles(req.query);
  return send(res, "Roles loaded.", result.data, result.meta);
}));

rolesRouter.get("/catalog", requirePermission("roles.view"), handle((req, res) => {
  const result = rolePermissionService.listRoles({ ...req.query, limit: req.query.limit || 100 });
  return send(res, "Role catalog loaded.", result.data, result.meta);
}));

rolesRouter.post("/", requirePermission("roles.create"), handle((req, res) => {
  const role = rolePermissionService.createRole(req.body || {}, req);
  return res.status(201).json({ success: true, message: "Role created.", data: role, meta: {} });
}));

rolesRouter.get("/:id", requirePermission("roles.view"), handle((req, res) => {
  const role = rolePermissionService.getRole(req.params.id);
  return role ? send(res, "Role loaded.", role) : notFound(res);
}));

rolesRouter.patch("/:id", requirePermission("roles.update"), handle((req, res) => {
  const role = rolePermissionService.updateRole(req.params.id, req.body || {}, req);
  return role ? send(res, "Role updated.", role) : notFound(res);
}));

rolesRouter.delete("/:id", requirePermission("roles.delete"), handle((req, res) => {
  const role = rolePermissionService.deleteRole(req.params.id, req);
  return role ? send(res, "Role deleted.", role) : notFound(res);
}));

rolesRouter.get("/:id/permissions", requirePermission("roles.view"), handle((req, res) => {
  const permissions = rolePermissionService.getRolePermissions(req.params.id);
  return permissions ? send(res, "Role permissions loaded.", permissions) : notFound(res);
}));

rolesRouter.put("/:id/permissions", requirePermission("roles.assign_permissions"), handle((req, res) => {
  const role = rolePermissionService.putRolePermissions(req.params.id, req.body?.permissions || [], req);
  return role ? send(res, "Role permissions updated.", role) : notFound(res);
}));

permissionsRouter.get("/", requirePermission("roles.view"), handle((req, res) => {
  const permissions = rolePermissionService.listPermissionCatalog();
  return send(res, "Permissions loaded.", permissions);
}));

permissionsRouter.get("/catalog", requirePermission("roles.view"), handle((req, res) => {
  const permissions = rolePermissionService.listPermissionCatalog();
  return send(res, "Permission catalog loaded.", permissions);
}));

module.exports = { permissionsRouter, rolesRouter };
