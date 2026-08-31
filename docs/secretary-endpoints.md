# Secretary API Endpoints

This file lists the backend endpoints available to the Secretary section.

Default API base: `/api/v1/secretary`

Legacy alias: `/api/secretary`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All Secretary routes require an authenticated user with `role = secretary`. Records are scoped to the secretary's organization and the Secretary backend does not grant user, role, permission, system, finance, payroll, or super admin management access.

List endpoints support pagination and filtering through query parameters such as `page`, `limit`, `q`, `search`, `sortBy`, `sortDirection`, `dateFrom`, and `dateTo`. Secretary scoped routes validate `organizationId`/`organization_id` when provided.

## Scope

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/scope` | Return the secretary's scoped organization, department, and employee IDs |

## Dashboard

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/dashboard` | Return real dashboard stats, pending email requests, failed email creations, meetings, overdue tasks, and upcoming reminders |

## Employment Record

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/employment-record` | Return the authenticated secretary's own employment record, documents, company email, leave history, tasks, meetings, reminders, and summary stats |
| GET | `/api/v1/secretary/employment-record/documents` | Return documents attached to the authenticated secretary's own employment record |
| PATCH | `/api/v1/secretary/employment-record` | Update allowed self-profile fields such as phone, address, profile photo, preferences, and emergency contact |
| PUT | `/api/v1/secretary/employment-record` | Alias for updating allowed self-profile fields |

The employment record endpoints are self-scoped only. They do not allow Secretary users to change role, permissions, system access, department, reporting line, salary, or employment status fields.

## Company Email Requests

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/email-requests` | List organization-scoped company email requests |
| POST | `/api/v1/secretary/email-requests` | Create a company email request |
| GET | `/api/v1/secretary/email-requests/failed` | List failed company email creation requests |
| POST | `/api/v1/secretary/email-requests/check-availability` | Validate an email address, check approved domains and duplicates, and return suggested alternatives |
| GET | `/api/v1/secretary/email-requests/:id` | Get one company email request |
| PATCH | `/api/v1/secretary/email-requests/:id/review` | Move an email request to `UNDER_REVIEW` |
| PATCH | `/api/v1/secretary/email-requests/:id/approve` | Approve an email request where authorized |
| PATCH | `/api/v1/secretary/email-requests/:id/reject` | Reject an email request |
| PATCH | `/api/v1/secretary/email-requests/:id/return` | Return an email request for correction |
| PATCH | `/api/v1/secretary/email-requests/:id/cancel` | Cancel an eligible email request |
| POST | `/api/v1/secretary/email-requests/:id/create-email` | Provision a company email account and assign it to the employee |
| POST | `/api/v1/secretary/email-requests/:id/retry` | Retry a failed email creation and log the retry |
| PATCH | `/api/v1/secretary/email-requests/:id/resolve` | Mark a failed email creation as resolved or created |

Email request statuses: `PENDING`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `CREATING`, `CREATED`, `FAILED`, `CANCELLED`.

`GET /api/v1/secretary/email-requests` returns queue stats, request rows, and pagination:

```json
{
  "stats": {
    "pendingRequests": 0,
    "failedCreations": 0,
    "createdEmails": 0,
    "totalRequests": 0
  },
  "requests": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 1
  }
}
```

## Company Email Directory

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/company-emails` | List organization-scoped company email accounts with mailbox stats |
| GET | `/api/v1/secretary/company-emails/:id` | Get one company email account |
| PATCH | `/api/v1/secretary/company-emails/:id/address` | Edit a mailbox address after availability checks and history logging |
| POST | `/api/v1/secretary/company-emails/:id/suspend` | Suspend an active mailbox |
| POST | `/api/v1/secretary/company-emails/:id/reactivate` | Reactivate a suspended mailbox |
| POST | `/api/v1/secretary/company-emails/:id/request-deactivation` | Mark an active or suspended mailbox as `DEACTIVATION_PENDING` |

Company email account statuses: `PROVISIONING`, `ACTIVE`, `SUSPENDED`, `DEACTIVATION_PENDING`, `DEACTIVATED`, `FAILED`.

`GET /api/v1/secretary/company-emails` supports `page`, `limit`, `search`, `q`, `status`, and `department`/`departmentId` filters and returns:

```json
{
  "stats": {
    "activeMailboxes": 0,
    "suspended": 0,
    "deactivationPending": 0,
    "totalMailboxes": 0
  },
  "emails": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 1
  }
}
```

## Calendar

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/calendar` | Return a unified calendar view from calendar events, meetings, and reminders |
| GET | `/api/v1/secretary/calendar/events` | List organization-scoped calendar events |
| POST | `/api/v1/secretary/calendar/events` | Create a calendar event |
| GET | `/api/v1/secretary/calendar/events/:id` | Get one calendar event |
| PUT | `/api/v1/secretary/calendar/events/:id` | Update a calendar event |
| PATCH | `/api/v1/secretary/calendar/events/:id` | Update a calendar event |
| DELETE | `/api/v1/secretary/calendar/events/:id` | Soft-delete a calendar event |

Calendar supports `start`, `end`, `view`, `date`, `week`, `month`, `eventType`, `type`, `department`, `departmentId`, `userId`, and `assignedTo` filters.

`GET /api/v1/secretary/calendar` returns a normalized aggregate view from existing meetings, reminders, task deadlines, and custom calendar events:

```json
{
  "events": [
    {
      "id": "MEETING:meeting_id",
      "sourceId": "meeting_id",
      "sourceType": "MEETING",
      "type": "MEETING",
      "title": "Engineering Department Review",
      "description": "Department review meeting",
      "start": "2026-08-04T10:00:00.000Z",
      "end": "2026-08-04T11:00:00.000Z",
      "allDay": false,
      "status": "SCHEDULED",
      "department": {
        "id": "department_id",
        "name": "Engineering"
      },
      "createdBy": {
        "id": "user_id",
        "name": "User Name"
      },
      "location": "Meeting Room",
      "meetingLink": null
    }
  ],
  "items": [],
  "stats": {
    "total": 1,
    "meetings": 1,
    "reminders": 0,
    "taskDeadlines": 0,
    "managementEvents": 0,
    "customEvents": 0
  }
}
```

`items` is kept as a compatibility alias for `events`.

Calendar event types returned to the UI: `MEETING`, `REMINDER`, `TASK_DEADLINE`, `MANAGEMENT_EVENT`, `CUSTOM_EVENT`.

Calendar event create/update also accepts legacy `EVENT` and `DEADLINE` values for compatibility; those normalize to `CUSTOM_EVENT` and `TASK_DEADLINE` in the aggregate calendar view.

## Meetings

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/meetings` | List organization-scoped meetings |
| POST | `/api/v1/secretary/meetings` | Create and schedule a meeting with structured attendees and reminders |
| GET | `/api/v1/secretary/meetings/today` | List today's organization-scoped meetings |
| GET | `/api/v1/secretary/meetings/upcoming` | List upcoming meetings after today |
| GET | `/api/v1/secretary/meetings/:id` | Get one meeting with attendees |
| PUT | `/api/v1/secretary/meetings/:id` | Update a meeting |
| PATCH | `/api/v1/secretary/meetings/:id` | Update a meeting |
| POST | `/api/v1/secretary/meetings/:id/reschedule` | Reschedule a meeting |
| PATCH | `/api/v1/secretary/meetings/:id/reschedule` | Reschedule a meeting |
| POST | `/api/v1/secretary/meetings/:id/cancel` | Cancel a meeting |
| PATCH | `/api/v1/secretary/meetings/:id/cancel` | Cancel a meeting |
| POST | `/api/v1/secretary/meetings/:id/attendees` | Add meeting attendees |
| DELETE | `/api/v1/secretary/meetings/:id/attendees/:userId` | Remove a meeting attendee |
| POST | `/api/v1/secretary/meetings/:id/reminders` | Schedule meeting reminders |

Meeting statuses: `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `RESCHEDULED`.

## Management Tasks

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/tasks` | List organization-scoped management tasks |
| POST | `/api/v1/secretary/tasks` | Create a management task |
| GET | `/api/v1/secretary/tasks/overdue` | List overdue management tasks calculated from due dates |
| GET | `/api/v1/secretary/tasks/:id` | Get one management task |
| PUT | `/api/v1/secretary/tasks/:id` | Update a management task |
| PATCH | `/api/v1/secretary/tasks/:id` | Update a management task |
| PATCH | `/api/v1/secretary/tasks/:id/complete` | Mark a management task completed |

Overdue tasks are calculated when the task is not `COMPLETED` or `CANCELLED` and `due_date`/`dueDate` is before the current time.

## Reminders

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/reminders` | List organization-scoped reminders |
| POST | `/api/v1/secretary/reminders` | Create a reminder |
| GET | `/api/v1/secretary/reminders/upcoming` | List pending reminders scheduled at or after the current time |
| GET | `/api/v1/secretary/reminders/:id` | Get one reminder |
| PUT | `/api/v1/secretary/reminders/:id` | Update a reminder |
| PATCH | `/api/v1/secretary/reminders/:id` | Update a reminder |
| DELETE | `/api/v1/secretary/reminders/:id` | Cancel a reminder |
| PATCH | `/api/v1/secretary/reminders/:id/cancel` | Cancel a reminder |

Reminder statuses: `PENDING`, `SENT`, `CANCELLED`, `FAILED`.

Reminder related types: `MEETING`, `TASK`, `EMAIL_REQUEST`, `EVENT`, `OTHER`.

## Notifications

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/notifications` | List notifications for the authenticated secretary |
| PATCH | `/api/v1/secretary/notifications/:id/read` | Mark one secretary notification as read |

## Audit Logs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/secretary/audit-logs` | List Secretary operational audit logs scoped to the secretary's organization |

## Legacy Alias

The same endpoints are also mounted under `/api/secretary`. For example:

| API v1 endpoint | Legacy alias |
| --- | --- |
| `/api/v1/secretary/dashboard` | `/api/secretary/dashboard` |
| `/api/v1/secretary/employment-record` | `/api/secretary/employment-record` |
| `/api/v1/secretary/email-requests` | `/api/secretary/email-requests` |
| `/api/v1/secretary/calendar/events/:id` | `/api/secretary/calendar/events/:id` |
| `/api/v1/secretary/meetings/today` | `/api/secretary/meetings/today` |
| `/api/v1/secretary/tasks/overdue` | `/api/secretary/tasks/overdue` |
