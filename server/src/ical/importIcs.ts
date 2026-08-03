import ICAL from 'ical.js'

// Caps the number of events a single import can create -- each accepted
// group becomes its own createObject() call against the DAV server, so an
// unbounded file could turn one request into thousands of upstream writes.
export const MAX_IMPORT_EVENTS = 1000

/**
 * Splits an uploaded .ics file (which may contain many events, e.g. an
 * export from another calendar) into one importable VCALENDAR string per
 * event -- grouping a master VEVENT together with any of its own
 * RECURRENCE-ID overrides sharing the same original UID, then assigning
 * every event a fresh UID so it can't collide with anything already in the
 * target calendar.
 */
export function splitImportIcs(icsText: string): string[] {
  const jcal = ICAL.parse(icsText)
  const comp = new ICAL.Component(jcal)
  const vevents = comp.getAllSubcomponents('vevent')
  if (vevents.length === 0) return []

  const groups = new Map<string, ICAL.Component[]>()
  for (const vevent of vevents) {
    const uid = vevent.getFirstPropertyValue('uid') as string | null
    if (!uid) continue
    const group = groups.get(uid) ?? []
    group.push(vevent)
    groups.set(uid, group)
  }

  const results: string[] = []
  for (const components of Array.from(groups.values()).slice(0, MAX_IMPORT_EVENTS)) {
    const newUid = crypto.randomUUID()
    const newCal = new ICAL.Component(['vcalendar', [], []])
    newCal.updatePropertyWithValue('prodid', '-//calendar//standalone//EN')
    newCal.updatePropertyWithValue('version', '2.0')
    for (const vevent of components) {
      vevent.updatePropertyWithValue('uid', newUid)
      newCal.addSubcomponent(vevent)
    }
    results.push(newCal.toString())
  }
  return results
}
