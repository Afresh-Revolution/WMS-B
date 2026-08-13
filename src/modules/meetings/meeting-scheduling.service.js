function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return null;
  }

  return value.length === 5 ? `${value}:00` : value;
}

function parseDateTime(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.includes("T") ? value : `${value}T00:00:00.000Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  return value.toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function minutesBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function buildSchedule(payload = {}) {
  let start = parseDateTime(payload.startAt || payload.start_at);
  let end = parseDateTime(payload.endAt || payload.end_at);

  if (!start) {
    const date = parseDateOnly(payload.date);
    const time = normalizeTime(payload.startTime || payload.start_time);
    if (date && time) {
      start = parseDateTime(`${payload.date}T${time}.000Z`);
    }
  }

  if (!end && payload.date && (payload.endTime || payload.end_time)) {
    const time = normalizeTime(payload.endTime || payload.end_time);
    if (time) {
      end = parseDateTime(`${payload.date}T${time}.000Z`);
    }
  }

  if (!start) {
    const error = new Error("Meeting start date and time are required.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  if (!end) {
    const requestedDuration = Number(payload.durationMinutes ?? payload.duration_minutes);
    if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
      const error = new Error("Meeting end time or a positive duration is required.");
      error.statusCode = 400;
      error.publicMessage = error.message;
      throw error;
    }

    end = addMinutes(start, requestedDuration);
  }

  const durationMinutes = minutesBetween(start, end);
  if (durationMinutes <= 0) {
    const error = new Error("Meeting end time must be after the start time.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return {
    startAt: toIso(start),
    endAt: toIso(end),
    date: toIso(start).slice(0, 10),
    startTime: toIso(start).slice(11, 16),
    endTime: toIso(end).slice(11, 16),
    durationMinutes,
  };
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

module.exports = { buildSchedule, overlaps, parseDateTime };
