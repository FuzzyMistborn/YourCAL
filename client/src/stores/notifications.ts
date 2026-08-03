import type { CalendarObject } from '@yourcal/shared'
import { DateTime } from 'luxon'
import { defineStore } from 'pinia'
import { ref } from 'vue'

// Only reminders whose fire time falls within this window of "now" get a
// setTimeout scheduled -- an alarm three months out would need a timer
// that outlives any realistic tab lifetime anyway, and timers don't
// survive a reload regardless, so this just re-arms on every subsequent
// load instead of trying to schedule far in advance.
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000

export const useNotificationsStore = defineStore('notifications', () => {
  const permission = ref<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const scheduled = new Map<string, ReturnType<typeof setTimeout>>()

  // Never call this unprompted on load -- browsers throttle/block
  // permission requests not triggered by a real user gesture, and it's
  // poor UX regardless. Call from an explicit settings toggle/button.
  async function requestPermission(): Promise<void> {
    if (typeof Notification === 'undefined') return
    permission.value = await Notification.requestPermission()
  }

  function fire(event: CalendarObject, minutesBefore: number): void {
    if (permission.value !== 'granted') return
    const when = DateTime.fromISO(event.start)
    new Notification(event.summary || '(No title)', {
      body: minutesBefore === 0 ? 'Starting now' : `${when.toFormat('h:mm a')} · ${minutesBefore} min reminder`,
      tag: `${event.calendarId}:${event.uid}:${event.recurrenceId ?? ''}:${minutesBefore}`,
    })
  }

  // Reminders only fire while this tab is open (or backgrounded but not
  // closed) -- no service worker, no push, no background delivery when
  // the tab isn't running. Call this after every successful events load.
  function scheduleForEvents(events: CalendarObject[]): void {
    if (permission.value !== 'granted') return
    const now = Date.now()

    for (const event of events) {
      for (const alarm of event.alarms) {
        const key = `${event.calendarId}:${event.uid}:${event.recurrenceId ?? ''}:${alarm.minutesBefore}`
        if (scheduled.has(key)) continue

        const fireAt = DateTime.fromISO(event.start).minus({ minutes: alarm.minutesBefore }).toMillis()
        const delay = fireAt - now
        if (delay < 0 || delay > LOOKAHEAD_MS) continue

        const handle = setTimeout(() => {
          scheduled.delete(key)
          fire(event, alarm.minutesBefore)
        }, delay)
        scheduled.set(key, handle)
      }
    }
  }

  function clear(): void {
    for (const handle of scheduled.values()) clearTimeout(handle)
    scheduled.clear()
  }

  return { permission, requestPermission, scheduleForEvents, clear }
})
