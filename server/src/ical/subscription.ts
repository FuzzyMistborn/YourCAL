import type { CalendarObject, TimeRange } from '@yourcal/shared'
import { createHash } from 'node:crypto'
import ICAL from 'ical.js'
import { safeFetchExternal } from '../dav/ssrf.js'
import { expandCalendarObject } from './recurrence.js'
import { registerEmbeddedTimezones } from './timezones.js'

// Bounds how much work a single feed can force onto the server -- an
// unbounded or malicious feed could otherwise contain enough VEVENTs to
// make expansion (recurrence.ts's own MAX_ITERATIONS is per-event, not
// per-feed) expensive across the whole request.
const MAX_SUBSCRIPTION_EVENTS = 2000

function normalizeUrl(url: string): string {
  return url.startsWith('webcal://') ? `https://${url.slice('webcal://'.length)}` : url
}

export function subscriptionCalendarId(url: string): string {
  return `sub:${createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 16)}`
}

/**
 * Fetches and parses a read-only external ICS/WebCal feed -- not a CalDAV
 * collection, just a static (or semi-static) document some other calendar
 * publishes. No etags exist for this kind of resource, so a constant
 * placeholder is used; these events are never written back anywhere.
 */
export async function fetchSubscriptionEvents(url: string, range: TimeRange): Promise<CalendarObject[]> {
  const normalized = normalizeUrl(url)
  const { text } = await safeFetchExternal(normalized, { headers: { Accept: 'text/calendar' } })
  const calendarId = subscriptionCalendarId(url)

  const comp = new ICAL.Component(ICAL.parse(text))
  // The per-UID VCALENDARs built below carry the VEVENTs but not the feed's
  // VTIMEZONE components, so any TZID they reference (DTSTART;TZID=...)
  // would otherwise be unresolvable -- registering them globally here,
  // before expandCalendarObject re-parses each split-out ICS on its own,
  // means the zone is already known by the time it's looked up. Same fix
  // as importIcs.ts, but via global registration rather than carrying the
  // VTIMEZONE along, since these per-event ICS strings are only ever used
  // transiently within this function.
  registerEmbeddedTimezones(comp)
  const vevents = comp.getAllSubcomponents('vevent').slice(0, MAX_SUBSCRIPTION_EVENTS)

  const groups = new Map<string, ICAL.Component[]>()
  for (const vevent of vevents) {
    const uid = vevent.getFirstPropertyValue('uid') as string | null
    if (!uid) continue
    const group = groups.get(uid) ?? []
    group.push(vevent)
    groups.set(uid, group)
  }

  const results: CalendarObject[] = []
  for (const [uid, components] of groups) {
    const eventCal = new ICAL.Component(['vcalendar', [], []])
    eventCal.updatePropertyWithValue('prodid', '-//calendar//standalone//EN')
    eventCal.updatePropertyWithValue('version', '2.0')
    for (const vevent of components) eventCal.addSubcomponent(vevent)

    try {
      results.push(...expandCalendarObject(eventCal.toString(), calendarId, `${normalized}#${uid}`, 'subscription', range))
    } catch {
      continue
    }
  }
  return results
}
