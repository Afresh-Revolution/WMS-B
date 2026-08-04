require("dotenv").config();

const { checkDatabaseConnection } = require("../src/db");

checkDatabaseConnection()
  .then((row) => {
    console.log("Database connection successful.");
    console.log(`Server time: ${row.now.toISOString()}`);
  })
  .catch((error) => {
    console.error("Database connection failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
