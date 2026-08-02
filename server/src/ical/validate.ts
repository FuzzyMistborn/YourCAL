import type { EventFields } from '@yourcal/shared'

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
