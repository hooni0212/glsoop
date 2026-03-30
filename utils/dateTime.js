const SQLITE_UTC_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;

function parseDateTimeValue(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = typeof value === 'string' ? value.trim() : String(value).trim();
  if (!raw) return null;

  const sqliteMatch = raw.match(SQLITE_UTC_DATETIME_RE);
  if (sqliteMatch) {
    const [
      ,
      year,
      month,
      day,
      hour = '00',
      minute = '00',
      second = '00',
      fraction = '',
    ] = sqliteMatch;
    const millisecond = fraction
      ? Number(String(fraction).slice(0, 3).padEnd(3, '0'))
      : 0;
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        millisecond
      )
    );
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeUtcDateTime(value) {
  const parsed = parseDateTimeValue(value);
  return parsed ? parsed.toISOString() : value;
}

function normalizeDateFields(record, fieldNames = []) {
  if (!record || typeof record !== 'object') return record;

  const nextRecord = { ...record };
  fieldNames.forEach((fieldName) => {
    if (!Object.prototype.hasOwnProperty.call(nextRecord, fieldName)) return;
    nextRecord[fieldName] = normalizeUtcDateTime(nextRecord[fieldName]);
  });
  return nextRecord;
}

module.exports = {
  parseDateTimeValue,
  normalizeUtcDateTime,
  normalizeDateFields,
};
