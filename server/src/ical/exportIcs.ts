import ICAL from 'ical.js'
import { registerEmbeddedTimezones } from './timezones.js'

/**
 * Merges multiple raw per-object ICS strings (each already a full
 * VCALENDAR, one VEVENT master + any overrides) into a single VCALENDAR
 * for a whole-calendar/date-range export -- mirrors calendarObjectToIcs's
 * wrapping pattern (mapper.ts) but starting from already-serialized ICS
 * rather than building fresh VEVENTs from EventFields.
 */
export function mergeIcsObjects(rawIcsList: string[]): string {
  const merged = new ICAL.Component(['vcalendar', [], []])
  merged.updatePropertyWithValue('prodid', '-//calendar//standalone//EN')
  merged.updatePropertyWithValue('version', '2.0')

  for (const raw of rawIcsList) {
    const comp = new ICAL.Component(ICAL.parse(raw))
    registerEmbeddedTimezones(comp)
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      merged.addSubcomponent(vevent)
    }
  }

  ICAL.helpers.updateTimezones(merged)
  return merged.toString()
}
