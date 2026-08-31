import type { EventFields } from '@yourcal/shared'

/**
 * Validates a start/end query-param pair before it reaches `new Date()` and,
 * downstream, `ICAL.Time.fromJSDate()` -- which throws on NaN and would
 * otherwise surface as an uncaught 500 instead of a 400.
 */
export function timeRangeError(
  start: string | undefined,
  end: string | undefined,
): string | null {
  if (!start || !end) {
    return 'start and end query params are required'
  }
  if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
    return 'start and end must be valid ISO dates'
  }
  return null
}

export function eventFieldsError(fields: EventFields | undefined | null): string | null {
  if (!fields || typeof fields.start !== 'string' || typeof fields.end !== 'string') {
    return 'fields.start and fields.end are required'
  }
  if (typeof fields.summary !== 'string' || !fields.summary.trim()) {
    return 'fields.summary is required'
  }
  const start = new Date(fields.start)
  const end = new Date(fields.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'start and end must be valid dates'
  }
  if (end <= start) {
    return 'end must be after start'
  }
  return null
}
