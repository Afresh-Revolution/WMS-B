const INTEGRATION_STATUSES = Object.freeze(["active", "inactive", "expired", "error", "pending"]);

const INTEGRATION_FIELDS = Object.freeze([
  "id",
  "provider",
  "name",
  "description",
  "status",
  "connectedBy",
  "accountEmail",
  "externalAccountId",
  "accessToken",
  "refreshToken",
  "apiKey",
  "config",
  "connectedAt",
  "disconnectedAt",
  "lastTestedAt",
  "createdAt",
  "updatedAt",
]);

module.exports = { INTEGRATION_FIELDS, INTEGRATION_STATUSES };
