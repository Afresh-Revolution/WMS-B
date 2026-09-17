# Announcements Integration

Frontend integration file for the WMS announcements module.

Pair this with [announcements.md](./announcements.md) for behaviour and permissions.

Base URL: `{API_ORIGIN}/api/v1`

Super Admin may also call the same paths under `{API_ORIGIN}/api/v1/super-admin`.

## Auth Header

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Use the token from `POST /api/v1/auth/login`.

## Enums

```js
export const ANNOUNCEMENT_STATUS = [
  "draft",
  "scheduled",
  "published",
  "archived",
  "expired",
  "deleted",
];

export const ANNOUNCEMENT_PRIORITY = ["normal", "important", "urgent"];

export const AUDIENCE_TYPE = [
  "all_staff",
  "department",
  "multiple_departments",
  "employee",
];
```

## Create Bodies

### 1. All staff, send now

`POST /api/v1/announcements/admin`

```json
{
  "title": "Office closed Friday",
  "message": "The office will be closed this Friday for a public holiday.",
  "category": "General",
  "priority": "normal",
  "audienceType": "all_staff",
  "isPinned": false,
  "status": "published",
  "notify": true
}
```

### 2. One department

`POST /api/v1/announcements/admin`

```json
{
  "title": "July Payroll Processing",
  "message": "The July payroll will be processed today.",
  "category": "Finance",
  "priority": "important",
  "audienceType": "department",
  "departmentId": "<department-uuid>",
  "isPinned": true,
  "status": "published",
  "expiresAt": "2026-09-30T23:59:59.000Z",
  "notify": true
}
```

### 3. Several departments

`POST /api/v1/announcements/admin`

```json
{
  "title": "Security Maintenance",
  "message": "Badges will be rotated next week.",
  "category": "Security",
  "priority": "important",
  "audienceType": "multiple_departments",
  "departmentIds": ["<finance-department-id>", "<operations-department-id>"]
}
```

This example saves a draft (no `"status": "published"`). Publish later.

### 4. Specific people

`POST /api/v1/announcements/admin`

```json
{
  "title": "One-to-one follow up",
  "message": "Please complete your appraisal form.",
  "category": "HR",
  "priority": "urgent",
  "audienceType": "employee",
  "employeeIds": ["<employee-uuid>"],
  "status": "published"
}
```

You can also send `"employeeId": "<id>"` (single) or `"userIds": ["<user-uuid>"]`.

### 5. Save draft

`POST /api/v1/announcements/admin/drafts`

```json
{
  "title": "Company Retreat",
  "message": "Our annual retreat will hold in September.",
  "category": "Events",
  "priority": "normal",
  "audienceType": "all_staff"
}
```

Always stored as `draft`. Publishing from this body is ignored.

## Create Response

```json
{
  "success": true,
  "message": "Announcement created.",
  "data": {
    "id": "uuid",
    "announcementCode": "ANN-0002",
    "title": "July Payroll Processing",
    "message": "The July payroll will be processed today.",
    "category": "Finance",
    "priority": "important",
    "status": "published",
    "isPinned": true,
    "audienceType": "department",
    "createdBy": "superadmin-user-id",
    "publishedAt": "2026-09-16T10:00:00.000Z",
    "publishedBy": "superadmin-user-id",
    "scheduledAt": null,
    "expiresAt": "2026-09-30T23:59:59.000Z"
  },
  "meta": {
    "recipients": 1,
    "notifications": 1
  }
}
```

Draft create uses message `"Announcement draft created."` and `meta.audiences` instead of recipients.

## Lifecycle Bodies

### Publish

`POST /api/v1/announcements/admin/:id/publish`

```json
{
  "notify": true
}
```

Omit `notify` or set `true` to send in-app notifications. `{ "notify": false }` creates recipients but skips notifications.

### Schedule

`POST /api/v1/announcements/admin/:id/schedule`

```json
{
  "scheduledAt": "2026-09-20T09:00:00.000Z"
}
```

Must be a future ISO timestamp. Works only when current status is `draft` or `scheduled`.

### Update

`PATCH /api/v1/announcements/admin/:id`

```json
{
  "title": "July Payroll Processing Update",
  "message": "Payroll is delayed by one day.",
  "category": "Finance",
  "priority": "urgent",
  "isPinned": false,
  "expiresAt": "2026-10-01T23:59:59.000Z",
  "audienceType": "department",
  "departmentId": "<department-uuid>"
}
```

Send only the fields that changed. `title` and `message` cannot be emptied.

### Pin / unpin / archive

```http
PATCH /api/v1/announcements/admin/:id/pin
PATCH /api/v1/announcements/admin/:id/unpin
PATCH /api/v1/announcements/admin/:id/archive
```

Body can be `{}`.

### Delete

`DELETE /api/v1/announcements/admin/:id`

```json
{
  "reason": "Superseded by a different memo."
}
```

`reason` is optional.

## Admin List Query

`GET /api/v1/announcements/admin`

| Query | Example | Purpose |
| --- | --- | --- |
| `q` | `payroll` | Search title / message / category |
| `status` | `published` | Filter status |
| `category` | `Finance` | Filter category |
| `priority` | `urgent` | Filter priority |
| `audience` | `department` | Filter audience type |
| `pinned` | `true` | Only pinned |
| `dateFrom` | `2026-09-01` | From date |
| `dateTo` | `2026-09-30` | To date |
| `page` | `1` | Page |
| `limit` | `20` | Page size |

Example:

```
GET /api/v1/announcements/admin?status=published&priority=urgent&page=1&limit=20
```

## Admin Analytics Response

`GET /api/v1/announcements/admin/:id/analytics`

```json
{
  "success": true,
  "message": "Announcement analytics loaded.",
  "data": {
    "recipients": 1,
    "delivered": 1,
    "read": 0,
    "unread": 1,
    "readPercentage": 0,
    "departmentBreakdown": [
      {
        "departmentId": "<department-uuid>"
      }
    ]
  },
  "meta": {}
}
```

## Staff Feed

### List

`GET /api/v1/announcements`

Only published, non-expired items for the current employee.

### Unread badge

`GET /api/v1/announcements/unread-count`

```json
{
  "success": true,
  "message": "Unread announcements counted.",
  "data": { "count": 2 },
  "meta": {}
}
```

### Mark read

`PATCH /api/v1/announcements/:id/read`

```json
{}
```

Always applies to the logged-in user.

```json
{
  "success": true,
  "message": "Announcement marked as read.",
  "data": {
    "announcementId": "uuid",
    "employeeId": "employee-uuid",
    "isRead": true,
    "readAt": "2026-09-16T10:05:00.000Z"
  },
  "meta": {}
}
```

## Error Shape

```json
{
  "success": false,
  "message": "Operation failed",
  "error": {
    "code": "ANNOUNCEMENT_ALREADY_PUBLISHED",
    "details": {}
  }
}
```

| HTTP | Code |
| --- | --- |
| 400 | `ANNOUNCEMENT_REQUIRED_FIELDS`, `ANNOUNCEMENT_DEPARTMENT_REQUIRED`, `ANNOUNCEMENT_EMPLOYEE_REQUIRED`, `ANNOUNCEMENT_SCHEDULE_REQUIRED`, `ANNOUNCEMENT_INVALID_SCHEDULE`, `ANNOUNCEMENT_SCHEDULE_IN_PAST` |
| 403 | `FORBIDDEN`, `EMPLOYEE_PROFILE_REQUIRED` |
| 404 | `ANNOUNCEMENT_NOT_FOUND` |
| 409 | `ANNOUNCEMENT_ALREADY_PUBLISHED`, `ANNOUNCEMENT_NOT_PUBLISHABLE`, `ANNOUNCEMENT_NOT_SCHEDULABLE` |

## Frontend Client Helper

```js
const API = "/api/v1";

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export const announcementsApi = {
  create(token, body) {
    return fetch(`${API}/announcements/admin`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    }).then((res) => res.json());
  },

  createDraft(token, body) {
    return fetch(`${API}/announcements/admin/drafts`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    }).then((res) => res.json());
  },

  publish(token, id, notify = true) {
    return fetch(`${API}/announcements/admin/${id}/publish`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ notify }),
    }).then((res) => res.json());
  },

  schedule(token, id, scheduledAt) {
    return fetch(`${API}/announcements/admin/${id}/schedule`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ scheduledAt }),
    }).then((res) => res.json());
  },

  listAdmin(token, query = "") {
    return fetch(`${API}/announcements/admin${query}`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  getAdmin(token, id) {
    return fetch(`${API}/announcements/admin/${id}`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  update(token, id, body) {
    return fetch(`${API}/announcements/admin/${id}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify(body),
    }).then((res) => res.json());
  },

  pin(token, id) {
    return fetch(`${API}/announcements/admin/${id}/pin`, {
      method: "PATCH",
      headers: headers(token),
      body: "{}",
    }).then((res) => res.json());
  },

  unpin(token, id) {
    return fetch(`${API}/announcements/admin/${id}/unpin`, {
      method: "PATCH",
      headers: headers(token),
      body: "{}",
    }).then((res) => res.json());
  },

  archive(token, id) {
    return fetch(`${API}/announcements/admin/${id}/archive`, {
      method: "PATCH",
      headers: headers(token),
      body: "{}",
    }).then((res) => res.json());
  },

  remove(token, id, reason) {
    return fetch(`${API}/announcements/admin/${id}`, {
      method: "DELETE",
      headers: headers(token),
      body: JSON.stringify({ reason }),
    }).then((res) => res.json());
  },

  recipients(token, id) {
    return fetch(`${API}/announcements/admin/${id}/recipients`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  analytics(token, id) {
    return fetch(`${API}/announcements/admin/${id}/analytics`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  dashboard(token) {
    return fetch(`${API}/announcements/admin/dashboard`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  feed(token) {
    return fetch(`${API}/announcements`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  unreadCount(token) {
    return fetch(`${API}/announcements/unread-count`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  get(token, id) {
    return fetch(`${API}/announcements/${id}`, {
      headers: headers(token),
    }).then((res) => res.json());
  },

  markRead(token, id) {
    return fetch(`${API}/announcements/${id}/read`, {
      method: "PATCH",
      headers: headers(token),
      body: "{}",
    }).then((res) => res.json());
  },
};
```

## Screen Wiring

Super Admin compose:

1. Load departments: `GET /api/v1/lookups/departments`
2. Load people (if targeting employees): `GET /api/v1/lookups/employees`
3. Submit `create()` with `status: "published"` or `createDraft()` then `publish()`

Staff inbox:

1. `unreadCount()` for the badge
2. `feed()` for the list
3. `get(id)` then `markRead(id)` when opened
