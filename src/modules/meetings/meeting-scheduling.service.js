function pad(value) {
  return String(value).padStart(2, "0");
}

function parseDateOnly(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = slash[3];
    const iso = first > 12 ? `${year}-${pad(second)}-${pad(first)}` : `${year}-${pad(first)}-${pad(second)}`;
    const date = new Date(`${iso}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function isoDateFromValue(value) {
  const parsed = parseDateOnly(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function normalizeTime(value) {
  if (typeof value !== "string") {
    return null;
  }

  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  const mer = compact.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(AM|PM)$/);
  if (mer) {
    let hour = Number(mer[1]);
    const minute = mer[2];
    const second = mer[3] || "00";
    if (mer[4] === "PM" && hour < 12) hour += 12;
    if (mer[4] === "AM" && hour === 12) hour = 0;
    return `${pad(hour)}:${minute}:${second}`;
  }

  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value.trim())) {
    return value.trim().length === 5 ? `${value.trim()}:00` : value.trim();
  }

  return null;
}

function parseDurationMinutes(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  const raw = String(value).trim().toLowerCase();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)?$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2] || "minute";
  return unit.startsWith("h") ? Math.round(amount * 60) : Math.round(amount);
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
  const isoDate = isoDateFromValue(payload.date);

  if (!start) {
    const time = normalizeTime(payload.startTime || payload.start_time || payload.time);
    if (isoDate && time) {
      start = parseDateTime(`${isoDate}T${time}.000Z`);
    }
  }

  if (!end && isoDate && (payload.endTime || payload.end_time)) {
    const time = normalizeTime(payload.endTime || payload.end_time);
    if (time) {
      end = parseDateTime(`${isoDate}T${time}.000Z`);
    }
  }

  if (!start) {
    const error = new Error("Meeting start date and time are required.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  if (!end) {
    const requestedDuration = parseDurationMinutes(payload.durationMinutes ?? payload.duration_minutes ?? payload.duration);
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

module.exports = { buildSchedule, overlaps, parseDateTime, parseDurationMinutes };
