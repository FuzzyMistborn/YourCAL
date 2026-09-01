import type { CalendarObject, TimeRange } from '@yourcal/shared'
import ICAL from 'ical.js'
import { buildCalendarObject, icalTimeToString } from './mapper.js'
import { registerEmbeddedTimezones } from './timezones.js'

// Safety cap on the number of *in-range* occurrences we'll materialize for
// a single series -- an open-ended RRULE (no UNTIL/COUNT) still can't spin
// forever because the loop also breaks once occurrences pass rangeEnd.
const MAX_ITERATIONS = 5000

// Separate, much larger budget for fast-forwarding the iterator from
// DTSTART up to rangeStart. The iterator always starts at DTSTART, so a
// long-running dense series (e.g. a daily event older than ~13.7 years)
// can have far more than MAX_ITERATIONS occurrences *before* the visible
// window -- counting those against MAX_ITERATIONS made the whole series
// silently vanish from the view. These skipped iterations are cheap
// (no getOccurrenceDetails / buildCalendarObject), so the cap only needs
// to be high enough to never bite in practice while still bounding a
// pathological RRULE with a tiny interval and a very old DTSTART.
const MAX_SKIP_ITERATIONS = 500_000

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

  const rangeStart = ICAL.Time.fromJSDate(new Date(range.start), true)
  const rangeEnd = ICAL.Time.fromJSDate(new Date(range.end), true)

  if (!masterEvent.isRecurring()) {
    // Non-recurring objects still need range filtering: the SQLite cache
    // (SqliteCalendarStore.getEvents) calls this for every cached object
    // regardless of the requested range, relying on this function to do
    // the filtering -- without this check, every cached non-recurring
    // event would show up on every date range navigated to.
    if (masterEvent.endDate.compare(rangeStart) < 0 || masterEvent.startDate.compare(rangeEnd) > 0) {
      return []
    }
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

  const masterRruleProp = master.getFirstPropertyValue('rrule') as { toString(): string } | null
  const masterRrule = masterRruleProp ? masterRruleProp.toString() : null

  const results: CalendarObject[] = []
  const iterator = masterEvent.iterator()
  let occurrenceTime: ICAL.Time | null
  let guard = 0
  let skipGuard = 0

  while ((occurrenceTime = iterator.next())) {
    if (occurrenceTime.compare(rangeEnd) > 0) break
    if (occurrenceTime.compare(rangeStart) < 0) {
      if (++skipGuard >= MAX_SKIP_ITERATIONS) break
      continue
    }
    if (guard++ >= MAX_ITERATIONS) break

    const details = masterEvent.getOccurrenceDetails(occurrenceTime)
    // details.item may be the master (plain occurrence) or an exception
    // VEVENT; details.startDate/endDate are always the correct
    // occurrence-specific times regardless of which one it is. isRecurring
    // and rrule are always taken from the *master* (not details.item) --
    // an exception VEVENT never carries its own RRULE, so it would
    // otherwise report isRecurring: false and look like a standalone event.
    results.push(
      buildCalendarObject(details.item, {
        calendarId,
        etag,
        href,
        start: details.startDate,
        end: details.endDate,
        // For an all-day series details.recurrenceId is DATE-typed;
        // toJSDate().toISOString() would apply the server process's UTC
        // offset and, under a non-UTC TZ, shift it to the adjacent day
        // (editScope then slices the first 10 chars and EXDATEs/overrides
        // the wrong date). icalTimeToString emits a bare YYYY-MM-DD for
        // DATE values and an ISO instant only for timed ones.
        recurrenceId: icalTimeToString(details.recurrenceId),
        isRecurring: true,
        rrule: masterRrule,
      }),
    )
  }

  return results
}
