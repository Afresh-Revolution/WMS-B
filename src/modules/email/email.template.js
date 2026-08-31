const DEFAULT_EMAIL_TEMPLATES = Object.freeze([
  ["welcome", "Welcome email", "Welcome to Afresh", "<p>Hello {{employeeName}}, welcome to Afresh.</p>"],
  ["password-reset", "Password reset", "Reset your Afresh password", "<p>Use this link to reset your password: {{resetLink}}</p>"],
  ["leave-request-submitted", "Leave request submitted", "New Leave Request - {{employeeName}}", "<p>{{employeeName}} submitted {{leaveType}} from {{startDate}} to {{endDate}}.</p>"],
  ["leave-approved", "Leave approved", "Leave request approved", "<p>Your leave request has been approved.</p>"],
  ["leave-rejected", "Leave rejected", "Leave request rejected", "<p>Your leave request has been rejected.</p>"],
  ["meeting-invitation", "Meeting invitation", "Meeting invitation: {{title}}", "<p>You have been invited to {{title}}.</p>"],
  ["meeting-reminder", "Meeting reminder", "Reminder: {{title}}", "<p>{{title}} starts soon.</p>"],
  ["task-assigned", "Task assigned", "New task assigned: {{title}}", "<p>You have been assigned {{title}}.</p>"],
  ["task-completed", "Task completed", "Task completed: {{title}}", "<p>{{title}} has been completed.</p>"],
  ["payroll-processed", "Payroll processed", "Payroll processed", "<p>Payroll has been processed.</p>"],
  ["payslip-available", "Payslip available", "Your payslip is available", "<p>Your payslip is available in Afresh.</p>"],
  ["purchase-request-submitted", "Purchase request submitted", "Purchase request submitted", "<p>A purchase request needs review.</p>"],
  ["purchase-request-approved", "Purchase request approved", "Purchase request approved", "<p>Your purchase request has been approved.</p>"],
  ["bill-approved", "Bill approved", "Bill approved", "<p>A bill has been approved.</p>"],
  ["expense-approved", "Expense approved", "Expense approved", "<p>Your expense has been approved.</p>"],
  ["announcement", "Announcement", "{{title}}", "<p>{{body}}</p>"],
  ["disciplinary-action-notification", "Disciplinary action notification", "Disciplinary action notice", "<p>Please review the disciplinary action notice in Afresh.</p>"],
  ["nysc-intern-onboarding", "NYSC/Intern onboarding", "Welcome to Afresh", "<p>Hello {{fullName}}, your onboarding has started.</p>"],
  ["event-notification", "Event notification", "Event: {{title}}", "<p>{{title}} is coming up.</p>"],
]);

function render(template, data = {}) {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = key.split(".").reduce((current, part) => (current && current[part] !== undefined ? current[part] : undefined), data);
    return value === undefined || value === null ? "" : String(value);
  });
}

module.exports = { DEFAULT_EMAIL_TEMPLATES, render };
