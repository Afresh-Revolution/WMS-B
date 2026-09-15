const EARTH_RADIUS_METERS = 6371008.8;

function toCoordinate(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${label} must be between ${min} and ${max}.`);
    error.statusCode = 400;
    error.publicMessage = error.message;
    error.code = `INVALID_${label.toUpperCase()}`;
    error.details = { min, max };
    throw error;
  }
  return number;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(from, to) {
  const fromLatitude = toCoordinate(from.latitude ?? from.lat, -90, 90, "latitude");
  const fromLongitude = toCoordinate(from.longitude ?? from.lng ?? from.lon, -180, 180, "longitude");
  const toLatitude = toCoordinate(to.latitude ?? to.lat, -90, 90, "latitude");
  const toLongitude = toCoordinate(to.longitude ?? to.lng ?? to.lon, -180, 180, "longitude");

  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude)) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withinRadius({ from, to, radiusMeters }) {
  const distanceMeters = haversineDistanceMeters(from, to);
  return {
    distanceMeters,
    inside: distanceMeters <= Number(radiusMeters),
  };
}

module.exports = { haversineDistanceMeters, toCoordinate, withinRadius };
