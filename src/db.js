const { Pool } = require("pg");

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

async function checkDatabaseConnection() {
  const pool = createPool();

  try {
    const result = await pool.query("select now() as now");
    return result.rows[0];
  } finally {
    await pool.end();
  }
}

module.exports = { checkDatabaseConnection, createPool };
