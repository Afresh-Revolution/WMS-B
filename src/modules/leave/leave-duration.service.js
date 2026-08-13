const { DURATION_TYPE } = require("./constants");

function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function calculateLeaveDuration({ startDate, endDate, durationType = DURATION_TYPE.FULL_DAY, policy = {}, holidays = [] }) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (!start || !end) {
    const error = new Error("Start date and end date must use YYYY-MM-DD.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  if (start > end) {
    const error = new Error("Start date cannot be after end date.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const normalizedDurationType = String(durationType || DURATION_TYPE.FULL_DAY).toUpperCase();
  if (normalizedDurationType === DURATION_TYPE.HALF_DAY && policy.halfDayEnabled === false) {
    const error = new Error("Half-day leave is not enabled for this leave policy.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const holidayDates = new Set(
    holidays
      .filter((holiday) => String(holiday.status || "active").toLowerCase() === "active")
      .map((holiday) => holiday.date || holiday.holidayDate || holiday.startDate)
      .filter(Boolean)
  );

  let calendarDays = 0;
  let workingDays = 0;

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    calendarDays += 1;
    const dateOnly = toDateOnly(cursor);
    const excludedWeekend = !policy.weekendCounted && isWeekend(cursor);
    const excludedHoliday = !policy.holidayCounted && holidayDates.has(dateOnly);

    if (!excludedWeekend && !excludedHoliday) {
      workingDays += 1;
    }
  }

  if (normalizedDurationType === DURATION_TYPE.HALF_DAY) {
    if (calendarDays !== 1) {
      const error = new Error("Half-day leave must start and end on the same date.");
      error.statusCode = 400;
      error.publicMessage = error.message;
      throw error;
    }

    workingDays = workingDays > 0 ? 0.5 : 0;
  }

  return {
    calendarDays,
    workingDays,
    duration: workingDays,
    durationType: normalizedDurationType === DURATION_TYPE.HALF_DAY ? DURATION_TYPE.HALF_DAY : DURATION_TYPE.FULL_DAY,
  };
}

module.exports = { calculateLeaveDuration, parseDateOnly };
