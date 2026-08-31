# WMS Backend

Express backend for the work management system.

Role dashboards are backend-only JSON APIs for Super Admin, Manager, HR, Secretary, and Accountant. UI mockups are used as product references for endpoint behavior and permission boundaries.

## Setup

Copy `.env.example` into `.env` and set strong secret values before deploying.

```bash
npm install
npm start
```

On Windows PowerShell, use `npm.cmd start` if script execution is disabled.

Check the database connection:

```bash
npm run db:check
```

Create the local superadmin from `.env`:

```bash
npm run seed:superadmin
```

## Superadmin Auth

Create the first superadmin:

```bash
curl -X POST http://127.0.0.1:3000/api/superadmin/bootstrap ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Main Admin\",\"email\":\"admin@example.com\",\"password\":\"password123\",\"setupToken\":\"replace-with-a-one-time-bootstrap-token\"}"
```

Login:

```bash
curl -X POST http://127.0.0.1:3000/api/superadmin/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@example.com\",\"password\":\"password123\"}"
```

Read current superadmin profile:

```bash
curl http://127.0.0.1:3000/api/superadmin/me ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

Change password:

```bash
curl -X PATCH http://127.0.0.1:3000/api/superadmin/password ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_TOKEN" ^
  -d "{\"currentPassword\":\"password123\",\"newPassword\":\"newPassword123\"}"
```

## Endpoints

- `GET /health`
- `GET /api/superadmin/bootstrap/status`
- `POST /api/superadmin/bootstrap`
- `POST /api/superadmin/login`
- `POST /api/superadmin/logout`
- `GET /api/superadmin/me`
- `PATCH /api/superadmin/password`

## Super Admin Command Center API

The enterprise Super Admin surface is mounted at `/api/v1`. It keeps the legacy auth routes available while adding session-backed login, refresh tokens, failed-login tracking, login history, remote session revocation, RBAC catalogs, operational audits, security views, system health, and module endpoints.

Core routes:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/:id`
- `GET /api/v1/dashboard/overview`
- `GET /api/v1/dashboard/super-admin`
- `GET /api/v1/search?q=term`
- `GET /api/v1/security`
- `GET /api/v1/security/dashboard`
- `GET /api/v1/security/events`
- `GET /api/v1/security/login-attempts`
- `GET /api/v1/security/sessions`
- `PATCH /api/v1/security/password-policy`
- `PATCH /api/v1/security/login-policy`
- `PATCH /api/v1/security/session-policy`
- `PATCH /api/v1/security/mfa`
- `PATCH /api/v1/security/maintenance`
- `POST /api/v1/security/users/:id/unlock`
- `POST /api/v1/security/users/:id/revoke-sessions`
- `POST /api/v1/security/users/:id/mfa`
- `GET /api/v1/security/trusted-devices`
- `DELETE /api/v1/security/trusted-devices/:id`
- `GET /api/admin/security`
- `GET /api/integrations`
- `GET /api/integrations/:provider`
- `POST /api/integrations/:provider/connect`
- `GET /api/integrations/:provider/callback`
- `POST /api/integrations/:provider/disconnect`
- `POST /api/integrations/:provider/test`
- `PUT /api/integrations/:provider/config`
- `POST /api/integrations/slack/message`
- `POST /api/integrations/slack/announcement`
- `POST /api/integrations/google_workspace/calendar/events`
- `POST /api/integrations/zoom/meetings`
- `POST /api/payments/paystack/initialize`
- `GET /api/payments/paystack/verify/:reference`
- `POST /api/payments/paystack/transfer`
- `POST /api/webhooks/paystack`
- `GET /api/admin/email-config`
- `PUT /api/admin/email-config`
- `POST /api/admin/email-config/test`
- `POST /api/admin/email-config/check`
- `PATCH /api/admin/email-config/status`
- `GET /api/admin/email-config/templates`
- `POST /api/admin/email-config/templates`
- `GET /api/admin/email-config/logs`
- `POST /api/admin/email-config/queue/process`
- `GET /api/admin/notification-config`
- `PATCH /api/admin/notification-config/channels`
- `PATCH /api/admin/notification-config/delivery-preferences`
- `GET /api/admin/notification-config/rules`
- `PUT /api/admin/notification-config/rules/:type`
- `GET /api/admin/notification-config/logs`
- `POST /api/admin/notification-config/queue/process`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`
- `DELETE /api/notifications/:id`
- `GET /api/notifications/preferences`
- `PATCH /api/notifications/preferences`
- `GET /api/v1/system/health`
- `GET /api/v1/system/settings`
- `GET /api/v1/system/backups`
- `POST /api/v1/system/backups`
- `POST /api/v1/system/backups/:id/restore`
- `GET /api/v1/roles/catalog`
- `GET /api/v1/permissions/catalog`

Enterprise modules are exposed with list/create/view/update/delete routes and audited item actions where applicable:

- `/api/v1/employers` - Super Admin Staff Directory / Workforce Management
- `/api/v1/employees`
- `/api/v1/interns`
- `/api/v1/nysc`
- `/api/v1/departments` - Super Admin Department Management
- `/api/v1/leave`
- `/api/v1/salary-increments`
- `/api/v1/promotions`
- `/api/v1/meetings`
- `/api/v1/tasks`
- `/api/v1/targets`
- `/api/v1/payroll`
- `/api/v1/purchases`
- `/api/v1/bills`
- `/api/v1/expenses`
- `/api/v1/vendors`
- `/api/v1/events`
- `/api/v1/discipline`
- `/api/v1/announcements`
- `/api/v1/reports`
- `/api/v1/accountant`
- `/api/v1/users`
- `/api/v1/roles`
- `/api/v1/permissions`
- `/api/v1/integrations`
- `/api/v1/email-configurations`
- `/api/v1/notification-configurations`
- `/api/v1/document-templates`
- `/api/v1/backups`
- `/api/v1/system-health`
- `/api/v1/operational-audit`
- `/api/v1/technical-audit`
- `/api/v1/help`

All list endpoints support `page`, `limit`, `q`, field filters, `sortBy`, `sortDirection`, `dateFrom`, and `dateTo`.

The PostgreSQL architecture blueprint is in `src/database/schema.sql`. It defines UUID primary keys, timestamps, core access tables, organization/workforce/HR/operations/finance/system tables, immutable audit-log tables, indexes, and soft-delete columns for records that must not be permanently removed.

The Prisma production schema is in `prisma/schema.prisma`. The current runtime still uses the local JSON store for dependency-light development and tests; the Prisma schema and SQL schema are the migration contract for PostgreSQL.

Seed default roles and permissions:

```bash
npm run seed:rbac
```

Architecture notes and the JSON-store-to-Prisma migration path are in `docs/backend-architecture.md`.

## Roles & Permissions

Top-level RBAC routes:

- `GET /api/v1/roles`
- `GET /api/v1/roles/:id`
- `POST /api/v1/roles`
- `PATCH /api/v1/roles/:id`
- `DELETE /api/v1/roles/:id`
- `GET /api/v1/permissions`
- `GET /api/v1/roles/:id/permissions`
- `PUT /api/v1/roles/:id/permissions`

Role permission changes validate permission keys, protect the Super Admin role, create technical audit events, and record permission-cache invalidation markers.

## Global Search

`GET /api/v1/search?q=term` searches users, employees, departments, tasks, meetings, vendors, bills, expenses, announcements, events, and NYSC/intern records. Results are permission-aware; non-Super Admin users only receive resources their backend permissions allow them to view.

## Staff Directory

`/api/v1/employers` is the Super Admin workforce directory. In this codebase, "employers" means everyone the organization manages, not a public employer portal.

Directory features:

- `GET /api/v1/employers` returns paginated staff cards/list rows from employees, interns, NYSC members, managers, administrators, and other authorized staff.
- Search is server-side through `search` or `q`.
- Filters include `department`, `position`, `status`, `employment_type`, `location`, `branch`, `manager`, `role`, and `staff_type`.
- `view=grid` and `view=list` are both supported in the API response metadata.
- Dynamic category filters are returned in `meta.filters` from stored departments, positions, staff categories, and staff records.

Staff actions:

- `POST /api/v1/employers` creates an employee, intern, NYSC member, administrator, manager, or other staff record.
- Staff records and login accounts are separated. A staff record can exist without a user account.
- Optional `systemAccess` creates a user account with a hashed temporary password and force-reset support.
- `GET /api/v1/employers/:id` returns the complete staff profile, including overview, employment history, attendance, leave, salary history, promotions, tasks, targets, meetings, documents, discipline, activity, and login/security.
- `PATCH /api/v1/employers/:id` updates profile data and records history.
- `POST /api/v1/employers/:id/deactivate`
- `POST /api/v1/employers/:id/activate`
- `POST /api/v1/employers/:id/suspend`
- `POST /api/v1/employers/:id/terminate` requires `confirmation: "TERMINATE STAFF"`.
- `POST /api/v1/employers/:id/transfer`
- `POST /api/v1/employers/:id/promote`
- `POST /api/v1/employers/:id/department`
- `POST /api/v1/employers/:id/manager`
- `POST /api/v1/employers/:id/role`
- `POST /api/v1/employers/:id/reset-password`
- `POST /api/v1/employers/:id/force-logout`
- `GET /api/v1/employers/:id/documents`
- `POST /api/v1/employers/:id/documents`
- `GET /api/v1/employers/:id/activity`
- `GET /api/v1/employers/:id/login-history`
- `GET /api/v1/employers/export`
- `POST /api/v1/employers/import`
- `POST /api/v1/employers/bulk`

Every important Staff Directory action writes an operational audit record and a staff activity record.

## Departments

`/api/v1/departments` is the Super Admin organizational department module. Departments are dynamic records, not hard-coded UI categories.

Department dashboard:

- `GET /api/v1/departments` returns department cards with HOD, active headcount, staff-type counts, target achievement, and summary cards in `meta.summary`.
- `filter=active` returns active departments.
- `filter=no_hod` returns active departments where no valid active HOD is assigned.
- Search is server-side through `search` or `q`.
- Sorting supports normal fields plus calculated fields such as `headcount`, `targetAchievement`, and `expenses`.

Department actions:

- `POST /api/v1/departments`
- `GET /api/v1/departments/:id`
- `GET /api/v1/departments/:id/overview`
- `PATCH /api/v1/departments/:id`
- `DELETE /api/v1/departments/:id`
- `POST /api/v1/departments/:id/activate`
- `POST /api/v1/departments/:id/deactivate`
- `POST /api/v1/departments/:id/hod`
- `DELETE /api/v1/departments/:id/hod`
- `POST /api/v1/departments/:id/assistant-hod`

Department relationship feeds:

- `GET /api/v1/departments/:id/employees`
- `GET /api/v1/departments/:id/interns`
- `GET /api/v1/departments/:id/nysc`
- `GET /api/v1/departments/:id/tasks`
- `GET /api/v1/departments/:id/targets`
- `GET /api/v1/departments/:id/leave`
- `GET /api/v1/departments/:id/payroll`
- `GET /api/v1/departments/:id/expenses`
- `GET /api/v1/departments/:id/purchases`
- `GET /api/v1/departments/:id/meetings`
- `GET /api/v1/departments/:id/events`
- `GET /api/v1/departments/:id/reports`
- `GET /api/v1/departments/:id/activity`

HOD and assistant HOD assignment requires an existing active employee. Deactivation with active members returns a confirmation response unless the request includes `confirmation: "DEACTIVATE DEPARTMENT"`. Employees are never deleted automatically.

## User Access

`/api/v1/users` is the Super Admin User Access module for account provisioning, roles, permissions, departments, session control, status changes, and account security.

Account types:

- `SUPER_ADMIN`
- `ADMIN`
- `STAFF`

User Access routes:

- `GET /api/v1/users/statistics`
- `GET /api/v1/users`
- `POST /api/v1/users`
- `GET /api/v1/users/:id`
- `PATCH /api/v1/users/:id`
- `PUT /api/v1/users/:id`
- `DELETE /api/v1/users/:id`
- `POST /api/v1/users/:id/lock`
- `POST /api/v1/users/:id/unlock`
- `POST /api/v1/users/:id/deactivate`
- `POST /api/v1/users/:id/reactivate`
- `POST /api/v1/users/:id/suspend`
- `POST /api/v1/users/:id/reset-password`
- `POST /api/v1/users/:id/force-password-change`
- `POST /api/v1/users/:id/revoke-sessions`
- `GET /api/v1/users/:id/sessions`
- `DELETE /api/v1/users/:id/sessions/:sessionId`
- `GET /api/v1/users/:id/login-history`
- `GET /api/v1/users/:id/activity`

Security behavior:

- User records never return `passwordHash`, refresh-token hashes, reset tokens, or activation tokens.
- Created accounts receive hashed temporary credentials and `mustChangePassword`.
- Super Admin security settings persist password, login lockout, session, MFA, trusted device, and maintenance policies.
- Password updates are validated against the active policy and password history before hashing.
- Login attempts and security events are stored for dashboard metrics and audit review.
- MFA-enabled logins return an MFA challenge before issuing session tokens.
- Session timeout, concurrent-session limits, admin revocation, and revoke reasons are enforced by the session store.
- Maintenance mode blocks non-Super Admin authenticated API access with a `503` response.
- Users with `mustChangePassword` can only access auth/self-service routes until they change password.
- Lock, deactivate, suspend, and reset-password actions revoke active sessions.
- Super Admin accounts can only be created or modified by Super Admin.
- A user cannot lock, deactivate, or delete their own account through normal User Access routes.
- Login failures are tracked and accounts lock after the configured failed-attempt threshold.
- User Access actions write append-only operational audit records and user activity records.

## Integrations

`/api/integrations` and `/api/v1/integrations` expose Slack, Google Workspace, Paystack, and Zoom connection management. OAuth providers return authorization URLs from `POST /:provider/connect`, validate callback state, encrypt stored tokens, and never return credentials in API responses.

Integration behavior:

- Credentials are encrypted with `ENCRYPTION_KEY` before persistence.
- `GET /api/integrations` is the source of truth for frontend card status.
- Slack message/announcement, Google Calendar/Meet, Zoom meeting, and Paystack payment services are reusable from other modules.
- Virtual meeting creation can create Google Meet or Zoom meetings when the selected provider is active.
- Paystack webhooks verify `x-paystack-signature`, update payment state, and ignore duplicate events.
- Important integration actions write `integration_logs` and Operational Audit records.

## Email Configuration

`/api/admin/email-config`, `/api/v1/email-config`, `/api/v1/email-configurations`, and `/api/v1/email` expose the centralized outbound email control plane. The module supports Postmark and SMTP, encrypted credentials, status checks, test sends, templates, queue processing, delivery logs, and audit records.

Email behavior:

- SMTP passwords, Postmark/API keys, and encrypted credential values are never returned to the frontend.
- `EmailService.sendEmail()` is the central path for application emails, including password-reset requests.
- Emails are queued by default and processed through `email_jobs`; failed deliveries retry up to three times before becoming `failed`.
- Disabled email service records delivery attempts as cancelled/skipped instead of sending.
- Email config changes, checks, status toggles, template changes, and test sends write Operational and Technical Audit records.

## Notification Configuration

`/api/admin/notification-config`, `/api/v1/notification-config`, and `/api/v1/notification-configurations` control organization-wide notification channels, rules, daily digest, quiet hours, delivery logs, and queue processing. `/api/notifications` and `/api/v1/notifications` power the user notification bell, read/unread state, deletion, and personal preferences.

Notification behavior:

- `NotificationService.send()` is the central path for in-app, email, and SMS notifications.
- Global channels, notification rules, and user preferences decide final delivery channels.
- Email notifications call the central Email Service; SMS calls the SMS provider adapter.
- Quiet hours delay normal/low priority external delivery; urgent/high notifications can still be delivered.
- Delivery attempts write `notification_delivery_logs` and queue work writes `notification_jobs`.
- Users can only read/delete their own notifications unless granted organization-wide notification permissions.
