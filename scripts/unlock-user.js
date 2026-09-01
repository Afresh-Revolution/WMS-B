require("dotenv").config();

const { Pool } = require("pg");

const email = process.argv[2] || process.env.SUPERADMIN_EMAIL;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!email) {
  console.error("User email is required. Pass it as an argument or set SUPERADMIN_EMAIL.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const result = await pool.query(
    `update users
     set status = 'active',
         locked_at = null,
         locked_until = null,
         failed_login_attempts = 0,
         failed_login_count = 0,
         updated_at = now()
     where lower(email) = lower($1)
     returning email, role, status, failed_login_attempts`,
    [email]
  );

  console.log(JSON.stringify({ updated: result.rowCount, users: result.rows }, null, 2));
})()
  .catch((error) => {
    console.error(error.publicMessage || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
