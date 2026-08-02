import type { CalendarObject, TimeRange } from '@yourcal/shared'
import ICAL from 'ical.js'
import { buildCalendarObject } from './mapper.js'
import { registerEmbeddedTimezones } from './timezones.js'

// Safety cap so an open-ended RRULE (no UNTIL/COUNT) can't spin the
// expansion loop forever -- bound to the requested range plus one guard
// on iteration count.
const MAX_ITERATIONS = 5000

/**
 * Expands a (possibly recurring) ICS object into the occurrences that
 * fall within `range`. Non-recurring objects return a single-element
 * array. Overrides (RECURRENCE-ID components) and EXDATEs are honored
 * via ical.js's exception-aware iterator.
 */
export function expandCalendarObject(
  ics: string,
  calendarId: string,
  href: string,
  etag: string,
  range: TimeRange,
): CalendarObject[] {
  const jcal = ICAL.parse(ics)
  const comp = new ICAL.Component(jcal)
  registerEmbeddedTimezones(comp)
  const vevents = comp.getAllSubcomponents('vevent')
  if (vevents.length === 0) return []

  const master = vevents.find((v) => !v.hasProperty('recurrence-id'))
  if (!master) return [] // Malformed: only override components present, no master.

  const masterEvent = new ICAL.Event(master, { strictExceptions: false })

  if (!masterEvent.isRecurring()) {
    return [
      buildCalendarObject(masterEvent, {
        calendarId,
        etag,
        href,
        start: masterEvent.startDate,
        end: masterEvent.endDate,
        recurrenceId: null,
      }),
    ]
  }

  for (const override of vevents) {
    if (override === master) continue
    masterEvent.relateException(override)
  }

  const rangeStart = ICAL.Time.fromJSDate(new Date(range.start), true)
  const rangeEnd = ICAL.Time.fromJSDate(new Date(range.end), true)

  const results: CalendarObject[] = []
  const iterator = masterEvent.iterator()
  let occurrenceTime: ICAL.Time | null
  let guard = 0

  while ((occurrenceTime = iterator.next()) && guard++ < MAX_ITERATIONS) {
    if (occurrenceTime.compare(rangeEnd) > 0) break
    if (occurrenceTime.compare(rangeStart) < 0) continue

    const details = masterEvent.getOccurrenceDetails(occurrenceTime)
    // details.item may be the master (plain occurrence) or an exception
    // VEVENT; details.startDate/endDate are always the correct
    // occurrence-specific times regardless of which one it is.
    results.push(
      buildCalendarObject(details.item, {
        calendarId,
        etag,
        href,
        start: details.startDate,
        end: details.endDate,
        recurrenceId: details.recurrenceId.toJSDate().toISOString(),
      }),
    )
  }

  return results
}
