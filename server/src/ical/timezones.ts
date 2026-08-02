import { getVtimezoneComponent } from '@touch4it/ical-timezones'
import ICAL from 'ical.js'

/**
 * ical.js ships no IANA timezone data at all -- only UTC/GMT/Z are
 * pre-registered in ICAL.TimezoneService. Without this, any named zone
 * (e.g. "America/New_York") silently fails to resolve via
 * TimezoneService.get() and gets dropped on write.
 *
 * No-ops for null/UTC (already registered) and for zones already known
 * (e.g. registered earlier from an embedded VTIMEZONE via
 * registerEmbeddedTimezones).
 */
export function ensureTimezoneRegistered(tzid: string | null): void {
  if (!tzid || tzid === 'UTC' || ICAL.TimezoneService.has(tzid)) return

  const vtimezoneIcs = getVtimezoneComponent(tzid)
  if (!vtimezoneIcs) return // Unknown zone name; TimezoneService.get() will return undefined downstream.

  const comp = new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${vtimezoneIcs}\r\nEND:VCALENDAR`))
  const vtimezone = comp.getFirstSubcomponent('vtimezone')
  if (vtimezone) ICAL.TimezoneService.register(vtimezone)
}

/**
 * Registers every VTIMEZONE embedded in a parsed VCALENDAR -- needed
 * because a raw `new ICAL.Component(ICAL.parse(ics))` parse does not
 * auto-register embedded VTIMEZONEs the way ICAL.ComponentParser does.
 * Without this, DTSTART/DTEND values using a TZID from the ICS's own
 * embedded VTIMEZONE (whether written by us or by another CalDAV client)
 * resolve against whatever happens to already be globally registered,
 * which may be nothing.
 */
export function registerEmbeddedTimezones(comp: ICAL.Component): void {
  for (const vtimezone of comp.getAllSubcomponents('vtimezone')) {
    const tzid = vtimezone.getFirstPropertyValue('tzid') as string | null
    if (tzid && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(vtimezone)
    }
  }
}
