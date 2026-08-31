const repository = require("./repository");

function createHttpError(statusCode, message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  error.details = details;
  return error;
}

function assertSuperAdmin(user) {
  if (user?.role !== "superadmin") {
    throw createHttpError(403, "Forbidden.", "FORBIDDEN");
  }
}

async function listLogs(user, query = {}) {
  assertSuperAdmin(user);
  return repository.listLogs(normalizeFilter(query));
}

async function searchLogs(user, query = {}) {
  assertSuperAdmin(user);
  return repository.listLogs({ ...query, search: query.search || query.q || "" });
}

async function getLog(id, user) {
  assertSuperAdmin(user);
  return repository.getLog(id);
}

async function exportLogs(user, query = {}, requestContext = {}) {
  assertSuperAdmin(user);
  const format = String(query.format || "csv").toLowerCase();
  if (!["csv", "xlsx", "excel", "pdf", "json"].includes(format)) {
    throw createHttpError(400, "Unsupported technical audit export format.", "UNSUPPORTED_AUDIT_EXPORT_FORMAT");
  }
  const result = await repository.listLogs({ ...normalizeFilter(query), limit: 100 });
  await repository.recordLog({
    user,
    action: "TECHNICAL_AUDIT_LOGS_EXPORTED",
    module: "Technical Audit",
    target: "technical_audit_logs",
    status: "success",
    metadata: { format, exportedRows: result.data.length, filters: query },
    ...requestContext,
  });
  if (format === "json") {
    return { format, contentType: "application/json; charset=utf-8", filename: "technical-audit-logs.json", content: JSON.stringify(result.data, null, 2) };
  }
  if (format === "pdf") {
    return { format, contentType: "application/pdf", filename: "technical-audit-logs.pdf", content: toPdf(result.data) };
  }
  if (format === "xlsx" || format === "excel") {
    return {
      format: "xls",
      contentType: "application/vnd.ms-excel; charset=utf-8",
      filename: "technical-audit-logs.xls",
      content: toExcelHtml(result.data),
    };
  }
  return {
    format,
    contentType: "text/csv; charset=utf-8",
    filename: `technical-audit-logs.${format}`,
    content: toCsv(result.data),
  };
}

function normalizeFilter(query = {}) {
  const filter = String(query.filter || query.category || "").toLowerCase();
  const normalized = { ...query };
  if (filter === "authentication") normalized.module = "Authentication";
  if (filter === "security") normalized.module = "Security";
  if (filter === "backups") normalized.module = "Backups";
  if (filter === "integrations") normalized.module = "Integrations";
  if (filter === "system") normalized.module = "System";
  if (filter === "failed_events") normalized.status = "failed";
  return normalized;
}

function toCsv(logs) {
  const headers = [
    "id",
    "userName",
    "action",
    "module",
    "target",
    "status",
    "ipAddress",
    "browser",
    "device",
    "requestMethod",
    "requestPath",
    "createdAt",
  ];
  return [headers, ...logs.map((log) => headers.map((header) => log[header] || ""))]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function toPlainTextReport(logs) {
  const lines = ["Technical Audit Logs", `Generated: ${new Date().toISOString()}`, ""];
  for (const log of logs) {
    lines.push(`${log.createdAt} ${log.status.toUpperCase()} ${log.module} ${log.action} ${log.userName || "System"}`);
  }
  return lines.join("\n");
}

function toExcelHtml(logs) {
  const headers = ["Timestamp", "User", "Action", "Module", "Target", "Status", "IP", "Browser", "Device"];
  const rows = logs.map((log) => [
    log.createdAt,
    log.userName,
    log.action,
    log.module,
    log.target,
    log.status,
    log.ipAddress,
    log.browser,
    log.device,
  ]);
  return [
    "<html><head><meta charset=\"utf-8\"></head><body><table>",
    `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`,
    ...rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell || "")}</td>`).join("")}</tr>`),
    "</table></body></html>",
  ].join("");
}

function toPdf(logs) {
  const text = toPlainTextReport(logs).split("\n").slice(0, 45);
  const lines = text.map((line, index) => `BT /F1 10 Tf 50 ${760 - index * 14} Td (${escapePdf(line)}) Tj ET`).join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(lines)} >> stream\n${lines}\nendstream endobj`,
  ];
  let offset = "%PDF-1.4\n".length;
  const xref = ["0000000000 65535 f "];
  const body = objects.map((object) => {
    xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
    offset += Buffer.byteLength(`${object}\n`);
    return object;
  }).join("\n") + "\n";
  const trailerOffset = offset;
  const pdf = `%PDF-1.4\n${body}xref\n0 ${xref.length}\n${xref.join("\n")}\ntrailer << /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${trailerOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapePdf(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

module.exports = { exportLogs, getLog, listLogs, searchLogs };
