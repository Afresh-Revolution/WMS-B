# Announcements

This document explains how announcements work on WMS-B and which APIs the frontend should call.

Default API base: `/api/v1/announcements`

Super Admin alias (same router): `/api/v1/super-admin/announcements`

Authentication for every route:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Super Admin can do every announcement action. Other roles need announcement permissions. Staff can only read the feed that was targeted to them and mark those items as read.

Copy-paste request bodies, query params, and frontend client helpers are in [announcements-integration.md](./announcements-integration.md).

## How It Works

An announcement is a company memo. Super Admin (or a user with create/publish permission) writes it, chooses who should see it, then either saves a draft, schedules it, or publishes it immediately.

Publishing is the important step. Until an announcement is published:

- it does not appear in the staff feed
- no recipient rows are created
- no in-app notifications are sent

When it is published, the backend:

1. Resolves the audience into a list of **active employees**
2. Creates one recipient record per employee (`deliveredAt` now, `isRead: false`)
3. Queues an in-app notification for each employee who has a login (`userId`)
4. Sets `status` to `published`, `publishedAt`, and `publishedBy`

Staff then load `GET /api/v1/announcements`. That list only includes **published** items targeted to the logged-in employee. Expired items drop off the feed. Marking read updates that employee’s recipient row only. You cannot mark another person as read.

## Status Lifecycle

```
draft ──publish──► published ──archive──► archived
  │                    │
  │                    └── expiresAt passed ──► expired
  └──schedule──► scheduled ──publish──► published
```

| Status | Meaning | Staff can see it? |
| --- | --- | --- |
| `draft` | Saved, not sent | No |
| `scheduled` | Waiting for `scheduledAt` | No |
| `published` | Live in the feed | Yes, if they are in the audience |
| `archived` | Taken down by admin | No |
| `expired` | `expiresAt` has passed | No |
| `deleted` | Soft-deleted | No |

Rules:

- `POST /admin/drafts` always creates `draft`, even if the body sends `"status": "published"`.
- `POST /admin` with `"status": "published"` creates a draft internally, then publishes it in the same request.
- Publishing a published announcement returns `409 ANNOUNCEMENT_ALREADY_PUBLISHED`.
- Scheduling only works on `draft` or `scheduled`. `scheduledAt` must be a future ISO date.
- Delete is a soft delete. Send an optional `reason`.

Each announcement also gets a code like `ANN-0001`.

## Who Sees What (Audience)

`audienceType` decides the recipient list at **publish time**.

| `audienceType` | Who is included | Required fields |
| --- | --- | --- |
| `all_staff` | Every active employee | none |
| `department` | Active employees in one department | `departmentId` |
| `multiple_departments` | Active employees in those departments | `departmentIds` |
| `employee` | Specific people | `employeeId` / `employeeIds` and/or `userIds` |

Inactive, suspended, terminated, or deleted employees are skipped.

Department matching uses the employee’s `departmentId`. Load department ids from `GET /api/v1/lookups/departments` or `GET /api/v1/departments`. Load people from `GET /api/v1/lookups/hods` or `GET /api/v1/lookups/employees`.

If you target `department` or `employee` without the matching ids, create fails with `400`.

## Priority And Category

Priority (defaults to `normal`):

- `normal`
- `important`
- `urgent`

Category is a free-text label. If omitted, it becomes `General`. Examples used in the product: `Events`, `Finance`, `Security`.

`isPinned: true` keeps the item at the top of admin lists and the staff feed.

## Notifications And Read Tracking

On publish (unless `"notify": false`):

- a notification is created with `type: "announcement"`
- an in-app delivery row is queued
- employees without a login get a recipient row but no notification

Unread count is the number of published recipient rows for the current employee where `isRead` is false.

`PATCH /:id/read` always uses the logged-in user. Extra `employeeId` in the body is ignored.

## Permissions

Super Admin bypasses these. Other roles need the matching permission.

| Permission | Used for |
| --- | --- |
| `announcement.view` | Staff feed, unread count, details, mark read; admin list/detail |
| `announcement.create` | Create / save draft |
| `announcement.edit` | Patch title, message, audience, etc. |
| `announcement.delete` | Soft delete |
| `announcement.publish` | Publish |
| `announcement.schedule` | Schedule |
| `announcement.archive` | Archive |
| `announcement.pin` | Pin / unpin |
| `announcement.viewRecipients` | Recipient list |
| `announcement.viewAnalytics` | Analytics, dashboard, reports, CSV export |

A normal employee posting to `/admin` gets `403 FORBIDDEN`.

## Recommended UI Flows

### Super Admin compose screen

1. Collect title, message, category, priority, audience, pin, optional expiry.
2. **Save draft:** `POST /admin/drafts`
3. **Send now:** `POST /admin` with `"status": "published"`  
   or `POST /admin/:id/publish` with `{ "notify": true }`
4. **Send later:** `POST /admin/drafts` then `POST /admin/:id/schedule` with a future `scheduledAt`

### Staff inbox

1. Badge: `GET /unread-count`
2. List: `GET /`
3. Open one: `GET /:id`
4. On open: `PATCH /:id/read`

## Admin Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/announcements/admin` | Create. Publishes immediately if `status` is `published` |
| POST | `/api/v1/announcements/admin/drafts` | Create as draft |
| GET | `/api/v1/announcements/admin` | List all (drafts included). Query: `q`, `status`, `category`, `priority`, `audience`, `pinned`, `dateFrom`, `dateTo`, `page`, `limit` |
| GET | `/api/v1/announcements/admin/:id` | Admin detail with analytics and audit history |
| PATCH | `/api/v1/announcements/admin/:id` | Update content / audience / pin / expiry |
| DELETE | `/api/v1/announcements/admin/:id` | Soft delete |
| POST | `/api/v1/announcements/admin/:id/publish` | Publish a draft or scheduled item |
| POST | `/api/v1/announcements/admin/:id/schedule` | Schedule a draft |
| PATCH | `/api/v1/announcements/admin/:id/archive` | Archive |
| PATCH | `/api/v1/announcements/admin/:id/pin` | Pin |
| PATCH | `/api/v1/announcements/admin/:id/unpin` | Unpin |
| GET | `/api/v1/announcements/admin/:id/recipients` | Who received it and who has read it |
| GET | `/api/v1/announcements/admin/:id/analytics` | Recipient / delivered / read / unread counts |
| GET | `/api/v1/announcements/admin/:id/audit-logs` | History |
| GET | `/api/v1/announcements/admin/dashboard` | Totals for the admin dashboard |
| GET | `/api/v1/announcements/admin/reports` | Report payload |
| GET | `/api/v1/announcements/admin/export` | CSV download |

## Staff Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/announcements` | Published items for the current employee |
| GET | `/api/v1/announcements/unread-count` | `{ "count": 2 }` |
| GET | `/api/v1/announcements/:id` | One published item, plus `isRead` |
| PATCH | `/api/v1/announcements/:id/read` | Mark current user’s copy as read |

Staff without a linked active employee profile get `403 EMPLOYEE_PROFILE_REQUIRED` on the feed.

## Response Shape

Success:

```json
{
  "success": true,
  "message": "Announcement created.",
  "data": {},
  "meta": {}
}
```

On publish, `meta` includes:

```json
{
  "recipients": 12,
  "notifications": 12
}
```

Failure:

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

Common codes:

| Code | When |
| --- | --- |
| `FORBIDDEN` | Role cannot create/publish |
| `ANNOUNCEMENT_REQUIRED_FIELDS` | Missing `title` or `message` |
| `ANNOUNCEMENT_AUDIENCE_REQUIRED` | Empty audience |
| `ANNOUNCEMENT_DEPARTMENT_REQUIRED` | Department audience without id |
| `ANNOUNCEMENT_EMPLOYEE_REQUIRED` | Employee audience without id |
| `ANNOUNCEMENT_ALREADY_PUBLISHED` | Publish called twice |
| `ANNOUNCEMENT_NOT_PUBLISHABLE` | Archived / deleted / expired |
| `ANNOUNCEMENT_NOT_SCHEDULABLE` | Not a draft or scheduled item |
| `ANNOUNCEMENT_SCHEDULE_REQUIRED` | Missing `scheduledAt` |
| `ANNOUNCEMENT_INVALID_SCHEDULE` | Bad date |
| `ANNOUNCEMENT_SCHEDULE_IN_PAST` | `scheduledAt` is not in the future |
| `ANNOUNCEMENT_NOT_FOUND` | Unknown id |
| `EMPLOYEE_PROFILE_REQUIRED` | Logged-in user is not linked to an employee record |
