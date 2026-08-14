import type { EventFields } from '@yourcal/shared'
import { describe, expect, it } from 'vitest'
import { eventFieldsError } from './validate.js'

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

describe('eventFieldsError', () => {
  it('accepts valid fields', () => {
    expect(eventFieldsError(baseFields())).toBeNull()
  })

  it('rejects missing fields', () => {
    expect(eventFieldsError(null)).toMatch(/required/)
    expect(eventFieldsError(undefined)).toMatch(/required/)
  })

  it('rejects a missing/blank summary', () => {
    expect(eventFieldsError(baseFields({ summary: '' }))).toMatch(/summary/)
    expect(eventFieldsError(baseFields({ summary: '   ' }))).toMatch(/summary/)
  })

  it('rejects unparseable dates', () => {
    expect(eventFieldsError(baseFields({ start: 'not-a-date' }))).toMatch(/valid dates/)
    expect(eventFieldsError(baseFields({ end: 'not-a-date' }))).toMatch(/valid dates/)
  })

  it('rejects end at or before start', () => {
    expect(eventFieldsError(baseFields({ start: '2026-03-10T15:00:00.000Z', end: '2026-03-10T15:00:00.000Z' }))).toMatch(
      /end must be after start/,
    )
    expect(eventFieldsError(baseFields({ start: '2026-03-10T15:00:00.000Z', end: '2026-03-10T14:00:00.000Z' }))).toMatch(
      /end must be after start/,
    )
  })
})
