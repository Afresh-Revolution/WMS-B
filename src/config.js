function assertRuntimeConfig() {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !process.env.AUTH_TOKEN_SECRET) {
    throw new Error("AUTH_TOKEN_SECRET is required in production.");
  }

  if (isProduction && !process.env.SUPERADMIN_SETUP_TOKEN) {
    throw new Error("SUPERADMIN_SETUP_TOKEN is required in production.");
  }

  if (!process.env.AUTH_TOKEN_SECRET) {
    process.env.AUTH_TOKEN_SECRET = "development-only-token-secret-change-me";
    console.warn("AUTH_TOKEN_SECRET is not set. Using an insecure development default.");
  }
}

module.exports = { assertRuntimeConfig };
