function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assessCheckInRisk({ reading, candidate, previousCheckIn, at = new Date() }) {
  const flags = [];
  const accuracyMeters = toNumber(reading?.accuracyMeters, Number.NaN);
  const clientTimezone = reading?.clientTimezone || null;
  const locationTimezone = candidate?.window?.timezone || null;
  const locationTimestamp = reading?.locationTimestamp ? new Date(reading.locationTimestamp) : null;

  if (clientTimezone && locationTimezone && clientTimezone !== locationTimezone) {
    flags.push("CLIENT_TIMEZONE_MISMATCH");
  }

  if (accuracyMeters === 0) {
    flags.push("ZERO_ACCURACY");
  }

  if (locationTimestamp && !Number.isNaN(locationTimestamp.getTime()) && locationTimestamp.getTime() - at.getTime() > 60 * 1000) {
    flags.push("FUTURE_LOCATION_TIMESTAMP");
  }

  if (toNumber(candidate?.distanceMeters, 1) === 0) {
    flags.push("EXACT_OFFICE_COORDINATE");
  }

  if (previousCheckIn && candidate) {
    const previousAt = new Date(previousCheckIn.checkInAt || previousCheckIn.check_in_at || previousCheckIn.checkIn || previousCheckIn.createdAt);
    const elapsedHours = Math.max((at.getTime() - previousAt.getTime()) / 3600000, 1 / 60);
    const previousLat = Number(previousCheckIn.latitude);
    const previousLon = Number(previousCheckIn.longitude);
    if (Number.isFinite(previousLat) && Number.isFinite(previousLon)) {
      const { haversineDistanceMeters } = require("./geo");
      const travelMeters = haversineDistanceMeters(
        { latitude: previousLat, longitude: previousLon },
        { latitude: reading.latitude, longitude: reading.longitude }
      );
      const kmPerHour = travelMeters / 1000 / elapsedHours;
      if (kmPerHour > 900) {
        flags.push("IMPOSSIBLE_TRAVEL");
      }
    }
  }

  return [...new Set(flags)];
}

module.exports = { assessCheckInRisk };
