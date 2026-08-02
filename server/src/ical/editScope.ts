import type { EventFields } from '@yourcal/shared'
import ICAL from 'ical.js'
import { buildVeventComponent } from './mapper.js'
import { registerEmbeddedTimezones } from './timezones.js'

function parseCalendar(ics: string): ICAL.Component {
  const comp = new ICAL.Component(ICAL.parse(ics))
  registerEmbeddedTimezones(comp)
  return comp
}

function getMaster(comp: ICAL.Component): ICAL.Component {
  const master = comp.getAllSubcomponents('vevent').find((v) => !v.hasProperty('recurrence-id'))
  if (!master) throw new Error('No master VEVENT found in recurring series')
  return master
}

function getRecurrenceId(vevent: ICAL.Component): ICAL.Time | null {
  return vevent.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
}

/** Whether the master's own DTSTART is DATE-typed (all-day) -- the value type a
 * RECURRENCE-ID/boundary must match, regardless of what an edit's new fields say. */
function masterIsAllDay(master: ICAL.Component): boolean {
  return (master.getFirstPropertyValue('dtstart') as ICAL.Time).isDate
}

function icalTimeFromIso(iso: string, allDay: boolean): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(iso), !allDay)
}

/** Bounds a master's RRULE so it produces no occurrence at or after `boundary`. */
function truncateRrule(master: ICAL.Component, boundary: ICAL.Time): void {
  const rrule = master.getFirstProperty('rrule')
  if (!rrule) return
  const recur = rrule.getFirstValue() as ICAL.Recur
  const until = boundary.clone()
  // RFC 5545 requires UNTIL's value type to match DTSTART's. For an all-day
  // (DATE-typed) boundary, subtracting a sub-day duration is meaningless --
  // step back a whole day instead so the boundary occurrence itself is
  // excluded. For a DATE-TIME boundary, one second back is enough.
  if (until.isDate) {
    until.addDuration(ICAL.Duration.fromString('-P1D'))
  } else {
    until.addDuration(ICAL.Duration.fromString('-P0DT0H0M1S'))
  }
  recur.until = until
  recur.count = null
  rrule.setValue(recur)
}

/** this-occurrence edit: replace/insert an override VEVENT with RECURRENCE-ID. */
export function applyThisOccurrence(ics: string, recurrenceId: string, fields: EventFields): string {
  const comp = parseCalendar(ics)
  const master = getMaster(comp)
  const uid = master.getFirstPropertyValue('uid') as string

  for (const v of comp.getAllSubcomponents('vevent')) {
    const rid = getRecurrenceId(v)
    if (rid && rid.toJSDate().toISOString() === recurrenceId) comp.removeSubcomponent(v)
  }

  const override = buildVeventComponent(uid, fields)
  override.updatePropertyWithValue('recurrence-id', icalTimeFromIso(recurrenceId, masterIsAllDay(master)))
  comp.addSubcomponent(override)
  ICAL.helpers.updateTimezones(comp)
  return comp.toString()
}

/**
 * all-events edit: rewrite the master with the new fields.
 *
 * Simplification (see AGENTS.md): existing per-occurrence overrides are
 * dropped, since they may no longer make sense against the new fields.
 */
export function applyAll(ics: string, fields: EventFields): string {
  const comp = parseCalendar(ics)
  const master = getMaster(comp)
  const uid = master.getFirstPropertyValue('uid') as string

  for (const v of comp.getAllSubcomponents('vevent')) {
    comp.removeSubcomponent(v)
  }
  comp.addSubcomponent(buildVeventComponent(uid, fields))
  ICAL.helpers.updateTimezones(comp)
  return comp.toString()
}

/**
 * this-and-future edit: truncates the existing series with UNTIL just
 * before `recurrenceId`, and returns a fresh ICS for a brand new series
 * (new UID) starting at recurrenceId with the edited fields.
 *
 * Simplification (see AGENTS.md): overrides at/after the split point are
 * dropped from the old series and not migrated to the new one. Also, a
 * COUNT-based RRULE is carried into the new series unchanged, so it
 * restarts the count from the split point rather than continuing the
 * original series's remaining occurrences.
 */
export function applyThisAndFuture(
  ics: string,
  recurrenceId: string,
  fields: EventFields,
): { updatedIcs: string; newSeriesIcs: string; newUid: string } {
  const comp = parseCalendar(ics)
  const master = getMaster(comp)
  const boundary = icalTimeFromIso(recurrenceId, masterIsAllDay(master))

  // getFirstPropertyValue returns the underlying Recur object by reference, not
  // a copy -- truncateRrule mutates it in place, so this must be cloned before
  // truncating or the "carried" rule silently ends up truncated too.
  const originalRrule = master.getFirstPropertyValue('rrule') as ICAL.Recur | null
  const carriedRrule = originalRrule ? originalRrule.clone() : null

  for (const v of comp.getAllSubcomponents('vevent')) {
    if (v === master) continue
    const rid = getRecurrenceId(v)
    if (rid && rid.compare(boundary) >= 0) comp.removeSubcomponent(v)
  }
  truncateRrule(master, boundary)

  const newUid = crypto.randomUUID()
  const newFields: EventFields = {
    ...fields,
    rrule: fields.rrule ?? (carriedRrule ? carriedRrule.toString() : null),
  }

  const newComp = new ICAL.Component(['vcalendar', [], []])
  newComp.updatePropertyWithValue('prodid', '-//calendar//standalone//EN')
  newComp.updatePropertyWithValue('version', '2.0')
  newComp.addSubcomponent(buildVeventComponent(newUid, newFields))
  ICAL.helpers.updateTimezones(comp)
  ICAL.helpers.updateTimezones(newComp)

  return { updatedIcs: comp.toString(), newSeriesIcs: newComp.toString(), newUid }
}

/** this-occurrence delete: remove any override for it and EXDATE it out of the master. */
export function deleteThisOccurrence(ics: string, recurrenceId: string): string {
  const comp = parseCalendar(ics)
  const master = getMaster(comp)

  for (const v of comp.getAllSubcomponents('vevent')) {
    const rid = getRecurrenceId(v)
    if (rid && rid.toJSDate().toISOString() === recurrenceId) comp.removeSubcomponent(v)
  }

  master.addPropertyWithValue('exdate', icalTimeFromIso(recurrenceId, masterIsAllDay(master)))
  return comp.toString()
}

/** this-and-future delete: truncate the master's RRULE and drop overrides at/after the boundary. */
export function deleteThisAndFuture(ics: string, recurrenceId: string): string {
  const comp = parseCalendar(ics)
  const master = getMaster(comp)
  const boundary = icalTimeFromIso(recurrenceId, masterIsAllDay(master))

  for (const v of comp.getAllSubcomponents('vevent')) {
    if (v === master) continue
    const rid = getRecurrenceId(v)
    if (rid && rid.compare(boundary) >= 0) comp.removeSubcomponent(v)
  }
  truncateRrule(master, boundary)

  return comp.toString()
}
