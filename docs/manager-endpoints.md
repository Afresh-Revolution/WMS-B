# Manager API Endpoints

This file lists the backend endpoints available to the Manager section.

Default API base: `/api/v1/manager`

Legacy alias: `/api/manager`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All Manager routes require an authenticated user with `role = manager`. Records are scoped to the manager's organization, assigned departments, direct reports, and records created by the manager where supported.

List endpoints support pagination and filtering through query parameters such as `page`, `limit`, `q`, `search`, `sortBy`, `sortDirection`, `dateFrom`, and `dateTo`. Scoped list endpoints also validate `departmentId`/`department_id` and `employeeId`/`employee_id` when provided.

## Scope

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/scope` | Return the manager's scoped organization, department, and employee IDs |

## Dashboard

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/dashboard` | Return dashboard metrics, approvals, department summaries, recent activity, and navigation |
| GET | `/api/v1/manager/dashboard/stats` | Return dashboard metric counts only |

## Profile, Settings, and Employment Record

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/employment-record` | Return the authenticated manager's employment record, documents, leave history, tasks, targets, meetings, and performance history |
| GET | `/api/v1/manager/employment-record/documents` | Return the authenticated manager's employment documents |
| PATCH | `/api/v1/manager/employment-record` | Update manager self-service personal/contact fields only |
| PUT | `/api/v1/manager/employment-record` | Alias for updating manager self-service personal/contact fields only |
| GET | `/api/v1/manager/profile` | Return the authenticated manager's profile summary |
| PATCH | `/api/v1/manager/profile` | Update manager self-service profile fields only |
| PUT | `/api/v1/manager/profile` | Alias for updating manager self-service profile fields only |
| GET | `/api/v1/manager/settings` | Return manager profile and authorized personal preferences |
| PATCH | `/api/v1/manager/settings` | Update manager personal preferences only |
| GET | `/api/v1/manager/help-center` | Return Manager dashboard help sections and related API routes |

## Employees

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/employees` | List employees in the manager's scope |
| GET | `/api/v1/manager/employees/:id` | Get one scoped employee |
| GET | `/api/v1/manager/team` | Alias for listing employees in the manager's scope |
| GET | `/api/v1/manager/team/:id` | Alias for getting one scoped employee |

## Departments

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/departments` | List departments in the manager's scope |
| GET | `/api/v1/manager/departments/:id` | Get one scoped department |

## Leave

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/leave` | List scoped leave requests |
| POST | `/api/v1/manager/leave` | Create a leave request for the manager or a scoped employee |
| GET | `/api/v1/manager/leave/:id` | Get one scoped leave request |
| PATCH | `/api/v1/manager/leave/:id/approve` | Approve a scoped leave request |
| PATCH | `/api/v1/manager/leave/:id/reject` | Reject a scoped leave request |

## Attendance

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/attendance` | List scoped team attendance records |
| GET | `/api/v1/manager/attendance/:id` | Get one scoped team attendance record |
| PATCH | `/api/v1/manager/attendance/:id/correct` | Correct a scoped attendance record with audit logging |

## Performance

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/performance` | List scoped team performance reviews |
| POST | `/api/v1/manager/performance` | Create a scoped performance review |
| GET | `/api/v1/manager/performance/:id` | Get one scoped performance review |
| PATCH | `/api/v1/manager/performance/:id` | Update a scoped performance review |
| PUT | `/api/v1/manager/performance/:id` | Alias for updating a scoped performance review |

## Promotions

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/promotions` | List scoped promotion recommendations |
| POST | `/api/v1/manager/promotions` | Create a promotion recommendation |
| GET | `/api/v1/manager/promotions/:id` | Get one scoped promotion recommendation |

## Salary Recommendations

| Method | Endpoint | Purpose |


| --- | --- | --- |
| GET | `/api/v1/manager/salary-recommendations` | List scoped salary recommendations |
| POST | `/api/v1/manager/salary-recommendations` | Create a salary recommendation |
| GET | `/api/v1/manager/salary-recommendations/:id` | Get one scoped salary recommendation |
| GET | `/api/v1/manager/salary` | Alias for listing scoped salary recommendations |
| POST | `/api/v1/manager/salary/recommend` | Alias for creating a salary recommendation |

## Meetings

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/meetings` | List scoped meetings |
| POST | `/api/v1/manager/meetings` | Create a scoped meeting |
| GET | `/api/v1/manager/meetings/:id` | Get one scoped meeting |
| PATCH | `/api/v1/manager/meetings/:id/cancel` | Cancel a scoped meeting |
| PATCH | `/api/v1/manager/meetings/:id/reschedule` | Reschedule a scoped meeting |
| PATCH | `/api/v1/manager/meetings/:id` | Update a scoped meeting |
| PUT | `/api/v1/manager/meetings/:id` | Alias for updating a scoped meeting |

## Tasks

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/tasks` | List scoped tasks |
| GET | `/api/v1/manager/tasks/overdue` | List scoped overdue tasks |
| POST | `/api/v1/manager/tasks` | Create a scoped task |
| GET | `/api/v1/manager/tasks/:id` | Get one scoped task |
| PATCH | `/api/v1/manager/tasks/:id/complete` | Mark a scoped task as complete |
| PATCH | `/api/v1/manager/tasks/:id` | Update a scoped task |
| PUT | `/api/v1/manager/tasks/:id` | Alias for updating a scoped task |

## Targets

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/targets` | List scoped targets |
| POST | `/api/v1/manager/targets` | Create a scoped target |
| GET | `/api/v1/manager/targets/:id` | Get one scoped target |
| PATCH | `/api/v1/manager/targets/:id/progress` | Update a scoped target's progress |
| PATCH | `/api/v1/manager/targets/:id/complete` | Mark a scoped target as complete |
| PATCH | `/api/v1/manager/targets/:id` | Update a scoped target |
| PUT | `/api/v1/manager/targets/:id` | Alias for updating a scoped target |

## Finance

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/finance` | List scoped finance items across expenses, bills, and purchase requests |

## Expenses

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/expenses` | List scoped expenses |
| POST | `/api/v1/manager/expenses` | Create a scoped expense |
| GET | `/api/v1/manager/expenses/:id` | Get one scoped expense |
| PATCH | `/api/v1/manager/expenses/:id/approve` | Approve a scoped expense |
| PATCH | `/api/v1/manager/expenses/:id/reject` | Reject a scoped expense |

## Procurement Requests

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/procurement-requests` | List scoped procurement requests |
| POST | `/api/v1/manager/procurement-requests` | Create a scoped procurement request |
| GET | `/api/v1/manager/procurement-requests/:id` | Get one scoped procurement request |
| PATCH | `/api/v1/manager/procurement-requests/:id/approve` | Approve a scoped procurement request |
| PATCH | `/api/v1/manager/procurement-requests/:id/reject` | Reject a scoped procurement request |

## Events

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/events` | List scoped events |
| POST | `/api/v1/manager/events` | Create a scoped event |
| GET | `/api/v1/manager/events/:id` | Get one scoped event |
| PATCH | `/api/v1/manager/events/:id` | Update a scoped event |
| PUT | `/api/v1/manager/events/:id` | Alias for updating a scoped event |

## Discipline

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/discipline` | List scoped discipline cases |
| POST | `/api/v1/manager/discipline` | Create a scoped discipline case |
| GET | `/api/v1/manager/discipline/:id` | Get one scoped discipline case |
| PATCH | `/api/v1/manager/discipline/:id` | Update a scoped discipline case |
| PUT | `/api/v1/manager/discipline/:id` | Alias for updating a scoped discipline case |
| PATCH | `/api/v1/manager/discipline/:id/close` | Close a scoped discipline case |

## Approvals

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/approvals` | List pending scoped approvals for leave, promotions, salary recommendations, procurement, and expenses |

## Reports

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/reports` | Return scoped headcount, leave, and finance summary reports |

## Notifications

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/notifications` | List notifications for the authenticated manager |
| PATCH | `/api/v1/manager/notifications/:id/read` | Mark one manager notification as read |

## Audit Logs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/manager/audit-logs` | List scoped operational audit logs |

## Legacy Alias

The same endpoints are also mounted under `/api/manager`. For example:

| API v1 endpoint | Legacy alias |
| --- | --- |
| `/api/v1/manager/dashboard` | `/api/manager/dashboard` |
| `/api/v1/manager/employees` | `/api/manager/employees` |
| `/api/v1/manager/tasks/:id` | `/api/manager/tasks/:id` |
