require("dotenv").config();

const { createApp } = require("./app");
const { ensureSuperadminFromEnv } = require("./auth/bootstrap");
const { syncAllUsersToSupabase } = require("./auth/accountStore");
const { assertRuntimeConfig, getRuntimeConfig } = require("./config");
const { startBackgroundWorkers, stopBackgroundWorkers } = require("./workers");

assertRuntimeConfig();

let server;

async function start() {
  await syncAllUsersToSupabase();
  await ensureSuperadminFromEnv();

  const app = createApp();
  const runtimeConfig = getRuntimeConfig();

  server = app.listen(runtimeConfig.port, () => {
    console.log(`WMS API listening on port ${runtimeConfig.port}`);
    startBackgroundWorkers();
  });
}

function shutdown(signal) {
  console.log(`${signal} received. Shutting down WMS API.`);
  stopBackgroundWorkers();

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, runtimeConfig.shutdownTimeoutMs);
  if (typeof forceExit.unref === "function") forceExit.unref();

  if (!server) {
    process.exit(0);
  }

  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
