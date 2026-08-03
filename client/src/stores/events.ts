import type { CalendarObject, CreateEventInput, DeleteEventInput, UpdateEventInput } from '@yourcal/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api.js'

function rangeKey(calendarId: string, start: string, end: string): string {
  return `${calendarId}:${start}:${end}`
}

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

  async function loadRange(calendarIds: string[], start: string, end: string): Promise<void> {
    const seq = ++loadSeq
    loading.value = true
    lastLoadedIds.value = calendarIds
    lastRange.value = { start, end }
    try {
      // allSettled, not all -- one calendar erroring (e.g. a stale/revoked
      // share, a flaky upstream CalDAV server) shouldn't blank out every
      // *other* calendar's already-successful results just because they
      // were requested together.
      const results = await Promise.allSettled(
        calendarIds.map(async (id) => {
          const events = await api.listEvents(id, start, end)
          return [id, events] as const
        }),
      )
      if (seq !== loadSeq) return // superseded by a newer loadRange call

      const now = Date.now()
      const failures: unknown[] = []
      for (const result of results) {
        if (result.status === 'rejected') {
          failures.push(result.reason)
          continue
        }
        const [id, events] = result.value
        const key = rangeKey(id, start, end)
        byRange.value[key] = events
        rangeLoadedAt.value[key] = now
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

  async function reloadLastRange(): Promise<void> {
    if (!lastRange.value) return
    await loadRange(lastLoadedIds.value, lastRange.value.start, lastRange.value.end)
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
    await reloadLastRange()
  }

  async function updateEvent(calendarId: string, uid: string, input: UpdateEventInput): Promise<void> {
    await api.updateEvent(calendarId, uid, input)
    await reloadLastRange()
  }

  async function deleteEvent(calendarId: string, uid: string, input: DeleteEventInput): Promise<void> {
    await api.deleteEvent(calendarId, uid, input)
    await reloadLastRange()
  }

  return { byRange, loading, loadRange, reloadLastRange, eventsFor, findEvent, createEvent, updateEvent, deleteEvent }
})
