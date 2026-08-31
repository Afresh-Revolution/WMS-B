const { isDatabaseConfigured, query, withClient } = require("../_shared/postgres");

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

      create table if not exists system_health_checks (
        id uuid primary key default gen_random_uuid(),
        service_name text not null,
        service_type text not null,
        status text not null check (status in ('operational', 'degraded', 'down', 'unknown')),
        response_time_ms integer,
        error_message text,
        checked_at timestamptz not null default now(),
        created_at timestamptz not null default now()
      );

      create table if not exists infrastructure_metrics (
        id uuid primary key default gen_random_uuid(),
        cpu_percent numeric(5,2) not null,
        memory_percent numeric(5,2) not null,
        disk_percent numeric(5,2) not null,
        recorded_at timestamptz not null default now()
      );

      create table if not exists api_metrics (
        id uuid primary key default gen_random_uuid(),
        route text not null,
        method text not null,
        status_code integer not null,
        response_time_ms integer not null,
        created_at timestamptz not null default now()
      );

      create table if not exists user_sessions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references users(id),
        session_token_hash text not null unique,
        last_activity timestamptz not null default now(),
        expires_at timestamptz not null,
        ip_address inet,
        user_agent text,
        created_at timestamptz not null default now()
      );

      create table if not exists worker_heartbeats (
        worker_name text primary key,
        last_heartbeat_at timestamptz not null default now(),
        metadata jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_system_health_checks_service_time
        on system_health_checks(service_name, checked_at desc);
      create index if not exists idx_system_health_checks_time
        on system_health_checks(checked_at desc);
      create index if not exists idx_infrastructure_metrics_time
        on infrastructure_metrics(recorded_at desc);
      create index if not exists idx_api_metrics_time
        on api_metrics(created_at desc);
      create index if not exists idx_user_sessions_activity
        on user_sessions(last_activity, expires_at);
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

async function recordApiMetric({ route, method, statusCode, responseTimeMs }) {
  await ensureSchema();
  await query(
    `insert into api_metrics (route, method, status_code, response_time_ms)
     values ($1, $2, $3, $4)`,
    [route || "unknown", method, statusCode, responseTimeMs]
  );
}

async function getPreviousServiceStatus(serviceName) {
  await ensureSchema();
  const result = await query(
    `select status from system_health_checks
     where service_name = $1
     order by checked_at desc
     limit 1`,
    [serviceName]
  );
  return result.rows[0]?.status || null;
}

async function recordHealthCheck(check) {
  await ensureSchema();
  const result = await query(
    `insert into system_health_checks
      (service_name, service_type, status, response_time_ms, error_message, checked_at)
     values ($1, $2, $3, $4, $5, now())
     returning *`,
    [
      check.serviceName,
      check.serviceType,
      check.status,
      check.responseTimeMs ?? null,
      check.errorMessage || null,
    ]
  );
  return result.rows[0];
}

async function recordInfrastructureMetric(metric) {
  await ensureSchema();
  const result = await query(
    `insert into infrastructure_metrics (cpu_percent, memory_percent, disk_percent)
     values ($1, $2, $3)
     returning *`,
    [metric.cpuPercent, metric.memoryPercent, metric.diskPercent]
  );
  return result.rows[0];
}

async function recordHeartbeat(workerName, metadata = {}) {
  await ensureSchema();
  await query(
    `insert into worker_heartbeats (worker_name, last_heartbeat_at, metadata, updated_at)
     values ($1, now(), $2::jsonb, now())
     on conflict (worker_name)
     do update set last_heartbeat_at = excluded.last_heartbeat_at,
                   metadata = excluded.metadata,
                   updated_at = excluded.updated_at`,
    [workerName, JSON.stringify(metadata)]
  );
}

function intervalForRange(range = "24h") {
  const normalized = String(range || "24h").toLowerCase();
  if (["7d", "7days", "7_days"].includes(normalized)) return "7 days";
  if (["30d", "30days", "30_days"].includes(normalized)) return "30 days";
  if (["90d", "90days", "90_days"].includes(normalized)) return "90 days";
  return "24 hours";
}

async function getDashboard(range = "24h") {
  await ensureSchema();
  const interval = intervalForRange(range);

  return withClient(async (client) => {
    const [
      uptime,
      services,
      latency,
      activeUserSessions,
      activeLegacySessions,
      latestInfrastructure,
      infrastructureHistory,
      responseTimes,
    ] = await Promise.all([
      client.query(
        `select count(*)::int as total,
                count(*) filter (where status = 'operational')::int as successful
         from system_health_checks
         where checked_at >= now() - $1::interval`,
        [interval]
      ),
      client.query(
        `select distinct on (service_name)
                id, service_name, service_type, status, response_time_ms, error_message, checked_at, created_at
         from system_health_checks
         order by service_name, checked_at desc`
      ),
      client.query(
        `select coalesce(round(avg(response_time_ms))::int, 0) as average_latency_ms
         from api_metrics
         where created_at >= now() - $1::interval`,
        [interval]
      ),
      client.query(
        `select count(*)::int as count
         from user_sessions
         where last_activity > now() - interval '30 minutes'
           and expires_at > now()`,
      ),
      client.query(
        `select count(*)::int as count
         from sessions
         where status = 'active'
           and coalesce(last_used_at, last_seen_at, updated_at, created_at) > now() - interval '30 minutes'
           and (expires_at is null or expires_at > now())`
      ).catch(() => ({ rows: [{ count: 0 }] })),
      client.query(
        `select id, cpu_percent, memory_percent, disk_percent, recorded_at
         from infrastructure_metrics
         order by recorded_at desc
         limit 1`
      ),
      client.query(
        `select id, cpu_percent, memory_percent, disk_percent, recorded_at
         from infrastructure_metrics
         where recorded_at >= now() - $1::interval
         order by recorded_at desc
         limit 120`,
        [interval]
      ),
      client.query(
        `select service_name, response_time_ms, checked_at
         from system_health_checks
         where checked_at >= now() - $1::interval
         order by checked_at desc
         limit 100`,
        [interval]
      ),
    ]);

    const uptimeRow = uptime.rows[0] || { total: 0, successful: 0 };
    const serviceRows = services.rows;
    const healthyCount = serviceRows.filter((service) => service.status === "operational").length;
    const totalServices = serviceRows.length;
    const latestInfra = latestInfrastructure.rows[0] || null;
    const averageLatencyMs = latency.rows[0]?.average_latency_ms || 0;

    return {
      uptime: {
        range,
        percent: uptimeRow.total ? Number(((uptimeRow.successful / uptimeRow.total) * 100).toFixed(2)) : 0,
        successfulChecks: uptimeRow.successful,
        totalChecks: uptimeRow.total,
      },
      healthyServices: {
        healthy: healthyCount,
        total: totalServices,
        label: `${healthyCount}/${totalServices}`,
      },
      activeSessions: Number(activeUserSessions.rows[0]?.count || 0) + Number(activeLegacySessions.rows[0]?.count || 0),
      averageApiLatencyMs: averageLatencyMs,
      services: serviceRows.map(mapHealthCheck),
      infrastructure: latestInfra ? mapInfrastructure(latestInfra) : null,
      infrastructureHistory: infrastructureHistory.rows.map(mapInfrastructure),
      serviceResponseTimes: responseTimes.rows.map((row) => ({
        serviceName: row.service_name,
        responseTimeMs: row.response_time_ms,
        checkedAt: row.checked_at,
      })),
    };
  });
}

async function listServices() {
  await ensureSchema();
  const result = await query(
    `select distinct on (service_name)
            id, service_name, service_type, status, response_time_ms, error_message, checked_at, created_at
     from system_health_checks
     order by service_name, checked_at desc`
  );
  return result.rows.map(mapHealthCheck);
}

async function listInfrastructure(range = "24h") {
  await ensureSchema();
  const result = await query(
    `select id, cpu_percent, memory_percent, disk_percent, recorded_at
     from infrastructure_metrics
     where recorded_at >= now() - $1::interval
     order by recorded_at desc
     limit 500`,
    [intervalForRange(range)]
  );
  return result.rows.map(mapInfrastructure);
}

async function listApiMetrics(range = "24h") {
  await ensureSchema();
  const result = await query(
    `select route, method, count(*)::int as request_count,
            round(avg(response_time_ms))::int as average_response_time_ms,
            max(response_time_ms)::int as max_response_time_ms,
            min(response_time_ms)::int as min_response_time_ms
     from api_metrics
     where created_at >= now() - $1::interval
     group by route, method
     order by request_count desc, average_response_time_ms desc`,
    [intervalForRange(range)]
  );
  return result.rows.map((row) => ({
    route: row.route,
    method: row.method,
    requestCount: row.request_count,
    averageResponseTimeMs: row.average_response_time_ms,
    maxResponseTimeMs: row.max_response_time_ms,
    minResponseTimeMs: row.min_response_time_ms,
  }));
}

async function getWorkerHeartbeat(workerName) {
  await ensureSchema();
  const result = await query(
    `select worker_name, last_heartbeat_at, metadata
     from worker_heartbeats
     where worker_name = $1`,
    [workerName]
  );
  return result.rows[0] || null;
}

function mapHealthCheck(row) {
  return {
    id: row.id,
    serviceName: row.service_name,
    serviceType: row.service_type,
    status: row.status,
    responseTimeMs: row.response_time_ms,
    errorMessage: row.error_message,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  };
}

function mapInfrastructure(row) {
  return {
    id: row.id,
    cpuPercent: Number(row.cpu_percent),
    memoryPercent: Number(row.memory_percent),
    diskPercent: Number(row.disk_percent),
    recordedAt: row.recorded_at,
  };
}

module.exports = {
  ensureSchema,
  getDashboard,
  getPreviousServiceStatus,
  getWorkerHeartbeat,
  listApiMetrics,
  listInfrastructure,
  listServices,
  recordApiMetric,
  recordHealthCheck,
  recordHeartbeat,
  recordInfrastructureMetric,
};
