import type { CalendarObject, TimeRange } from '@yourcal/shared'
import { createHash } from 'node:crypto'
import ICAL from 'ical.js'
import { expandCalendarObject } from './recurrence.js'

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
  const response = await fetch(normalized, { headers: { Accept: 'text/calendar' } })
  if (!response.ok) {
    throw new Error(`Failed to fetch subscription feed: ${response.status} ${response.statusText}`)
  }
  const text = await response.text()
  const calendarId = subscriptionCalendarId(url)

  const comp = new ICAL.Component(ICAL.parse(text))
  const vevents = comp.getAllSubcomponents('vevent')

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
