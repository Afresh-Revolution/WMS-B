# Super Admin API Endpoints

This file lists the backend endpoints available to the Super Admin dashboard.

Default API base: `/api/v1`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Most Super Admin dashboard routes require an authenticated user with `role = superadmin`. Some shared routes use permission checks, but Super Admin bypasses permission restrictions.

## Public Health

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Basic API liveness |
| GET | `/health/database` | Database health |
| GET | `/health/redis` | Redis health placeholder |
| GET | `/health/email` | Email service health |
| GET | `/health/storage` | Storage health |

## Authentication

Primary auth endpoints are mounted at `/api/v1/auth`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/auth/bootstrap/status` | Check whether Super Admin setup is complete |
| POST | `/api/v1/auth/bootstrap` | Create the first Super Admin |
| POST | `/api/v1/auth/login` | Shared login for every workspace role, including Super Admin |
| GET | `/api/v1/auth/login-options` | Public login-page options for the shared sign-in screen |
| POST | `/api/v1/auth/mfa/verify` | Verify MFA challenge |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Logout current session |
| GET | `/api/v1/auth/me` | Current authenticated user |
| GET | `/api/v1/auth/superadmin/me` | Current Super Admin profile |
| POST | `/api/v1/auth/change-password` | Change own password |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| POST | `/api/v1/auth/reset-password` | Reset password with token |
| GET | `/api/v1/auth/sessions` | List own sessions |
| DELETE | `/api/v1/auth/sessions/:id` | Revoke one own session |

Legacy Super Admin auth aliases are mounted at `/api/superadmin`:

| Method | Endpoint |
| --- | --- |
| GET | `/api/superadmin/bootstrap/status` |
| POST | `/api/superadmin/bootstrap` |
| POST | `/api/superadmin/login` |
| POST | `/api/superadmin/refresh` |
| POST | `/api/superadmin/logout` |
| GET | `/api/superadmin/me` |
| PATCH | `/api/superadmin/password` |
| POST | `/api/superadmin/change-password` |

## Dashboard

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/dashboard/overview` | Full Super Admin dashboard overview |
| GET | `/api/v1/dashboard/super-admin` | Super Admin summary cards and system status |
| GET | `/api/v1/health` | API v1 system health summary |

## Super Admin Dashboard Namespace

Mounted at `/api/v1/super-admin` with the same dashboard modules shown in the Super Admin Figma board. These routes require `role = superadmin`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/super-admin/dashboard` | Full Super Admin dashboard overview, metrics, charts, security summary, system status, and navigation |
| GET | `/api/v1/super-admin/dashboard/stats` | Super Admin dashboard metric counts only |
| GET | `/api/v1/super-admin/navigation` | Return Super Admin navigation keys |
| GET | `/api/v1/super-admin/modules` | Return Super Admin module directory with route metadata |
| GET | `/api/v1/super-admin/modules/:key` | Return one Super Admin module definition |
| GET | `/api/v1/super-admin/settings` | Alias for Super Admin system settings |
| PATCH | `/api/v1/super-admin/settings` | Alias for updating Super Admin system settings |
| GET | `/api/v1/super-admin/status` | Alias for system maintenance status |
| GET | `/api/v1/super-admin/health` | Alias for Super Admin system health |

The same namespace is also available at `/api/super-admin` for legacy frontend clients. Super Admin signs in through the shared login page at `POST /api/v1/auth/login`, the same endpoint used by every other role. The existing `/api/superadmin` auth routes remain as legacy Super Admin-only aliases.

The namespace reuses the same underlying services as the primary `/api/v1` routes. For example:

| Super Admin namespace | Primary route |
| --- | --- |
| `/api/v1/super-admin/users` | `/api/v1/users` |
| `/api/v1/super-admin/roles` | `/api/v1/roles` |
| `/api/v1/super-admin/permissions` | `/api/v1/permissions` |
| `/api/v1/super-admin/security` | `/api/v1/security` |
| `/api/v1/super-admin/system-management` | `/api/v1/system-management` |
| `/api/v1/super-admin/system-health` | `/api/v1/system-health` |
| `/api/v1/super-admin/backups` | `/api/v1/backups` |
| `/api/v1/super-admin/technical-audit-logs` | `/api/v1/technical-audit-logs` |
| `/api/v1/super-admin/audit-logs` | `/api/v1/audit-logs` |
| `/api/v1/super-admin/profile` | `/api/v1/profile` |
| `/api/v1/super-admin/employers` | `/api/v1/employers` |
| `/api/v1/super-admin/departments` | `/api/v1/departments` |
| `/api/v1/super-admin/leave` | `/api/v1/leave` |
| `/api/v1/super-admin/meetings` | `/api/v1/meetings` |
| `/api/v1/super-admin/tasks` | `/api/v1/tasks` |
| `/api/v1/super-admin/targets` | `/api/v1/targets` |
| `/api/v1/super-admin/payroll` | `/api/v1/payroll` |
| `/api/v1/super-admin/purchases` | `/api/v1/purchases` |
| `/api/v1/super-admin/purchase-requests` | `/api/v1/purchase-requests` |
| `/api/v1/super-admin/bills` | `/api/v1/bills` |
| `/api/v1/super-admin/expenses` | `/api/v1/expenses` |
| `/api/v1/super-admin/vendors` | `/api/v1/vendors` |
| `/api/v1/super-admin/events` | `/api/v1/events` |
| `/api/v1/super-admin/discipline` | `/api/v1/discipline` |
| `/api/v1/super-admin/nysc-interns` | `/api/v1/nysc-interns` |
| `/api/v1/super-admin/announcements` | `/api/v1/announcements` |
| `/api/v1/super-admin/reports` | `/api/v1/reports` |
| `/api/v1/super-admin/integrations` | `/api/v1/integrations` |
| `/api/v1/super-admin/email-config` | `/api/v1/email-config` |
| `/api/v1/super-admin/notification-config` | `/api/v1/notification-config` |
| `/api/v1/super-admin/notifications` | `/api/v1/notifications` |
| `/api/v1/super-admin/search` | `/api/v1/search` |

## Profile

Mounted at both `/api/profile` and `/api/v1/profile`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/profile` |
| PUT | `/api/v1/profile` |
| PUT | `/api/v1/profile/password` |
| POST | `/api/v1/profile/avatar` |
| GET | `/api/v1/profile/sessions` |
| DELETE | `/api/v1/profile/sessions/:id` |
| DELETE | `/api/v1/profile/sessions` |
| GET | `/api/v1/profile/login-history` |
| POST | `/api/v1/profile/mfa/enable` |
| POST | `/api/v1/profile/mfa/disable` |
| POST | `/api/v1/profile/mfa/verify` |
| POST | `/api/v1/profile/mfa/backup-codes` |

## System Management

Mounted at both `/api/v1/system-management` and `/api/v1/system`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/system-management/overview` | Platform summary |
| GET | `/api/v1/system-management/health` | System health summary |
| GET | `/api/v1/system-management/status` | Maintenance status |
| GET | `/api/v1/system-management/settings` | List settings |
| PATCH | `/api/v1/system-management/settings` | Update settings |
| POST | `/api/v1/system-management/maintenance/enable` | Enable maintenance mode |
| POST | `/api/v1/system-management/maintenance/disable` | Disable maintenance mode |
| GET | `/api/v1/system-management/security/settings` | Security settings |
| PATCH | `/api/v1/system-management/security/settings` | Update security settings |
| GET | `/api/v1/system-management/users` | List platform users |
| POST | `/api/v1/system-management/users` | Create platform user |
| PATCH | `/api/v1/system-management/users/:id` | Update platform user |
| POST | `/api/v1/system-management/users/:id/activate` | Activate user |
| POST | `/api/v1/system-management/users/:id/deactivate` | Deactivate user |
| POST | `/api/v1/system-management/users/:id/suspend` | Suspend user |
| POST | `/api/v1/system-management/users/:id/lock` | Lock user |
| POST | `/api/v1/system-management/users/:id/unlock` | Unlock user |
| POST | `/api/v1/system-management/users/:id/reset-password` | Reset user password |
| POST | `/api/v1/system-management/users/:id/revoke-sessions` | Revoke all user sessions |
| GET | `/api/v1/system-management/users/:id/login-history` | User login history |
| GET | `/api/v1/system-management/sessions` | List sessions |
| POST | `/api/v1/system-management/sessions/:id/revoke` | Revoke session |
| GET | `/api/v1/system-management/roles` | List roles |
| POST | `/api/v1/system-management/roles` | Create role |
| PATCH | `/api/v1/system-management/roles/:id` | Update role |
| DELETE | `/api/v1/system-management/roles/:id` | Delete role |
| GET | `/api/v1/system-management/permissions` | List permissions |
| POST | `/api/v1/system-management/roles/:id/permissions` | Assign role permissions |
| GET | `/api/v1/system-management/integrations` | List integrations |
| POST | `/api/v1/system-management/integrations` | Create integration |
| PATCH | `/api/v1/system-management/integrations/:id` | Update integration |
| DELETE | `/api/v1/system-management/integrations/:id` | Delete integration |
| POST | `/api/v1/system-management/integrations/:id/test` | Test integration |
| GET | `/api/v1/system-management/email/configuration` | Email configuration |
| PATCH | `/api/v1/system-management/email/configuration` | Update email configuration |
| POST | `/api/v1/system-management/email/test` | Send/test email |
| GET | `/api/v1/system-management/notifications/configuration` | Notification configuration |
| PATCH | `/api/v1/system-management/notifications/configuration` | Update notification configuration |
| GET | `/api/v1/system-management/document-templates` | List document templates |
| POST | `/api/v1/system-management/document-templates` | Create document template |
| PATCH | `/api/v1/system-management/document-templates/:id` | Update document template |
| DELETE | `/api/v1/system-management/document-templates/:id` | Delete document template |
| GET | `/api/v1/system-management/backups` | List backups |
| POST | `/api/v1/system-management/backups` | Queue backup |
| POST | `/api/v1/system-management/backups/:id/restore` | Queue restore |
| GET | `/api/v1/system-management/technical-audit-logs` | List technical audit logs |
| GET | `/api/v1/system-management/technical-audit-logs/export` | Export technical audit logs |
| GET | `/api/v1/system-management/technical-audit-logs/:id` | Get technical audit log |

## System Health

Mounted at `/api/admin/system-health`, `/api/health`, and `/api/v1/system-health`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/admin/system-health` |
| GET | `/api/admin/system-health/services` |
| GET | `/api/admin/system-health/infrastructure` |
| GET | `/api/admin/system-health/metrics` |
| GET | `/api/v1/system-health` |
| GET | `/api/v1/system-health/services` |
| GET | `/api/v1/system-health/infrastructure` |
| GET | `/api/v1/system-health/metrics` |

## Backups

Mounted at `/api/admin/backups` and `/api/v1/backups`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/admin/backups` |
| POST | `/api/admin/backups` |
| GET | `/api/admin/backups/settings` |
| PUT | `/api/admin/backups/settings` |
| GET | `/api/admin/backups/health` |
| GET | `/api/admin/backups/:id/status` |
| GET | `/api/admin/backups/:id` |
| POST | `/api/admin/backups/:id/restore` |
| DELETE | `/api/admin/backups/:id` |
| GET | `/api/v1/backups` |
| POST | `/api/v1/backups` |
| GET | `/api/v1/backups/settings` |
| PUT | `/api/v1/backups/settings` |
| GET | `/api/v1/backups/health` |
| GET | `/api/v1/backups/:id/status` |
| GET | `/api/v1/backups/:id` |
| POST | `/api/v1/backups/:id/restore` |
| DELETE | `/api/v1/backups/:id` |

## Technical Audit Logs

Mounted at `/api/admin/technical-audit-logs` and `/api/v1/technical-audit-logs`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/admin/technical-audit-logs` |
| GET | `/api/admin/technical-audit-logs/search` |
| GET | `/api/admin/technical-audit-logs/export` |
| GET | `/api/admin/technical-audit-logs/:id` |
| GET | `/api/v1/technical-audit-logs` |
| GET | `/api/v1/technical-audit-logs/search` |
| GET | `/api/v1/technical-audit-logs/export` |
| GET | `/api/v1/technical-audit-logs/:id` |

## Security

Mounted at `/api/admin/security` and `/api/v1/security`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/security` |
| GET | `/api/v1/security/dashboard` |
| PATCH | `/api/v1/security/password-policy` |
| PATCH | `/api/v1/security/mfa` |
| PATCH | `/api/v1/security/login-policy` |
| PATCH | `/api/v1/security/session-policy` |
| PATCH | `/api/v1/security/maintenance` |
| GET | `/api/v1/security/sessions` |
| DELETE | `/api/v1/security/sessions/:sessionId` |
| POST | `/api/v1/security/users/:userId/unlock` |
| POST | `/api/v1/security/users/:userId/revoke-sessions` |
| GET | `/api/v1/security/login-attempts` |
| GET | `/api/v1/security/events` |
| GET | `/api/v1/security/trusted-devices` |
| DELETE | `/api/v1/security/trusted-devices/:id` |
| POST | `/api/v1/security/users/:userId/mfa` |

Use the same paths with `/api/admin/security` for the admin alias.

## Email Configuration

Mounted at `/api/admin/email-config`, `/api/v1/email-config`, `/api/v1/email-configurations`, and `/api/v1/email`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/email-config` |
| PUT | `/api/v1/email-config` |
| PATCH | `/api/v1/email-config` |
| POST | `/api/v1/email-config/test` |
| POST | `/api/v1/email-config/check` |
| PATCH | `/api/v1/email-config/status` |
| GET | `/api/v1/email-config/templates` |
| POST | `/api/v1/email-config/templates` |
| PUT | `/api/v1/email-config/templates/:id` |
| GET | `/api/v1/email-config/logs` |
| GET | `/api/v1/email-config/queue` |
| POST | `/api/v1/email-config/queue/process` |

## Notifications

Configuration is mounted at `/api/admin/notification-config`, `/api/v1/notification-config`, and `/api/v1/notification-configurations`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/notification-config` |
| PATCH | `/api/v1/notification-config/channels` |
| PATCH | `/api/v1/notification-config/delivery-preferences` |
| GET | `/api/v1/notification-config/rules` |
| PUT | `/api/v1/notification-config/rules/:type` |
| GET | `/api/v1/notification-config/logs` |
| GET | `/api/v1/notification-config/queue` |
| POST | `/api/v1/notification-config/queue/process` |

User notification endpoints are mounted at `/api/notifications` and `/api/v1/notifications`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/notifications` |
| GET | `/api/v1/notifications/preferences` |
| PATCH | `/api/v1/notifications/preferences` |
| PATCH | `/api/v1/notifications/read-all` |
| PATCH | `/api/v1/notifications/:id/read` |
| DELETE | `/api/v1/notifications/:id` |

## User Access

Mounted at `/api/v1/users`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/users/statistics` |
| GET | `/api/v1/users` |
| POST | `/api/v1/users` |
| GET | `/api/v1/users/:id` |
| PATCH | `/api/v1/users/:id` |
| PUT | `/api/v1/users/:id` |
| DELETE | `/api/v1/users/:id` |
| POST | `/api/v1/users/:id/lock` |
| POST | `/api/v1/users/:id/unlock` |
| POST | `/api/v1/users/:id/deactivate` |
| POST | `/api/v1/users/:id/reactivate` |
| POST | `/api/v1/users/:id/suspend` |
| POST | `/api/v1/users/:id/reset-password` |
| POST | `/api/v1/users/:id/force-password-change` |
| POST | `/api/v1/users/:id/revoke-sessions` |
| GET | `/api/v1/users/:id/sessions` |
| DELETE | `/api/v1/users/:id/sessions/:sessionId` |
| GET | `/api/v1/users/:id/login-history` |
| GET | `/api/v1/users/:id/activity` |

## Employees

The Super Admin Employees page uses `/api/v1/employees`. This is the list/create API for adding a person. Nested payroll and discipline routes on the same prefix still work.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employees` | List employees |
| POST | `/api/v1/employees` | Add a person |
| GET | `/api/v1/employees/:id` | Get one employee profile |
| PATCH | `/api/v1/employees/:id` | Update an employee |
| PUT | `/api/v1/employees/:id` | Update an employee |
| DELETE | `/api/v1/employees/:id` | Deactivate an employee |
| POST | `/api/v1/employees/:id/deactivate` | Deactivate |
| POST | `/api/v1/employees/:id/activate` | Activate |
| POST | `/api/v1/employees/:id/suspend` | Suspend |
| POST | `/api/v1/employees/:id/terminate` | Terminate |
| POST | `/api/v1/employees/:id/transfer` | Transfer department/location |
| POST | `/api/v1/employees/:id/promote` | Promote |
| POST | `/api/v1/employees/:id/reset-password` | Reset login password |

The same routes are also mounted at `/api/v1/super-admin/employees`.

Add-person body can be a nested staff payload or a flat form:

```json
{
  "fullName": "Lena Fisher",
  "email": "lena.f@afresh.com",
  "phone": "08030000000",
  "jobTitle": "Hardware Lead",
  "department": "Hardware",
  "location": "Remote",
  "role": "employee"
}
```

If `email` is omitted, the backend generates a login email. A temporary password is always created and returned in `meta.temporaryPassword`. The new user **must change that password on first login** (`mustChangePassword: true`). Until they POST `/api/v1/auth/change-password`, other APIs return `403 PASSWORD_CHANGE_REQUIRED`.

Dropdown values for Add person / employment forms:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/lookups` | Departments, employment types, login roles, **employees/HODs**, and meeting types |
| GET | `/api/v1/lookups/departments` | Department dropdown |
| GET | `/api/v1/lookups/employment-types` | `full_time`, `nysc`, `intern` |
| GET | `/api/v1/lookups/employees` | Active system users for Assign HOD |
| GET | `/api/v1/lookups/hods` | Same list as `/lookups/employees` |
| GET | `/api/v1/lookups/meeting-types` | In-person / Virtual / Hybrid |
| GET | `/api/v1/employees/options` | Same lookups plus `employees`/`hods` for the Employees page |
| GET | `/api/v1/departments` | Full Super Admin department module. `meta.hods` is the Assign HOD dropdown |
| GET | `/api/v1/departments/hod-options` | Assign HOD dropdown only |

Default departments (seeded when the list is empty): Software Engineers, Finance, Human Resources, Media / Photography, Administration, IT & Operations.

Employment types from the backend:

```json
[
  { "key": "full_time", "label": "Full-time" },
  { "key": "nysc", "label": "NYSC" },
  { "key": "intern", "label": "Intern" }
]
```

Do not hardcode those dropdowns on the frontend.

Super Admin employment/profile edits use:

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/profile` |
| PATCH | `/api/v1/profile` |
| PUT | `/api/v1/profile` |
| PATCH | `/api/v1/employees/:id` |

`PATCH /api/v1/profile` accepts employment fields (`department`, `employmentType`, `startDate`, `reportsTo`, job title as `role`/`jobTitle`) and no longer 404s for Super Admin. For another person, PATCH `/api/v1/employees/:id` (id, email, or name).

## Roles And Permissions

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/roles` |
| GET | `/api/v1/roles/catalog` |
| POST | `/api/v1/roles` |
| GET | `/api/v1/roles/:id` |
| PATCH | `/api/v1/roles/:id` |
| DELETE | `/api/v1/roles/:id` |
| GET | `/api/v1/roles/:id/permissions` |
| PUT | `/api/v1/roles/:id/permissions` |
| GET | `/api/v1/permissions` |
| GET | `/api/v1/permissions/catalog` |

## Departments

Mounted at `/api/v1/departments`. Super Admin only for create/update/delete. `POST` from the Add department modal does **not** need a code — the backend generates one from the name.

Assign HOD must be an **existing user on the system**. Do not hardcode names like Nina Patel. Load the dropdown from `GET /api/v1/lookups/hods`, `GET /api/v1/departments/hod-options`, or `meta.hods` on `GET /api/v1/departments`. Submit `hodId` (the option `id` or `userId`).

```json
{
  "name": "software",
  "hodId": "<employee-or-user-id>",
  "description": "build apps"
}
```

Accepted name fields: `name`, `departmentName`. Accepted HOD fields: `hodId`, `headOfDepartment`, `hod`, `hodName`. A name or id that is not a current user returns `400 HOD_NOT_FOUND`. HOD is optional.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/departments` |
| GET | `/api/v1/departments/hod-options` |
| POST | `/api/v1/departments` |
| GET | `/api/v1/departments/:id` |
| GET | `/api/v1/departments/:id/overview` |
| PATCH | `/api/v1/departments/:id` |
| DELETE | `/api/v1/departments/:id` |
| POST | `/api/v1/departments/:id/activate` |
| POST | `/api/v1/departments/:id/deactivate` |
| POST | `/api/v1/departments/:id/hod` |
| DELETE | `/api/v1/departments/:id/hod` |
| POST | `/api/v1/departments/:id/assistant-hod` |
| GET | `/api/v1/departments/:id/employees` |
| GET | `/api/v1/departments/:id/interns` |
| GET | `/api/v1/departments/:id/nysc` |
| GET | `/api/v1/departments/:id/tasks` |
| GET | `/api/v1/departments/:id/targets` |
| GET | `/api/v1/departments/:id/leave` |
| GET | `/api/v1/departments/:id/payroll` |
| GET | `/api/v1/departments/:id/expenses` |
| GET | `/api/v1/departments/:id/purchases` |
| GET | `/api/v1/departments/:id/meetings` |
| GET | `/api/v1/departments/:id/events` |
| GET | `/api/v1/departments/:id/reports` |
| GET | `/api/v1/departments/:id/activity` |

## HR Dashboard

Mounted at `/api/hr` and `/api/v1/hr`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/hr/dashboard` |
| GET | `/api/v1/hr/dashboard/stats` |
| GET | `/api/v1/hr/employees` |
| POST | `/api/v1/hr/employees` |
| GET | `/api/v1/hr/employees/:id` |
| PUT | `/api/v1/hr/employees/:id` |
| PATCH | `/api/v1/hr/employees/:id/status` |
| GET | `/api/v1/hr/departments` |
| POST | `/api/v1/hr/departments` |
| PUT | `/api/v1/hr/departments/:id` |
| DELETE | `/api/v1/hr/departments/:id` |
| GET | `/api/v1/hr/positions` |
| POST | `/api/v1/hr/positions` |
| PUT | `/api/v1/hr/positions/:id` |
| GET | `/api/v1/hr/leave` |
| POST | `/api/v1/hr/leave` |
| PATCH | `/api/v1/hr/leave/:id/approve` |
| PATCH | `/api/v1/hr/leave/:id/reject` |
| GET | `/api/v1/hr/promotions` |
| POST | `/api/v1/hr/promotions` |
| PATCH | `/api/v1/hr/promotions/:id/approve` |
| PATCH | `/api/v1/hr/promotions/:id/reject` |
| GET | `/api/v1/hr/salary-adjustments` |
| POST | `/api/v1/hr/salary-adjustments` |
| PATCH | `/api/v1/hr/salary-adjustments/:id/approve` |
| PATCH | `/api/v1/hr/salary-adjustments/:id/reject` |
| GET | `/api/v1/hr/salary-increments` |
| POST | `/api/v1/hr/salary-increments` |
| PATCH | `/api/v1/hr/salary-increments/:id/approve` |
| PATCH | `/api/v1/hr/salary-increments/:id/reject` |
| GET | `/api/v1/hr/attendance` |
| PATCH | `/api/v1/hr/attendance/:id/correct` |
| GET | `/api/v1/hr/performance` |
| GET | `/api/v1/hr/discipline` |
| GET | `/api/v1/hr/meetings` |
| POST | `/api/v1/hr/meetings` |
| GET | `/api/v1/hr/tasks` |
| POST | `/api/v1/hr/tasks` |
| GET | `/api/v1/hr/targets` |
| POST | `/api/v1/hr/targets` |
| GET | `/api/v1/hr/reports` |
| GET | `/api/v1/hr/audit-logs` |
| GET | `/api/v1/hr/approval-queue` |

## Salary Increments

The Super Admin Salary Increments page can list and create through either path. Both read and write the same underlying records, so a recommendation created on one endpoint appears on the other.

Create accepts the Afresh form fields (`employeeName`, `department`, `currentSalary`, `proposedSalary`, `effectiveDate` such as `12/17/2026`) as well as `employeeId` / `newSalary`. Super Admin tokens are allowed on these HR writes.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/salary-increments` | List salary increment recommendations |
| POST | `/api/v1/salary-increments` | Submit a recommendation |
| GET | `/api/v1/salary-increments/:id` | Get one recommendation |
| PATCH | `/api/v1/salary-increments/:id/approve` | Approve |
| POST | `/api/v1/salary-increments/:id/approve` | Approve |
| PATCH | `/api/v1/salary-increments/:id/reject` | Reject |
| POST | `/api/v1/salary-increments/:id/reject` | Reject |
| GET | `/api/v1/hr/salary-adjustments` | Same list via the HR module |
| POST | `/api/v1/hr/salary-adjustments` | Same create via the HR module |

The same salary-increments routes are also mounted at `/api/v1/super-admin/salary-increments`.

## Reports

Mounted at `/api/v1/reports`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/reports/overview` |
| GET | `/api/v1/reports/headcount` |
| GET | `/api/v1/reports/headcount-growth` |
| GET | `/api/v1/reports/attendance` |
| GET | `/api/v1/reports/attrition` |
| GET | `/api/v1/reports/departments` |
| GET | `/api/v1/reports/leave` |
| GET | `/api/v1/reports/payroll` |
| GET | `/api/v1/reports/tasks` |
| GET | `/api/v1/reports/targets` |
| GET | `/api/v1/reports/promotions` |
| GET | `/api/v1/reports/salary-increments` |
| GET | `/api/v1/reports/expenses` |
| GET | `/api/v1/reports/purchases` |
| GET | `/api/v1/reports/bills` |
| GET | `/api/v1/reports/vendors` |
| GET | `/api/v1/reports/nysc-interns` |
| GET | `/api/v1/reports/discipline` |
| GET | `/api/v1/reports/meetings` |
| GET | `/api/v1/reports/events` |
| GET | `/api/v1/reports/announcements` |
| GET | `/api/v1/reports/data-quality` |
| POST | `/api/v1/reports/custom` |
| GET | `/api/v1/reports/export-history` |
| GET | `/api/v1/reports/export` |
| POST | `/api/v1/reports/saved` |
| GET | `/api/v1/reports/saved` |
| GET | `/api/v1/reports/saved/:id` |
| PATCH | `/api/v1/reports/saved/:id` |
| DELETE | `/api/v1/reports/saved/:id` |
| POST | `/api/v1/reports/saved/:id/run` |

## Audit Logs

Operational audit logs are mounted at `/api/v1/audit-logs` and `/api/v1/audit/operational`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/audit-logs/stats` |
| GET | `/api/v1/audit-logs/export` |
| GET | `/api/v1/audit-logs` |
| GET | `/api/v1/audit-logs/:id` |
| POST | `/api/v1/audit-logs` |
| PUT | `/api/v1/audit-logs/:id` |
| PATCH | `/api/v1/audit-logs/:id` |
| DELETE | `/api/v1/audit-logs/:id` |

Write methods on operational audit logs return `405 AUDIT_LOG_IMMUTABLE`.

## Search

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/search?q=<query>` |
| GET | `/api/v1/global-search?q=<query>` |

## Generic Super Admin Resource Modules

These modules are mounted through the shared resource router and support this common pattern unless a custom router overrides the path:

| Method | Pattern |
| --- | --- |
| GET | `/api/v1/<module>` |
| POST | `/api/v1/<module>` |
| GET | `/api/v1/<module>/:id` |
| PATCH | `/api/v1/<module>/:id` |
| DELETE | `/api/v1/<module>/:id` |
| POST | `/api/v1/<module>/:id/:action` |
| GET | `/api/v1/<module>/:id/:action` |
| POST | `/api/v1/<module>/:collectionAction` |

Generated module mounts and supported actions:

| Module | Base endpoint | Actions |
| --- | --- | --- |
| Employers | `/api/v1/employers` | `configure` |
| Branches | `/api/v1/employers/branches` | `deactivate` |
| Employees | `/api/v1/employees` | `deactivate`, `suspend`, `terminate`, `transfer`, `promote`, `reset-password` |
| Interns | `/api/v1/interns` | `register`, `complete`, `terminate`, `generate-document` |
| NYSC | `/api/v1/nysc` | `transfer`, `complete`, `generate-acceptance-letter`, `generate-completion-letter` |
| Leave Types | `/api/v1/leave/types` | `configure` |
| Salary Increments | `/api/v1/salary-increments` | `approve`, `reject` |
| Promotions | `/api/v1/promotions` | `approve`, `reject` |
| Tasks | `/api/v1/tasks` | `assign`, `reassign`, `review`, `approve-completion` |
| Vendors | `/api/v1/vendors` | `deactivate` |
| Settings | `/api/v1/settings` | `configure` |
| Documents | `/api/v1/documents` | `generate-pdf` |
| Operational Audit | `/api/v1/operational-audit` | immutable |
| Help | `/api/v1/help` | `publish` |

## Meetings

`POST /api/v1/meetings` accepts the Super Admin Create meeting modal as-is. Meeting type is **not required**. If it is omitted or a leftover seed id, the backend defaults to In-person when a location is present.

```json
{
  "title": "software",
  "date": "08/16/2026",
  "time": "10:00AM",
  "duration": "1 HOUR",
  "location": "office premises"
}
```

Accepted date formats: `YYYY-MM-DD` and `MM/DD/YYYY`. Accepted time: `10:00`, `10:00AM`. Accepted duration: `60`, `1 HOUR`, `1h`.

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/meetings` |
| POST | `/api/v1/meetings` |
| GET | `/api/v1/meetings/:id` |
| PATCH | `/api/v1/meetings/:id` |
| GET | `/api/v1/meeting-types` |
| GET | `/api/v1/meeting-rooms` |

## Primary Operational Dashboard Modules

The frontend can use these base paths for list/detail/action workflows:

| Area | Base endpoint |
| --- | --- |
| Employers | `/api/v1/employers` |
| Employees | `/api/v1/employees` |
| Departments | `/api/v1/departments` |
| Leave | `/api/v1/leave` |
| Meetings | `/api/v1/meetings` |
| Meeting Types | `/api/v1/meeting-types` |
| Meeting Rooms | `/api/v1/meeting-rooms` |
| Targets | `/api/v1/targets` |
| Payroll | `/api/v1/payroll` |
| Salaries | `/api/v1/salaries` |
| Purchase Requests | `/api/v1/purchase-requests` |
| Purchase Orders | `/api/v1/purchase-orders` |
| Receipts | `/api/v1/receipts` |
| Bills | `/api/v1/bills` |
| Expenses | `/api/v1/expenses` |
| Expense Policies | `/api/v1/expense-policies` |
| Events | `/api/v1/events` |
| Discipline | `/api/v1/discipline` |
| NYSC/Interns | `/api/v1/nysc-interns` |
| Announcements | `/api/v1/announcements` |
| Purchases alias | `/api/v1/purchases` |
| Vendors | `/api/v1/vendors` |
