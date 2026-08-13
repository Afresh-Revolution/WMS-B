function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function paginate(records, query = {}) {
  const page = Math.max(1, toNumber(query.page, 1));
  const limit = Math.min(100, Math.max(1, toNumber(query.limit, 25)));
  const total = records.length;
  const start = (page - 1) * limit;

  return {
    data: records.slice(start, start + limit),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

function sortRecords(records, sortBy = "createdAt", sortDirection = "desc") {
  const direction = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;
  return [...records].sort((left, right) => {
    const leftValue = left[sortBy] || "";
    const rightValue = right[sortBy] || "";
    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
}

function isValidDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function applyDateRange(records, query = {}) {
  const from = query.dateFrom || query.from || query.startDate;
  const to = query.dateTo || query.to || query.endDate;

  if (!from && !to) {
    return records;
  }

  return records.filter((record) => {
    const value = record.createdAt || record.date || record.startDate || record.dueDate;
    if (!value || !isValidDate(value)) {
      return false;
    }

    const timestamp = new Date(value).getTime();
    if (from && isValidDate(from) && timestamp < new Date(from).getTime()) {
      return false;
    }

    if (to && isValidDate(to) && timestamp > new Date(to).getTime()) {
      return false;
    }

    return true;
  });
}

function applyBasicFilters(records, query = {}, searchableFields = []) {
  const ignoredKeys = new Set([
    "page",
    "limit",
    "sortBy",
    "sortDirection",
    "q",
    "dateFrom",
    "dateTo",
    "from",
    "to",
    "startDate",
    "endDate",
  ]);
  let filtered = records.filter((record) => !record.deletedAt);

  for (const [key, value] of Object.entries(query)) {
    if (ignoredKeys.has(key) || value === undefined || value === "") {
      continue;
    }

    filtered = filtered.filter((record) => String(record[key] || "") === String(value));
  }

  if (query.q && searchableFields.length > 0) {
    const needle = String(query.q).toLowerCase();
    filtered = filtered.filter((record) =>
      searchableFields.some((field) => String(record[field] || "").toLowerCase().includes(needle))
    );
  }

  return sortRecords(applyDateRange(filtered, query), query.sortBy, query.sortDirection);
}

module.exports = { applyBasicFilters, paginate, sortRecords };
