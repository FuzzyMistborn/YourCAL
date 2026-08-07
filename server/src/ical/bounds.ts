import ICAL from 'ical.js'
import { registerEmbeddedTimezones } from './timezones.js'

// Mirrors expandCalendarObject's guard: an open-ended RRULE (no UNTIL/COUNT)
// iterated past this many occurrences is treated as unbounded rather than
// walked to completion.
const MAX_ITERATIONS = 5000

export interface ObjectBounds {
  startTs: number
  // null means "no known upper bound" (open-ended recurrence) -- callers
  // must treat that as "always include regardless of requested range".
  endTs: number | null
}

/**
 * Computes a coarse [start, end] bound for an ICS object, used to prefilter
 * candidate rows in SQL before the precise per-occurrence range filtering
 * that expandCalendarObject already does. Deliberately conservative: any
 * ambiguity (parse trouble, unbounded recurrence) widens the bound rather
 * than narrowing it, since a too-wide bound only costs an extra expansion
 * pass while a too-narrow one would silently drop real events from results.
 * Returns null if the object can't be parsed -- callers should store that as
 * unbounded too, and let getEvents' existing per-object try/catch around
 * expandCalendarObject deal with the malformed ICS at query time.
 */
export function computeObjectBounds(ics: string): ObjectBounds | null {
  try {
    const jcal = ICAL.parse(ics)
    const comp = new ICAL.Component(jcal)
    registerEmbeddedTimezones(comp)
    const vevents = comp.getAllSubcomponents('vevent')
    if (vevents.length === 0) return null

    const master = vevents.find((v) => !v.hasProperty('recurrence-id'))
    if (!master) return null

    const masterEvent = new ICAL.Event(master, { strictExceptions: false })
    const startTs = masterEvent.startDate.toJSDate().getTime()

    if (!masterEvent.isRecurring()) {
      return { startTs, endTs: masterEvent.endDate.toJSDate().getTime() }
    }

    // Walk the recurrence to find its last occurrence, same as
    // expandCalendarObject's guarded iterator. If it doesn't terminate
    // within the guard, the series is effectively unbounded for our
    // purposes -- report no upper bound.
    const iterator = masterEvent.iterator()
    let last: ICAL.Time | null = null
    let occurrenceTime: ICAL.Time | null
    let guard = 0
    while ((occurrenceTime = iterator.next()) && guard++ < MAX_ITERATIONS) {
      last = occurrenceTime
    }
    if (guard >= MAX_ITERATIONS || !last) {
      return { startTs, endTs: null }
    }

    const details = masterEvent.getOccurrenceDetails(last)
    return { startTs, endTs: details.endDate.toJSDate().getTime() }
  } catch {
    return null
  }
}
