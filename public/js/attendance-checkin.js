const MAX_LOCATION_AGE_MS = 5 * 60 * 1000;

export function geolocationSupported() {
  return "geolocation" in navigator;
}

export function readFreshPosition() {
  return new Promise((resolve, reject) => {
    if (!geolocationSupported()) {
      reject(Object.assign(new Error("Location services are not supported in this browser."), { code: "GEOLOCATION_UNSUPPORTED" }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const ageMs = Math.abs(Date.now() - position.timestamp);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          locationTimestamp: new Date(position.timestamp).toISOString(),
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          stale: ageMs > MAX_LOCATION_AGE_MS,
        });
      },
      (error) => {
        const mapped =
          error.code === error.PERMISSION_DENIED
            ? "Location permission is required to check in."
            : error.code === error.TIMEOUT
              ? "Location request timed out. Move to an open area and try again."
              : "We could not get an accurate location. Move to an open area and try again.";
        reject(Object.assign(new Error(mapped), { code: error.code }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export function canSubmitCheckIn({ permission, position, status }) {
  if (!geolocationSupported()) return { enabled: false, reason: "Location services are not supported in this browser." };
  if (permission === "denied") return { enabled: false, reason: "Location permission is required to check in." };
  if (!position) return { enabled: false, reason: "A reliable position has not been obtained." };
  if (position.stale) return { enabled: false, reason: "Location reading is stale. Please try again." };
  if (!status?.canCheckIn) return { enabled: false, reason: status?.schedules?.[0]?.reason || "Check-in is not available." };
  return { enabled: true, reason: null };
}

export async function loadCheckInStatus({ apiOrigin, token }) {
  const response = await fetch(`${apiOrigin}/api/v1/attendance/me/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function submitCheckIn({ apiOrigin, token, position, idempotencyKey }) {
  const response = await fetch(`${apiOrigin}/api/v1/attendance/check-in`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey || crypto.randomUUID(),
    },
    body: JSON.stringify({
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracyMeters,
      locationTimestamp: position.locationTimestamp,
      clientTimezone: position.clientTimezone,
    }),
  });
  return response.json();
}
