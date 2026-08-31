const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { verifyPassword } = require("../src/auth/passwords");
const { ensureSuperadminFromEnv } = require("../src/auth/bootstrap");
const { getUserByEmail } = require("../src/auth/userStore");

test("auto-creates the superadmin from environment when no superadmin exists", () => {
  const previousDataDir = process.env.DATA_DIR;
  const previousEmail = process.env.SUPERADMIN_EMAIL;
  const previousPassword = process.env.SUPERADMIN_PASSWORD;
  const previousName = process.env.SUPERADMIN_NAME;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-superadmin-bootstrap-"));

  try {
    process.env.DATA_DIR = dataDir;
    process.env.SUPERADMIN_EMAIL = "owner@example.com";
    process.env.SUPERADMIN_PASSWORD = "StrongPassword123!";
    process.env.SUPERADMIN_NAME = "Owner Admin";

    const result = ensureSuperadminFromEnv({ logger: { log() {}, warn() {} } });
    const user = getUserByEmail("owner@example.com");

    assert.equal(result.created, true);
    assert.equal(user.email, "owner@example.com");
    assert.equal(user.role, "superadmin");
    assert.equal(verifyPassword("StrongPassword123!", user.passwordHash), true);

    const secondResult = ensureSuperadminFromEnv({ logger: { log() {}, warn() {} } });
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.reason, "already_exists");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousEmail === undefined) delete process.env.SUPERADMIN_EMAIL;
    else process.env.SUPERADMIN_EMAIL = previousEmail;
    if (previousPassword === undefined) delete process.env.SUPERADMIN_PASSWORD;
    else process.env.SUPERADMIN_PASSWORD = previousPassword;
    if (previousName === undefined) delete process.env.SUPERADMIN_NAME;
    else process.env.SUPERADMIN_NAME = previousName;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
