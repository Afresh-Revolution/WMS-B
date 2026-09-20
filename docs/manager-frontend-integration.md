# Manager Frontend Integration

Use this file when wiring the **Manager** workspace: Finance claims, vendors, clock-in, NYSC members, and announcements.

Base URL: `{API_ORIGIN}/api/v1`

Legacy alias: `{API_ORIGIN}/api/manager` (same manager routes without `/v1`)

## Auth

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Token comes from `POST /api/v1/auth/login`. The user `role` must be `manager`.

Do **not** send Manager actions to Super Admin-only pages and hope they work. Preferred Manager paths are listed first. Shared `/api/v1/...` paths also work for a manager now. The old Super Admin URLs for expenses, vendors, NYSC, and announcements are accepted as a temporary fallback only.

## What was failing

| Manager screen | Old frontend call | Result | Use this instead |
| --- | --- | --- | --- |
| Submit expense claim | `POST /api/v1/expenses` without `expense.create`, or Super Admin expenses | 403 Access denied | `POST /api/v1/manager/expenses` |
| Add vendor | `POST /api/v1/vendors` (was Super Admin only) | 403 Access denied | `POST /api/v1/manager/vendors` |
| Clock in | `POST /api/v1/manager/attendance/clock-in` (missing) or GPS check-in | 404 Not Found | `POST /api/v1/manager/attendance/clock-in` |
| Add NYSC member | `POST /api/v1/super-admin/nysc-interns` | 403/404 | `POST /api/v1/manager/nysc-interns` |
| New announcement | `POST /api/v1/announcements` with no create handler, or Super Admin | 404 Not Found | `POST /api/v1/manager/announcements` |

Map toasts from the HTTP status and `error.code`. Do not show “Not Founded” for every failure.

| Status | Typical `error.code` | Toast |
| --- | --- | --- |
| 201 / 200 | — | Success |
| 400 | `VENDOR_NAME_REQUIRED`, `FULL_NAME_REQUIRED`, `ANNOUNCEMENT_REQUIRED_FIELDS` | Show `error.message` |
| 403 | `FORBIDDEN` | Access denied |
| 404 | `DEPARTMENT_NOT_FOUND`, `SUPERVISOR_NOT_FOUND`, `CATEGORY_NOT_FOUND` | Show `error.message` (pick a real department / supervisor / category) |
| 409 | `ACTIVE_PLACEMENT_EXISTS`, `EXPENSE_LIMIT_EXCEEDED` | Show `error.message` |

## Lookups (dropdowns)

Load these before opening Add member, Add vendor, or New announcement.

```http
GET /api/v1/manager/lookups
GET /api/v1/manager/employees
GET /api/v1/manager/departments
GET /api/v1/expenses/categories
```

`GET /api/v1/manager/lookups` includes:

- `departments[]` — `{ id, name, code }`
- `locationTypes[]` — `onsite`, `remote`
- employment types and roles

Supervisor options must come from `GET /api/v1/manager/employees` (or the staff directory). Send the employee **id**. The backend also accepts the supervisor **name** (for example `Abner Supervisor`) if the directory has an exact or close match.

Department can be the UUID or the name (`Administration`). If omitted, the backend uses the manager’s department, then the first active department.

---

## 1. Submit expense claim

Manager Finance → **Submit claim**.

### Preferred

`POST /api/v1/manager/expenses`

Aliases that also work for a manager:

- `POST /api/v1/manager/expense-claims`
- `POST /api/v1/manager/claims`
- `POST /api/v1/expenses`
- `POST /api/v1/super-admin/expenses` (fallback only)

### Body (matches the current form)

```json
{
  "description": "Team lunch with a client",
  "category": "Meals",
  "date": "2026-09-20",
  "amount": 100000
}
```

Accepted field aliases:

| Form field | Send as | Also accepted |
| --- | --- | --- |
| Description | `description` | — |
| Category | `category` | `categoryId`, `category_id` |
| Date | `date` | `expenseDate`, `expense_date` |
| Amount | `amount` | `items[]` |

`category` can be the seeded name. Seeded names:

`Meals`, `Transport`, `Accommodation`, `Fuel`, `Office Supplies`, `Communication`, `Travel`, `Client Entertainment`, `Training`, `Software`, `Equipment`, `Medical`, `Internet`, `Other`

Receipt upload is optional for this simple claim form. Do not block submit if the user has no file.

### Success

`201`

```json
{
  "success": true,
  "message": "Expense claim submitted.",
  "data": {
    "id": "<expense-uuid>",
    "reference": "EXP-0001",
    "description": "Team lunch with a client",
    "category": "Meals",
    "amount": 100000,
    "currency": "NGN",
    "status": "SUBMITTED",
    "expenseDate": "2026-09-20"
  },
  "meta": {}
}
```

### List / approve

```http
GET    /api/v1/manager/expenses
GET    /api/v1/manager/finance
GET    /api/v1/manager/expenses/:id
PATCH  /api/v1/manager/expenses/:id/approve
PATCH  /api/v1/manager/expenses/:id/reject
GET    /api/v1/expenses/categories
```

---

## 2. Add vendor

Manager Finance → Vendors → **Add vendor**.

### Preferred

`POST /api/v1/manager/vendors`

Aliases:

- `POST /api/v1/manager/vendor`
- `POST /api/v1/vendors`
- `POST /api/v1/super-admin/vendors` (fallback only)

### Body

```json
{
  "name": "Plangnan",
  "category": "Meals",
  "location": "Jos",
  "email": "nungseplangnan@gmail.com"
}
```

`vendorName` / `vendor_name` are accepted instead of `name`.

Optional: `phone`, `notes`, `status` (`active` by default).

### Success

`201`

```json
{
  "success": true,
  "message": "Vendor created.",
  "data": {
    "id": "<vendor-uuid>",
    "name": "Plangnan",
    "vendorName": "Plangnan",
    "category": "Meals",
    "location": "Jos",
    "email": "nungseplangnan@gmail.com",
    "status": "active"
  },
  "meta": {}
}
```

### List / update

```http
GET    /api/v1/manager/vendors
GET    /api/v1/vendors
GET    /api/v1/manager/vendors/:id
PATCH  /api/v1/manager/vendors/:id
```

---

## 3. Clock in

Manager Attendance → **Clock in**.

This Manager modal is a **simple clock-in**. It does **not** send GPS. Do not call the employee GPS endpoint for a manager.

### Preferred

`POST /api/v1/manager/attendance/clock-in`

```json
{}
```

Optional body:

```json
{
  "date": "2026-09-20",
  "checkIn": "2026-09-20T18:39:00.000Z"
}
```

If `date` / `checkIn` are omitted, the server uses today and server time.

Aliases:

- `POST /api/v1/manager/attendance`
- `POST /api/v1/manager/attendance/clockIn`
- `POST /api/v1/manager/attendance/check-in`
- `POST /api/v1/manager/clock-in`
- `POST /api/v1/attendance/clock-in` (manager token only; this is the simple clock-in, not GPS)

### Do not call for managers

```http
POST /api/v1/attendance/check-in
POST /api/v1/employee/attendance/check-in
```

Those are GPS geofence check-in. Managers are not on that flow. They return 403 `EMPLOYEE_CHECK_IN_ROLE_REQUIRED` unless a full GPS payload is used by an employee / accountant / intern / NYSC account.

### Success

`201` first clock-in of the day, `200` if already clocked in (`meta.idempotent: true`).

```json
{
  "success": true,
  "message": "Clock-in recorded.",
  "data": {
    "id": "<attendance-uuid>",
    "employeeId": "<employee-uuid>",
    "employeeName": "Smoke Manager",
    "workDate": "2026-09-20",
    "checkIn": "2026-09-20T18:39:00.000Z",
    "status": "PRESENT",
    "source": "manager_self_service"
  },
  "meta": { "idempotent": false }
}
```

### Clock out / team list

```http
POST   /api/v1/manager/attendance/clock-out
GET    /api/v1/manager/attendance
GET    /api/v1/manager/attendance/:id
PATCH  /api/v1/manager/attendance/:id/correct
```

The manager must have a linked employee profile. Login / user-create now creates that profile for `manager`. If clock-in returns `EMPLOYEE_PROFILE_REQUIRED`, the account is not linked in the directory.

---

## 4. Add NYSC member

Manager NYSC & Interns → **Add member**.

### Preferred

`POST /api/v1/manager/nysc-interns`

Aliases:

- `POST /api/v1/manager/nysc`
- `POST /api/v1/manager/nysc-interns/members`
- `POST /api/v1/nysc-interns`
- `POST /api/v1/super-admin/nysc-interns` (fallback only)

### Body

```json
{
  "fullName": "Samuel Nungse",
  "email": "samuelnungse0@gmail.com",
  "phone": "07088944773",
  "type": "NYSC",
  "departmentId": "<department-uuid>",
  "supervisorEmployeeId": "<employee-uuid>",
  "startDate": "2026-09-21",
  "endDate": "2027-01-19"
}
```

Accepted aliases:

| Form field | Preferred | Also accepted |
| --- | --- | --- |
| Full name | `fullName` | `full_name`, `name` |
| Type | `type`: `NYSC` or `INTERN` | `staffType` |
| Department | `departmentId` | `department` as name, e.g. `"Administration"` |
| Supervisor | `supervisorEmployeeId` | `supervisorId`, `supervisor` as id **or name** |
| Start / end | `startDate`, `endDate` | `start_date`, `end_date` |

`endDate` must be after `startDate`. Same calendar day is rejected (`INVALID_PLACEMENT_DATES`).

`type` defaults to `NYSC` if omitted.

Institution / course are optional. The backend fills `NYSC` / `Not specified` when missing.

### Success

`201`

```json
{
  "success": true,
  "message": "NYSC/intern member created.",
  "data": {
    "profile": {
      "id": "<profile-uuid>",
      "fullName": "Samuel Nungse",
      "type": "NYSC",
      "email": "samuelnungse0@gmail.com",
      "phone": "07088944773",
      "status": "ACTIVE"
    },
    "placement": {
      "id": "<placement-uuid>",
      "departmentId": "<department-uuid>",
      "startDate": "2026-09-21",
      "expectedEndDate": "2027-01-19",
      "placementStatus": "PENDING"
    },
    "department": { "id": "<department-uuid>", "name": "Administration" },
    "supervisor": {
      "id": "<employee-uuid>",
      "fullName": "Abner Supervisor",
      "assignment": { "employeeId": "<employee-uuid>" }
    }
  },
  "meta": {}
}
```

### List / export

```http
GET /api/v1/manager/nysc-interns
GET /api/v1/manager/nysc-interns/dashboard
GET /api/v1/manager/nysc-interns/export
GET /api/v1/manager/nysc-interns/:id
PATCH /api/v1/manager/nysc-interns/:id
POST /api/v1/manager/nysc-interns/:id/supervisor
```

---

## 5. New announcement

Manager Announcements → **New announcement** / Save + Publish now.

### Preferred

`POST /api/v1/manager/announcements`

Aliases:

- `POST /api/v1/manager/announcement`
- `POST /api/v1/announcements`
- `POST /api/v1/announcements/admin`
- `POST /api/v1/super-admin/announcements` (fallback only)

Manager create defaults to **published** if `status` is omitted.

### Body (matches the current form — title optional)

```json
{
  "body": "Placement orientation is on Monday at 9:00.",
  "category": "Events",
  "priority": "normal",
  "audience": "All staff",
  "department": "Administration",
  "pinToTop": "No",
  "whenToSend": "Publish now",
  "expires": "2026-09-20"
}
```

If `title` is missing, the backend uses the first line of `body` / `message` (max 120 chars).

Canonical body (preferred going forward):

```json
{
  "title": "Placement orientation",
  "message": "Placement orientation is on Monday at 9:00.",
  "category": "Events",
  "priority": "normal",
  "audienceType": "all_staff",
  "isPinned": false,
  "status": "published",
  "expiresAt": "2026-09-20"
}
```

### Field aliases

| Form field | Preferred | Also accepted |
| --- | --- | --- |
| Title | `title` | `subject`, or first line of message |
| Message | `message` | `body`, `content`, `text`, `description` |
| Category | `category` | free text, default `General` |
| Priority | `priority`: `normal` / `important` / `urgent` | `Normal` is lowercased |
| Audience | `audienceType`: `all_staff` | `audience`: `All staff`, `everyone`, `department` |
| Department | `departmentId` | `department` as name |
| Pin | `isPinned`: boolean | `pinToTop`: `Yes` / `No` |
| When to send | `status`: `published` | `whenToSend`: `Publish now` |
| Expires | `expiresAt` | `expires`, `expiry` |

Audience values the backend understands:

- `all_staff`, `All staff`, `everyone`, `general`, `staff`
- `department`, `single_department`
- `employee`, `employees`
- `multiple_departments` plus `departmentIds: []`

If audience is `all_staff`, `department` is ignored. If audience is `department`, send a real department id or name.

### Success

`201`

```json
{
  "success": true,
  "message": "Announcement published.",
  "data": {
    "id": "<announcement-uuid>",
    "title": "Placement orientation is on Monday at 9:00.",
    "message": "Placement orientation is on Monday at 9:00.",
    "category": "Events",
    "priority": "normal",
    "status": "published",
    "isPinned": false,
    "audienceType": "all_staff"
  },
  "meta": {}
}
```

### List / publish later

```http
GET  /api/v1/manager/announcements
GET  /api/v1/manager/announcements/:id
POST /api/v1/manager/announcements/:id/publish
GET  /api/v1/announcements
```

`GET /api/v1/announcements` is the **staff feed** (published items for the signed-in user). Admin/manager compose list is `GET /api/v1/manager/announcements` or `GET /api/v1/announcements/admin`.

---

## Recommended frontend API map

Use role-based clients. For `role === "manager"`:

```js
export const managerApi = {
  lookups: "GET /api/v1/manager/lookups",
  employees: "GET /api/v1/manager/employees",
  departments: "GET /api/v1/manager/departments",

  clockIn: "POST /api/v1/manager/attendance/clock-in",
  clockOut: "POST /api/v1/manager/attendance/clock-out",
  attendance: "GET /api/v1/manager/attendance",

  submitClaim: "POST /api/v1/manager/expenses",
  listExpenses: "GET /api/v1/manager/expenses",
  expenseCategories: "GET /api/v1/expenses/categories",
  addVendor: "POST /api/v1/manager/vendors",
  listVendors: "GET /api/v1/manager/vendors",

  addNyscMember: "POST /api/v1/manager/nysc-interns",
  listNysc: "GET /api/v1/manager/nysc-interns",

  createAnnouncement: "POST /api/v1/manager/announcements",
  listAnnouncements: "GET /api/v1/manager/announcements",
};
```

Stop routing Manager create actions through `/api/v1/super-admin/...` except as a last-resort fallback. Super Admin system routes (`/users` create is allowed for manager on `/api/v1/users`, but `/api/v1/super-admin/users` stays Super Admin only).

## Who can create users

Only `superadmin`, `manager`, and `hr` may `POST /api/v1/users`. Other roles get 403.

```http
POST /api/v1/users
```

```json
{
  "fullName": "New Staff",
  "email": "new.staff@example.com",
  "role": "employee",
  "status": "active",
  "departmentId": "<department-uuid>"
}
```

New staff get a directory employee profile automatically. That profile is required for leave, expenses, and clock-in.

## Employee directory location (not GPS)

When adding or editing a person, location on the card is **work mode + typed place**, not the employee UUID.

```json
{
  "locationType": "remote",
  "location": "Jos"
}
```

`locationType`: `remote` | `onsite`.

Do not render `employee.id` under the pin icon.

GPS office pins for employee check-in are a separate Super Admin / manager attendance-location API (`POST /api/v1/attendance/locations` with `latitude`, `longitude`, `radiusMeters`). That is not the directory location dropdown.

## Error envelope

Failed calls look like:

```json
{
  "success": false,
  "message": "Operation failed",
  "error": {
    "code": "FORBIDDEN",
    "details": {}
  }
}
```

Some older auth gates still return `{ "error": "Forbidden." }` with no `success` field. Treat any 403 as access denied.

Useful codes:

| Code | Meaning |
| --- | --- |
| `FORBIDDEN` | Missing permission or Super Admin-only route |
| `VENDOR_NAME_REQUIRED` | Vendor name empty |
| `CATEGORY_NOT_FOUND` | Expense category name/id not in the catalog |
| `EMPLOYEE_PROFILE_REQUIRED` | Manager has no directory row — clock-in / claim cannot bind |
| `DEPARTMENT_NOT_FOUND` | Department id/name missing or inactive |
| `SUPERVISOR_NOT_FOUND` | Supervisor not in the employee directory |
| `FULL_NAME_REQUIRED` | NYSC full name missing |
| `INVALID_PLACEMENT_DATES` | End date not after start date |
| `ACTIVE_PLACEMENT_EXISTS` | That person already has an active NYSC/intern placement |
| `ANNOUNCEMENT_REQUIRED_FIELDS` | No title and no message/body |
| `ANNOUNCEMENT_DEPARTMENT_REQUIRED` | Audience is department but no department sent |

## Checklist for the Manager app

1. Finance Submit claim → `POST /api/v1/manager/expenses` with `description`, `category`, `date`, `amount`.
2. Finance Add vendor → `POST /api/v1/manager/vendors` with `name` (or `vendorName`), `category`, `location`, `email`.
3. Attendance Clock in → `POST /api/v1/manager/attendance/clock-in` with `{}`. Do not send GPS.
4. NYSC Add member → `POST /api/v1/manager/nysc-interns`. Department and supervisor from lookups/directory, not typed junk.
5. New announcement → `POST /api/v1/manager/announcements`. `body` is enough; add `title` when the form has one. `whenToSend: "Publish now"` publishes immediately.
6. Show `error.message` or `error.code` in the toast. Do not label every 404 as “Not Founded”.
