import type { EventFields } from '@yourcal/shared'
import { describe, expect, it } from 'vitest'
import { computeObjectBounds } from './bounds.js'
import { calendarObjectToIcs } from './mapper.js'

function baseFields(overrides: Partial<EventFields> = {}): EventFields {
  return {
    summary: 'Standup',
    description: null,
    location: null,
    start: '2026-03-10T15:00:00.000Z',
    end: '2026-03-10T15:30:00.000Z',
    allDay: false,
    timezone: null,
    rrule: null,
    color: null,
    alarms: [],
    rdate: [],
    ...overrides,
  }
}

describe('computeObjectBounds', () => {
  it('returns exact start/end for a non-recurring event', () => {
    const ics = calendarObjectToIcs('uid1', baseFields())
    const bounds = computeObjectBounds(ics)
    expect(bounds).not.toBeNull()
    expect(bounds!.startTs).toBe(new Date('2026-03-10T15:00:00.000Z').getTime())
    expect(bounds!.endTs).toBe(new Date('2026-03-10T15:30:00.000Z').getTime())
  })

  it('bounds a COUNT-limited recurring series to its last occurrence', () => {
    const ics = calendarObjectToIcs('uid2', baseFields({ rrule: 'FREQ=WEEKLY;COUNT=3' }))
    const bounds = computeObjectBounds(ics)
    expect(bounds).not.toBeNull()
    // 3rd weekly occurrence starting 2026-03-10, ending 15:30, is 2026-03-24.
    expect(new Date(bounds!.endTs!).toISOString()).toBe('2026-03-24T15:30:00.000Z')
  })

  it('bounds an UNTIL-limited recurring series to its last occurrence', () => {
    const ics = calendarObjectToIcs('uid3', baseFields({ rrule: 'FREQ=DAILY;UNTIL=20260315T150000Z' }))
    const bounds = computeObjectBounds(ics)
    expect(bounds).not.toBeNull()
    expect(new Date(bounds!.endTs!).toISOString().slice(0, 10)).toBe('2026-03-15')
  })

  it('reports no upper bound for an open-ended RRULE', () => {
    const ics = calendarObjectToIcs('uid4', baseFields({ rrule: 'FREQ=DAILY' }))
    const bounds = computeObjectBounds(ics)
    expect(bounds).not.toBeNull()
    expect(bounds!.endTs).toBeNull()
  })

  it('returns null for malformed ICS', () => {
    expect(computeObjectBounds('not a valid ics document')).toBeNull()
  })
})
