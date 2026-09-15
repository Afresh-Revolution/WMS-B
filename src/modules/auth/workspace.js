const WORKSPACES = Object.freeze({
  superadmin: {
    key: "super-admin",
    name: "Super Admin",
    dashboardPath: "/api/v1/super-admin/dashboard",
    homePath: "/super-admin",
  },
  admin: {
    key: "admin",
    name: "Admin",
    dashboardPath: "/api/v1/dashboard/overview",
    homePath: "/admin",
  },
  hr: {
    key: "hr",
    name: "HR",
    dashboardPath: "/api/v1/hr/dashboard",
    homePath: "/hr",
  },
  hod: {
    key: "hod",
    name: "HOD",
    dashboardPath: "/api/v1/hod/dashboard",
    homePath: "/hod",
  },
  manager: {
    key: "manager",
    name: "Manager",
    dashboardPath: "/api/v1/manager/dashboard",
    homePath: "/manager",
  },
  secretary: {
    key: "secretary",
    name: "Secretary",
    dashboardPath: "/api/v1/secretary/dashboard",
    homePath: "/secretary",
  },
  accountant: {
    key: "accountant",
    name: "Accountant",
    dashboardPath: "/api/v1/accountant/dashboard",
    homePath: "/accountant",
  },
  employee: {
    key: "employee",
    name: "Employee",
    dashboardPath: "/api/v1/employee/dashboard",
    homePath: "/employee",
  },
  intern: {
    key: "nysc-intern",
    name: "NYSC/Intern",
    dashboardPath: "/api/v1/nysc-intern/dashboard",
    homePath: "/intern",
  },
  nysc_intern: {
    key: "nysc-intern",
    name: "NYSC/Intern",
    dashboardPath: "/api/v1/nysc-intern/dashboard",
    homePath: "/intern",
  },
  department_manager: {
    key: "manager",
    name: "Department Manager",
    dashboardPath: "/api/v1/manager/dashboard",
    homePath: "/manager",
  },
  team_leader: {
    key: "manager",
    name: "Team Leader",
    dashboardPath: "/api/v1/manager/dashboard",
    homePath: "/manager",
  },
});

function normalizeRoleKey(role) {
  if (!role) {
    return "";
  }
  if (typeof role === "object") {
    return String(role.key || role.id || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }
  return String(role).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function getWorkspaceForRole(role) {
  const roleKey = normalizeRoleKey(role);
  return WORKSPACES[roleKey] || {
    key: roleKey || "staff",
    name: "Workspace",
    dashboardPath: "/api/v1/auth/me",
    homePath: "/",
  };
}

module.exports = {
  WORKSPACES,
  getWorkspaceForRole,
  normalizeRoleKey,
};
