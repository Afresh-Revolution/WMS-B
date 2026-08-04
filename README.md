# WMS Backend

Express backend for the work management system.

## Setup

Copy `.env.example` into `.env` and set strong secret values before deploying.

```bash
npm install
npm start
```

On Windows PowerShell, use `npm.cmd start` if script execution is disabled.

Check the database connection:

```bash
npm run db:check
```

Create the local superadmin from `.env`:

```bash
npm run seed:superadmin
```

## Superadmin Auth

Create the first superadmin:

```bash
curl -X POST http://127.0.0.1:3000/api/superadmin/bootstrap ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Main Admin\",\"email\":\"admin@example.com\",\"password\":\"password123\",\"setupToken\":\"replace-with-a-one-time-bootstrap-token\"}"
```

Login:

```bash
curl -X POST http://127.0.0.1:3000/api/superadmin/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@example.com\",\"password\":\"password123\"}"
```

Read current superadmin profile:

```bash
curl http://127.0.0.1:3000/api/superadmin/me ^
  -H "Authorization: Bearer YOUR_TOKEN"
```

Change password:

```bash
curl -X PATCH http://127.0.0.1:3000/api/superadmin/password ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_TOKEN" ^
  -d "{\"currentPassword\":\"password123\",\"newPassword\":\"newPassword123\"}"
```

## Endpoints

- `GET /health`
- `GET /api/superadmin/bootstrap/status`
- `POST /api/superadmin/bootstrap`
- `POST /api/superadmin/login`
- `POST /api/superadmin/logout`
- `GET /api/superadmin/me`
- `PATCH /api/superadmin/password`
