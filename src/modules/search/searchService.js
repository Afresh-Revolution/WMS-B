const { hasPermission } = require("../../constants/rbac");
const { readCollection } = require("../../database/jsonStore");
const { paginate } = require("../../utils/query");
const { listUsers } = require("../../auth/userStore");

const SEARCH_SOURCES = [
  {
    type: "users",
    module: "users",
    permission: "users.view",
    collection: null,
    fields: ["name", "fullName", "email", "phone", "role", "status"],
    label(record) {
      return record.fullName || record.name || record.email;
    },
    description(record) {
      return [record.role, record.status].filter(Boolean).join(" | ");
    },
  },
  {
    type: "employees",
    module: "employees",
    permission: "employees.view",
    collection: "employees",
    fields: ["employeeId", "employee_id", "fullName", "name", "email", "phone", "jobTitle", "department", "position"],
    label(record) {
      return record.fullName || record.name || record.email;
    },
  },
  {
    type: "departments",
    module: "departments",
    permission: "departments.view",
    collection: "departments",
    fields: ["name", "code", "description", "location", "status"],
    label(record) {
      return record.name;
    },
  },
  {
    type: "tasks",
    module: "tasks",
    permission: "tasks.view",
    collection: "tasks",
    fields: ["title", "description", "status", "priority", "department"],
    label(record) {
      return record.title;
    },
  },
  {
    type: "meetings",
    module: "meetings",
    permission: "meetings.view",
    collection: "meetings",
    fields: ["title", "description", "location", "agenda", "status"],
    label(record) {
      return record.title;
    },
  },
  {
    type: "vendors",
    module: "vendors",
    permission: "vendors.view",
    collection: "vendors",
    fields: ["name", "email", "phone", "category", "status"],
    label(record) {
      return record.name;
    },
  },
  {
    type: "bills",
    module: "bills",
    permission: "bills.view",
    collection: "bills",
    fields: ["billNumber", "invoiceNumber", "invoice_number", "description", "category", "status"],
    label(record) {
      return record.billNumber || record.invoiceNumber || record.invoice_number || record.description;
    },
  },
  {
    type: "expenses",
    module: "expenses",
    permission: "expenses.view",
    collection: "expenses",
    fields: ["description", "title", "category", "status", "employeeName"],
    label(record) {
      return record.description || record.title || record.category;
    },
  },
  {
    type: "announcements",
    module: "announcements",
    permission: "announcements.view",
    collection: "announcements",
    fields: ["title", "message", "body", "category", "status"],
    label(record) {
      return record.title;
    },
  },
  {
    type: "events",
    module: "events",
    permission: "events.view",
    collection: "events",
    fields: ["title", "type", "location", "description", "status"],
    label(record) {
      return record.title;
    },
  },
  {
    type: "nysc_interns",
    module: "nysc_interns",
    permission: "nysc_interns.view",
    collection: "placements",
    fields: ["fullName", "name", "institution", "course", "department", "status", "type"],
    label(record) {
      return record.fullName || record.name;
    },
  },
  {
    type: "interns",
    module: "nysc_interns",
    permission: "nysc_interns.view",
    collection: "interns",
    fields: ["fullName", "name", "institution", "course", "department", "status"],
    label(record) {
      return record.fullName || record.name;
    },
  },
  {
    type: "nysc",
    module: "nysc_interns",
    permission: "nysc_interns.view",
    collection: "nysc_members",
    fields: ["fullName", "name", "stateCode", "callUpNumber", "institution", "course", "department", "status"],
    label(record) {
      return record.fullName || record.name;
    },
  },
];

function canSearchSource(user, source) {
  return user?.role === "superadmin" || hasPermission(user, source.permission) || hasPermission(user, `${source.module}.manage`);
}

function recordMatches(record, fields, needle) {
  return fields.some((field) => String(record[field] || "").toLowerCase().includes(needle));
}

function getRecordsForSource(source) {
  if (source.type === "users") {
    return listUsers();
  }

  return readCollection(source.collection).filter((record) => !record.deletedAt);
}

function globalSearch(query = {}, user) {
  const search = String(query.q || query.search || "").trim().toLowerCase();
  if (!search) {
    return { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1, sources: [] } };
  }

  const requestedTypes = query.type ? new Set(String(query.type).split(",").map((value) => value.trim())) : null;
  const results = [];
  const sources = [];

  for (const source of SEARCH_SOURCES) {
    if (requestedTypes && !requestedTypes.has(source.type)) {
      continue;
    }
    if (!canSearchSource(user, source)) {
      continue;
    }

    const matches = getRecordsForSource(source)
      .filter((record) => recordMatches(record, source.fields, search))
      .map((record) => ({
        id: record.id,
        type: source.type,
        module: source.module,
        label: source.label(record) || "Untitled",
        description: source.description ? source.description(record) : [record.status, record.department, record.email].filter(Boolean).join(" | "),
        url: `/api/v1/${source.type.replace(/_/g, "-")}/${record.id}`,
        record,
      }));

    if (matches.length > 0) {
      sources.push({ type: source.type, count: matches.length });
      results.push(...matches);
    }
  }

  const paginated = paginate(results, query);
  return { data: paginated.data, meta: { ...paginated.meta, sources } };
}

module.exports = { globalSearch };
