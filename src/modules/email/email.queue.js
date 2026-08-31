const crypto = require("crypto");
const { appendRecord, readCollection, writeCollection } = require("../../database/jsonStore");

const EMAIL_JOBS_COLLECTION = "email_jobs";
const EMAIL_LOGS_COLLECTION = "email_logs";
const MAX_RETRIES = 3;

function now() {
  return new Date().toISOString();
}

function createEmailLog(payload) {
  return appendRecord(EMAIL_LOGS_COLLECTION, {
    id: crypto.randomUUID(),
    recipient: payload.recipient,
    sender: payload.sender || null,
    subject: payload.subject,
    templateId: payload.templateId || null,
    template_id: payload.templateId || null,
    template: payload.template || null,
    provider: payload.provider || null,
    status: payload.status || "queued",
    messageId: payload.messageId || null,
    message_id: payload.messageId || null,
    errorMessage: payload.errorMessage || null,
    error_message: payload.errorMessage || null,
    retryCount: payload.retryCount || 0,
    retry_count: payload.retryCount || 0,
    queuedAt: payload.queuedAt || now(),
    queued_at: payload.queuedAt || now(),
    sentAt: payload.sentAt || null,
    sent_at: payload.sentAt || null,
    deliveredAt: payload.deliveredAt || null,
    delivered_at: payload.deliveredAt || null,
    createdAt: now(),
    created_at: now(),
    updatedAt: now(),
    updated_at: now(),
  });
}

function updateEmailLog(id, payload) {
  const logs = readCollection(EMAIL_LOGS_COLLECTION);
  const index = logs.findIndex((log) => log.id === id);
  if (index === -1) {
    return null;
  }
  logs[index] = { ...logs[index], ...payload, id, updatedAt: now(), updated_at: now() };
  writeCollection(EMAIL_LOGS_COLLECTION, logs);
  return logs[index];
}

function enqueueEmail(payload) {
  const timestamp = now();
  const log = createEmailLog({
    recipient: Array.isArray(payload.to) ? payload.to.join(",") : payload.to,
    sender: payload.from,
    subject: payload.subject,
    templateId: payload.templateId,
    template: payload.template,
    provider: payload.provider,
    status: "queued",
    queuedAt: timestamp,
  });
  const job = appendRecord(EMAIL_JOBS_COLLECTION, {
    id: crypto.randomUUID(),
    logId: log.id,
    log_id: log.id,
    payload,
    status: "queued",
    retryCount: 0,
    retry_count: 0,
    maxRetries: MAX_RETRIES,
    max_retries: MAX_RETRIES,
    nextRunAt: timestamp,
    next_run_at: timestamp,
    lockedAt: null,
    locked_at: null,
    lastError: null,
    last_error: null,
    createdAt: timestamp,
    created_at: timestamp,
    updatedAt: timestamp,
    updated_at: timestamp,
  });
  return { job, log };
}

function updateJob(id, payload) {
  const jobs = readCollection(EMAIL_JOBS_COLLECTION);
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) {
    return null;
  }
  jobs[index] = { ...jobs[index], ...payload, id, updatedAt: now(), updated_at: now() };
  writeCollection(EMAIL_JOBS_COLLECTION, jobs);
  return jobs[index];
}

function listRunnableJobs(limit = 25) {
  const timestamp = now();
  return readCollection(EMAIL_JOBS_COLLECTION)
    .filter((job) => ["queued", "retrying"].includes(job.status) && (job.nextRunAt || job.next_run_at || timestamp) <= timestamp)
    .slice(0, limit);
}

function getQueueStats() {
  const jobs = readCollection(EMAIL_JOBS_COLLECTION);
  return jobs.reduce(
    (summary, job) => {
      summary.total += 1;
      summary[job.status] = (summary[job.status] || 0) + 1;
      return summary;
    },
    { total: 0, queued: 0, sending: 0, retrying: 0, sent: 0, failed: 0, cancelled: 0 }
  );
}

module.exports = {
  createEmailLog,
  enqueueEmail,
  getQueueStats,
  listRunnableJobs,
  updateEmailLog,
  updateJob,
};
