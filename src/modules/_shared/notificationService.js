const crypto = require("crypto");
const { appendRecord } = require("../../database/jsonStore");

function queueNotification({ recipientUserId, recipientEmployeeId, type, title, body, data }) {
  return appendRecord("notifications", {
    id: crypto.randomUUID(),
    recipientUserId: recipientUserId || null,
    recipientEmployeeId: recipientEmployeeId || null,
    type: type || "in_app",
    title,
    body,
    data: data || {},
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

module.exports = { queueNotification };
