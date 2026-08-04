require("dotenv").config();

const { hashPassword } = require("../src/auth/passwords");
const {
  createSuperadmin,
  getUserByEmail,
  hasSuperadmin,
  sanitizeUser,
} = require("../src/auth/userStore");

const name = process.env.SUPERADMIN_NAME || "Main Admin";
const email = process.env.SUPERADMIN_EMAIL;
const password = process.env.SUPERADMIN_PASSWORD;

if (!email || !password) {
  console.error("SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are required.");
  process.exit(1);
}

if (hasSuperadmin()) {
  const existingUser = getUserByEmail(email);

  console.log("Superadmin already exists. No password was changed.");
  if (existingUser) {
    console.log(JSON.stringify({ user: sanitizeUser(existingUser) }, null, 2));
  }
  process.exit(0);
}

const user = createSuperadmin({
  name,
  email,
  passwordHash: hashPassword(password),
});

console.log("Superadmin created.");
console.log(JSON.stringify({ user: sanitizeUser(user) }, null, 2));
