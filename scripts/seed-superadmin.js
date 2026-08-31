require("dotenv").config();

const { ensureSuperadminFromEnv } = require("../src/auth/bootstrap");

const result = ensureSuperadminFromEnv();

if (result.reason === "missing_env") {
  process.exit(1);
}

if (!result.created) {
  console.log("Superadmin already exists. No password was changed.");
  if (result.user) {
    console.log(JSON.stringify({ user: result.user }, null, 2));
  }
  process.exit(0);
}

console.log("Superadmin created.");
console.log(JSON.stringify({ user: result.user }, null, 2));
