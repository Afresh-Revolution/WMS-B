const notificationService = require("../notifications/notification.service");

function queueNotification({ recipientUserId, recipientEmployeeId, type, title, body, data }) {
  const result = notificationService.send({
    userId: recipientUserId || null,
    recipientUserId: recipientUserId || null,
    recipientEmployeeId: recipientEmployeeId || null,
    type,
    title,
    message: body,
    body,
    data: data || {},
  });
  return result.notification;
}

module.exports = { queueNotification };
