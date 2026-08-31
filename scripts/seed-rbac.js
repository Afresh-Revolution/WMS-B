require("dotenv").config();

const { PERMISSIONS, ROLE_DEFINITIONS } = require("../src/constants/rbac");
const { readCollection, writeCollection } = require("../src/database/jsonStore");

const DEFAULT_ROLES = [
  { key: "superadmin", name: "Super Admin", permissions: Object.values(PERMISSIONS), isSystemRole: true },
  {
    key: "admin",
    name: "Admin",
    permissions: ["overview.view", "users.view", "employees.view", "departments.view", "tasks.view", "reports.view"],
    isSystemRole: true,
  },
  {
    key: "hr",
    name: "HR",
    permissions: ROLE_DEFINITIONS.hr.permissions,
    isSystemRole: true,
  },
  {
    key: "accountant",
    name: "Accountant",
    permissions: ["payroll.view", "bills.view", "expenses.view", "purchases.view", "vendors.view", "reports.view"],
    isSystemRole: true,
  },
  {
    key: "secretary",
    name: "Secretary",
    permissions: ["meetings.view", "meetings.create", "events.view", "announcements.view", "announcements.create"],
    isSystemRole: true,
  },
  {
    key: "hod",
    name: "HOD",
    permissions: ["departments.view", "employees.view", "leave.view_team", "tasks.view", "tasks.assign", "targets.view"],
    isSystemRole: true,
  },
  {
    key: "employee",
    name: "Employee",
    permissions: ["profile.view", "profile.update", "leave.request", "tasks.view", "targets.view", "meetings.view", "announcements.view"],
    isSystemRole: true,
  },
  {
    key: "nysc_intern",
    name: "NYSC/Intern",
    permissions: ["profile.view", "tasks.view", "targets.view", "meetings.view", "announcements.view"],
    isSystemRole: true,
  },
];

function now() {
  return new Date().toISOString();
}

function upsertByKey(records, key, payload) {
  const index = records.findIndex((record) => record.key === key);
  const timestamp = now();
  if (index === -1) {
    records.push({ id: key, ...payload, createdAt: timestamp, updatedAt: timestamp });
    return;
  }

  records[index] = { ...records[index], ...payload, updatedAt: timestamp };
}

const permissions = readCollection("permissions");
for (const permission of Object.values(PERMISSIONS)) {
  const [module, action = "manage"] = permission.split(".");
  upsertByKey(permissions, permission, {
    key: permission,
    name: permission,
    module,
    action,
    description: permission,
  });
}
writeCollection("permissions", permissions);

const roles = readCollection("roles");
for (const role of DEFAULT_ROLES) {
  upsertByKey(roles, role.key, {
    key: role.key,
    name: role.name,
    description: `${role.name} default system role.`,
    permissions: role.permissions,
    isSystemRole: role.isSystemRole,
    is_system_role: role.isSystemRole,
  });
}
writeCollection("roles", roles);

console.log(`Seeded ${Object.values(PERMISSIONS).length} permissions and ${DEFAULT_ROLES.length} roles.`);
