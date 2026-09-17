# Production Deployment

This backend is an API-only Express service for the WMS roles: Super Admin, Manager, HR, Secretary, and Accountant. UI mockups are product reference only; deployment serves backend JSON routes.

## Required Environment

Set these variables before production startup:

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@host:5432/database
AUTH_TOKEN_SECRET=<32+ character random secret>
ENCRYPTION_KEY=<32+ character random secret>
SUPERADMIN_SETUP_TOKEN=<one-time bootstrap token>
CORS_ORIGIN=https://your-frontend.example.com
TRUST_PROXY=true
REQUIRE_DATABASE_ON_READY=true
```

Useful optional controls:

```bash
REQUEST_BODY_LIMIT=1mb
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=600
AUTH_RATE_LIMIT_MAX=30
WEB_PUSH_VAPID_PUBLIC_KEY=<browser public key>
WEB_PUSH_VAPID_PRIVATE_KEY=<server private key>
WEB_PUSH_VAPID_SUBJECT=mailto:admin@example.com
ATTENDANCE_DEFAULT_RADIUS_METERS=3000
ATTENDANCE_MIN_RADIUS_METERS=10
ATTENDANCE_MAX_RADIUS_METERS=5000
ATTENDANCE_MAX_GPS_ACCURACY_METERS=100
ATTENDANCE_MAX_LOCATION_AGE_SECONDS=300
SHUTDOWN_TIMEOUT_MS=10000
DISABLE_BACKGROUND_WORKERS=false
```

## Health Checks

- `GET /live` checks process liveness.
- `GET /ready` checks readiness and, when `REQUIRE_DATABASE_ON_READY=true`, verifies PostgreSQL connectivity.
- `GET /health` remains the simple public health endpoint.
- `GET /health/database` performs an explicit database check.

## Container

Build and run:

```bash
docker build -t wms-api .
docker run --env-file .env -p 3000:3000 wms-api
```

Run migrations or schema setup according to your PostgreSQL deployment plan before accepting production traffic. The SQL blueprint is in `src/database/schema.sql`, and the Prisma contract is in `prisma/schema.prisma`.

## Attendance Check-in And Web Push

Attendance check-in uses trusted server time, approved attendance locations, and backend Haversine distance checks. Store location radii in metres; the default is `3000`, and the configured maximum defaults to `5000`. A 3-5 km radius covers a large area, so choose the smallest operationally acceptable radius per location.

Web Push requires HTTPS in production, a frontend service worker, and VAPID keys. Generate VAPID keys outside the repository (`npx web-push generate-vapid-keys`), store only the public key in frontend-safe configuration, and keep `WEB_PUSH_VAPID_PRIVATE_KEY` in the deployment secret manager. The backend keeps in-app notifications available even when browser push permission is denied or unsupported.

The API origin also serves `/check-in`, `/sw.js`, and `/manifest.webmanifest` for verification and as a drop-in PWA. The Vite frontend at `FRONTEND_URL` should copy `/pwa/js/web-push-client.js` and `/pwa/js/attendance-checkin.js` rather than prompting for notification permission on first page load.

Default check-in opening time is `08:50` in the location IANA timezone. Precise employee coordinates should be retained no longer than `ATTENDANCE_LOCATION_RETENTION_DAYS` (default 365). Browser GPS can be spoofed; do not treat this check-in as spoof-proof.

Job queue scaling: notification delivery uses the in-process worker in `src/workers/index.js` (one-minute poll, 25 jobs per tick). That is enough for a single API instance. Multiple instances can duplicate work; use a shared queue if volume grows.

Deployment order:

1. Apply the additive SQL schema from `src/database/schema.sql`.
2. Configure the attendance and Web Push environment variables.
3. Deploy the backend.
4. Deploy/register the frontend service worker and web app manifest.
5. Create active attendance locations and schedules before enabling employee check-in in the UI.

Rollback:

1. Disable the frontend check-in and push controls.
2. Redeploy the previous backend version if needed.
3. Leave the additive tables and columns in place unless a database administrator has confirmed no retained records are required.

Privacy note: precise employee coordinates are collected only for explicit check-in attempts. Define a retention period for attendance location evidence and avoid exposing coordinates in push payloads, general logs, or user-facing list responses.

## First Admin

Bootstrap once:

```bash
curl -X POST https://your-api.example.com/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"name":"Main Admin","email":"admin@example.com","password":"replace-me","setupToken":"<SUPERADMIN_SETUP_TOKEN>"}'
```

After bootstrap, rotate `SUPERADMIN_SETUP_TOKEN` and store secrets in your host secret manager.
