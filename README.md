# WMS Backend

Express backend for the work management system.

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
- `POST /api/v1/auth/change-password`
- `GET /api/v1/dashboard/overview`
- `GET /api/v1/security/events`
- `GET /api/v1/security/sessions`
- `POST /api/v1/security/users/:id/lock`
- `POST /api/v1/security/users/:id/unlock`
- `POST /api/v1/security/users/:id/force-logout`
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
