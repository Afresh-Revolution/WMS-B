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

## First Admin

Bootstrap once:

```bash
curl -X POST https://your-api.example.com/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"name":"Main Admin","email":"admin@example.com","password":"replace-me","setupToken":"<SUPERADMIN_SETUP_TOKEN>"}'
```

After bootstrap, rotate `SUPERADMIN_SETUP_TOKEN` and store secrets in your host secret manager.
