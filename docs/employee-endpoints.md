# Employee API Endpoints

This file lists the backend endpoints available to the Employee self-service dashboard shown in the UI.

Default API base: `/api/v1/employee`

Compatibility aliases: `/api/v1/employer`, `/api/employee`, and `/api/employer`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All Employee routes require an authenticated user with `role = employee`. The backend derives the employee identity from the logged-in user and linked employee record; the frontend does not decide which employee record is being accessed.

## UI Flow From The Employee Screens

1. Super Admin, HR, or another authorized staff workflow creates the employee record and login account.
2. Employee logs in through `POST /api/v1/auth/login`.
3. Frontend loads `GET /api/v1/employee/dashboard` for the Home screen.
4. Frontend loads focused endpoints for employment record, leave/time off, assigned tasks, meetings/schedule, expense claims, performance, records, notifications, and settings.

## Dashboard And Scope

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/scope` | Return the authenticated employee's user, employee, department, and organization IDs |
| GET | `/api/v1/employee/dashboard` | Return Home metrics, assigned work, meetings, leave, expenses, targets, and notifications |
| GET | `/api/v1/employee/home` | Alias for the Employee dashboard payload |

## Employment Record, Profile, And Settings

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/employment-record` | Return the authenticated employee's profile, contact information, employment record, documents, leave, tasks, targets, meetings, expenses, and performance |
| PATCH | `/api/v1/employee/employment-record` | Update safe self-service profile fields only |
| PUT | `/api/v1/employee/employment-record` | Alias for updating safe self-service profile fields |
| GET | `/api/v1/employee/profile` | Alias for employment record |
| PATCH | `/api/v1/employee/profile` | Update safe employee profile fields only |
| PUT | `/api/v1/employee/profile` | Alias for updating safe employee profile fields |
| GET | `/api/v1/employee/settings` | Return employee profile and personal preferences |
| PATCH | `/api/v1/employee/settings` | Update personal preferences only |

Self-service updates cannot change role, permissions, department, employee ID, salary, or employment status.

## Leave And Time Off

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/leave` | List the authenticated employee's leave requests |
| GET | `/api/v1/employee/leave/types` | List active leave types for the apply-for-leave modal |
| GET | `/api/v1/employee/leave/balances` | List the authenticated employee's leave balances |
| GET | `/api/v1/employee/leave/requests` | Alias for employee leave requests |
| POST | `/api/v1/employee/leave` | Submit a leave request for the authenticated employee |
| POST | `/api/v1/employee/leave/requests` | Alias for submitting a leave request |
| GET | `/api/v1/employee/leave/:id` | Get one self-scoped leave request |

## Assigned Tasks

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/tasks` | List tasks assigned to the authenticated employee |
| GET | `/api/v1/employee/assigned-to-me` | Alias for assigned tasks |
| GET | `/api/v1/employee/tasks/:id` | Get one assigned task |
| PATCH | `/api/v1/employee/tasks/:id/progress` | Update progress, status, or note for an assigned task |
| PATCH | `/api/v1/employee/tasks/:id` | Alias for updating assigned task progress |

## Targets

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/targets` | List targets/KPIs assigned to the authenticated employee |
| GET | `/api/v1/employee/targets/:id` | Get one assigned target/KPI |
| PATCH | `/api/v1/employee/targets/:id/progress` | Update progress on an assigned target/KPI |
| POST | `/api/v1/employee/targets/:id/progress` | Alias for progress updates |

## Schedule And Meetings

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/schedule` | List meetings visible to the authenticated employee |
| GET | `/api/v1/employee/meetings` | Alias for employee meetings |
| GET | `/api/v1/employee/meetings/:id` | Get one visible meeting |

## Attendance Check-in

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/attendance/locations` | List assigned active check-in locations without exposing precise coordinates |
| GET | `/api/v1/employee/attendance/status` | Return current server-side check-in availability and policy |
| POST | `/api/v1/employee/attendance/check-in` | Submit a fresh browser location reading for backend geofence verification |
| GET | `/api/v1/employee/attendance/history` | List the authenticated employee's own attendance check-ins |

The shared attendance endpoints are also available at `/api/v1/attendance/me/locations`, `/api/v1/attendance/me/status`, `/api/v1/attendance/check-in`, and `/api/v1/attendance/me/history`. GPS check-in is limited to `employee`, `accountant`, `intern`, and `nysc_intern` roles.

## Expense Claims

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/expense-claims` | List the authenticated employee's expense claims |
| GET | `/api/v1/employee/expenses` | Alias for expense claims |
| POST | `/api/v1/employee/expense-claims` | Create an expense claim for the authenticated employee |
| POST | `/api/v1/employee/expenses` | Alias for creating an expense claim |
| GET | `/api/v1/employee/expense-claims/:id` | Get one self-scoped expense claim |
| GET | `/api/v1/employee/expenses/:id` | Alias for one self-scoped expense claim |
| PATCH | `/api/v1/employee/expenses/:id` | Update a draft self-scoped expense claim |
| POST | `/api/v1/employee/expenses/:id/submit` | Submit a draft self-scoped expense claim |
| POST | `/api/v1/employee/expenses/:id/cancel` | Cancel a self-scoped expense claim |

## Performance, Records, And Notifications

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/performance` | List the authenticated employee's performance reviews |
| GET | `/api/v1/employee/records` | Return the employee record bundle used by My Records |
| GET | `/api/v1/employee/notifications` | List employee notifications |
| PATCH | `/api/v1/employee/notifications/:id/read` | Mark one notification as read |

## Example Leave Request

```http
POST /api/v1/employee/leave
Authorization: Bearer <employee_access_token>
Content-Type: application/json
```

```json
{
  "leaveTypeId": "leave-type-id",
  "startDate": "2026-09-21",
  "endDate": "2026-09-23",
  "durationType": "FULL_DAY",
  "reason": "Family appointment"
}
```

## Example Expense Claim

```http
POST /api/v1/employee/expense-claims
Authorization: Bearer <employee_access_token>
Content-Type: application/json
```

```json
{
  "category": "Transport",
  "amount": 24000,
  "expenseDate": "2026-09-02",
  "description": "Client visit transport"
}
```
