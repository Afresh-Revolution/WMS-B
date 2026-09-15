# HOD API Endpoints

This file lists the backend endpoints available to the Head of Department dashboard.

Default API base: `/api/v1/hod`

Legacy alias: `/api/hod`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All HOD routes require an authenticated user with `role = hod`. The backend also accepts the existing Manager department scope rules, so records are limited to the HOD's organization, assigned department, department `hodId`, direct reports, and records created by the HOD where supported.

## UI Flow From The HOD Screens

1. Super Admin creates the HOD user with `role` or `roleId` set to `hod`.
2. Super Admin assigns the HOD to a department through the department `hodId`/`headEmployeeId` fields or the department HOD endpoint.
3. HOD logs in through `POST /api/v1/auth/login`.
4. Frontend loads `GET /api/v1/hod/overview` for the dashboard shell.
5. Frontend uses the focused list and write endpoints for team members, department tasks, targets/KPIs, and meetings.

## Dashboard And Scope

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hod/scope` | Return the HOD's scoped organization, department, and employee IDs |
| GET | `/api/v1/hod/overview` | Return the full HOD workspace payload for the first dashboard screen |
| GET | `/api/v1/hod/dashboard` | Alias for loading the HOD workspace payload |
| GET | `/api/v1/hod/dashboard/stats` | Return dashboard metric counts only |

## Department

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hod/department` | Return the primary department summary shown in the HOD dashboard |
| GET | `/api/v1/hod/departments` | List departments in HOD scope |
| GET | `/api/v1/hod/departments/:id` | Get one scoped department |

## Team Members

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hod/team-members` | List employees in the HOD's department scope |
| GET | `/api/v1/hod/team-members/:id` | Get one scoped team member |
| GET | `/api/v1/hod/team` | Alias for team member list |
| GET | `/api/v1/hod/team/:id` | Alias for one team member |

## Department Tasks

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hod/tasks` | List scoped department tasks |
| GET | `/api/v1/hod/tasks/overdue` | List scoped overdue tasks |
| POST | `/api/v1/hod/tasks` | Create and assign a department task |
| GET | `/api/v1/hod/tasks/:id` | Get one scoped task |
| PATCH | `/api/v1/hod/tasks/:id` | Update a scoped task |
| PUT | `/api/v1/hod/tasks/:id` | Alias for updating a scoped task |
| PATCH | `/api/v1/hod/tasks/:id/complete` | Mark a scoped task as complete |

## Targets And KPIs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hod/targets` | List scoped targets/KPIs |
| POST | `/api/v1/hod/targets` | Create and assign a target/KPI |
| GET | `/api/v1/hod/targets/:id` | Get one scoped target/KPI |
| PATCH | `/api/v1/hod/targets/:id` | Update a scoped target/KPI |
| PUT | `/api/v1/hod/targets/:id` | Alias for updating a scoped target/KPI |
| PATCH | `/api/v1/hod/targets/:id/progress` | Update progress for a scoped target/KPI |
| PATCH | `/api/v1/hod/targets/:id/complete` | Mark a scoped target/KPI as complete |

## Department Meetings

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hod/meetings` | List scoped department meetings |
| POST | `/api/v1/hod/meetings` | Create a department meeting |
| GET | `/api/v1/hod/meetings/:id` | Get one scoped meeting |
| PATCH | `/api/v1/hod/meetings/:id` | Update a scoped meeting |
| PUT | `/api/v1/hod/meetings/:id` | Alias for updating a scoped meeting |
| PATCH | `/api/v1/hod/meetings/:id/reschedule` | Reschedule a scoped meeting |
| PATCH | `/api/v1/hod/meetings/:id/cancel` | Cancel a scoped meeting |

## Leave, Reports, And Notifications

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hod/leave` | List scoped department leave requests |
| PATCH | `/api/v1/hod/leave/:id/approve` | Approve a pending scoped leave request |
| PATCH | `/api/v1/hod/leave/:id/reject` | Reject a pending scoped leave request |
| GET | `/api/v1/hod/reports` | Return scoped department summary reports |
| GET | `/api/v1/hod/notifications` | List notifications for the authenticated HOD |
| PATCH | `/api/v1/hod/notifications/:id/read` | Mark one HOD notification as read |

## Example Create Task Request

```http
POST /api/v1/hod/tasks
Authorization: Bearer <hod_access_token>
Content-Type: application/json
```

```json
{
  "title": "Build payroll export",
  "description": "Prepare the department payroll export for review.",
  "employeeId": "employee-id",
  "departmentId": "department-id",
  "priority": "HIGH",
  "dueDate": "2026-09-30"
}
```

The backend rejects any `departmentId` or `employeeId` outside the HOD's scope with `RESOURCE_OUT_OF_MANAGER_SCOPE`.
