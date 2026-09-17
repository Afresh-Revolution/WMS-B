const { hashPassword } = require("./passwords");
const accountStore = require("./accountStore");
const localUserStore = require("./userStore");

async function ensureSuperadminFromEnv({ logger = console } = {}) {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  const name = process.env.SUPERADMIN_NAME || "Main Admin";

  if (await accountStore.hasSuperadmin()) {
    const existingUser = email ? await accountStore.getUserByEmail(email) : null;
    return {
      created: false,
      reason: "already_exists",
      user: existingUser ? localUserStore.sanitizeUser(existingUser) : null,
    };
  }

  if (!email || !password) {
    logger.warn("SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are not set. Superadmin was not auto-created.");
    return {
      created: false,
      reason: "missing_env",
      user: null,
    };
  }

  const user = await accountStore.createSuperadmin({
    name,
    email,
    passwordHash: hashPassword(password),
  });

  logger.log(`Superadmin auto-created for ${user.email}.`);
  return {
    created: true,
    reason: "created",
    user: localUserStore.sanitizeUser(user),
  };
}

module.exports = { ensureSuperadminFromEnv };
