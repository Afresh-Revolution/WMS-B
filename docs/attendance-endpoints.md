# Attendance API Endpoints

This file is the backend contract for GPS check-in attendance.

Primary base: `/api/v1/attendance`

Legacy alias: `/api/attendance`

All routes require:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

The frontend may collect geolocation for user experience. It must not send or trust client-calculated distance, device time as proof, timezone as proof, role, attendance state, or an “inside geofence” flag. The backend decides whether check-in is allowed.

There is no check-out workflow yet. The record structure already includes `checkOutAt` so it can be added later.

---

## Roles

| Action | Roles |
| --- | --- |
| GPS check-in (self only) | `employee`, `accountant`, `intern`, `nysc_intern` |
| Monitor records and reports | `superadmin`, `hr`, `manager` |
| Create/update locations and schedules | `superadmin`, `manager` |
| Correct a team attendance record | `manager` (`attendance.correct`) |

Scope:

- Super Admin sees all records. Only Super Admin responses include stored GPS coordinates on record listing.
- HR sees organization-wide records, without stored GPS coordinates.
- Manager sees assigned organization, branch, department, and direct-report employees only.
- Check-in users see only their own history. Assigned locations are returned without precise coordinates.

HOD, secretary, and other roles cannot monitor other people's attendance.

---

## Shared Response Envelope

Success:

```json
{
  "success": true,
  "message": "Human-readable message.",
  "data": {},
  "meta": {}
}
```

Paged lists put the array in `data` and pagination in `meta`:

```json
{
  "success": true,
  "message": "Attendance records loaded.",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

Error:

```json
{
  "success": false,
  "message": "Operation failed",
  "error": {
    "code": "OUTSIDE_ATTENDANCE_LOCATION",
    "details": {}
  }
}
```

List query parameters: `page`, `limit`, `q`, `search`, `id`, `sort`, `sortBy`, `order`.

---

## 1. Self-service GPS check-in

Who: `employee`, `accountant`, `intern`, `nysc_intern` with `attendance.check_in`.

Shared routes:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/me/locations` | Assigned active locations, without lat/lng |
| GET | `/api/v1/attendance/me/status` | Server-side availability, schedules, and GPS policy |
| POST | `/api/v1/attendance/check-in` | Submit a fresh GPS reading |
| GET | `/api/v1/attendance/me/history` | Own check-in history |

Dashboard aliases (same payloads and responses):

| Method | Employee | Accountant | Intern / NYSC |
| --- | --- | --- | --- |
| GET locations | `/api/v1/employee/attendance/locations` | `/api/v1/accountant/attendance/locations` | `/api/v1/intern/attendance/locations` |
| GET status | `/api/v1/employee/attendance/status` | `/api/v1/accountant/attendance/status` | `/api/v1/intern/attendance/status` |
| POST check-in | `/api/v1/employee/attendance/check-in` | `/api/v1/accountant/attendance/check-in` | `/api/v1/intern/attendance/check-in` |
| GET history | `/api/v1/employee/attendance/history` | `/api/v1/accountant/attendance/history` | `/api/v1/intern/attendance/history` |

Legacy aliases exist under `/api/attendance`, `/api/employee`, `/api/accountant`, `/api/intern`, `/api/nysc`, and `/api/nysc-intern`.

### GET assigned locations

Response `data[]`:

```json
{
  "id": "location_id",
  "name": "Lagos Office",
  "description": "Main office",
  "address": "Victoria Island, Lagos",
  "radiusMeters": 3000,
  "timezone": "Africa/Lagos",
  "active": true,
  "organizationId": "org_id",
  "branchId": null,
  "departmentId": "department_id",
  "departmentIds": [],
  "employeeIds": [],
  "createdAt": "2026-09-08T07:00:00.000Z",
  "updatedAt": "2026-09-08T07:00:00.000Z"
}
```

`latitude` and `longitude` are omitted.

`meta.gpsAccuracyPolicy`:

```json
{
  "maxAccuracyMeters": 100,
  "maxLocationAgeSeconds": 300,
  "radiusPolicy": "The backend does not expand the approved radius for poor GPS accuracy."
}
```

### GET check-in status

Response `data`:

```json
{
  "employeeId": "employee_id",
  "organizationId": "org_id",
  "serverTime": "2026-09-08T07:55:00.000Z",
  "gpsAccuracyPolicy": {
    "maxAccuracyMeters": 100,
    "maxLocationAgeSeconds": 300,
    "radiusPolicy": "The backend does not expand the approved radius for poor GPS accuracy."
  },
  "canCheckIn": true,
  "schedules": [
    {
      "schedule": {
        "id": "schedule_id",
        "name": "Weekday Office Check-in",
        "description": null,
        "openingTime": "08:00",
        "lateAfterTime": "09:30",
        "closingTime": "17:00",
        "daysOfWeek": [1, 2, 3, 4, 5],
        "timezone": "Africa/Lagos",
        "startDate": "2026-09-08",
        "endDate": "2026-12-31",
        "locationIds": ["location_id"],
        "active": true,
        "organizationId": "org_id",
        "branchId": null,
        "departmentId": "department_id",
        "departmentIds": [],
        "employeeIds": [],
        "createdAt": "2026-09-08T07:00:00.000Z",
        "updatedAt": "2026-09-08T07:00:00.000Z"
      },
      "locations": [
        {
          "id": "location_id",
          "name": "Lagos Office",
          "radiusMeters": 3000,
          "timezone": "Africa/Lagos",
          "active": true
        }
      ],
      "window": {
        "timezone": "Africa/Lagos",
        "localDate": "2026-09-08",
        "localTime": "08:55",
        "workDate": "2026-09-08",
        "dayOfWeek": 2,
        "workingDays": [1, 2, 3, 4, 5],
        "openingTime": "08:00",
        "lateAfterTime": "09:30",
        "closingTime": "17:00",
        "spansMidnight": false,
        "isOpen": true,
        "isTooEarly": false,
        "isClosed": false,
        "isLate": false,
        "reason": "OPEN"
      },
      "alreadyCheckedIn": false,
      "checkIn": null,
      "canCheckIn": true,
      "reason": "OPEN"
    }
  ]
}
```

`window.reason` values: `OPEN`, `ATTENDANCE_NOT_OPEN`, `ATTENDANCE_CLOSED`, `NOT_WORKING_DAY`, `SCHEDULE_NOT_ACTIVE_FOR_DATE`, `ALREADY_CHECKED_IN`.

Disable the Check in button unless `canCheckIn` is `true`.

### POST check-in

Request:

```json
{
  "latitude": 6.5244,
  "longitude": 3.3792,
  "accuracyMeters": 25,
  "locationTimestamp": "2026-09-08T08:55:00.000Z",
  "clientTimezone": "Africa/Lagos",
  "scheduleId": "optional_schedule_id",
  "locationId": "optional_location_id",
  "idempotencyKey": "optional-client-generated-key",
  "device": {
    "browser": "Chromium",
    "platform": "Windows"
  }
}
```

Aliases accepted: `lat`, `lng`/`lon`, `accuracy`/`accuracy_meters`, `location_timestamp`/`timestamp`, `client_timezone`, `schedule_id`, `location_id`, `idempotency_key`.

Optional header: `Idempotency-Key: optional-client-generated-key`

Required fields: `latitude`, `longitude`, `accuracyMeters`, `locationTimestamp`.

Backend checks, in order:

1. Role and `attendance.check_in`
2. Linked employee / intern / NYSC profile
3. Account status (`active`; employee also `confirmed` or `probation`; intern may be `ending_soon`)
4. GPS accuracy ≤ 100 m
5. Location timestamp present and not older than 300 seconds
6. Assigned active schedule and location
7. Server time in the location/schedule IANA timezone
8. Working day, date range, opening and closing window
9. Haversine distance ≤ location radius
10. No existing check-in for the same employee, schedule, and work date

If several locations qualify, the nearest inside-radius location is used.

`201 Created` when a new record is written. `200 OK` when the same idempotency key is replayed.

Success response:

```json
{
  "success": true,
  "message": "Check-in recorded.",
  "data": {
    "id": "attendance_id",
    "employeeId": "employee_id",
    "employeeName": "Ada Okafor",
    "organizationId": "org_id",
    "departmentId": "department_id",
    "locationId": "location_id",
    "locationName": "Lagos Office",
    "scheduleId": "schedule_id",
    "scheduleName": "Weekday Office Check-in",
    "workDate": "2026-09-08",
    "checkInAt": "2026-09-08T07:55:00.000Z",
    "checkOutAt": null,
    "accuracyMeters": 25,
    "calculatedDistanceMeters": 12.4,
    "clientLocationTimestamp": "2026-09-08T08:55:00.000Z",
    "clientTimezone": "Africa/Lagos",
    "timezone": "Africa/Lagos",
    "status": "on_time",
    "riskFlags": [],
    "createdAt": "2026-09-08T07:55:00.000Z"
  },
  "meta": {
    "idempotent": false
  }
}
```

`status` is `on_time` or `late`. Precise employee coordinates are stored but not returned on self-service responses. `riskFlags` may include `CLIENT_TIMEZONE_MISMATCH`.

A successful check-in also creates an in-app/push notification.

### GET own history

Response `data[]` uses the check-in record structure above, without coordinates.

---

## 2. Location management

Who: `superadmin` or `manager` with `attendance.manage`.

Managers must assign at least one of `branchId`, `departmentId` / `departmentIds`, or `employeeId` / `employeeIds` in their own scope.

HR can list locations because they have `attendance.view`, but cannot create or change them.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/locations` | List manageable locations |
| POST | `/api/v1/attendance/locations` | Create a location |
| GET | `/api/v1/attendance/locations/:id` | Get one location |
| PATCH | `/api/v1/attendance/locations/:id` | Update a location |
| PUT | `/api/v1/attendance/locations/:id` | Alias for update |
| POST | `/api/v1/attendance/locations/:id/enable` | Enable |
| POST | `/api/v1/attendance/locations/:id/disable` | Disable |

Create / update request:

```json
{
  "name": "Lagos Office",
  "description": "Main office",
  "address": "Victoria Island, Lagos",
  "latitude": 6.5244,
  "longitude": 3.3792,
  "radiusMeters": 3000,
  "timezone": "Africa/Lagos",
  "organizationId": "org_id",
  "branchId": null,
  "departmentId": "department_id",
  "departmentIds": [],
  "employeeIds": [],
  "active": true
}
```

`name`, `latitude`, and `longitude` are required on create. Radius default is `3000`. Allowed range is `10`–`5000`. Timezone must be a valid IANA name; default is `Africa/Lagos`.

Admin/manager location response includes coordinates:

```json
{
  "id": "location_id",
  "name": "Lagos Office",
  "description": "Main office",
  "address": "Victoria Island, Lagos",
  "latitude": 6.5244,
  "longitude": 3.3792,
  "radiusMeters": 3000,
  "timezone": "Africa/Lagos",
  "active": true,
  "organizationId": "org_id",
  "branchId": null,
  "departmentId": "department_id",
  "departmentIds": [],
  "employeeIds": [],
  "createdAt": "2026-09-08T07:00:00.000Z",
  "updatedAt": "2026-09-08T07:00:00.000Z"
}
```

A location alone is not enough for check-in. Create a schedule that points at it.

---

## 3. Schedule management

Who: `superadmin` or `manager` with `attendance.manage`. Same scope rules as locations.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/schedules` | List schedules |
| POST | `/api/v1/attendance/schedules` | Create a schedule |
| GET | `/api/v1/attendance/schedules/:id` | Get one schedule |
| PATCH | `/api/v1/attendance/schedules/:id` | Update a schedule |
| PUT | `/api/v1/attendance/schedules/:id` | Alias for update |
| POST | `/api/v1/attendance/schedules/:id/enable` | Enable |
| POST | `/api/v1/attendance/schedules/:id/disable` | Disable |

Create / update request:

```json
{
  "name": "Weekday Office Check-in",
  "description": "Office hours",
  "openingTime": "08:00",
  "lateAfterTime": "09:30",
  "closingTime": "17:00",
  "daysOfWeek": [1, 2, 3, 4, 5],
  "locationIds": ["location_id"],
  "timezone": "Africa/Lagos",
  "startDate": "2026-09-08",
  "endDate": "2026-12-31",
  "organizationId": "org_id",
  "branchId": null,
  "departmentId": "department_id",
  "departmentIds": [],
  "employeeIds": [],
  "active": true
}
```

Times are `HH:mm` in the schedule/location timezone. Defaults: open `08:50`, late after `09:30`, close `17:00`. `daysOfWeek` uses `0` = Sunday through `6` = Saturday; default is Monday–Friday. Closing before opening is treated as overnight.

The backend uses trusted server time and stores check-in timestamps in UTC.

Schedule response:

```json
{
  "id": "schedule_id",
  "name": "Weekday Office Check-in",
  "description": "Office hours",
  "openingTime": "08:00",
  "lateAfterTime": "09:30",
  "closingTime": "17:00",
  "daysOfWeek": [1, 2, 3, 4, 5],
  "timezone": "Africa/Lagos",
  "startDate": "2026-09-08",
  "endDate": "2026-12-31",
  "locationIds": ["location_id"],
  "active": true,
  "organizationId": "org_id",
  "branchId": null,
  "departmentId": "department_id",
  "departmentIds": [],
  "employeeIds": [],
  "createdAt": "2026-09-08T07:00:00.000Z",
  "updatedAt": "2026-09-08T07:00:00.000Z"
}
```

---

## 4. Monitoring and reports

Who: `superadmin`, `hr`, `manager` with `attendance.view`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/records` | List visible GPS check-in records |
| GET | `/api/v1/attendance/records/:id` | Get one visible record |
| GET | `/api/v1/attendance/reports/summary` | Status counts for the caller’s scope |
| GET | `/api/v1/reports/attendance` | Attendance report totals |
| GET | `/api/v1/manager/attendance` | Manager team attendance list |
| GET | `/api/v1/manager/attendance/:id` | One scoped team record |
| PATCH | `/api/v1/manager/attendance/:id/correct` | Manager correction with audit |

Record object (same as check-in history). Super Admin listing also includes `latitude` and `longitude`.

Summary response `data`:

```json
{
  "total": 12,
  "on_time": 9,
  "late": 3,
  "period": "current"
}
```

Pass `period` as a query parameter if needed. Summary currently counts up to 100 matching records.

Manager correction request:

```json
{
  "checkIn": "2026-09-08T07:55:00.000Z",
  "checkOut": null,
  "status": "late",
  "lateMinutes": 20,
  "overtimeMinutes": 0,
  "notes": "Traffic delay confirmed by manager",
  "reason": "Manual correction after GPS failure"
}
```

---

## 5. Intern placement attendance (separate from GPS check-in)

This writes `placement_attendance`, not GPS `attendance`. Keep it distinct in the UI.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/intern/attendance` | List the intern’s placement attendance |
| POST | `/api/v1/intern/attendance` | Record or update one date |
| GET | `/api/v1/nysc-interns/:id/attendance` | Admin/HR list for one profile |
| POST | `/api/v1/nysc-interns/:id/attendance` | Admin/HR record for one profile |
| PATCH | `/api/v1/nysc-interns/attendance/:id` | Admin update one placement record |
| GET | `/api/v1/hr/nysc-interns/:id/attendance` | HR list |
| POST | `/api/v1/hr/nysc-interns/:id/attendance` | HR record |

Intern self-service request:

```json
{
  "date": "2026-09-02",
  "checkIn": "09:00",
  "checkOut": "17:00",
  "status": "PRESENT",
  "notes": "Worked from the office."
}
```

---

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `EMPLOYEE_CHECK_IN_ROLE_REQUIRED` | 403 | Role cannot GPS check in |
| `ATTENDANCE_CHECK_IN_FORBIDDEN` | 403 | Missing `attendance.check_in` |
| `EMPLOYEE_PROFILE_REQUIRED` | 403 | No linked employee / intern / NYSC record |
| `CHECK_IN_ACCOUNT_INACTIVE` | 403 | Account or employment status is not eligible |
| `ATTENDANCE_MONITOR_FORBIDDEN` | 403 | Not Super Admin, HR, or manager |
| `ATTENDANCE_MANAGE_FORBIDDEN` | 403 | Not Super Admin or manager |
| `ATTENDANCE_SCOPE_REQUIRED` | 403 | Manager payload has no branch, department, or employee |
| `ATTENDANCE_SCOPE_FORBIDDEN` | 403 | Requested scope is outside the manager’s team |
| `FORBIDDEN` | 403 | Missing permission |
| `LOCATION_TIMESTAMP_REQUIRED` | 400 | Missing or invalid GPS timestamp |
| `INVALID_LATITUDE` / `INVALID_LONGITUDE` | 400 | Coordinate out of range |
| `INVALID_LOCATION_ACCURACY` | 400 | Accuracy missing or negative |
| `INVALID_ATTENDANCE_RADIUS` | 400 | Radius outside configured bounds |
| `INVALID_SCHEDULE_TIME` | 400 | Time is not `HH:mm` |
| `INVALID_TIMEZONE` | 400 | Not a valid IANA timezone |
| `ATTENDANCE_LOCATION_NAME_REQUIRED` | 400 | Location name missing |
| `ATTENDANCE_SCHEDULE_NAME_REQUIRED` | 400 | Schedule name missing |
| `STALE_LOCATION_READING` | 422 | GPS reading older than 300 seconds |
| `LOW_LOCATION_ACCURACY` | 422 | GPS accuracy worse than 100 m |
| `ATTENDANCE_NOT_OPEN` | 422 | Before opening time |
| `ATTENDANCE_CLOSED` | 422 | After closing time |
| `OUTSIDE_ATTENDANCE_LOCATION` | 422 | Outside the approved radius |
| `NO_ASSIGNED_ATTENDANCE_SCHEDULE` | 403 | No active assigned schedule |
| `NO_ASSIGNED_ATTENDANCE_LOCATION` | 403 | No active assigned location |
| `ALREADY_CHECKED_IN` | 409 | Already checked in for that schedule and work date |
| `ATTENDANCE_LOCATION_NOT_FOUND` | 404 | Location not found in scope |
| `ATTENDANCE_SCHEDULE_NOT_FOUND` | 404 | Schedule not found in scope |
| `ATTENDANCE_RECORD_NOT_FOUND` | 404 | Record not found in scope |

---

## Setup order

1. Super Admin or manager creates an active location with coordinates and radius.
2. Super Admin or manager creates an active schedule, including `locationIds` and the same department/branch/employee scope.
3. The employee, accountant, intern, or NYSC user opens status, gets a fresh GPS reading, and posts check-in.
4. Super Admin, HR, or manager reviews records.

---

## Environment variables

```text
ATTENDANCE_DEFAULT_RADIUS_METERS=3000
ATTENDANCE_MIN_RADIUS_METERS=10
ATTENDANCE_MAX_RADIUS_METERS=5000
ATTENDANCE_MAX_GPS_ACCURACY_METERS=100
ATTENDANCE_MAX_LOCATION_AGE_SECONDS=300
```

Browser GPS can be spoofed. This API treats coordinates as evidence, not proof. A 3–5 km radius covers a large area; use the smallest radius that still works for the site.
