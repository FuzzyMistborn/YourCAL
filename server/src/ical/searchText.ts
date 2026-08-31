import ICAL from 'ical.js'
import { registerEmbeddedTimezones } from './timezones.js'

/**
 * Extracts the free-text fields (SUMMARY / DESCRIPTION / LOCATION) from
 * every VEVENT in an ICS object and returns them as one lowercased,
 * newline-joined blob, suitable for storing in `objects.search_text` and
 * substring-matching in SQL (`instr(search_text, ?) > 0`).
 *
 * All VEVENTs are included (master plus any RECURRENCE-ID overrides) so a
 * word that only appears on an overridden occurrence is still findable.
 * Returns '' on a parse failure -- a row that can't be indexed simply
 * won't match, same posture as computeObjectBounds.
 */
export function extractSearchText(ics: string): string {
  try {
    const comp = new ICAL.Component(ICAL.parse(ics))
    registerEmbeddedTimezones(comp)
    const parts: string[] = []
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      for (const prop of ['summary', 'description', 'location']) {
        const value = vevent.getFirstPropertyValue(prop)
        if (typeof value === 'string' && value.trim()) parts.push(value)
      }
    }
    return parts.join('\n').toLowerCase()
  } catch {
    return ''
  }
}
