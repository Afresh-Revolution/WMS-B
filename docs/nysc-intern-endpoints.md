# NYSC And Intern API Endpoints

NYSC members and interns share the same APIs. The profile `type` is either `NYSC` or `INTERN`. Self-service uses the intern dashboard. Back-office management uses `/nysc-interns`.

All protected routes require:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Do not send another person’s `profileId` or `placementId` to change scope. The backend binds the logged-in user to their profile by `userId` or matching email.

---

## Bases And Aliases

Self-service (same router):

```text
/api/v1/intern
/api/v1/nysc
/api/v1/nysc-intern
/api/intern
/api/nysc
/api/nysc-intern
```

Use `/api/v1/intern` for new frontend work. The other bases are compatibility aliases.

Management:

```text
/api/v1/nysc-interns
/api/v1/super-admin/nysc-interns
/api/super-admin/nysc-interns
/api/v1/hr/nysc-interns
/api/hr/nysc-interns
```

Use `/api/v1/nysc-interns` for general admin screens, `/api/v1/hr/nysc-interns` inside HR, and `/api/v1/super-admin/nysc-interns` inside Super Admin.

---

## Who Can Call What

| Audience | Roles / permissions |
| --- | --- |
| Self-service | `intern` or `nysc_intern`, linked to a `nysc_intern_profiles` record and an active placement |
| GPS check-in | Same roles, plus `attendance.check_in` |
| Management list/view | `nysc_intern.view` (Super Admin override). Without `nysc_intern.view_all`, results are limited to own profile or supervised placements |
| Create / update / lifecycle | matching `nysc_intern.*` permissions, or Super Admin |

List query parameters where supported: `page`, `limit`, `q`, `search`, `sortBy`, `sortDirection`, `dateFrom`, `dateTo`, `type`, `status`.

Shared success envelope:

```json
{
  "success": true,
  "message": "Human-readable message.",
  "data": {},
  "meta": {}
}
```

Paged lists put the array in `data`. Export returns CSV, not JSON.

---

## Enums

Profile type: `NYSC`, `INTERN`

Placement status: `PENDING`, `ACTIVE`, `ENDING_SOON`, `COMPLETED`, `EXITED`, `TERMINATED`, `CANCELLED`

Placement attendance status: `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`, `REMOTE`

Review period: `MONTHLY`, `MID_PLACEMENT`, `FINAL`

Review recommendation: `CONTINUE`, `EXTEND_PLACEMENT`, `COMPLETE`, `RECOMMEND_FOR_EMPLOYMENT`, `DO_NOT_RECOMMEND`

Exit type: `COMPLETED`, `EARLY_EXIT`, `TERMINATED`, `TRANSFERRED`

GPS check-in status: `on_time`, `late`

---

## 1. Self-service endpoints

Who: logged-in `intern` or `nysc_intern`.

Replace `/api/v1/intern` with any self-service alias above.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/intern/scope` | User, profile, placement, department, organization, type |
| GET | `/api/v1/intern/dashboard` | Home metrics, assigned work, schedule, progress, news, notifications |
| GET | `/api/v1/intern/home` | Alias for dashboard |
| GET | `/api/v1/intern/placement-record` | Full placement record |
| GET | `/api/v1/intern/profile` | Alias for placement record |
| PATCH | `/api/v1/intern/placement-record` | Update safe personal fields only |
| PUT | `/api/v1/intern/placement-record` | Alias for PATCH |
| PATCH | `/api/v1/intern/profile` | Alias for PATCH placement record |
| PUT | `/api/v1/intern/profile` | Alias for PATCH placement record |
| GET | `/api/v1/intern/settings` | Profile overview and preferences |
| PATCH | `/api/v1/intern/settings` | Update preferences only |
| GET | `/api/v1/intern/tasks` | Assigned tasks |
| GET | `/api/v1/intern/assigned-to-me` | Alias for tasks |
| GET | `/api/v1/intern/tasks/:id` | One assigned task |
| PATCH | `/api/v1/intern/tasks/:id/progress` | Update task progress |
| PATCH | `/api/v1/intern/tasks/:id` | Alias for task progress |
| GET | `/api/v1/intern/targets` | Assigned targets/KPIs |
| GET | `/api/v1/intern/targets/:id` | One assigned target |
| PATCH | `/api/v1/intern/targets/:id/progress` | Update target progress |
| POST | `/api/v1/intern/targets/:id/progress` | Alias for target progress (`201`) |
| GET | `/api/v1/intern/progress` | Placement timeline, targets, reviews, attendance summary |
| GET | `/api/v1/intern/schedule` | Visible meetings |
| GET | `/api/v1/intern/meetings` | Alias for schedule |
| GET | `/api/v1/intern/meetings/:id` | One visible meeting |
| GET | `/api/v1/intern/attendance/locations` | Assigned GPS locations (no lat/lng) |
| GET | `/api/v1/intern/attendance/status` | GPS check-in availability |
| POST | `/api/v1/intern/attendance/check-in` | GPS check-in |
| GET | `/api/v1/intern/attendance/history` | Own GPS check-in history |
| GET | `/api/v1/intern/attendance` | Placement attendance list |
| POST | `/api/v1/intern/attendance` | Record or update placement attendance for one date |
| GET | `/api/v1/intern/documents` | Placement documents |
| GET | `/api/v1/intern/reviews` | Placement reviews |
| GET | `/api/v1/intern/company-news` | Published company news |
| GET | `/api/v1/intern/department-news` | Visible department news |
| GET | `/api/v1/intern/news` | All visible news |
| GET | `/api/v1/intern/notifications` | Own notifications |
| PATCH | `/api/v1/intern/notifications/:id/read` | Mark one notification read |

Interns cannot change role, permissions, type, profile number, department, placement status, dates, or supervisor from self-service.

### GET `/scope`

```json
{
  "userId": "user_id",
  "profileId": "profile_id",
  "placementId": "placement_id",
  "departmentId": "department_id",
  "organizationId": "org_id",
  "type": "INTERN"
}
```

`type` is `INTERN` or `NYSC`.

### GET `/dashboard` and `/home`

Optional query: `previewLimit` or `limit` (1–25, default 5).

```json
{
  "scope": {
    "userId": "user_id",
    "profileId": "profile_id",
    "placementId": "placement_id",
    "departmentId": "department_id",
    "organizationId": "org_id",
    "type": "NYSC"
  },
  "profile": {
    "id": "profile_id",
    "profileNumber": "NYSC-2026-0001",
    "fullName": "Chidi Eze",
    "email": "chidi.nysc@example.com",
    "phone": "08030000000",
    "type": "NYSC",
    "avatarUrl": null,
    "department": { "id": "department_id", "name": "Finance", "code": "FIN" },
    "supervisor": { "id": "employee_id", "fullName": "Ada Okafor", "email": "ada@example.com" }
  },
  "placement": {
    "id": "placement_id",
    "departmentId": "department_id",
    "startDate": "2026-09-01",
    "expectedEndDate": "2027-08-31",
    "placementStatus": "ACTIVE",
    "role": "NYSC Member",
    "workLocation": "Lagos Office",
    "progress": {
      "startDate": "2026-09-01",
      "endDate": "2027-08-31",
      "daysElapsed": 11,
      "daysRemaining": 354,
      "totalDays": 365,
      "progressPercentage": 3.01,
      "completionProgress": 3.01
    }
  },
  "metrics": {
    "assignedTasks": 2,
    "completedTasks": 1,
    "overdueTasks": 0,
    "upcomingMeetings": 1,
    "placementProgress": 3.01,
    "daysRemaining": 354,
    "attendanceDays": 8,
    "reviews": 0,
    "documents": 2,
    "unreadNotifications": 1,
    "news": 3,
    "targetProgress": 40
  },
  "assignedToMe": [],
  "schedule": [],
  "progress": {
    "placement": {},
    "targets": [],
    "reviews": [],
    "attendance": {
      "total": 8,
      "present": 7,
      "absent": 0,
      "late": 1,
      "remote": 0,
      "excused": 0
    }
  },
  "news": [],
  "notifications": [],
  "navigation": [
    "Home",
    "My Placement",
    "Assigned To Me",
    "My Schedule",
    "Placement Progress",
    "Company News",
    "Settings",
    "Sign Out"
  ]
}
```

### GET `/placement-record` and `/profile`

```json
{
  "overview": {},
  "profile": {},
  "placement": {},
  "contact": {
    "email": "chidi.nysc@example.com",
    "phone": "08030000000",
    "address": "Lagos",
    "emergencyContact": { "name": "Jane Eze", "phone": "08011111111" }
  },
  "education": {
    "institution": "University of Lagos",
    "courseOfStudy": "Accounting",
    "matricNumber": "ACC/19/001",
    "stateCode": "LA/26A/1234",
    "callUpNumber": null
  },
  "documents": [],
  "attendance": [],
  "reviews": [],
  "tasks": [],
  "targets": [],
  "meetings": [],
  "news": [],
  "history": []
}
```

### PATCH `/placement-record` or `/profile`

Allowed fields only:

```json
{
  "fullName": "Chidi Eze",
  "phone": "08030000000",
  "address": "Lagos",
  "emergencyContactName": "Jane Eze",
  "emergencyContactPhone": "08011111111",
  "avatarUrl": "https://cdn.example.com/avatar.png",
  "preferences": { "theme": "light" }
}
```

Rejected fields include `role`, `permissions`, `type`, `profileNumber`, `departmentId`, placement dates, `placementStatus`, and supervisor IDs (`INTERN_SELF_FIELD_FORBIDDEN`).

### PATCH `/settings`

```json
{
  "preferences": {
    "theme": "light",
    "emailNotifications": true
  }
}
```

Response `data`: `{ "profile": {}, "preferences": {} }`

### PATCH `/tasks/:id/progress`

```json
{
  "progress": 70,
  "status": "IN_PROGRESS",
  "note": "Completed the API integration work."
}
```

Progress is 0–100. `100` sets status to `COMPLETED` if no status is sent.

### PATCH or POST `/targets/:id/progress`

```json
{
  "value": 40,
  "note": "Closed 40 of 100 assigned tickets."
}
```

Only `ACTIVE` or `OVERDUE` targets accept updates.

### POST `/attendance/check-in` (GPS)

Same payload as the attendance API. Full GPS contract: `docs/attendance-endpoints.md`.

```json
{
  "latitude": 6.5244,
  "longitude": 3.3792,
  "accuracyMeters": 25,
  "locationTimestamp": "2026-09-08T08:55:00.000Z",
  "clientTimezone": "Africa/Lagos"
}
```

`201` on create, `200` on idempotent replay. Coordinates are not returned.

### POST `/attendance` (placement attendance)

This is not GPS check-in. It writes `placement_attendance`.

```json
{
  "date": "2026-09-02",
  "checkIn": "09:00",
  "checkOut": "17:00",
  "status": "PRESENT",
  "notes": "Worked from the office."
}
```

`201` if created, `200` if that date already exists and is updated. Default status is `PRESENT`. Default date is today (UTC).

### PATCH `/notifications/:id/read`

No body. Marks the intern’s own notification as read.

---

## 2. Management endpoints

Who: staff with `nysc_intern.*` permissions, or Super Admin.

Primary path: `/api/v1/nysc-interns`

The same routes are mounted at:

- `/api/v1/super-admin/nysc-interns`
- `/api/super-admin/nysc-interns`

HR copies (same payloads) live under `/api/v1/hr/nysc-interns` and `/api/hr/nysc-interns`. HR does not expose export, document download-by-id, attendance patch-by-attendance-id, or placement task/target list on the HR namespace; those stay on `/api/v1/nysc-interns`.

| Method | `/api/v1/nysc-interns...` | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/dashboard` | `nysc_intern.view` | Counts of active NYSC/interns |
| GET | `/reports/summary` | `nysc_intern.view` | Department, institution, and score summary |
| GET | `/export` | `nysc_intern.export` | CSV export |
| GET | `/documents/:id/download` | `nysc_intern.view_documents` | Authorize document download |
| PATCH | `/attendance/:id` | `nysc_intern.manage_attendance` | Update one placement attendance row |
| POST | `/` | `nysc_intern.create` | Create profile and placement |
| GET | `/` | `nysc_intern.view` | List profiles |
| GET | `/:id` | `nysc_intern.view` | Profile plus placement details |
| PATCH | `/:id` | `nysc_intern.update` | Update profile |
| DELETE | `/:id` | `nysc_intern.delete` | Cancel placement |
| POST | `/:id/supervisor` | `nysc_intern.assign_supervisor` | Assign supervisor |
| POST | `/:id/department` | `nysc_intern.manage_placement` | Change department |
| POST | `/:id/extend` | `nysc_intern.extend` | Extend end date |
| POST | `/:id/complete` | `nysc_intern.complete` | Complete placement |
| POST | `/:id/terminate` | `nysc_intern.terminate` | Terminate placement |
| POST | `/:id/exit` | `nysc_intern.manage_exit` | Process exit |
| GET | `/:id/attendance` | `nysc_intern.view` | List placement attendance |
| POST | `/:id/attendance` | `nysc_intern.manage_attendance` | Record placement attendance |
| GET | `/:id/documents` | `nysc_intern.view_documents` | List documents |
| POST | `/:id/documents` | `nysc_intern.manage_documents` | Add document metadata |
| GET | `/:id/reviews` | `nysc_intern.view_reviews` | List reviews |
| POST | `/:id/reviews` | `nysc_intern.manage_reviews` | Add review |
| GET | `/:id/tasks` | `nysc_intern.view` | Placement tasks |
| GET | `/:id/targets` | `nysc_intern.view` | Placement targets |
| GET | `/:id/history` | `nysc_intern.view` | Placement history |
| POST | `/:id/convert-to-employee` | `nysc_intern.convert_employee` | Convert to employee |

HR also has GET/POST for dashboard, summary, list, create, get, patch, supervisor, department, extend, complete, terminate, exit, documents, reviews, attendance, history, and convert-to-employee.

### GET `/dashboard`

```json
{
  "activeMembers": 12,
  "activeNYSC": 7,
  "activeInterns": 5,
  "endingSoon": 2,
  "completed": 4,
  "exited": 1,
  "totalPlacements": 17
}
```

### GET `/reports/summary`

Dashboard counts plus:

```json
{
  "departments": [{ "id": "department_id", "name": "Finance", "nysc": 3, "interns": 2, "total": 5 }],
  "membersByInstitution": { "University of Lagos": 4 },
  "membersByCourse": { "Accounting": 3 },
  "averagePlacementProgress": 41.2,
  "averagePerformance": 78.5
}
```

### GET `/export`

Returns `text/csv` with filename `nysc-interns.csv`.

Columns: `profileNumber`, `fullName`, `type`, `institution`, `courseOfStudy`, `department`, `status`, `startDate`, `endDate`, `progress`.

### POST `/` create profile

Required: `fullName`, `type` (`NYSC` or `INTERN`), `institution`, `courseOfStudy`, `startDate`, `endDate`, `departmentId`.

```json
{
  "type": "NYSC",
  "fullName": "Chidi Eze",
  "email": "chidi.nysc@example.com",
  "phone": "08030000000",
  "gender": "male",
  "dateOfBirth": "2000-04-12",
  "institution": "University of Lagos",
  "courseOfStudy": "Accounting",
  "matricNumber": "ACC/19/001",
  "stateOfOrigin": "Anambra",
  "stateOfResidence": "Lagos",
  "address": "Yaba, Lagos",
  "emergencyContactName": "Jane Eze",
  "emergencyContactPhone": "08011111111",
  "departmentId": "department_id",
  "startDate": "2026-09-01",
  "endDate": "2027-08-31",
  "role": "NYSC Member",
  "description": "Finance support",
  "workLocation": "Lagos Office",
  "userId": null
}
```

`endDate` must be after `startDate`. An active duplicate of the same name/email and type is rejected (`ACTIVE_PLACEMENT_EXISTS`). Profile numbers are generated as `NYSC-YYYY-0001` or `INT-YYYY-0001`.

Response `data` is a decorated profile:

```json
{
  "profile": {
    "id": "profile_id",
    "profileNumber": "NYSC-2026-0001",
    "fullName": "Chidi Eze",
    "type": "NYSC",
    "email": "chidi.nysc@example.com",
    "status": "ACTIVE"
  },
  "placement": {
    "id": "placement_id",
    "departmentId": "department_id",
    "startDate": "2026-09-01",
    "expectedEndDate": "2027-08-31",
    "placementStatus": "ACTIVE",
    "progress": {}
  },
  "department": { "id": "department_id", "name": "Finance" },
  "supervisor": null,
  "attendance": [],
  "tasks": [],
  "targets": [],
  "reviews": [],
  "documents": [],
  "history": [],
  "exit": null
}
```

List (`GET /`) returns the same decoration without the nested attendance/tasks/reviews arrays. Detail (`GET /:id`) includes them.

### PATCH `/:id`

```json
{
  "fullName": "Chidi Eze",
  "email": "chidi.nysc@example.com",
  "phone": "08030000000",
  "institution": "University of Lagos",
  "courseOfStudy": "Accounting",
  "address": "Yaba, Lagos"
}
```

### POST `/:id/supervisor`

```json
{
  "employeeId": "employee_id"
}
```

The employee must exist and be active.

### POST `/:id/department`

```json
{
  "departmentId": "department_id"
}
```

### POST `/:id/extend`

```json
{
  "newEndDate": "2027-11-30",
  "reason": "Service year extension"
}
```

`newEndDate` must be after the current expected end date.

### POST `/:id/complete` and `/:id/terminate`

Optional body:

```json
{
  "exitDate": "2027-08-31",
  "reason": "Completed service year",
  "certificateIssued": true,
  "eligibleForEmployment": true
}
```

Complete forces exit type `COMPLETED`. Terminate forces `TERMINATED`.

### POST `/:id/exit`

```json
{
  "exitType": "EARLY_EXIT",
  "exitDate": "2026-12-15",
  "reason": "Returned to school",
  "exitInterview": "Discussed handover",
  "certificateIssued": false,
  "eligibleForEmployment": false
}
```

### POST `/:id/attendance`

```json
{
  "date": "2026-09-02",
  "checkIn": "09:00",
  "checkOut": "17:00",
  "status": "PRESENT",
  "notes": "On site"
}
```

Duplicate date for the same placement returns `409` `DUPLICATE_ATTENDANCE`.

### PATCH `/attendance/:id`

`:id` is the attendance record id, not the profile id.

```json
{
  "checkIn": "09:15",
  "checkOut": "17:00",
  "status": "LATE",
  "notes": "Arrived late"
}
```

### POST `/:id/documents`

```json
{
  "fileName": "call-up-letter.pdf",
  "fileUrl": "https://files.example.com/call-up-letter.pdf",
  "documentType": "CALL_UP_LETTER",
  "fileType": "application/pdf",
  "fileSize": 245000
}
```

`fileName`/`name` and `fileUrl`/`url` are required.

### GET `/documents/:id/download`

`:id` is the document id. Response includes `downloadUrl` copied from `fileUrl`. It does not stream the file.

### POST `/:id/reviews`

```json
{
  "reviewPeriod": "MONTHLY",
  "attendanceScore": 80,
  "performanceScore": 75,
  "teamworkScore": 82,
  "communicationScore": 70,
  "technicalScore": 78,
  "strengths": "Reliable and punctual",
  "weaknesses": "Needs more Excel practice",
  "comments": "Good first month",
  "recommendation": "CONTINUE"
}
```

`overallScore` is the average of the five scores and is calculated by the backend.

### POST `/:id/convert-to-employee`

```json
{
  "employeeId": "EMP-0041",
  "jobTitle": "Accounts Officer",
  "employmentType": "Full-time",
  "conversionDate": "2027-09-01"
}
```

Creates an employee record, marks the placement completed, and returns the employee in `data`.

### DELETE `/:id`

Cancels the placement (`CANCELLED`). It does not hard-delete history.

---

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `INTERN_ROLE_REQUIRED` | 403 | Not an intern/NYSC self-service user |
| `INTERN_PROFILE_REQUIRED` | 403 | User is not linked to a profile |
| `INTERN_PLACEMENT_REQUIRED` | 403 | Profile has no placement |
| `INTERN_SELF_FIELD_FORBIDDEN` | 403 | Intern tried to change a restricted field |
| `RESOURCE_OUT_OF_INTERN_SCOPE` | 403 | Task or target is not on this placement |
| `FORBIDDEN` | 403 | Missing management permission or not the supervisor |
| `NYSC_INTERN_PROFILE_NOT_FOUND` / `PROFILE_NOT_FOUND` | 404 | Profile not found |
| `TASK_NOT_FOUND` | 404 | Assigned task not found |
| `TARGET_NOT_FOUND` | 404 | Assigned target not found |
| `MEETING_NOT_FOUND` | 404 | Meeting not found |
| `NOTIFICATION_NOT_FOUND` | 404 | Notification not found |
| `PLACEMENT_DOCUMENT_NOT_FOUND` | 404 | Document not found |
| `PLACEMENT_ATTENDANCE_NOT_FOUND` | 404 | Attendance row not found |
| `DEPARTMENT_NOT_FOUND` | 404 | Department missing or inactive |
| `SUPERVISOR_NOT_FOUND` | 404 | Supervisor employee missing or inactive |
| `FULL_NAME_REQUIRED` | 400 | Create payload missing name |
| `INVALID_PROFILE_TYPE` | 400 | Type is not `NYSC` or `INTERN` |
| `INSTITUTION_REQUIRED` | 400 | Institution missing |
| `COURSE_REQUIRED` | 400 | Course of study missing |
| `START_DATE_REQUIRED` / `END_DATE_REQUIRED` | 400 | Placement dates missing |
| `INVALID_PLACEMENT_DATES` | 400 | End date is not after start date |
| `NEW_END_DATE_REQUIRED` | 400 | Extension date missing |
| `INVALID_EXTENSION_DATE` | 400 | New end date is not later |
| `INVALID_EXIT_TYPE` | 400 | Exit type is invalid |
| `DOCUMENT_NAME_REQUIRED` / `DOCUMENT_URL_REQUIRED` | 400 | Document metadata incomplete |
| `INVALID_PROGRESS_VALUE` | 400 | Target progress is not a non-negative number |
| `INVALID_INTERN_PREFERENCES` | 400 | Settings preferences is not an object |
| `TARGET_NOT_ACTIVE` | 409 | Target cannot receive progress |
| `ACTIVE_PLACEMENT_EXISTS` | 409 | Duplicate active NYSC/intern placement |
| `DUPLICATE_ATTENDANCE` | 409 | Placement attendance already exists for that date |

GPS check-in errors (`OUTSIDE_ATTENDANCE_LOCATION`, `ALREADY_CHECKED_IN`, and others) are listed in `docs/attendance-endpoints.md`.

---

## Frontend notes

- One login role covers both NYSC and intern: `nysc_intern` or `intern`. Read `data.scope.type` or `data.profile.type` to label the UI.
- Self-service GPS check-in and placement attendance are different features. Use `/attendance/check-in` for location check-in and `/attendance` for daily placement status.
- Create uses `endDate`. After create, the stored placement field is `expectedEndDate`.
- Export is CSV. Everything else is `{ success, message, data, meta }`.
- HR screens should call `/api/v1/hr/nysc-interns`. Super Admin screens may call `/api/v1/super-admin/nysc-interns`. Both hit the same management service as `/api/v1/nysc-interns`.
