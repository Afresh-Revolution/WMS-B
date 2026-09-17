# Attendance Check-in And Web Push API Endpoints

This file lists the backend endpoints for location-restricted employee check-in and Web Push notification subscriptions.

Attendance API base: `/api/v1/attendance`

Legacy attendance alias: `/api/attendance`

Notification API base: `/api/v1/notifications`

Legacy notification alias: `/api/notifications`

Authentication header:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All private decisions are made by the backend. The frontend may collect browser notification and geolocation permission states for user experience, but it must not send or rely on client-calculated distance, time, timezone, role, attendance state, or inside-geofence flags.

## Notification Centre

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/notifications` | List the authenticated user's notifications with pagination and unread count |
| GET | `/api/v1/notifications/unread-count` | Return unread notification count only |
| PATCH | `/api/v1/notifications/:id/read` | Mark one owned notification as read |
| PATCH | `/api/v1/notifications/read-all` | Mark all owned notifications as read |
| DELETE | `/api/v1/notifications/:id` | Soft-delete/archive one owned notification |
| GET | `/api/v1/notifications/preferences` | Return the authenticated user's notification preferences |
| PATCH | `/api/v1/notifications/preferences` | Update the authenticated user's notification preferences |

Notifications are owned by recipient user ID. Users can only read, update, or delete their own notification records unless an existing permission explicitly allows broader notification administration.

Notification records support:

```text
id
userId / recipientUserId
organizationId
type
title
message/body
destinationUrl
data/metadata
isRead
readAt
expiresAt
idempotencyKey
createdAt
```

`destinationUrl` must be a relative internal route such as `/messages` or `/employee/attendance`. External URLs and protocol-relative URLs are rejected.

## Web Push Subscriptions

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/notifications/push/public-key` | Return the VAPID public key and whether Web Push delivery is configured |
| GET | `/api/v1/notifications/push/subscriptions` | List the authenticated user's active push subscriptions |
| POST | `/api/v1/notifications/push/subscribe` | Save or refresh a browser push subscription for the authenticated user |
| POST | `/api/v1/notifications/push/unsubscribe` | Revoke an owned push subscription by ID or endpoint |
| DELETE | `/api/v1/notifications/push/subscriptions/:id` | Revoke one owned push subscription |

Subscribe request:

```json
{
  "endpoint": "https://push-service.example/subscription-id",
  "keys": {
    "p256dh": "browser-generated-key",
    "auth": "browser-generated-auth-secret"
  },
  "metadata": {
    "browser": "Chromium",
    "device": "Desktop"
  }
}
```

The server always binds the subscription to the authenticated user. Client-supplied `userId` values are ignored. Multiple active devices are supported, and duplicate active subscriptions are prevented by user ID plus endpoint hash.

## Who Can Check In

GPS check-in is limited to these roles:

- `employee`
- `accountant`
- `intern`
- `nysc_intern`

Managers, HODs, HR, secretaries, and Super Admin cannot submit their own check-in.

## Who Can Monitor Attendance

Attendance records and reports are limited to:

- `superadmin` — all organizations
- `hr` — organization-wide
- `manager` — assigned team, department, and branch only

HOD, accountant, secretary, intern, NYSC, and employee accounts cannot list or report on other people's attendance. Employees, accountants, NYSC members, and interns can still see their own check-in history.

## Employee Check-in

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/me/locations` | List active attendance locations assigned to the authenticated employee without exposing precise coordinates |
| GET | `/api/v1/attendance/me/status` | Return current server-side check-in availability, schedules, and policy |
| POST | `/api/v1/attendance/check-in` | Submit a fresh browser geolocation reading for backend verification and check-in |
| GET | `/api/v1/attendance/me/history` | List the authenticated employee's own check-in records |

Dashboard aliases:

| Method | Endpoint |
| --- | --- |
| GET | `/api/v1/employee/attendance/locations` |
| GET | `/api/v1/employee/attendance/status` |
| POST | `/api/v1/employee/attendance/check-in` |
| GET | `/api/v1/employee/attendance/history` |
| GET | `/api/v1/accountant/attendance/locations` |
| GET | `/api/v1/accountant/attendance/status` |
| POST | `/api/v1/accountant/attendance/check-in` |
| GET | `/api/v1/accountant/attendance/history` |
| GET | `/api/v1/intern/attendance/locations` |
| GET | `/api/v1/intern/attendance/status` |
| POST | `/api/v1/intern/attendance/check-in` |
| GET | `/api/v1/intern/attendance/history` |

Check-in request:

```json
{
  "latitude": 6.5244,
  "longitude": 3.3792,
  "accuracyMeters": 25,
  "locationTimestamp": "2026-09-08T08:55:00.000Z",
  "clientTimezone": "Africa/Lagos",
  "scheduleId": "optional_schedule_id",
  "locationId": "optional_location_id",
  "idempotencyKey": "optional-client-generated-key"
}
```

The backend verifies authenticated identity, linked employee profile, account/employment status, tenant scope, assigned location, assigned schedule, active date range, working day, server time, GPS accuracy, stale-location policy, distance from approved coordinates, and duplicate check-ins.

Successful response:

```json
{
  "success": true,
  "message": "Check-in recorded.",
  "data": {
    "id": "attendance_id",
    "employeeId": "employee_id",
    "locationId": "location_id",
    "scheduleId": "schedule_id",
    "workDate": "2026-09-08",
    "checkInAt": "2026-09-08T07:55:00.000Z",
    "accuracyMeters": 25,
    "calculatedDistanceMeters": 0,
    "timezone": "Africa/Lagos",
    "status": "on_time",
    "riskFlags": []
  },
  "meta": {
    "idempotent": false
  }
}
```

Precise employee coordinates are stored for audit/verification but are not returned by self-service check-in responses.

## Attendance Location Management

These routes require `attendance.manage` and are limited to `superadmin` and `manager`. Managers are restricted to their assigned organization, branch, department, and employee scope.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/locations` | List manageable attendance locations |
| POST | `/api/v1/attendance/locations` | Create an approved check-in location |
| GET | `/api/v1/attendance/locations/:id` | Get one manageable attendance location |
| PATCH | `/api/v1/attendance/locations/:id` | Update an attendance location |
| PUT | `/api/v1/attendance/locations/:id` | Alias for updating an attendance location |
| POST | `/api/v1/attendance/locations/:id/enable` | Enable an attendance location |
| POST | `/api/v1/attendance/locations/:id/disable` | Disable an attendance location |

Create location request:

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
  "departmentId": "department_id"
}
```

Default radius is `3000` metres. The configured maximum defaults to `5000` metres. The frontend should warn administrators that a 3-5 km radius covers a large area.

## Attendance Schedule Management

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/schedules` | List manageable attendance schedules |
| POST | `/api/v1/attendance/schedules` | Create an attendance schedule |
| GET | `/api/v1/attendance/schedules/:id` | Get one manageable attendance schedule |
| PATCH | `/api/v1/attendance/schedules/:id` | Update an attendance schedule |
| PUT | `/api/v1/attendance/schedules/:id` | Alias for updating an attendance schedule |
| POST | `/api/v1/attendance/schedules/:id/enable` | Enable an attendance schedule |
| POST | `/api/v1/attendance/schedules/:id/disable` | Disable an attendance schedule |

Create schedule request:

```json
{
  "name": "Weekday Office Check-in",
  "openingTime": "08:50",
  "lateAfterTime": "09:30",
  "closingTime": "17:00",
  "daysOfWeek": [1, 2, 3, 4, 5],
  "locationIds": ["attendance_location_id"],
  "departmentId": "department_id",
  "timezone": "Africa/Lagos",
  "startDate": "2026-09-08",
  "endDate": "2026-12-31"
}
```

Times use `HH:mm` in the schedule/location IANA timezone. New schedules default to opening at `08:50`, late after `09:30`, and closing at `17:00` unless the administrator saves different values. Existing saved schedules keep their stored times until edited. The backend uses trusted server time and stores check-in timestamps in UTC.

## Attendance Reports

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/attendance/records` | List attendance records visible to Super Admin, HR, or manager |
| GET | `/api/v1/attendance/records/:id` | Get one visible attendance record |
| GET | `/api/v1/attendance/reports/summary` | Return simple attendance status counts for the authorized scope |
| GET | `/api/v1/reports/attendance` | Return attendance report totals for Super Admin, HR, or manager |
| GET | `/api/v1/manager/attendance` | List team attendance records for a manager |

## Common Check-in Error Codes

| Code | Meaning |
| --- | --- |
| `ATTENDANCE_MONITOR_FORBIDDEN` | User is not Super Admin, HR, or manager |
| `ATTENDANCE_MANAGE_FORBIDDEN` | User is not Super Admin or manager |
| `EMPLOYEE_PROFILE_REQUIRED` | Authenticated user is not linked to an employee record |
| `CHECK_IN_ACCOUNT_INACTIVE` | User or employee status is not eligible |
| `LOCATION_TIMESTAMP_REQUIRED` | No valid browser location timestamp was sent |
| `STALE_LOCATION_READING` | Browser location reading is older than the configured maximum age |
| `LOW_LOCATION_ACCURACY` | Reported GPS accuracy exceeds the configured threshold |
| `NO_ASSIGNED_ATTENDANCE_SCHEDULE` | No active schedule applies to the authenticated employee |
| `NO_ASSIGNED_ATTENDANCE_LOCATION` | No active assigned location applies |
| `ATTENDANCE_NOT_OPEN` | Server time is before opening time |
| `ATTENDANCE_CLOSED` | Server time is after closing time |
| `OUTSIDE_ATTENDANCE_LOCATION` | Backend-calculated distance is outside the approved radius |
| `ALREADY_CHECKED_IN` | A successful check-in already exists for the same employee, schedule, and work date |

## Environment Variables

```text
WEB_PUSH_VAPID_PUBLIC_KEY=browser-public-key
WEB_PUSH_VAPID_PRIVATE_KEY=server-private-key
WEB_PUSH_VAPID_SUBJECT=mailto:admin@example.com
ATTENDANCE_DEFAULT_RADIUS_METERS=3000
ATTENDANCE_MIN_RADIUS_METERS=10
ATTENDANCE_MAX_RADIUS_METERS=5000
ATTENDANCE_MAX_GPS_ACCURACY_METERS=100
ATTENDANCE_MAX_LOCATION_AGE_SECONDS=300
ATTENDANCE_DEFAULT_OPENING_TIME=08:50
ATTENDANCE_LOCATION_RETENTION_DAYS=365
CHECK_IN_RATE_LIMIT_MAX=30
PUSH_RATE_LIMIT_MAX=40
```

Generate development VAPID keys outside Git:

```bash
npx web-push generate-vapid-keys
```

Copy the public key to `WEB_PUSH_VAPID_PUBLIC_KEY` and keep the private key only in the environment. Never commit generated secrets.

## PWA And Frontend Helpers

This repository is the API. It also serves a minimum PWA so check-in and push can be verified without a separate frontend:

| Path | Purpose |
| --- | --- |
| `/check-in` | Employee check-in page. Requests geolocation only after **Use my location**. |
| `/sw.js` | Push and notification-click service worker. Destinations are restricted to internal routes. |
| `/manifest.webmanifest` | Installable web app manifest. |
| `/pwa/js/attendance-checkin.js` | Client helper the Vite frontend can copy. |
| `/pwa/js/web-push-client.js` | Push opt-in helper. Does not prompt on first page load. |

Production Web Push requires HTTPS. iPhone/iPad browsers typically need Home Screen installation. The in-app notification centre remains available when push is denied or unsupported.

## GPS Accuracy And Privacy

- The backend does **not** enlarge the approved radius because GPS accuracy is poor.
- Readings older than `ATTENDANCE_MAX_LOCATION_AGE_SECONDS` (default 300) are rejected.
- Accuracy worse than `ATTENDANCE_MAX_GPS_ACCURACY_METERS` (default 100) is rejected.
- Precise coordinates are stored for audit, omitted from self-service responses, and never included in push payloads.
- Retain precise location evidence for `ATTENDANCE_LOCATION_RETENTION_DAYS` (default 365) then delete or anonymise it according to policy.
- Browser geolocation can be spoofed. This release flags suspicious readings (`ZERO_ACCURACY`, `IMPOSSIBLE_TRAVEL`, `EXACT_OFFICE_COORDINATE`, `CLIENT_TIMEZONE_MISMATCH`) and is structured so QR, selfie, or trusted-network checks can be added later.

Do not commit generated VAPID private keys.
