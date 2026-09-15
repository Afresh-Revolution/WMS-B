You are working on an existing production codebase. Implement a secure, production-ready Web Push Notification system and location-restricted employee Attendance Check-in system.

Your implementation must preserve all legacy functionality. Do not rewrite unrelated parts of the application, replace the existing architecture, rename existing database objects unnecessarily, or introduce breaking API changes.

1. Mandatory repository audit

Before editing any code:

1. Inspect the complete repository structure.
2. Read all relevant documentation, environment examples, database schemas, migrations, authentication code, authorization logic, API conventions, service-worker configuration, PWA configuration, notification features, testing setup, and deployment configuration.
3. Determine:
    * Frontend and backend frameworks.
    * Package manager.
    * ORM or database client.
    * Existing PostgreSQL structure.
    * Migration conventions.
    * Authentication and session mechanism.
    * Existing user, organization, branch, role, message, and notification models.
    * Whether multi-tenancy is supported.
    * Whether a service worker or PWA already exists.
    * Existing naming, validation, error-handling, logging, and testing conventions.
4. Check for uncommitted changes and preserve them.
5. Reuse existing services and components whenever appropriate.
6. Present a concise implementation plan before making major changes, then proceed with implementation.

Do not assume table names, frameworks, authentication libraries, or folder paths before inspecting the repository.

2. Core requirements

Implement two connected modules:

1. Web Push Notifications.
2. Employee Attendance Check-in.

This attendance feature is for work attendance and should be described in the interface primarily as “Check in,” not “Take attendance.”

All security-sensitive decisions must be performed and verified by the backend. Frontend checks are for user experience only and must never be treated as authoritative.

⸻

PART A: WEB PUSH NOTIFICATIONS

3. Notification centre

Create a persistent in-application notification centre.

Each notification should support:

* Unique ID.
* Recipient user ID.
* Organization or tenant ID where applicable.
* Notification type.
* Title.
* Message/body.
* Safe internal destination URL.
* Optional structured metadata using JSONB.
* Read/unread status.
* Read timestamp.
* Creation timestamp.
* Expiration timestamp where applicable.
* Deduplication or idempotency key where appropriate.

Users must only be able to retrieve, read, update, or delete their own notifications. Administrators must not automatically gain access to private notification contents unless the existing application explicitly authorizes it.

Add:

* Paginated notification listing.
* Unread notification count.
* Mark one as read.
* Mark all as read.
* Safe deletion or archival following existing application conventions.
* Appropriate indexes for recipient, unread status, tenant and creation time.

Do not rely on web push as the permanent notification record. Save the database notification first, then attempt push delivery.

4. Push subscriptions

Implement browser Web Push using the existing application architecture. Use standards-based service workers and VAPID authentication unless the project already uses a suitable provider such as Firebase Cloud Messaging or OneSignal.

Store push subscriptions in PostgreSQL with:

* Subscription ID.
* User ID.
* Organization or tenant ID where applicable.
* Push endpoint.
* Encryption keys (p256dh and auth) or provider-specific token.
* Browser/device metadata where useful.
* Created and updated timestamps.
* Last successful delivery time.
* Failure count.
* Revoked or disabled timestamp.
* A uniqueness constraint that prevents duplicate active subscriptions.

Requirements:

* A subscription must be associated with the authenticated user on the server.
* Never accept a user ID from the client as proof of subscription ownership.
* Allow multiple devices per user.
* Provide authenticated subscribe and unsubscribe endpoints.
* Validate all subscription payloads.
* Protect endpoints with rate limiting and CSRF protection where relevant to the existing authentication model.
* Automatically disable or remove expired subscriptions when the push provider returns a permanent expiration response such as HTTP 404 or 410.
* Do not log encryption keys, credentials, full tokens, cookies or authorization headers.

5. Notification permission experience

Implement a non-disruptive permission flow:

* Do not request browser notification permission immediately on first page load.
* Show an explanatory UI first.
* Request permission only after a clear user action.
* Properly handle default, granted, denied, unsupported browser, and unsubscribed states.
* Provide a setting allowing the user to enable or disable push notifications.
* Keep the in-app notification centre available if push permission is denied.
* Avoid repeatedly prompting users who declined.

6. PWA and service worker

If a PWA or service worker already exists, extend it carefully without overwriting its caching, update or offline behaviour.

Otherwise, add the minimum standards-compliant PWA configuration required:

* Web app manifest.
* Service-worker registration.
* Push event handler.
* Notification-click handler.
* Safe navigation to an internal route.
* Suitable icons using existing application branding/assets.
* HTTPS-compatible setup.

Do not allow arbitrary external URLs in notification click payloads. Validate destinations against an allowlist or require relative internal application routes.

Support compatible desktop and Android browsers. Handle iPhone/iPad limitations gracefully and inform users when Home Screen installation is required for web push support.

7. Notification events

Create a reusable server-side notification service that can be called when:

* A user receives a new message.
* Relevant activity occurs on the user’s account.
* A check-in succeeds.
* A manager changes an attendance location or schedule, if appropriate.

The service should:

1. Create the persistent database notification.
2. Queue or send push delivery using the application’s existing background-job system.
3. Avoid making core operations fail merely because push delivery fails.
4. Retry transient failures with bounded exponential backoff.
5. Use idempotency to avoid duplicate notifications.
6. Send minimal, privacy-conscious push content.
7. Log delivery outcomes without exposing secrets.

If no job queue exists, introduce the smallest reliable solution compatible with the current stack. Do not add major infrastructure unnecessarily. Clearly document production scaling limitations.

⸻

PART B: ATTENDANCE CHECK-IN

8. Roles and permissions

Integrate with the existing role system. Do not create a competing authorization mechanism.

Required permissions:

Super administrator

* Create, view, edit, enable and disable any approved attendance location.
* Configure schedules, radii and organization-wide attendance rules.
* View permitted attendance reports and audit records.

Manager

* Manage only locations, schedules and employees within the manager’s assigned organization, branch, department or scope.
* View attendance records only within that authorized scope.
* Never elevate their own permissions or manage locations outside their assigned scope.

Employee/user

* View locations assigned to them where appropriate.
* Check in only for themselves.
* View only their own attendance history unless otherwise authorized.

Enforce all permissions on the server. Hiding frontend controls is not sufficient.

9. Approved attendance locations

Allow authorized super administrators and managers to create fixed attendance locations using either:

* A human-readable location name plus selected map coordinates.
* Direct latitude and longitude entry.

Each location should contain:

* Unique ID.
* Organization/tenant ID where applicable.
* Name.
* Description or address.
* Latitude.
* Longitude.
* Allowed radius in metres.
* IANA timezone, for example Africa/Lagos.
* Active/inactive state.
* Creator and last updater.
* Creation and update timestamps.
* Optional branch/department assignment.

Default radius may be between 3 km and 5 km as required, but it must be configurable per location and stored in metres. Provide clear warnings in the admin interface that a 3–5 km radius covers a large area. Validate radius using sensible configurable minimum and maximum bounds.

Use sufficiently precise PostgreSQL numeric types for latitude and longitude. Add database constraints:

* Latitude must be between -90 and 90.
* Longitude must be between -180 and 180.
* Radius must be positive and within the configured maximum.
* Timezone must be a valid supported IANA timezone at the application-validation layer.
* Required foreign keys and tenant constraints must be enforced.

Use PostGIS only if it is already available or can be introduced safely without deployment risk. Otherwise, perform the Haversine distance calculation securely on the backend using decimal coordinates.

10. Attendance schedules

Allow authorized administrators to configure schedules containing:

* Opening time, initially/defaulting to 8:00 a.m.
* Optional late-after time.
* Closing time.
* Applicable days of the week.
* Associated attendance location(s).
* Associated branch, department or employee group where applicable.
* IANA timezone inherited from or explicitly associated with the location.
* Active date range.
* Active/inactive state.

Do not use the employee’s device clock as the authoritative time.

The backend must use its trusted server time, preferably stored in UTC, and evaluate attendance rules using the approved location’s IANA timezone. The client-detected timezone may be recorded as diagnostic metadata but must not determine whether check-in is allowed.

Handle daylight-saving transitions correctly for locations that use them.

11. Check-in flow

When the authenticated employee opens the attendance/check-in page:

1. Retrieve applicable active schedules and assigned attendance locations securely.
2. Explain why location access is needed.
3. Ask for browser geolocation permission only after a user action where practical.
4. Request a fresh high-accuracy location reading.
5. Capture:
    * Latitude.
    * Longitude.
    * Reported accuracy in metres.
    * Location reading timestamp.
    * Client-detected IANA timezone.
6. Send the reading to the backend.
7. The backend must independently check:
    * The authenticated user’s identity.
    * Employment/account status.
    * Organization/tenant membership.
    * Location and schedule assignment.
    * Whether the approved location is active.
    * Trusted server time.
    * Applicable working day and active date range.
    * Opening, late and closing rules.
    * Whether the submitted coordinates are valid.
    * GPS accuracy threshold.
    * Distance from the approved location.
    * Whether the employee already checked in for that schedule/workday.
8. Only after all checks pass should the backend create the check-in record.
9. Return the authoritative result to the frontend.
10. Show a clear success or failure state.

The check-in button must remain disabled when:

* Geolocation is unsupported.
* Location permission is denied.
* A reliable position has not been obtained.
* The location reading is stale.
* Reported accuracy exceeds the configured limit.
* The user is outside every authorized location.
* Attendance is not yet open.
* Attendance has closed.
* The user already checked in.
* The backend rejects the request.

Never trust a client-provided calculated distance, time, timezone, location ID, role, attendance state or “inside geofence” flag.

12. Distance calculation

Calculate distance on the backend between:

* Submitted employee coordinates.
* Approved location coordinates.

Use the Haversine formula or PostGIS if safely available.

A check-in is allowed only when:

calculated distance <= approved radius

Account for reported GPS accuracy according to a clearly documented policy. Do not silently increase the approved radius by several kilometres because of poor accuracy.

Store the backend-calculated distance, not a distance submitted by the client.

13. Check-in records

Create or extend the PostgreSQL attendance/check-in table to contain the appropriate version of:

* Check-in ID.
* User/employee ID.
* Organization/tenant ID.
* Approved location ID.
* Schedule ID.
* Work date in the approved location’s timezone.
* Trusted server check-in timestamp in UTC.
* Employee latitude and longitude at check-in.
* Reported GPS accuracy.
* Backend-calculated distance in metres.
* Client-reported location timestamp.
* Client-detected timezone.
* Status such as on_time or late.
* Verification/risk flags where applicable.
* Device/browser metadata, kept minimal.
* Created timestamp.

Use a database-level unique constraint to prevent multiple successful check-ins by the same employee for the same schedule and work date.

Use a transaction and concurrency-safe insert so double taps, retries or simultaneous requests cannot create duplicates.

This release is primarily check-in functionality. Do not force a check-out workflow unless one already exists, but design the schema so check-out can be added later without destructive migration.

14. PostgreSQL and migration safety

Use the project’s existing ORM and migration system.

All migrations must be:

* Additive where possible.
* Reversible where the migration framework supports it.
* Compatible with existing production data.
* Free of destructive table recreation.
* Safe for deployment.
* Properly indexed.
* Backed by foreign keys and check constraints.
* Designed for the project’s tenant model.

Requirements:

* Do not drop or rename legacy columns without explicit necessity.
* Do not reset or reseed the production database.
* Do not use schema synchronization commands that can destroy data.
* Use nullable columns or safe staged migrations when introducing required fields to existing populated tables.
* Add indexes for common notification, subscription, location, schedule and attendance queries.
* Avoid storing latitude/longitude as imprecise floating-point values if the existing ORM supports suitable decimal/numeric types.
* Store timestamps consistently, preferably as PostgreSQL timestamptz in UTC.
* Include migration rollback notes.
* If using Supabase or another system with row-level security, implement and test the necessary RLS policies. Otherwise, enforce equivalent ownership and tenant isolation in the backend service layer.

15. Audit logging

Create an audit trail for security-sensitive actions:

* Location created, changed, activated or disabled.
* Attendance schedule created or changed.
* Attendance check-in accepted or rejected.
* Manual attendance modification, if that feature already exists or is introduced.
* Push subscription enabled or disabled.
* Administrative access to reports where appropriate.

Each audit event should record:

* Actor ID.
* Organization/tenant.
* Action.
* Target type and ID.
* Server timestamp.
* Safe structured metadata.
* Request/correlation ID where available.

Do not store passwords, session tokens, push encryption secrets or unnecessary precise location information in general logs.

16. Security requirements

Apply the security mechanisms already established by the application and add missing protections where needed:

* Authentication on every private endpoint.
* Server-side role and tenant authorization.
* Input validation using the project’s standard validation library.
* Parameterized queries or ORM-safe query methods.
* CSRF protection where cookie-based authentication requires it.
* Appropriate CORS policy.
* Rate limiting for check-in, subscription and administrative endpoints.
* Request body limits.
* Secure secret management through environment variables.
* VAPID private keys must never be sent to the frontend or committed to Git.
* Do not expose precise coordinates in push notifications.
* Do not reveal another tenant’s locations through IDs, errors or timing-sensitive lookups.
* Use generic unauthorized/not-found responses where appropriate.
* Prevent open redirects from notification destination URLs.
* Preserve the application’s Content Security Policy and service-worker security.
* Do not collect continuous/background location.
* Request location only when required for check-in.
* Define retention controls for precise employee location data.
* Document privacy and consent requirements.
* Add basic detection/flagging for obviously impossible or suspicious readings, while acknowledging that browser geolocation alone cannot completely prevent GPS spoofing.

Do not claim the system is fully spoof-proof. Browser GPS data can be manipulated. Structure the implementation so stronger verification—registered device, rotating workplace QR code, selfie verification, trusted network or manager approval—can be added later.

17. User interface

Follow the existing design system and make the interface responsive and accessible.

Employee check-in screen should display:

* Current attendance availability.
* Assigned/nearest approved location.
* Scheduled opening and closing times.
* Location-permission state.
* Location accuracy where useful.
* Distance/status without exposing sensitive administrative data.
* “Check in” button.
* Loading state.
* Success result with authoritative server timestamp.
* On-time or late status.
* Clear remediation messages.

Example failure messages:

* “Location permission is required to check in.”
* “We could not get an accurate location. Move to an open area and try again.”
* “You are outside the approved work location.”
* “Check-in opens at 8:00 a.m.”
* “The check-in period has closed.”
* “You have already checked in today.”
* “This location is not assigned to your account.”

Admin/manager screens should allow authorized users to:

* Create and update attendance locations.
* Select coordinates on a map if the existing project has a map provider.
* Configure radius and schedule.
* Assign scope.
* Enable or disable a location.
* View filtered attendance records.
* Export data only if an existing safe export convention exists.

Do not introduce a paid map dependency without documenting it. A map is optional; coordinates and location name must still work without one.

18. Location and permission edge cases

Handle:

* Permission denied.
* Permission permanently blocked.
* Location services disabled.
* Unsupported browser.
* Location timeout.
* Stale cached position.
* Low-accuracy reading.
* No assigned location.
* Multiple eligible nearby locations.
* User exactly on the radius boundary.
* Network failure during submission.
* Duplicate submission.
* Schedule spanning midnight.
* Server/client timezone disagreement.
* Inactive location.
* Suspended employee.
* Manager attempting cross-tenant access.
* Push permission denied.
* Expired push subscription.
* Service-worker update conflict.

If multiple locations qualify, select deterministically—prefer the assigned location with the shortest calculated distance unless existing business rules specify otherwise.

19. API design

Follow existing API conventions. Suggested operations include equivalents of:

* Register push subscription.
* Remove push subscription.
* List notifications.
* Get unread count.
* Mark notification as read.
* Mark all notifications as read.
* List applicable attendance locations/schedules.
* Obtain check-in availability/status.
* Submit check-in.
* Manage locations and schedules for authorized roles.
* View attendance history/reports.

Do not copy these paths blindly if the repository uses different conventions.

All error responses should use the existing structured error format and stable machine-readable error codes.

The final check-in endpoint must be idempotent. Use an idempotency key where consistent with the architecture, together with the database uniqueness constraint.

20. Testing

Add comprehensive tests using the existing test framework.

At minimum, test:

Unit tests

* Haversine distance calculations.
* Radius boundary behaviour.
* Timezone conversion.
* 8:00 a.m. opening rule.
* Late and closing rules.
* Schedule spanning midnight.
* Accuracy and stale-location validation.
* Notification destination validation.
* Role and scope checks.

Integration/database tests

* Successful check-in.
* Too-early check-in.
* Closed attendance period.
* Outside-radius rejection.
* Duplicate and concurrent check-in prevention.
* Inactive location rejection.
* Unassigned employee rejection.
* Cross-tenant access prevention.
* Manager scope enforcement.
* PostgreSQL constraints and foreign keys.
* Push subscription ownership.
* Expired subscription cleanup.
* Notification ownership and unread counts.

Frontend/end-to-end tests where supported

* Permission granted.
* Permission denied.
* Loading and retry states.
* Check-in success.
* Already-checked-in state.
* Offline/network failure.
* Push opt-in and opt-out.
* Notification click navigation.

Mock browser geolocation, server time and push services deterministically in tests. Do not make tests depend on the developer’s real coordinates or current clock.

21. Environment and documentation

Update the environment example file with placeholder names only, never real credentials.

Document:

* Required VAPID/provider environment variables.
* How to generate development VAPID keys safely.
* Migration and deployment commands.
* Service-worker/PWA requirements.
* HTTPS requirement.
* Browser and iOS/iPadOS limitations.
* Notification testing instructions.
* Attendance location configuration.
* Server-time and timezone behaviour.
* GPS accuracy policy.
* Location-data retention recommendations.
* Known GPS-spoofing limitations.
* Rollback procedure.

Do not commit generated secrets.

22. Implementation discipline

While implementing:

* Make small, focused changes.
* Preserve existing public interfaces unless extension is required.
* Avoid broad refactors.
* Avoid changing unrelated formatting.
* Do not suppress type errors or lint errors.
* Do not use any, unsafe casts or disabled security checks merely to make compilation pass.
* Do not replace working legacy code without documenting a concrete reason.
* Do not delete existing migrations.
* Do not modify production data directly.
* Do not silently install major dependencies.
* Ensure all new code follows existing conventions.
* If requirements conflict with the current architecture, explain the conflict and choose the least disruptive secure solution.

23. Final verification and report

Before finishing:

1. Review the complete diff.
2. Confirm no unrelated code was changed.
3. Run database migration validation.
4. Run formatting, linting, type-checking and relevant tests.
5. Run the production build.
6. Resolve failures caused by the implementation.
7. Clearly identify any pre-existing failures separately.
8. Perform a security review covering authorization, tenant isolation, timestamps, coordinates, push secrets and service-worker behaviour.

Provide a final report containing:

* What was implemented.
* Files changed.
* Database tables/columns/indexes/constraints added.
* Migrations created.
* API endpoints added or changed.
* Environment variables required.
* Security protections added.
* Tests added and their results.
* Build/lint/type-check results.
* Manual testing steps.
* Deployment order.
* Rollback instructions.
* Remaining limitations or decisions requiring confirmation.

Do not stop after generating a plan or sample code. Implement the feature fully in the existing repository, migrate it safely, test it, and report the verified result.

---

## Codex Work Notes

### Repository Audit Summary

- Backend framework: Express 5 on Node.js.
- Package manager/test runner: npm with `node --test`.
- Runtime data layer: local JSON store for tests/development.
- PostgreSQL migration contract: `src/database/schema.sql`.
- Prisma contract: `prisma/schema.prisma`.
- Authentication: bearer access tokens via `src/auth/middleware.js`, `src/auth/tokens.js`, and user/session stores.
- Authorization: existing RBAC permissions in `src/constants/rbac.js`; no separate attendance authorization system was introduced.
- Multi-tenancy/scope: records use organization/employer plus department/branch/employee scoping where present.
- Service worker/PWA frontend code is not present in this backend repository; backend push APIs and documentation are present.

### Implementation Status

- Web push notification center and push subscription backend support are implemented in `src/modules/notifications/notification.service.js` and `src/modules/notifications/notification.routes.js`.
- Location-restricted employee check-in backend support is implemented in `src/modules/attendance/service.js`, `src/modules/attendance/routes.js`, and `src/modules/attendance/geo.js`.
- API routes are mounted under `/api/v1/notifications`, `/api/notifications`, `/api/v1/attendance`, and `/api/attendance`.
- PostgreSQL and Prisma schema contracts include notification jobs, delivery logs, push subscriptions, attendance locations, attendance schedules, and attendance check-in fields/indexes.
- Endpoint documentation is maintained in `docs/attendance-and-push-endpoints.md`.
- Current schedule defaults are opening time `08:00`, late-after time `09:30`, and closing time `17:00`.
- Attendance record listing is available to super admin and HR through `/api/v1/attendance/records`; managers and HOD users remain scoped to their assigned teams.
- Placeholder environment variables are documented in `.env.example`; real secrets must stay in local/production environment configuration only.

### Verification Checklist

- Run focused tests: `node --test test/webPushNotifications.test.js test/attendanceCheckIn.test.js`.
- Run full test suite: `npm test`.
- Validate database contract before deployment with the project's PostgreSQL migration process.
- Configure VAPID values in production environment variables before enabling browser push delivery.

### Verification Results

- Focused attendance and web push tests passed: 3 tests, 3 passed.
- Full test suite passed through Windows-safe command `npm.cmd test`: 41 tests, 41 passed.
- Plain `npm test` in PowerShell was blocked by local script execution policy before running application code.
- Prisma CLI/database migration validation was not run because this repository does not list Prisma CLI or `@prisma/client` in `package.json`/`package-lock.json`; validate the SQL/Prisma contract with the deployment migration tooling used in production.
