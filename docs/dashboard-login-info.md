# Dashboard Login Information

This file lists the dashboard smoke-test login accounts used to verify that each dashboard can authenticate and load.

Every user on the system signs in through **one login page**. The frontend must call this shared endpoint for Super Admin, HR, HOD, Manager, Secretary, Accountant, Employee, and NYSC/Intern accounts:

```http
POST /api/v1/auth/login
Content-Type: application/json
```

Example login body:

```json
{
  "email": "smoke.hod@example.test",
  "password": "SmokePass123!",
  "keepMeSignedIn": true
}
```

The login response includes `user.roleKey` and `workspace.dashboardPath` so the same page can route each person to their own dashboard after a successful sign-in.

The login page can also read:

```http
GET /api/v1/auth/login-options
```

That response confirms the shared login endpoint, whether `keepMeSignedIn` is allowed, and whether SSO is enabled.

Forgot password for every account uses:

```http
POST /api/v1/auth/forgot-password
```

## Important User Creation Rule

Only Super Admin can add users to the system.

In the application flow, new dashboard users must be created by a Super Admin through the Super Admin user-management flow. Other dashboard roles such as HR, HOD, Manager, Secretary, Accountant, Employee, and NYSC/Intern must not create system login accounts directly.

The smoke-test accounts below are for backend/dashboard verification only.

## Smoke Dashboard Accounts

| Dashboard | Email | Password | Dashboard Endpoint |
| --- | --- | --- | --- |
| HR | `smoke.hr@example.test` | `SmokePass123!` | `GET /api/v1/hr/dashboard` |
| HOD | `smoke.hod@example.test` | `SmokePass123!` | `GET /api/v1/hod/dashboard` |
| Manager | `smoke.manager@example.test` | `SmokePass123!` | `GET /api/v1/manager/dashboard` |
| Secretary | `smoke.secretary@example.test` | `SmokePass123!` | `GET /api/v1/secretary/dashboard` |
| Accountant | `smoke.accountant@example.test` | `SmokePass123!` | `GET /api/v1/accountant/dashboard` |
| Employee | `smoke.employee@example.test` | `SmokePass123!` | `GET /api/v1/employee/dashboard` |
| NYSC/Intern | `smoke.nysc@example.test` | `SmokePass123!` | `GET /api/v1/nysc-intern/dashboard` |

## Super Admin

The Super Admin account comes from the local environment configuration:

| Dashboard | Email | Password | Dashboard Endpoint |
| --- | --- | --- | --- |
| Super Admin | `abnerabraham25@gmail.com` | Value of `SUPERADMIN_PASSWORD` in `.env` | `GET /api/v1/super-admin/dashboard` |

Do not commit or paste the real Super Admin password into documentation.

## Smoke Test Command

Run the dashboard login smoke test with:

```powershell
node scripts\smoke-dashboard-logins.js
```

Expected result: every dashboard user returns `200` for login and `200` for the dashboard endpoint.
