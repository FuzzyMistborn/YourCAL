import type { CalendarObject, CreateEventInput, DeleteEventInput, UpdateEventInput } from '@yourcal/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api.js'

function rangeKey(calendarId: string, start: string, end: string): string {
  return `${calendarId}:${start}:${end}`
}

export const useEventsStore = defineStore('events', () => {
  const byRange = ref<Record<string, CalendarObject[]>>({})
  const loading = ref(false)
  const lastLoadedIds = ref<string[]>([])
  const lastRange = ref<{ start: string; end: string } | null>(null)

  async function loadRange(calendarIds: string[], start: string, end: string): Promise<void> {
    loading.value = true
    lastLoadedIds.value = calendarIds
    lastRange.value = { start, end }
    try {
      const results = await Promise.all(
        calendarIds.map(async (id) => {
          const events = await api.listEvents(id, start, end)
          return [id, events] as const
        }),
      )
      for (const [id, events] of results) {
        byRange.value[rangeKey(id, start, end)] = events
      }
    } finally {
      loading.value = false
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
  // their edit against the fresh etag rather than just losing it.
  function findEvent(calendarId: string, uid: string, recurrenceId: string | null): CalendarObject | undefined {
    for (const events of Object.values(byRange.value)) {
      const found = events.find((e) => e.calendarId === calendarId && e.uid === uid && e.recurrenceId === recurrenceId)
      if (found) return found
    }
    return undefined
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
