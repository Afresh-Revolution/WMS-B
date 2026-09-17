# Leave And Time Off

This document explains how leave works on WMS-B and which APIs power the Employee **Leave & time off** screen (balances, apply, tabs, request list).

Copy-paste bodies and a frontend helper are in [leave-integration.md](./leave-integration.md).

## Bases

| Who | Base | Alias |
| --- | --- | --- |
| Employee (this screen) | `/api/v1/employee/leave` | `/api/v1/leave/requests` still works if the user has leave permissions |
| Shared leave engine | `/api/v1/leave` | `/api/v1/super-admin/leave` |
| HR | `/api/v1/hr/leave` | — |
| HOD | `/api/v1/hod/leave` | — |
| Manager | `/api/v1/manager/leave` | — |

All routes need:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Employee routes require `role = employee` (or Super Admin acting through the shared `/api/v1/leave` engine). The backend always uses the **logged-in user’s linked employee record**. Do not send another person’s `employeeId` when applying from this screen.

## How It Works

Leave is a request against a **leave type** and a **yearly balance**.

1. Seeded types exist as soon as types are listed: Annual (`ANNUAL`, 25 days), Sick (`SICK`, 10), Personal (`PERSONAL`, 5), Unpaid (`UNPAID`, 0).
2. The first time an employee applies for a type, the backend creates that year’s balance: `allocatedDays` from the type (or policy), `usedDays = 0`, `pendingDays = 0`, `remainingDays = allocated`.
3. Apply stores a request as `PENDING` and **holds** working days on `pendingDays`. Remaining is `allocated + carriedForward + accrued - used - pending`.
4. Approve moves those days from `pendingDays` to `usedDays`. Remaining stays the same as at submit (the days were already reserved).
5. Reject or withdraw releases `pendingDays` back to remaining.
6. Cancel is only for **approved** leave; it reduces `usedDays` and restores remaining.

Employees see only their own requests. HR / Super Admin / HOD / Manager see team or organisation requests and approve or reject.

## Screen Mapping (Employee Leave & time off)

| UI | Source |
| --- | --- |
| **DAYS REMAINING** | Sum of `remainingDays` from `GET /api/v1/employee/leave/balances` |
| **ANNUAL DAYS LEFT** | Balance where type is Annual: `remainingDays` and `usedDays` / `allocatedDays` |
| **SICK DAYS LEFT** | Same for Sick |
| **PERSONAL DAYS LEFT** | Same for Personal |
| **+ Apply for leave** | Types from `GET /api/v1/employee/leave/types`, submit `POST /api/v1/employee/leave` |
| Tabs All / Pending / Approved / Rejected | `GET /api/v1/employee/leave?status=PENDING` (or `APPROVED` / `REJECTED`). All = omit `status` |
| List row title | `{leaveTypeName} · {duration} days` |
| List dates | `{startDate} – {endDate}` plus `note` |
| Status chip | `status`: `PENDING`, `APPROVED`, `REJECTED` |
| **Decision letter** | Shown for approved items. There is **no dedicated PDF download route** today. Build the letter on the client from `GET /api/v1/employee/leave/:id` (type, dates, duration, `approvedBy`, `approvedAt`, comments). |

Home metrics also include leave: `GET /api/v1/employee/dashboard` → `metrics.leaveDaysRemaining`, `metrics.pendingLeaveRequests`, `leave.balances`, `leave.recentRequests`.

## Duration Logic

Dates must be `YYYY-MM-DD`. The client’s `duration` number is **ignored**; the server recalculates.

Default policy:

- Weekends are **not** counted
- Public holidays are **not** counted (if holidays exist in data)
- Half-day is allowed (`durationType: "HALF_DAY"`) and must be a single date; it costs `0.5` working days

Example: `2026-08-20` to `2026-08-25` is 6 calendar days and **4** working days. The request stores `duration: 4` and `calendarDays: 6`.

Overlapping `PENDING` or `APPROVED` dates for the same employee return `409 LEAVE_DATES_OVERLAP`.

If remaining balance is less than working days, submit returns `409 INSUFFICIENT_LEAVE_BALANCE`.

Policy can also require notice (`NOTICE_REQUIRED`) or a max consecutive stretch (`MAXIMUM_LEAVE_EXCEEDED`).

## Status Lifecycle

```
PENDING ──approve──► APPROVED ──cancel──► CANCELLED
   │
   ├──reject──► REJECTED
   └──withdraw──► WITHDRAWN   (employee, pending only)
```

Statuses are uppercase strings: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `WITHDRAWN`.

## Approval

On submit the engine creates a two-step workflow:

1. Manager (if the employee has `managerId`)
2. HR or Super Admin

Super Admin and users with `leave.approve` / `leave.reject` can decide through `/api/v1/leave/requests/:id/approve` (POST) or HR’s `PATCH /api/v1/hr/leave/:id/approve`.

Approve/reject body: `{ "comment": "Enjoy" }` or `{ "reason": "..." }` on reject.

The employee is notified (`leave_request_approved` / `leave_request_rejected`). The manager is notified on submit (`leave_request_submitted`).

## Employee Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/leave` | Own requests. Query: `status`, `q`, `page`, `limit` |
| GET | `/api/v1/employee/leave/requests` | Same list |
| GET | `/api/v1/employee/leave/types` | Active types for the apply modal |
| GET | `/api/v1/employee/leave/balances` | Own balances for the four cards |
| POST | `/api/v1/employee/leave` | Apply |
| POST | `/api/v1/employee/leave/requests` | Apply alias |
| GET | `/api/v1/employee/leave/:id` | One own request |

The employee must have a linked staff record. Otherwise apply fails (no employee profile).

## Shared Leave Engine (`/api/v1/leave`)

Use this for Super Admin leave admin, or for employees who also have leave permissions on the shared router.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/leave/types` | List types |
| POST | `/api/v1/leave/types` | Create type (manage types) |
| PATCH | `/api/v1/leave/types/:id` | Update type |
| GET | `/api/v1/leave/policies` | List policies |
| POST | `/api/v1/leave/policies` | Create policy |
| PATCH | `/api/v1/leave/policies/:id` | Update policy |
| GET | `/api/v1/leave/balances` | Balances (own or all, by permission) |
| GET | `/api/v1/leave/balances/:employeeId` | One employee’s balances |
| POST | `/api/v1/leave/balances/adjust` | Manual balance change |
| POST | `/api/v1/leave/requests` | Apply (uses the logged-in employee) |
| GET | `/api/v1/leave/requests` | Visible requests |
| GET | `/api/v1/leave/requests/:id` | One request |
| POST | `/api/v1/leave/requests/:id/approve` | Approve |
| POST | `/api/v1/leave/requests/:id/reject` | Reject |
| POST | `/api/v1/leave/requests/:id/withdraw` | Employee withdraws pending |
| POST | `/api/v1/leave/requests/:id/cancel` | Cancel approved |
| GET | `/api/v1/leave/calendar` | Calendar |
| GET | `/api/v1/leave/history` | History |
| GET | `/api/v1/leave/reports` | Reports |

Same router is mounted at `/api/v1/super-admin/leave`.

## HR / HOD / Manager

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/leave` | Organisation leave list |
| GET | `/api/v1/hr/leave/:id` | Detail with employee, balances, history |
| POST | `/api/v1/hr/leave` | Create (HR) |
| PATCH | `/api/v1/hr/leave/:id/approve` | Approve |
| PATCH | `/api/v1/hr/leave/:id/reject` | Reject |
| GET | `/api/v1/hod/leave` | Department leave |
| PATCH | `/api/v1/hod/leave/:id/approve` | Approve |
| PATCH | `/api/v1/hod/leave/:id/reject` | Reject |
| GET | `/api/v1/manager/leave` | Team leave |
| POST | `/api/v1/manager/leave` | Create |
| GET | `/api/v1/manager/leave/:id` | Detail |
| PATCH | `/api/v1/manager/leave/:id/approve` | Approve |
| PATCH | `/api/v1/manager/leave/:id/reject` | Reject |
| GET | `/api/v1/reports/leave` | Super Admin / analytics report |
| GET | `/api/v1/departments/:id/leave` | Leave for one department |

HR approve/reject use **PATCH**. Shared `/api/v1/leave/requests/:id/approve` uses **POST**. Both hit the same leave engine when HR goes through `leave.service`.

## Balance Formula

```
remainingDays = allocatedDays + carriedForwardDays + accruedDays - usedDays - pendingDays
```

On apply: `pendingDays += workingDays`  
On approve: `pendingDays -= workingDays`, `usedDays += workingDays`  
On reject/withdraw: `pendingDays -= workingDays`  
On cancel (approved): `usedDays -= workingDays`

Unpaid leave has `defaultDays: 0`. Applying unpaid still requires working days; remaining must cover them unless HR adjusts the balance first.

## Permissions

Super Admin bypasses these.

| Permission | Used for |
| --- | --- |
| `leave.view` / `leave.view_own` | Own list, types, balances |
| `leave.view_department` | Department list |
| `leave.view_all` | Organisation list |
| `leave.create` | Apply |
| `leave.approve` | Approve |
| `leave.reject` | Reject |
| `leave.withdraw` | Withdraw pending |
| `leave.cancel` | Cancel approved |
| `leave.manage_types` | Type CRUD |
| `leave.manage_policies` | Policy CRUD |
| `leave.manage_balances` | Adjust balances |
| `leave.reports` | Reports |

## Error Codes

| Code | When |
| --- | --- |
| `LEAVE_TYPE_NOT_FOUND` | Bad `leaveTypeId` |
| `LEAVE_TYPE_INACTIVE` | Type is not active |
| `INVALID_LEAVE_DURATION` | No working days (weekend-only range, etc.) |
| `LEAVE_DATES_OVERLAP` | Dates overlap pending/approved leave |
| `INSUFFICIENT_LEAVE_BALANCE` | Not enough remaining days |
| `NOTICE_REQUIRED` | Start date is too soon for policy |
| `MAXIMUM_LEAVE_EXCEEDED` | Consecutive days over policy max |
| `LEAVE_NOT_PENDING` | Approve/reject/withdraw on non-pending |
| `LEAVE_NOT_APPROVED` | Cancel on non-approved |
| `LEAVE_REQUEST_NOT_FOUND` | Unknown id |
| `FORBIDDEN` | Missing permission or not the owner |
