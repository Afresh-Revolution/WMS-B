# Backend Architecture

This backend exposes a versioned REST API under `/api/v1` for a company Work Management System controlled by Super Admin.

## Request Pipeline

Every protected request follows:

1. Authentication
2. Account status check
3. Role and permission lookup
4. Permission guard
5. Payload validation
6. Service-layer business logic
7. Repository/database persistence
8. Audit logging
9. Notification enqueueing when configured
10. Consistent API response

The frontend is never trusted as the security layer.

## Data Sources

The current runtime uses persisted JSON collections through `src/database/jsonStore.js` so tests can run without external services. The production database contract is defined in:

- `src/database/schema.sql`
- `prisma/schema.prisma`

Migration path:

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Install Prisma dependencies.
3. Run `npx prisma migrate dev --name init` from the schema in `prisma/schema.prisma`.
4. Replace JSON repositories incrementally with Prisma repositories behind the existing service APIs.
5. Keep tests at the route/service boundary so storage changes do not rewrite business tests.

## Core Modules

- Auth and sessions: `/api/v1/auth`
- User Access: `/api/v1/users`
- Roles and permissions: `/api/v1/roles`, `/api/v1/permissions`
- Staff Directory: `/api/v1/employers`
- Departments: `/api/v1/departments`
- Leave, meetings, targets, payroll, procurement, bills, expenses, events, discipline, NYSC/interns, announcements, reports, audit logs, security, and system management

## Security Configuration

Use environment variables for token TTLs, Redis, storage, CORS, and lockout policy. Secrets must never be committed.

Important production controls:

- Use Argon2id or bcrypt for passwords.
- Keep refresh tokens hashed at rest.
- Rotate refresh tokens on `/auth/refresh`.
- Rate-limit auth endpoints with Redis.
- Store files in object storage.
- Send emails/notifications via background queues.
- Use database transactions for financial, approval, user-role, and payroll operations.

## Seed Data

Run:

```bash
npm run seed:rbac
npm run seed:superadmin
```

`seed:rbac` provisions default permissions and roles: Super Admin, Admin, HR, Accountant, Secretary, HOD, Employee, and NYSC/Intern.
