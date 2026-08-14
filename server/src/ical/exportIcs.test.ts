import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { mergeIcsObjects } from './exportIcs.js'
import { calendarObjectToIcs } from './mapper.js'
import { expandCalendarObject } from './recurrence.js'

const wideRange = { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' }

function fields(overrides: Record<string, unknown> = {}) {
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
  } as Parameters<typeof calendarObjectToIcs>[1]
}

describe('mergeIcsObjects', () => {
  it('merges multiple per-object ICS strings into a single VCALENDAR with all VEVENTs', () => {
    const a = calendarObjectToIcs('uid-a', fields({ summary: 'Event A' }))
    const b = calendarObjectToIcs('uid-b', fields({ summary: 'Event B' }))
    const merged = mergeIcsObjects([a, b])

    expect((merged.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2)
    expect(merged).toContain('Event A')
    expect(merged).toContain('Event B')

    // Multiple independent (non-recurring) events merged into one VCALENDAR
    // isn't something expandCalendarObject is meant to re-expand (it expects
    // a single master + its own overrides) -- verify via direct parsing
    // instead, which is how the export route actually consumes this output.
    const comp = new ICAL.Component(ICAL.parse(merged))
    const summaries = comp.getAllSubcomponents('vevent').map((v) => v.getFirstPropertyValue('summary'))
    expect(summaries.sort()).toEqual(['Event A', 'Event B'])
  })

  it('returns an empty-VCALENDAR wrapper for an empty list', () => {
    const merged = mergeIcsObjects([])
    expect(merged).toContain('BEGIN:VCALENDAR')
    expect(merged).not.toContain('BEGIN:VEVENT')
  })

  it('carries along timezone data needed by a merged timed event', () => {
    const withTz = calendarObjectToIcs('uid-c', fields({ timezone: 'America/New_York' }))
    const merged = mergeIcsObjects([withTz])
    const results = expandCalendarObject(merged, 'cal1', 'events/merged.ics', '"etag"', wideRange)
    expect(results[0].timezone).toBe('America/New_York')
  })
})
