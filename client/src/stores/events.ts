import type { CalendarObject, CreateEventInput, DeleteEventInput, UpdateEventInput } from '@yourcal/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api.js'

function rangeKey(calendarId: string, start: string, end: string): string {
  return `${calendarId}:${start}:${end}`
}

// How long a cached range is trusted before re-requesting it from the
// server on navigation. The server already TTL-gates its own upstream
// CalDAV sync, so this is purely about skipping the client<->server round
// trip when flipping back to a month/week already viewed moments ago --
// short enough that edits made from a *different* browser tab/device
// during the window are still picked up promptly.
const FRESH_MS = 30_000

export const useEventsStore = defineStore('events', () => {
  const byRange = ref<Record<string, CalendarObject[]>>({})
  // Timestamp each range's data was last written, so findEvent can prefer
  // the freshest cached copy of an event over whichever one happens to be
  // iterated first (see findEvent's doc comment).
  const rangeLoadedAt = ref<Record<string, number>>({})
  const loading = ref(false)
  const lastLoadedIds = ref<string[]>([])
  const lastRange = ref<{ start: string; end: string } | null>(null)

  // Navigating (or switching visible calendars) quickly can start a new
  // loadRange before a previous one's requests resolve -- without this,
  // whichever call's Promise.all happens to resolve last wins and
  // overwrites byRange, even if it was the *older* request. Each call
  // captures its own sequence number and only commits its results if it's
  // still the most recently started call by the time it resolves.
  let loadSeq = 0

  // `force` of `true` refetches every requested calendar unconditionally;
  // an array of ids force-refetches only those (the rest still go through
  // the normal freshness check) -- used after a single-calendar write so an
  // edit doesn't pay for re-fetching every *other* enabled calendar's range
  // too (see reloadLastRange).
  async function loadRange(
    calendarIds: string[],
    start: string,
    end: string,
    force: boolean | string[] = false,
  ): Promise<void> {
    const seq = ++loadSeq
    lastLoadedIds.value = calendarIds
    lastRange.value = { start, end }

    // Skip calendars whose exact range is already cached and still fresh --
    // e.g. flipping back to a month viewed moments ago -- rather than
    // re-requesting data we already have.
    const now = Date.now()
    const forceIds = Array.isArray(force) ? new Set(force) : null
    const idsToFetch =
      force === true
        ? calendarIds
        : calendarIds.filter((id) => {
            if (forceIds?.has(id)) return true
            const loadedAt = rangeLoadedAt.value[rangeKey(id, start, end)]
            return loadedAt === undefined || now - loadedAt >= FRESH_MS
          })
    if (idsToFetch.length === 0) return

    loading.value = true
    try {
      // allSettled, not all -- one calendar erroring (e.g. a stale/revoked
      // share, a flaky upstream CalDAV server) shouldn't blank out every
      // *other* calendar's already-successful results just because they
      // were requested together.
      const results = await Promise.allSettled(
        idsToFetch.map(async (id) => {
          const events = await api.listEvents(id, start, end)
          return [id, events] as const
        }),
      )
      if (seq !== loadSeq) return // superseded by a newer loadRange call

      const loadedAt = Date.now()
      const failures: unknown[] = []
      for (const result of results) {
        if (result.status === 'rejected') {
          failures.push(result.reason)
          continue
        }
        const [id, events] = result.value
        const key = rangeKey(id, start, end)
        byRange.value[key] = events
        rangeLoadedAt.value[key] = loadedAt
      }
      if (failures.length > 0) {
        throw new Error(`Failed to load ${failures.length} of ${calendarIds.length} calendar(s)`, {
          cause: failures[0],
        })
      }
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  // `calendarIds` names which calendar(s) actually changed and must be
  // force-refetched; omit it (e.g. after a 412 conflict, where we don't
  // know what else might be stale) to fall back to refetching everything
  // currently visible, as before.
  async function reloadLastRange(calendarIds?: string[]): Promise<void> {
    if (!lastRange.value) return
    await loadRange(lastLoadedIds.value, lastRange.value.start, lastRange.value.end, calendarIds ?? true)
  }

  function eventsFor(calendarIds: string[], start: string, end: string): CalendarObject[] {
    return calendarIds.flatMap((id) => byRange.value[rangeKey(id, start, end)] ?? [])
  }

  // Used by conflict-resolution UI to look up the server's current version
  // of an event after a 412, so the user can see what changed and reapply
  // their edit against the fresh etag rather than just losing it. The same
  // event can be cached under several overlapping ranges loaded at
  // different times (e.g. a month view and a day view both covering
  // today), each potentially holding a different etag -- picks the copy
  // from the most recently loaded range rather than whichever range
  // Object.values happens to iterate first.
  function findEvent(calendarId: string, uid: string, recurrenceId: string | null): CalendarObject | undefined {
    let best: CalendarObject | undefined
    let bestLoadedAt = -1
    for (const [key, events] of Object.entries(byRange.value)) {
      const found = events.find((e) => e.calendarId === calendarId && e.uid === uid && e.recurrenceId === recurrenceId)
      if (!found) continue
      const loadedAt = rangeLoadedAt.value[key] ?? 0
      if (loadedAt > bestLoadedAt) {
        best = found
        bestLoadedAt = loadedAt
      }
    }
    return best
  }

  async function createEvent(calendarId: string, fields: CreateEventInput): Promise<void> {
    await api.createEvent(calendarId, fields)
    await reloadLastRange([calendarId])
  }

  async function updateEvent(calendarId: string, uid: string, input: UpdateEventInput): Promise<void> {
    await api.updateEvent(calendarId, uid, input)
    // A move to a different calendar (the edit dialog's Calendar dropdown)
    // means the event vanishes from `calendarId`'s range and appears in
    // `input.calendarId`'s -- both need refetching, not just one.
    const changed =
      input.calendarId && input.calendarId !== calendarId ? [calendarId, input.calendarId] : [calendarId]
    await reloadLastRange(changed)
  }

  async function deleteEvent(calendarId: string, uid: string, input: DeleteEventInput): Promise<void> {
    await api.deleteEvent(calendarId, uid, input)
    await reloadLastRange([calendarId])
  }

  // Undo a deletion by re-creating the object from a raw-ICS snapshot taken
  // before the delete. A 'this'/'thisAndFuture' delete only modifies the
  // object in place, so if one still holds this UID, remove it first --
  // otherwise the calendar would end up with two objects sharing the UID.
  async function restoreEvent(calendarId: string, uid: string, ics: string): Promise<void> {
    await reloadLastRange([calendarId])
    const existing = findEvent(calendarId, uid, null)
    if (existing) {
      await api.deleteEvent(calendarId, uid, {
        href: existing.href,
        etag: existing.etag,
        scope: 'all',
        recurrenceId: null,
      })
    }
    await api.restoreEvent(calendarId, uid, ics)
    await reloadLastRange([calendarId])
  }

  return {
    byRange,
    loading,
    loadRange,
    reloadLastRange,
    eventsFor,
    findEvent,
    createEvent,
    updateEvent,
    deleteEvent,
    restoreEvent,
  }
})
