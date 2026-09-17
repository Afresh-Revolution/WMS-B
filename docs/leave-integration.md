# Leave Integration

Frontend integration for the WMS leave module.

Pair this with [leave.md](./leave.md) for behaviour, balances, and approval flow.

Base URL: `{API_ORIGIN}/api/v1`

Super Admin may also call the shared engine under `{API_ORIGIN}/api/v1/super-admin/leave`.

## Auth Header

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Use the token from `POST /api/v1/auth/login`.

## Enums

```js
export const LEAVE_STATUS = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "WITHDRAWN",
];

export const DURATION_TYPE = ["FULL_DAY", "HALF_DAY"];

export const LEAVE_TYPE_CODE = ["ANNUAL", "SICK", "PERSONAL", "UNPAID"];
```

Seeded types (created on first types list):

| Code | Name | Default days | Document required |
| --- | --- | --- | --- |
| `ANNUAL` | Annual Leave | 25 | no |
| `SICK` | Sick Leave | 10 | yes |
| `PERSONAL` | Personal Leave | 5 | no |
| `UNPAID` | Unpaid Leave | 0 | no |

Always send `leaveTypeId` from `GET .../leave/types`. Do not hardcode ids.

## Employee screen (Leave & time off)

Load the page in this order:

1. `GET /employee/leave/types` — apply modal options
2. `GET /employee/leave/balances` — four summary cards
3. `GET /employee/leave` — list (add `?status=` when a tab is selected)

### 1. Types

`GET /api/v1/employee/leave/types`

```json
{
  "success": true,
  "message": "Employee leave types loaded.",
  "data": [
    {
      "id": "<leave-type-uuid>",
      "name": "Annual Leave",
      "code": "ANNUAL",
      "defaultDays": 25,
      "paid": true,
      "requiresDocument": false,
      "status": "active"
    }
  ],
  "meta": { "page": 1, "limit": 25, "total": 4 }
}
```

### 2. Balances (cards)

`GET /api/v1/employee/leave/balances`

```json
{
  "success": true,
  "message": "Employee leave balances loaded.",
  "data": [
    {
      "id": "<balance-uuid>",
      "employeeId": "<employee-uuid>",
      "leaveTypeId": "<leave-type-uuid>",
      "leaveTypeName": "Annual Leave",
      "year": 2026,
      "allocatedDays": 25,
      "carriedForwardDays": 0,
      "accruedDays": 0,
      "usedDays": 8,
      "pendingDays": 0,
      "remainingDays": 17
    }
  ],
  "meta": {}
}
```

Map the screenshot cards:

```js
function leaveCards(balances, types) {
  const byName = (name) =>
    balances.find((row) => String(row.leaveTypeName || "").toLowerCase().includes(name));

  const typeFallback = (code) => types.find((row) => row.code === code);
  const card = (balance, type) => ({
    remaining: Number(balance?.remainingDays ?? type?.defaultDays ?? 0),
    used: Number(balance?.usedDays ?? 0),
    allocated: Number(balance?.allocatedDays ?? type?.defaultDays ?? 0),
  });

  const annual = card(byName("annual"), typeFallback("ANNUAL"));
  const sick = card(byName("sick"), typeFallback("SICK"));
  const personal = card(byName("personal"), typeFallback("PERSONAL"));

  return {
    daysRemaining: balances.reduce((sum, row) => sum + Number(row.remainingDays || 0), 0)
      || annual.remaining + sick.remaining + personal.remaining,
    annual,
    sick,
    personal,
  };
}
```

`DAYS REMAINING` is the sum of remaining across types (29 in the mock: 17 + 8 + 4).  
Subtitle on Annual: `{used} of {allocated}` used, matching “8 of 25 used”.

Balances are created the first time that type is applied (or when HR adjusts). If `data` is empty, show cards from type `defaultDays` with `used = 0`.

### 3. Request list (tabs)

All:

`GET /api/v1/employee/leave`

Pending / Approved / Rejected:

`GET /api/v1/employee/leave?status=PENDING`  
`GET /api/v1/employee/leave?status=APPROVED`  
`GET /api/v1/employee/leave?status=REJECTED`

Also: `q`, `page`, `limit`.

```json
{
  "success": true,
  "message": "Employee leave requests loaded.",
  "data": [
    {
      "id": "<request-uuid>",
      "leaveTypeId": "<leave-type-uuid>",
      "leaveTypeName": "Annual Leave",
      "startDate": "2026-08-25",
      "endDate": "2026-08-29",
      "duration": 5,
      "calendarDays": 5,
      "durationType": "FULL_DAY",
      "note": "Family trip",
      "status": "PENDING",
      "submittedAt": "2026-08-01T09:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 25, "total": 1 }
}
```

Row title: `{leaveTypeName} · {duration} days`  
Dates: `{startDate} – {endDate}` plus `note`  
Chip: `status`

There is no `LV-4021` display code from the API. Use `id`, or format a client label from the first 8 characters of `id` if the UI needs a short reference.

### 4. Apply for leave

`POST /api/v1/employee/leave`

Same body on `POST /api/v1/employee/leave/requests` and `POST /api/v1/leave/requests`.

The employee is taken from the token. Do not send `employeeId`.

`duration` from the client is ignored. The server counts working days (weekends and holidays excluded unless policy says otherwise).

#### Full days

```json
{
  "leaveTypeId": "<leave-type-uuid>",
  "startDate": "2026-08-25",
  "endDate": "2026-08-29",
  "durationType": "FULL_DAY",
  "note": "Family trip"
}
```

#### Half day (same start and end)

```json
{
  "leaveTypeId": "<leave-type-uuid>",
  "startDate": "2026-08-25",
  "endDate": "2026-08-25",
  "durationType": "HALF_DAY",
  "note": "Morning appointment"
}
```

#### Sick leave with attachment

Use when `requiresDocument` is true on the type.

```json
{
  "leaveTypeId": "<sick-leave-type-uuid>",
  "startDate": "2026-07-14",
  "endDate": "2026-07-15",
  "durationType": "FULL_DAY",
  "note": "Fever",
  "attachments": [
    {
      "name": "doctors-note.pdf",
      "fileUrl": "https://files.example.com/doctors-note.pdf",
      "type": "application/pdf"
    }
  ]
}
```

`201` response:

```json
{
  "success": true,
  "message": "Employee leave request submitted.",
  "data": {
    "id": "<request-uuid>",
    "leaveTypeName": "Annual Leave",
    "startDate": "2026-08-25",
    "endDate": "2026-08-29",
    "duration": 5,
    "calendarDays": 5,
    "status": "PENDING",
    "note": "Family trip",
    "workflow": {},
    "attachments": []
  },
  "meta": {
    "balance": {
      "allocatedDays": 25,
      "usedDays": 8,
      "pendingDays": 5,
      "remainingDays": 12
    }
  }
}
```

After apply, refresh balances and the list. Remaining drops immediately because days sit on `pendingDays`.

### 5. One request (decision letter)

`GET /api/v1/employee/leave/:id`

There is **no** `GET .../leave/:id/letter` or PDF route. For **Decision letter** on approved rows, render from this payload (`leaveTypeName`, `startDate`, `endDate`, `duration`, `approvedBy`, `approvedAt`, comments).

### 6. Withdraw pending (optional)

Employee, pending only:

`POST /api/v1/leave/requests/:id/withdraw`

```json
{
  "reason": "Plans changed"
}
```

## Approve / reject (HR, HOD, manager, Super Admin)

Shared engine (POST):

`POST /api/v1/leave/requests/:id/approve`

```json
{
  "comment": "Get well soon. Approved."
}
```

`POST /api/v1/leave/requests/:id/reject`

```json
{
  "reason": "Team coverage is not available that week."
}
```

Reject requires `reason` or `comment` (`REJECTION_REASON_REQUIRED`).

HR aliases (PATCH):

`PATCH /api/v1/hr/leave/:id/approve`  
`PATCH /api/v1/hr/leave/:id/reject`

HOD:

`PATCH /api/v1/hod/leave/:id/approve`  
`PATCH /api/v1/hod/leave/:id/reject`

Manager:

`PATCH /api/v1/manager/leave/:id/approve`  
`PATCH /api/v1/manager/leave/:id/reject`

Cancel approved:

`POST /api/v1/leave/requests/:id/cancel`

```json
{
  "reason": "Employee returned early"
}
```

## Admin: types, policies, balances

### Create type

`POST /api/v1/leave/types`

```json
{
  "name": "Study Leave",
  "code": "STUDY",
  "description": "Paid study leave.",
  "defaultDays": 10,
  "paid": true,
  "requiresDocument": true,
  "requiresApproval": true,
  "carryForwardAllowed": false,
  "maxCarryForwardDays": 0,
  "status": "active"
}
```

### Create policy

`POST /api/v1/leave/policies`

```json
{
  "leaveTypeId": "<leave-type-uuid>",
  "annualDays": 25,
  "accrualMethod": "YEARLY",
  "minimumNoticeDays": 7,
  "maximumConsecutiveDays": 15,
  "carryForwardEnabled": true,
  "maxCarryForwardDays": 5,
  "halfDayEnabled": true,
  "weekendCounted": false
}
```

### Adjust balance

`POST /api/v1/leave/balances/adjust`

```json
{
  "employeeId": "<employee-uuid>",
  "leaveTypeId": "<leave-type-uuid>",
  "year": 2026,
  "adjustmentDays": 2,
  "reason": "Carry-over correction"
}
```

`adjustmentDays` is added to `accruedDays` (use a negative number to reduce). `reason` is required.

## Error shape

```json
{
  "success": false,
  "message": "Insufficient leave balance.",
  "error": {
    "code": "INSUFFICIENT_LEAVE_BALANCE",
    "details": {}
  }
}
```

| HTTP | Code | UI |
| --- | --- | --- |
| 400 | `INVALID_LEAVE_DURATION` | Range has no working days |
| 400 | `NOTICE_REQUIRED` | Start date is too soon |
| 400 | `REJECTION_REASON_REQUIRED` | Reject without reason |
| 403 | `FORBIDDEN` | Missing permission / not owner |
| 404 | `LEAVE_TYPE_NOT_FOUND` | Bad type id |
| 404 | `LEAVE_REQUEST_NOT_FOUND` | Bad request id |
| 409 | `LEAVE_DATES_OVERLAP` | Dates clash with pending/approved |
| 409 | `INSUFFICIENT_LEAVE_BALANCE` | Not enough remaining days |
| 409 | `LEAVE_NOT_PENDING` | Approve/reject/withdraw on a decided request |
| 409 | `LEAVE_NOT_APPROVED` | Cancel on a non-approved request |

## Frontend client

```js
const API = `${process.env.NEXT_PUBLIC_API_ORIGIN}/api/v1`;

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export const leaveApi = {
  types(token) {
    return fetch(`${API}/employee/leave/types`, { headers: headers(token) }).then((res) => res.json());
  },

  balances(token) {
    return fetch(`${API}/employee/leave/balances`, { headers: headers(token) }).then((res) => res.json());
  },

  list(token, { status, q, page = 1, limit = 25 } = {}) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status && status !== "ALL") params.set("status", status);
    if (q) params.set("q", q);
    return fetch(`${API}/employee/leave?${params}`, { headers: headers(token) }).then((res) => res.json());
  },

  get(token, id) {
    return fetch(`${API}/employee/leave/${id}`, { headers: headers(token) }).then((res) => res.json());
  },

  apply(token, body) {
    return fetch(`${API}/employee/leave`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    }).then((res) => res.json());
  },

  withdraw(token, id, reason) {
    return fetch(`${API}/leave/requests/${id}/withdraw`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ reason }),
    }).then((res) => res.json());
  },

  approve(token, id, comment) {
    return fetch(`${API}/leave/requests/${id}/approve`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ comment }),
    }).then((res) => res.json());
  },

  reject(token, id, reason) {
    return fetch(`${API}/leave/requests/${id}/reject`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ reason }),
    }).then((res) => res.json());
  },

  hrApprove(token, id, comment) {
    return fetch(`${API}/hr/leave/${id}/approve`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({ comment }),
    }).then((res) => res.json());
  },

  hrReject(token, id, reason) {
    return fetch(`${API}/hr/leave/${id}/reject`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({ reason }),
    }).then((res) => res.json());
  },
};
```

## Suggested page load

```js
const [typesRes, balancesRes, listRes] = await Promise.all([
  leaveApi.types(token),
  leaveApi.balances(token),
  leaveApi.list(token, { status: activeTab }),
]);
```

On **Apply for leave** success, call `balances` and `list` again so the cards and tabs stay in sync.
