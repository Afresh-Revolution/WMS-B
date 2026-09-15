# NYSC/Intern API Endpoints

This file lists every backend endpoint available for NYSC/Intern self-service and NYSC/Intern placement management.

## Authentication

Protected routes require:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Self-service routes require a logged-in `nysc_intern` or `intern` account. The backend links the user to the placement profile by `userId` or matching email, then derives placement, department, supervisor, organization, and visible records from that profile. The frontend must not send another intern's `profileId` or `placementId` to control scope.

Management routes require the existing NYSC/Intern permissions, such as `nysc_intern.view`, `nysc_intern.create`, `nysc_intern.update`, `nysc_intern.manage_attendance`, `nysc_intern.manage_documents`, `nysc_intern.manage_reviews`, and related lifecycle permissions. Super Admin has the normal override.

List endpoints support the existing pagination and filter query parameters where applicable: `page`, `limit`, `q`, `search`, `sortBy`, `sortDirection`, `dateFrom`, and `dateTo`.

## Self-Service Bases

Primary base:

```text
/api/v1/intern
```

Compatibility bases for the same self-service routes:

```text
/api/v1/nysc
/api/v1/nysc-intern
/api/intern
/api/nysc
/api/nysc-intern
```

## Self-Service Endpoint Matrix

| Method | Primary endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/intern/scope` | Return the authenticated intern's user, profile, placement, department, organization, and type IDs |
| GET | `/api/v1/intern/dashboard` | Return home metrics, assigned work, schedule, placement progress, news, and notifications |
| GET | `/api/v1/intern/home` | Alias for the dashboard payload |
| GET | `/api/v1/intern/placement-record` | Return profile, placement, contact, education, documents, attendance, reviews, tasks, targets, meetings, news, and placement history |
| GET | `/api/v1/intern/profile` | Alias for placement record |
| PATCH | `/api/v1/intern/placement-record` | Update safe self-service profile fields only |
| PUT | `/api/v1/intern/placement-record` | Alias for updating safe self-service profile fields |
| PATCH | `/api/v1/intern/profile` | Update safe self-service profile fields only |
| PUT | `/api/v1/intern/profile` | Alias for updating safe self-service profile fields |
| GET | `/api/v1/intern/settings` | Return profile and personal preferences |
| PATCH | `/api/v1/intern/settings` | Update personal preferences only |
| GET | `/api/v1/intern/tasks` | List tasks assigned to the authenticated profile or placement |
| GET | `/api/v1/intern/assigned-to-me` | Alias for assigned tasks |
| GET | `/api/v1/intern/tasks/:id` | Get one assigned task |
| PATCH | `/api/v1/intern/tasks/:id/progress` | Update progress, status, or note for an assigned task |
| PATCH | `/api/v1/intern/tasks/:id` | Alias for updating assigned task progress |
| GET | `/api/v1/intern/targets` | List assigned placement targets/KPIs |
| GET | `/api/v1/intern/progress` | Return placement timeline progress, assigned targets, reviews, and attendance summary |
| GET | `/api/v1/intern/targets/:id` | Get one assigned target/KPI |
| PATCH | `/api/v1/intern/targets/:id/progress` | Update progress on an assigned target/KPI |
| POST | `/api/v1/intern/targets/:id/progress` | Alias for progress updates |
| GET | `/api/v1/intern/schedule` | List meetings visible to the authenticated profile or placement |
| GET | `/api/v1/intern/meetings` | Alias for schedule |
| GET | `/api/v1/intern/meetings/:id` | Get one visible meeting |
| GET | `/api/v1/intern/attendance/locations` | List assigned active GPS check-in locations without exposing precise coordinates |
| GET | `/api/v1/intern/attendance/status` | Return current server-side GPS check-in availability and policy |
| POST | `/api/v1/intern/attendance/check-in` | Submit a fresh browser location reading for backend geofence verification |
| GET | `/api/v1/intern/attendance/history` | List the authenticated intern or NYSC member's GPS check-ins |
| GET | `/api/v1/intern/attendance` | List placement attendance |
| POST | `/api/v1/intern/attendance` | Record or update the authenticated intern's placement attendance for one date |
| GET | `/api/v1/intern/documents` | List placement documents visible to the intern |
| GET | `/api/v1/intern/reviews` | List placement reviews visible to the intern |
| GET | `/api/v1/intern/company-news` | List published company-wide news |
| GET | `/api/v1/intern/department-news` | List published department news visible to the intern |
| GET | `/api/v1/intern/news` | Alias for all visible news |
| GET | `/api/v1/intern/notifications` | List notifications for the logged-in user/profile/placement |
| PATCH | `/api/v1/intern/notifications/:id/read` | Mark one notification as read |

To call the same self-service route through a compatibility base, replace `/api/v1/intern` with `/api/v1/nysc`, `/api/v1/nysc-intern`, `/api/intern`, `/api/nysc`, or `/api/nysc-intern`.

## NYSC/Intern Management Bases

Primary management base:

```text
/api/v1/nysc-interns
```

Super Admin namespace aliases:

```text
/api/v1/super-admin/nysc-interns
/api/super-admin/nysc-interns
```

## NYSC/Intern Management Endpoint Matrix

| Method | Primary endpoint | Super Admin namespace alias | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/nysc-interns/dashboard` | `/api/v1/super-admin/nysc-interns/dashboard` | Return NYSC/intern dashboard metrics |
| GET | `/api/v1/nysc-interns/reports/summary` | `/api/v1/super-admin/nysc-interns/reports/summary` | Return NYSC/intern report summary |
| GET | `/api/v1/nysc-interns/export` | `/api/v1/super-admin/nysc-interns/export` | Export NYSC/intern profiles as CSV |
| GET | `/api/v1/nysc-interns/documents/:id/download` | `/api/v1/super-admin/nysc-interns/documents/:id/download` | Authorize placement document download |
| PATCH | `/api/v1/nysc-interns/attendance/:id` | `/api/v1/super-admin/nysc-interns/attendance/:id` | Update a placement attendance record |
| POST | `/api/v1/nysc-interns` | `/api/v1/super-admin/nysc-interns` | Create a NYSC/intern profile and placement |
| GET | `/api/v1/nysc-interns` | `/api/v1/super-admin/nysc-interns` | List NYSC/intern profiles |
| GET | `/api/v1/nysc-interns/:id` | `/api/v1/super-admin/nysc-interns/:id` | Get one NYSC/intern profile with placement details |
| PATCH | `/api/v1/nysc-interns/:id` | `/api/v1/super-admin/nysc-interns/:id` | Update a NYSC/intern profile |
| DELETE | `/api/v1/nysc-interns/:id` | `/api/v1/super-admin/nysc-interns/:id` | Cancel/remove a NYSC/intern placement |
| POST | `/api/v1/nysc-interns/:id/supervisor` | `/api/v1/super-admin/nysc-interns/:id/supervisor` | Assign a placement supervisor |
| POST | `/api/v1/nysc-interns/:id/department` | `/api/v1/super-admin/nysc-interns/:id/department` | Change placement department |
| POST | `/api/v1/nysc-interns/:id/extend` | `/api/v1/super-admin/nysc-interns/:id/extend` | Extend a placement |
| POST | `/api/v1/nysc-interns/:id/complete` | `/api/v1/super-admin/nysc-interns/:id/complete` | Complete a placement |
| POST | `/api/v1/nysc-interns/:id/terminate` | `/api/v1/super-admin/nysc-interns/:id/terminate` | Terminate a placement |
| POST | `/api/v1/nysc-interns/:id/exit` | `/api/v1/super-admin/nysc-interns/:id/exit` | Process placement exit |
| GET | `/api/v1/nysc-interns/:id/attendance` | `/api/v1/super-admin/nysc-interns/:id/attendance` | List placement attendance |
| POST | `/api/v1/nysc-interns/:id/attendance` | `/api/v1/super-admin/nysc-interns/:id/attendance` | Record placement attendance |
| GET | `/api/v1/nysc-interns/:id/documents` | `/api/v1/super-admin/nysc-interns/:id/documents` | List placement documents |
| POST | `/api/v1/nysc-interns/:id/documents` | `/api/v1/super-admin/nysc-interns/:id/documents` | Upload/add placement document metadata |
| GET | `/api/v1/nysc-interns/:id/reviews` | `/api/v1/super-admin/nysc-interns/:id/reviews` | List placement reviews |
| POST | `/api/v1/nysc-interns/:id/reviews` | `/api/v1/super-admin/nysc-interns/:id/reviews` | Record placement review |
| GET | `/api/v1/nysc-interns/:id/tasks` | `/api/v1/super-admin/nysc-interns/:id/tasks` | List placement tasks |
| GET | `/api/v1/nysc-interns/:id/targets` | `/api/v1/super-admin/nysc-interns/:id/targets` | List placement targets |
| GET | `/api/v1/nysc-interns/:id/history` | `/api/v1/super-admin/nysc-interns/:id/history` | List placement history |
| POST | `/api/v1/nysc-interns/:id/convert-to-employee` | `/api/v1/super-admin/nysc-interns/:id/convert-to-employee` | Convert placement profile to employee |

The same Super Admin namespace aliases are also mounted under `/api/super-admin/nysc-interns`.

## HR NYSC/Intern Management Bases

HR base:

```text
/api/v1/hr/nysc-interns
```

Legacy HR alias:

```text
/api/hr/nysc-interns
```

## HR NYSC/Intern Endpoint Matrix

| Method | API v1 endpoint | Legacy alias | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/hr/nysc-interns/dashboard` | `/api/hr/nysc-interns/dashboard` | Return HR NYSC/intern dashboard metrics |
| GET | `/api/v1/hr/nysc-interns/reports/summary` | `/api/hr/nysc-interns/reports/summary` | Return HR NYSC/intern report summary |
| GET | `/api/v1/hr/nysc-interns` | `/api/hr/nysc-interns` | List HR-visible NYSC/intern profiles |
| POST | `/api/v1/hr/nysc-interns` | `/api/hr/nysc-interns` | Create a NYSC/intern profile |
| GET | `/api/v1/hr/nysc-interns/:id` | `/api/hr/nysc-interns/:id` | Get one HR-visible NYSC/intern profile |
| PATCH | `/api/v1/hr/nysc-interns/:id` | `/api/hr/nysc-interns/:id` | Update a NYSC/intern profile |
| POST | `/api/v1/hr/nysc-interns/:id/supervisor` | `/api/hr/nysc-interns/:id/supervisor` | Assign a placement supervisor |
| POST | `/api/v1/hr/nysc-interns/:id/department` | `/api/hr/nysc-interns/:id/department` | Change placement department |
| POST | `/api/v1/hr/nysc-interns/:id/extend` | `/api/hr/nysc-interns/:id/extend` | Extend a placement |
| POST | `/api/v1/hr/nysc-interns/:id/complete` | `/api/hr/nysc-interns/:id/complete` | Complete a placement |
| POST | `/api/v1/hr/nysc-interns/:id/terminate` | `/api/hr/nysc-interns/:id/terminate` | Terminate a placement |
| POST | `/api/v1/hr/nysc-interns/:id/exit` | `/api/hr/nysc-interns/:id/exit` | Process placement exit |
| GET | `/api/v1/hr/nysc-interns/:id/documents` | `/api/hr/nysc-interns/:id/documents` | List placement documents |
| POST | `/api/v1/hr/nysc-interns/:id/documents` | `/api/hr/nysc-interns/:id/documents` | Upload/add placement document metadata |
| GET | `/api/v1/hr/nysc-interns/:id/reviews` | `/api/hr/nysc-interns/:id/reviews` | List placement reviews |
| POST | `/api/v1/hr/nysc-interns/:id/reviews` | `/api/hr/nysc-interns/:id/reviews` | Record placement review |
| GET | `/api/v1/hr/nysc-interns/:id/attendance` | `/api/hr/nysc-interns/:id/attendance` | List placement attendance |
| POST | `/api/v1/hr/nysc-interns/:id/attendance` | `/api/hr/nysc-interns/:id/attendance` | Record placement attendance |
| GET | `/api/v1/hr/nysc-interns/:id/history` | `/api/hr/nysc-interns/:id/history` | List placement history |
| POST | `/api/v1/hr/nysc-interns/:id/convert-to-employee` | `/api/hr/nysc-interns/:id/convert-to-employee` | Convert placement profile to employee |

## Example Requests

Update self-service task progress:

```http
PATCH /api/v1/intern/tasks/task-123/progress
Authorization: Bearer <intern_access_token>
Content-Type: application/json
```

```json
{
  "progress": 70,
  "note": "Completed the API integration work."
}
```

Record GPS check-in:

```http
POST /api/v1/intern/attendance/check-in
Authorization: Bearer <intern_access_token>
Content-Type: application/json
```

```json
{
  "latitude": 6.5244,
  "longitude": 3.3792,
  "accuracyMeters": 25,
  "locationTimestamp": "2026-09-08T08:55:00.000Z",
  "clientTimezone": "Africa/Lagos"
}
```

Record placement attendance:

```http
POST /api/v1/intern/attendance
Authorization: Bearer <intern_access_token>
Content-Type: application/json
```

```json
{
  "date": "2026-09-02",
  "checkIn": "09:00",
  "status": "PRESENT",
  "notes": "Worked from the office."
}
```

Create a NYSC/intern placement as an administrator:

```http
POST /api/v1/nysc-interns
Authorization: Bearer <admin_access_token>
Content-Type: application/json
```

```json
{
  "type": "NYSC",
  "fullName": "Chidi Eze",
  "email": "chidi.nysc@example.com",
  "institution": "University of Lagos",
  "courseOfStudy": "Accounting",
  "departmentId": "department_id",
  "startDate": "2026-09-01",
  "expectedEndDate": "2027-08-31"
}
```

## Notes For Frontend

- Use `/api/v1/intern` for NYSC/Intern self-service screens.
- Use `/api/v1/nysc-interns` for general back-office NYSC/Intern lifecycle management.
- Use `/api/v1/hr/nysc-interns` inside HR screens when the HR namespace is preferred.
- Use `/api/v1/super-admin/nysc-interns` inside Super Admin screens when the Super Admin namespace is preferred.
- Export endpoints return `text/csv`.
- Mutating routes return the standard JSON response shape: `{ success, message, data, meta }`.
- Missing scoped records return `404` with stable error codes such as `NYSC_INTERN_PROFILE_NOT_FOUND`, `PLACEMENT_DOCUMENT_NOT_FOUND`, `PLACEMENT_ATTENDANCE_NOT_FOUND`, `TASK_NOT_FOUND`, or `TARGET_NOT_FOUND`.
