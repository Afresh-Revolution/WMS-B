# WMS Backend Project Documentation

This document summarizes what has been built for the Afresh Work Management System backend, how it is structured, how authentication works, how the frontend should consume it, and how to deploy it.

## Project Summary

The project is a production-ready Node.js and Express backend for a Work Management System. It exposes REST APIs for these roles:

- Super Admin
- HOD
- Manager
- HR
- Secretary
- Accountant
- Employee
- NYSC/Intern

The UI screenshots were used only as product references. No frontend UI was built in this repository. The backend provides JSON APIs for the frontend to call.

## Technology Stack

- Runtime: Node.js
- Framework: Express
- Database: Supabase PostgreSQL through `DATABASE_URL`
- Local fallback storage: JSON files in `data/`
- Authentication: JWT access tokens and refresh tokens
- Passwords: hashed before storage
- Tests: Node built-in test runner
- Deployment target: Render

## Main Features Completed

### Authentication and Access Control

- Super Admin bootstrap endpoint.
- Super Admin login endpoint.
- Shared login endpoint for all roles.
- JWT access token generation.
- Refresh token generation.
- Protected route middleware.
- Role-based access control.
- Permission catalog and role catalog.
- Failed login tracking.
- Login history tracking.
- Session tracking and revocation.
- Password change and reset support.
- Persistent in-app notifications with Web Push subscription support.
- Location-restricted employee check-in with server-side geofence validation.

### Account Lock Workflow

Accounts are locked after repeated failed password attempts.

Default behavior:

- Failed attempts before lock: `10`
- Lock duration: `15` minutes
- Successful login resets failed attempt counters to `0`
- Expired timed locks are automatically cleared on the next login attempt

The lock policy can be controlled with:

```text
MAX_LOGIN_ATTEMPTS=10
LOCKOUT_DURATION_MINUTES=15
```

When an account is locked, login can return:

```json
{
  "success": false,
  "message": "Operation failed",
  "error": {
    "code": "ACCOUNT_NOT_ACTIVE",
    "details": {
      "message": "Account is not active.",
      "status": "locked"
    }
  }
}
```

Unlock one account from the command line:

```bash
npm run unlock:user -- user@example.com
```

Unlock the Super Admin from `.env`:

```bash
npm run unlock:user
```

### Supabase Credential Storage

Super Admin credentials now persist in Supabase when `DATABASE_URL` is configured.

This fixes the Render restart problem where local JSON data disappears. On deployment:

- The backend checks Supabase for an existing Super Admin.
- If none exists, it can create one from environment variables.
- Super Admin-created login accounts, including HOD and NYSC/Intern users, are created in Supabase when `DATABASE_URL` is configured.
- Login reads the user from Supabase, not temporary Render disk.
- Local JSON still works as a fallback for development and tests.

Important files:

- `src/auth/postgresUserStore.js`
- `src/auth/bootstrap.js`
- `src/auth/userStore.js`
- `src/modules/auth/routes.js`
- `src/routes/superadminAuth.js`
- `src/auth/middleware.js`

### Super Admin Backend

The Super Admin API includes:

- Dashboard overview
- System health
- System management
- Users
- Roles
- Permissions
- Staff directory
- Departments
- Leave
- Meetings
- Targets
- Payroll
- Purchases
- Bills
- Expenses
- Vendors
- Events
- Discipline
- Announcements
- Reports
- Integrations
- Email configuration
- Notification configuration
- Operational audit logs
- Technical audit logs
- Backups
- Global search

Detailed endpoint documentation:

- `docs/super-admin-endpoints.md`
- `docs/employer-endpoints.md`

### Manager Backend

The Manager API supports department-scoped management workflows:

- Manager dashboard
- Department staff overview
- Assigned tasks and targets
- Meetings
- Leave workflows
- Staff performance
- Reports
- Scoped access so managers cannot read or modify unrelated departments

Detailed endpoint documentation:

- `docs/manager-endpoints.md`

### HOD Backend

The HOD API supports the department dashboard shown in the HOD UI:

- Department overview
- Team member list and detail views
- Department tasks
- Target and KPI tracking
- Department meetings
- Scoped leave approvals
- Department reports and notifications
- Scoped access so HOD users cannot read or modify unrelated departments

Detailed endpoint documentation:

- `docs/hod-endpoints.md`

### HR Backend

The HR API supports people operations:

- HR dashboard
- Staff records
- Recruitment-style workflows
- Employment records
- Attendance/leave-related HR views
- Discipline support
- Announcements
- HR reports

Detailed endpoint documentation:

- `docs/hr-endpoints.md`

### Secretary Backend

The Secretary API supports administrative coordination:

- Secretary dashboard
- Email requests
- Company email account management
- Calendar events
- Meetings
- Reminders
- Administrative tasks
- Employment record views with restricted update rules

Detailed endpoint documentation:

- `docs/secretary-endpoints.md`

### Accountant Backend

The Accountant API supports finance workflows:

- Accountant dashboard
- Payments register
- Payment creation
- Payment reconciliation
- Purchase and bill payment sources
- Salary/payment summaries
- Expense summaries
- Financial reports
- Notifications and audit views

Detailed endpoint documentation:

- `docs/accountant-endpoints.md`

### Employee Backend

The Employee API supports the self-service dashboard shown in the Employee UI:

- Home dashboard
- Employment record
- Leave and time off requests
- Assigned tasks and progress updates
- Schedule and meetings
- Location-restricted attendance check-in
- Expense claims
- Performance and records
- Notifications and settings
- Self-scoped access so employees cannot read or modify another employee's records

Detailed endpoint documentation:

- `docs/employee-endpoints.md`

### Attendance And Web Push Backend

The attendance and notification backend supports:

- Approved attendance locations with configurable radius in metres
- Attendance schedules with `08:00` default opening time and `09:30` late-after time
- Server-time and IANA-timezone schedule evaluation
- Fresh browser geolocation submission with backend Haversine distance checks
- Duplicate check-in protection by employee, schedule, and work date
- Super admin, HR, Manager, and HOD attendance record and summary views with scoped manager/HOD access
- User-owned notification center
- Web Push subscription registration, revocation, and delivery queue hooks
- Safe internal notification destination URLs

Detailed endpoint documentation:

- `docs/attendance-and-push-endpoints.md`

### NYSC/Intern Backend

The NYSC/Intern API supports the self-service dashboard shown in the NYSC/Intern UI:

- Home dashboard
- Placement record
- Assigned tasks and progress updates
- Schedule and meetings
- Placement progress and targets
- Attendance, documents, and reviews
- Company and department news
- Notifications and settings
- Self-scoped access so interns cannot read or modify another intern's placement records

Detailed endpoint documentation:

- `docs/intern-endpoints.md`

## Important API Base URLs

Local development:

```text
http://127.0.0.1:3000
```

Render deployment:

```text
https://wms-b.onrender.com
```

Main API namespace:

```text
/api/v1
```

Legacy Super Admin auth namespace:

```text
/api/superadmin
```

## Login Endpoints

Every user signs in through one login page. The frontend must use this shared endpoint for Super Admin and all staff roles:

```http
POST /api/v1/auth/login
```

Public login-page options:

```http
GET /api/v1/auth/login-options
```

Legacy Super Admin-only login alias:

```http
POST /api/superadmin/login
```

Request body:

```json
{
  "email": "admin@example.com",
  "password": "your-password",
  "keepMeSignedIn": true
}
```

Successful response includes:

```json
{
  "token": "access-token",
  "accessToken": "access-token",
  "refreshToken": "refresh-token",
  "user": {
    "email": "admin@example.com",
    "roleKey": "superadmin"
  },
  "workspace": {
    "key": "super-admin",
    "name": "Super Admin",
    "dashboardPath": "/api/v1/super-admin/dashboard",
    "homePath": "/super-admin"
  }
}
```

The frontend should keep a single sign-in screen and use `workspace` / `user.roleKey` to open the correct dashboard after login.

For protected requests, the frontend must send:

```http
Authorization: Bearer ACCESS_TOKEN
```

The frontend must not receive or store backend secrets such as:

- `DATABASE_URL`
- `AUTH_TOKEN_SECRET`
- `SUPERADMIN_SETUP_TOKEN`
- `ENCRYPTION_KEY`

## Postman Login Test

Method:

```text
POST
```

URL:

```text
https://wms-b.onrender.com/api/v1/auth/login
```

Headers:

```text
Content-Type: application/json
```

Body type:

```text
raw JSON
```

Body:

```json
{
  "email": "your-superadmin-email",
  "password": "your-superadmin-password"
}
```

After login, copy the returned `token`. For protected endpoints in Postman, use:

```text
Authorization > Type: Bearer Token
Token: paste returned token
```

## Deployment on Render

Build command:

```bash
npm ci
```

Start command:

```bash
npm start
```

Required Render environment variables:

```text
NODE_ENV=production
PORT=10000
DATABASE_URL=postgresql://...
AUTH_TOKEN_SECRET=long-random-secret
ENCRYPTION_KEY=long-random-secret
SUPERADMIN_SETUP_TOKEN=one-time-setup-token
SUPERADMIN_EMAIL=superadmin-email
SUPERADMIN_PASSWORD=superadmin-password
CORS_ORIGIN=https://your-frontend-domain.com
TRUST_PROXY=true
```

Optional environment variables:

```text
REQUEST_BODY_LIMIT=1mb
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=600
AUTH_RATE_LIMIT_MAX=30
WEB_PUSH_VAPID_PUBLIC_KEY=browser-public-key
WEB_PUSH_VAPID_PRIVATE_KEY=server-private-key
WEB_PUSH_VAPID_SUBJECT=mailto:admin@example.com
ATTENDANCE_DEFAULT_RADIUS_METERS=3000
ATTENDANCE_MIN_RADIUS_METERS=10
ATTENDANCE_MAX_RADIUS_METERS=5000
ATTENDANCE_MAX_GPS_ACCURACY_METERS=100
ATTENDANCE_MAX_LOCATION_AGE_SECONDS=300
MAX_LOGIN_ATTEMPTS=10
LOCKOUT_DURATION_MINUTES=15
REQUIRE_DATABASE_ON_READY=true
DISABLE_BACKGROUND_WORKERS=false
SHUTDOWN_TIMEOUT_MS=10000
FRONTEND_URL=https://your-frontend-domain.com
```

Render must store only the database URL value, not `DATABASE_URL=` inside the value.

Correct:

```text
postgresql://postgres.project-ref:password@host.supabase.com:5432/postgres
```

Wrong:

```text
DATABASE_URL=postgresql://...
```

## Supabase Notes

The backend connects to Supabase PostgreSQL using `DATABASE_URL`.

The Super Admin user is stored in the `users` table. If the table does not exist, the backend creates the minimal required `users` table automatically for authentication.

The complete PostgreSQL schema is available at:

```text
src/database/schema.sql
```

Attendance check-in and Web Push add the following PostgreSQL objects in the schema blueprint:

- `push_subscriptions`
- `attendance_locations`
- `attendance_schedules`
- Additional `notifications` fields such as `destination_url` and `idempotency_key`
- Additional `attendance` fields such as `location_id`, `schedule_id`, `work_date`, GPS accuracy, backend-calculated distance, client location timestamp, timezone, risk flags, and idempotency key

The Prisma schema blueprint is available at:

```text
prisma/schema.prisma
```

## Health Checks

Basic API health:

```http
GET /live
```

Readiness:

```http
GET /ready
```

Database health:

```http
GET /health/database
```

## Local Development

Install dependencies:

```bash
npm install
```

Start server:

```bash
npm start
```

Windows PowerShell fallback:

```bash
npm.cmd start
```

Check Supabase database connection:

```bash
npm.cmd run db:check
```

Seed Super Admin:

```bash
npm.cmd run seed:superadmin
```

Run tests:

```bash
npm test
```

Windows PowerShell fallback:

```bash
npm.cmd test
```

## Security and Production Readiness

Production hardening added:

- Required production secrets validation.
- Security headers.
- CORS allow-list support.
- Rate limiting.
- Request IDs.
- JSON body limit.
- Graceful shutdown.
- Health/readiness endpoints.
- Database readiness check.
- Deployment documentation.
- Dockerfile and `.dockerignore`.
- Audit logging.
- Role and permission guards.
- Web Push subscription ownership checks.
- Internal-only notification destination validation.
- Backend-only attendance geofence, server-time, and duplicate check-in validation.

## Testing Status

The full backend test suite was run successfully:

```text
41 passed
0 failed
```

Test coverage includes:

- Super Admin auth
- Supabase-backed Super Admin bootstrap behavior
- HOD department dashboard flow
- Employee self-service dashboard flow
- NYSC/Intern self-service placement dashboard flow
- Location-restricted attendance check-in flow
- Web Push notification subscription flow
- User access
- Security policies
- Super Admin dashboard
- Manager dashboard
- HR dashboard
- Secretary dashboard
- Accountant dashboard
- Reports
- Integrations
- Notifications
- Email configuration
- Payroll
- Purchases
- Bills
- Expenses
- Staff directory
- System management

## Git and Deployment Workflow

After code changes:

```bash
git add .
git commit -m "your message"
git push origin main
```

Render should then redeploy from:

```text
main
```

Current pushed repository:

```text
https://github.com/Afresh-Revolution/WMS-B
```

## Current Important Behavior

- Nobody can self-sign up.
- Super Admin creates or assigns users.
- Super Admin credentials are stored in Supabase when deployed.
- Frontend receives tokens only after login.
- Frontend must send `Authorization: Bearer token` for protected routes.
- Setup token is only for first Super Admin bootstrap and must stay backend-side.
