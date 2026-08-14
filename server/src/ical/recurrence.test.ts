import type { EventFields, TimeRange } from '@yourcal/shared'
import { describe, expect, it } from 'vitest'
import { calendarObjectToIcs } from './mapper.js'
import { expandCalendarObject } from './recurrence.js'

function baseFields(overrides: Partial<EventFields> = {}): EventFields {
  return {
    summary: 'Standup',
    description: null,
    location: null,
    start: '2026-03-10T15:00:00.000Z', // a Tuesday
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

const wideRange: TimeRange = { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' }

function expand(ics: string, range: TimeRange = wideRange) {
  return expandCalendarObject(ics, 'cal1', 'events/test.ics', '"etag1"', range)
}

describe('expandCalendarObject', () => {
  it('expands a weekly COUNT=6 series to exactly 6 correctly-spaced occurrences', () => {
    const ics = calendarObjectToIcs('uid1', baseFields({ rrule: 'FREQ=WEEKLY;COUNT=6' }))
    const results = expand(ics)
    expect(results).toHaveLength(6)
    for (let i = 1; i < results.length; i++) {
      const delta = new Date(results[i].start).getTime() - new Date(results[i - 1].start).getTime()
      expect(delta).toBe(7 * 24 * 60 * 60 * 1000)
    }
    expect(results.every((r) => r.isRecurring)).toBe(true)
  })

  it('honors EXDATE by excluding exactly that occurrence', () => {
    const ics = calendarObjectToIcs('uid2', baseFields({ rrule: 'FREQ=WEEKLY;COUNT=4' }))
    const withExdate = ics.replace(
      'END:VEVENT',
      'EXDATE:20260317T150000Z\r\nEND:VEVENT',
    )
    const results = expand(withExdate)
    expect(results).toHaveLength(3)
    expect(results.some((r) => r.start.startsWith('2026-03-17'))).toBe(false)
  })

  it('shows a RECURRENCE-ID override with its own fields while other occurrences are untouched', () => {
    const ics = calendarObjectToIcs('uid3', baseFields({ rrule: 'FREQ=WEEKLY;COUNT=4' }))
    const override = [
      'BEGIN:VEVENT',
      'UID:uid3',
      'DTSTAMP:20260101T000000Z',
      'RECURRENCE-ID:20260317T150000Z',
      'DTSTART:20260317T170000Z',
      'DTEND:20260317T173000Z',
      'SUMMARY:Standup (moved)',
      'END:VEVENT',
    ].join('\r\n')
    const withOverride = ics.replace('END:VCALENDAR', `${override}\r\nEND:VCALENDAR`)
    const results = expand(withOverride)
    expect(results).toHaveLength(4)
    const overridden = results.find((r) => r.recurrenceId?.startsWith('2026-03-17'))
    expect(overridden?.summary).toBe('Standup (moved)')
    expect(overridden?.start).toBe('2026-03-17T17:00:00.000Z')
    // Overridden occurrence still reports the master's isRecurring/rrule.
    expect(overridden?.isRecurring).toBe(true)
    expect(overridden?.rrule).toContain('FREQ=WEEKLY')

    const untouched = results.filter((r) => !r.recurrenceId?.startsWith('2026-03-17'))
    expect(untouched.every((r) => r.summary === 'Standup')).toBe(true)
  })

  it('expands a monthly BYDAY rule ("2nd Tuesday") across several months', () => {
    // 2026-03-10 is the 2nd Tuesday of March 2026.
    const ics = calendarObjectToIcs(
      'uid4',
      baseFields({ rrule: 'FREQ=MONTHLY;BYDAY=2TU;COUNT=4' }),
    )
    const results = expand(ics)
    const dates = results.map((r) => r.start.slice(0, 10))
    expect(dates).toEqual(['2026-03-10', '2026-04-14', '2026-05-12', '2026-06-09'])
  })

  it('keeps all-day series dates correct across a DST transition', () => {
    // US spring-forward DST transition is 2026-03-08. A daily all-day
    // series straddling it should produce consecutive calendar dates with
    // no off-by-one from local-time shifting.
    const ics = calendarObjectToIcs(
      'uid5',
      baseFields({
        allDay: true,
        start: '2026-03-06T00:00:00.000Z',
        end: '2026-03-07T00:00:00.000Z',
        rrule: 'FREQ=DAILY;COUNT=5',
      }),
    )
    const results = expand(ics)
    const dates = results.map((r) => r.start.slice(0, 10))
    expect(dates).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
    expect(results.every((r) => r.allDay)).toBe(true)
  })

  it('filters non-recurring events by range', () => {
    const ics = calendarObjectToIcs('uid6', baseFields())
    expect(expand(ics, { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' })).toHaveLength(0)
    expect(expand(ics, { start: '2026-03-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' })).toHaveLength(1)
  })

  it('bounds an open-ended RRULE to the requested range without hanging', () => {
    const ics = calendarObjectToIcs('uid7', baseFields({ rrule: 'FREQ=DAILY' }))
    const results = expand(ics, { start: '2026-03-10T00:00:00.000Z', end: '2026-03-20T00:00:00.000Z' })
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThan(15)
    for (const r of results) {
      expect(new Date(r.start).getTime()).toBeGreaterThanOrEqual(new Date('2026-03-10T00:00:00.000Z').getTime())
      expect(new Date(r.start).getTime()).toBeLessThanOrEqual(new Date('2026-03-20T00:00:00.000Z').getTime())
    }
  })
})
