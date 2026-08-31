const crypto = require("crypto");
const { appendRecord, readCollection } = require("../../database/jsonStore");
const { isDatabaseConfigured, query } = require("../_shared/postgres");
const { redactSensitiveData } = require("../_shared/auditService");

let schemaReady = false;
let schemaPromise = null;

async function ensureSchema() {
  if (!isDatabaseConfigured()) {
    return false;
  }
  if (schemaReady) {
    return true;
  }
  if (!schemaPromise) {
    schemaPromise = query(`
      create extension if not exists "pgcrypto";

      create table if not exists technical_audit_logs (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references users(id),
        user_name text,
        action text not null,
        module text not null,
        target text,
        ip_address inet,
        device text,
        browser text,
        request_method text,
        request_path text,
        status text not null default 'success',
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      alter table technical_audit_logs add column if not exists user_name text;
      alter table technical_audit_logs add column if not exists target text;
      alter table technical_audit_logs add column if not exists device text;
      alter table technical_audit_logs add column if not exists browser text;
      alter table technical_audit_logs add column if not exists request_method text;
      alter table technical_audit_logs add column if not exists request_path text;
      alter table technical_audit_logs add column if not exists archived_at timestamptz;
      alter table technical_audit_logs add column if not exists metadata jsonb not null default '{}'::jsonb;

      create index if not exists idx_technical_audit_created_at on technical_audit_logs(created_at desc);
      create index if not exists idx_technical_audit_module_status on technical_audit_logs(module, status, created_at desc);
      create index if not exists idx_technical_audit_user on technical_audit_logs(user_id, created_at desc);
    `)
      .then(() => {
        schemaReady = true;
        return true;
      })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

function normalizeStatus(status, statusCode) {
  const value = String(status || "").toLowerCase();
  if (["success", "failed", "warning"].includes(value)) return value;
  if (["failed", "failure", "error"].includes(value)) return "failed";
  if (statusCode && Number(statusCode) >= 400) return "failed";
  return "success";
}

function parseUserAgent(userAgent = "") {
  const agent = String(userAgent || "");
  const browser =
    /Edg\//.test(agent) ? "Edge" :
    /Chrome\//.test(agent) ? "Chrome" :
    /Firefox\//.test(agent) ? "Firefox" :
    /Safari\//.test(agent) ? "Safari" :
    agent ? "Unknown" : null;
  const device =
    /Windows/i.test(agent) ? "Windows" :
    /Macintosh|Mac OS/i.test(agent) ? "macOS" :
    /Android/i.test(agent) ? "Android" :
    /iPhone|iPad/i.test(agent) ? "iOS" :
    /Linux/i.test(agent) ? "Linux" :
    agent ? "Unknown" : null;
  return { browser, device };
}

function normalizeAction(action) {
  return String(action || "TECHNICAL_EVENT")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function safeIp(value) {
  return value && value.length <= 64 ? value : null;
}

async function recordLog(payload = {}) {
  const req = payload.req || null;
  const user = payload.user || req?.user || null;
  const userAgent = payload.userAgent || req?.get?.("user-agent") || null;
  const agent = parseUserAgent(userAgent);
  const status = normalizeStatus(payload.status, payload.statusCode || req?.res?.statusCode);
  const action = normalizeAction(payload.action);
  const metadata = redactSensitiveData({
    ...(payload.metadata || {}),
    ...(payload.error ? { error: payload.error.publicMessage || payload.error.message } : {}),
  });
  const log = {
    id: crypto.randomUUID(),
    userId: user?.id || payload.userId || null,
    user_id: user?.id || payload.userId || null,
    userName: payload.userName || user?.name || user?.fullName || user?.email || null,
    user_name: payload.userName || user?.name || user?.fullName || user?.email || null,
    action,
    module: payload.module || inferModule(payload.requestPath || req?.originalUrl || req?.path),
    target: payload.target || payload.targetName || payload.targetId || null,
    ipAddress: payload.ipAddress || req?.ip || null,
    ip_address: payload.ipAddress || req?.ip || null,
    device: payload.device || agent.device,
    browser: payload.browser || agent.browser,
    requestMethod: payload.requestMethod || req?.method || null,
    request_method: payload.requestMethod || req?.method || null,
    requestPath: payload.requestPath || req?.originalUrl || req?.path || null,
    request_path: payload.requestPath || req?.originalUrl || req?.path || null,
    status,
    metadata,
    createdAt: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  if (isDatabaseConfigured()) {
    try {
      await ensureSchema();
      const result = await query(
        `insert into technical_audit_logs
          (id, user_id, user_name, action, module, target, ip_address, device, browser,
           request_method, request_path, status, metadata, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
         returning *`,
        [
          log.id,
          log.userId,
          log.userName,
          log.action,
          log.module,
          String(log.target || ""),
          safeIp(log.ipAddress),
          log.device,
          log.browser,
          log.requestMethod,
          log.requestPath,
          log.status,
          JSON.stringify(log.metadata),
          log.createdAt,
        ]
      );
      return mapRow(result.rows[0]);
    } catch (_error) {
      // Keep an audit record in local storage if Postgres is temporarily unavailable.
    }
  }

  return appendRecord("technical_audit_logs", log);
}

async function listLogs(queryParams = {}) {
  if (isDatabaseConfigured()) {
    try {
      await ensureSchema();
      const { where, values } = buildWhere(queryParams);
      const page = Math.max(1, Number(queryParams.page || 1));
      const limit = Math.min(100, Math.max(1, Number(queryParams.limit || 25)));
      const offset = (page - 1) * limit;
      const logs = await query(
        `select * from technical_audit_logs
         ${where}
         order by created_at desc
         limit $${values.length + 1} offset $${values.length + 2}`,
        [...values, limit, offset]
      );
      const count = await query(`select count(*)::int as total from technical_audit_logs ${where}`, values);
      return {
        data: logs.rows.map(mapRow),
        meta: {
          page,
          limit,
          total: count.rows[0]?.total || 0,
          totalPages: Math.max(1, Math.ceil((count.rows[0]?.total || 0) / limit)),
        },
      };
    } catch (_error) {
      // Fallback below.
    }
  }

  const filtered = applyLocalFilters(readCollection("technical_audit_logs"), queryParams);
  const page = Math.max(1, Number(queryParams.page || 1));
  const limit = Math.min(100, Math.max(1, Number(queryParams.limit || 25)));
  const total = filtered.length;
  return {
    data: filtered.slice((page - 1) * limit, page * limit).map(mapRow),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function getLog(id) {
  if (isDatabaseConfigured()) {
    try {
      await ensureSchema();
      const result = await query(`select * from technical_audit_logs where id = $1`, [id]);
      if (result.rows[0]) return mapRow(result.rows[0]);
    } catch (_error) {
      // Fallback below.
    }
  }
  const record = readCollection("technical_audit_logs").find((log) => log.id === id || log.eventId === id || log.event_id === id);
  return record ? mapRow(record) : null;
}

function buildWhere(queryParams = {}) {
  const clauses = [];
  const values = [];
  function add(value, clause) {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  }
  const search = queryParams.search || queryParams.q;
  if (search) {
    const pattern = `%${String(search).toLowerCase()}%`;
    const indexes = [];
    for (let index = 0; index < 5; index += 1) {
      values.push(pattern);
      indexes.push(`$${values.length}`);
    }
    clauses.push(
      `(lower(coalesce(user_name, '')) like ${indexes[0]} or ` +
        `lower(coalesce(action, '')) like ${indexes[1]} or ` +
        `lower(coalesce(module, '')) like ${indexes[2]} or ` +
        `lower(coalesce(ip_address::text, '')) like ${indexes[3]} or ` +
        `lower(coalesce(target, '')) like ${indexes[4]})`
    );
  }
  if (queryParams.module) add(String(queryParams.module), "module = ?");
  if (queryParams.status) add(normalizeStatus(queryParams.status), "lower(status) = lower(?)");
  if (queryParams.action) add(normalizeAction(queryParams.action), "action = ?");
  if (queryParams.ipAddress || queryParams.ip_address) add(String(queryParams.ipAddress || queryParams.ip_address), "ip_address::text = ?");
  const from = datePresetFrom(queryParams.filter || queryParams.datePreset || queryParams.date_filter) || queryParams.dateFrom || queryParams.from;
  if (from) add(new Date(from), "created_at >= ?");
  if (queryParams.dateTo || queryParams.to) add(new Date(queryParams.dateTo || queryParams.to), "created_at <= ?");
  return { where: clauses.length ? `where ${clauses.join(" and ")}` : "", values };
}

function applyLocalFilters(records, queryParams = {}) {
  const search = String(queryParams.search || queryParams.q || "").toLowerCase();
  const from = datePresetFrom(queryParams.filter || queryParams.datePreset || queryParams.date_filter) || queryParams.dateFrom || queryParams.from;
  const to = queryParams.dateTo || queryParams.to;
  return records
    .map(mapRow)
    .filter((log) => {
      if (queryParams.module && String(log.module).toLowerCase() !== String(queryParams.module).toLowerCase()) return false;
      if (queryParams.status && String(log.status).toLowerCase() !== String(queryParams.status).toLowerCase()) return false;
      if (queryParams.action && log.action !== normalizeAction(queryParams.action)) return false;
      if ((queryParams.ipAddress || queryParams.ip_address) && log.ipAddress !== (queryParams.ipAddress || queryParams.ip_address)) return false;
      if (from && new Date(log.createdAt).getTime() < new Date(from).getTime()) return false;
      if (to && new Date(log.createdAt).getTime() > new Date(to).getTime()) return false;
      if (!search) return true;
      return [log.userName, log.action, log.module, log.ipAddress, log.target, log.status]
        .some((value) => String(value || "").toLowerCase().includes(search));
    })
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function datePresetFrom(preset) {
  const normalized = String(preset || "").toLowerCase();
  const now = new Date();
  if (normalized === "today") {
    now.setUTCHours(0, 0, 0, 0);
    return now;
  }
  if (["last_7_days", "7d", "authentication", "security", "backups", "integrations", "system", "failed_events"].includes(normalized)) {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  if (["last_30_days", "30d"].includes(normalized)) {
    return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  return null;
}

function inferModule(path = "") {
  const normalized = String(path || "").toLowerCase();
  if (normalized.includes("backup")) return "Backups";
  if (normalized.includes("security") || normalized.includes("mfa")) return "Security";
  if (normalized.includes("integration")) return "Integrations";
  if (normalized.includes("email") || normalized.includes("smtp")) return "Email";
  if (normalized.includes("notification")) return "Notifications";
  if (normalized.includes("health") || normalized.includes("system")) return "System";
  if (normalized.includes("profile")) return "Profile";
  if (normalized.includes("auth")) return "Authentication";
  return "API";
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || row.userId || row.actor_id || row.actorId || null,
    userName: row.user_name || row.userName || row.actor_name || row.actorName || row.user?.name || row.user?.email || null,
    action: row.action,
    module: row.module || row.service || "API",
    target: row.target || row.target_id || row.targetId || row.target_type || row.targetType || null,
    ipAddress: row.ip_address || row.ipAddress || row.ip || null,
    device: row.device || parseUserAgent(row.user_agent || row.userAgent).device,
    browser: row.browser || parseUserAgent(row.user_agent || row.userAgent).browser,
    requestMethod: row.request_method || row.requestMethod || row.method || null,
    requestPath: row.request_path || row.requestPath || row.endpoint || null,
    status: normalizeStatus(row.status, row.status_code || row.statusCode),
    metadata: row.metadata || {},
    createdAt: row.created_at || row.createdAt || row.timestamp,
  };
}

module.exports = { ensureSchema, getLog, listLogs, recordLog };
