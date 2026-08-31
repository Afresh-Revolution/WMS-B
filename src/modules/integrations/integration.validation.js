const SUPPORTED_PROVIDERS = Object.freeze(["slack", "google_workspace", "paystack", "zoom"]);

function normalizeProvider(provider) {
  return String(provider || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function isSupportedProvider(provider) {
  return SUPPORTED_PROVIDERS.includes(normalizeProvider(provider));
}

module.exports = { SUPPORTED_PROVIDERS, isSupportedProvider, normalizeProvider };
