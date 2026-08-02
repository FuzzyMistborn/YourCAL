import type { CalendarObject, EventFields } from '@yourcal/shared'
import ICAL from 'ical.js'
import { ensureTimezoneRegistered, registerEmbeddedTimezones } from './timezones.js'

export function buildCalendarObject(
  event: ICAL.Event,
  opts: {
    calendarId: string
    etag: string
    href: string
    start: ICAL.Time
    end: ICAL.Time
    recurrenceId: string | null
  },
): CalendarObject {
  const rruleProp = event.component.getFirstPropertyValue('rrule') as { toString(): string } | null

  return {
    uid: event.uid,
    etag: opts.etag,
    href: opts.href,
    calendarId: opts.calendarId,
    summary: event.summary ?? '',
    description: event.description ?? null,
    location: event.location ?? null,
    start: opts.start.toJSDate().toISOString(),
    end: opts.end.toJSDate().toISOString(),
    allDay: opts.start.isDate,
    timezone: opts.start.isDate ? null : (opts.start.zone?.tzid ?? null),
    recurrenceId: opts.recurrenceId,
    isRecurring: event.isRecurring(),
    rrule: rruleProp ? rruleProp.toString() : null,
  }
}

/**
 * Maps a raw ICS object to its master-event view. Recurring series are
 * flagged via isRecurring/rrule but not expanded here -- expansion into
 * per-occurrence CalendarObjects happens in ical/recurrence.ts.
 */
export function icsToCalendarObject(ics: string, calendarId: string, href: string, etag: string): CalendarObject {
  const jcal = ICAL.parse(ics)
  const comp = new ICAL.Component(jcal)
  registerEmbeddedTimezones(comp)
  const vevent = comp.getFirstSubcomponent('vevent')
  if (!vevent) {
    throw new Error('ICS object has no VEVENT component')
  }

  const event = new ICAL.Event(vevent)
  return buildCalendarObject(event, {
    calendarId,
    etag,
    href,
    start: event.startDate,
    end: event.endDate,
    recurrenceId: null,
  })
}

export function buildVeventComponent(uid: string, fields: EventFields): ICAL.Component {
  const vevent = new ICAL.Component('vevent')
  const event = new ICAL.Event(vevent)

  event.uid = uid
  event.summary = fields.summary
  if (fields.description) event.description = fields.description
  if (fields.location) event.location = fields.location

  if (fields.allDay) {
    // fromJSDate + isDate=true does NOT produce a proper all-day value: it
    // converts through the JS Date first (shifting across a UTC/local
    // boundary) and isDate alone doesn't truncate the retained time-of-day.
    // fromDateString builds a real DATE-typed value directly, with no
    // timezone conversion to go wrong. `fields.start`/`end` are ISO strings
    // (always YYYY-MM-DD...), so the date is just the first 10 characters.
    event.startDate = ICAL.Time.fromDateString(fields.start.slice(0, 10))
    event.endDate = ICAL.Time.fromDateString(fields.end.slice(0, 10))
  } else {
    ensureTimezoneRegistered(fields.timezone)
    const zone = fields.timezone ? ICAL.TimezoneService.get(fields.timezone) : null
    event.startDate = ICAL.Time.fromJSDate(new Date(fields.start), true)
    event.endDate = ICAL.Time.fromJSDate(new Date(fields.end), true)
    if (zone) {
      // Reassigning .zone directly does NOT convert the stored wall-clock
      // time -- it just relabels it, so a UTC time would get serialized as
      // if it were already local. convertToZone does the actual conversion.
      event.startDate = event.startDate.convertToZone(zone)
      event.endDate = event.endDate.convertToZone(zone)
    }
  }

  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now())
  if (fields.rrule) {
    vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(fields.rrule))
  }

  return vevent
}

export function calendarObjectToIcs(uid: string, fields: EventFields): string {
  const comp = new ICAL.Component(['vcalendar', [], []])
  comp.updatePropertyWithValue('prodid', '-//calendar//standalone//EN')
  comp.updatePropertyWithValue('version', '2.0')
  comp.addSubcomponent(buildVeventComponent(uid, fields))
  ICAL.helpers.updateTimezones(comp)
  return comp.toString()
}
