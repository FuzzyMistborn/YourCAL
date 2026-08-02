import type { CalendarObject } from '@yourcal/shared'
import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { api } from '../api.js'

export interface Subscription {
  id: string
  name: string
  url: string
  color: string
}

const STORAGE_KEY = 'calendar.subscriptions'
const DEFAULT_COLOR = '#8e5fd4'

// crypto.randomUUID() only exists in secure contexts (HTTPS, or the
// literal hostname "localhost") -- accessing the app over plain HTTP via a
// LAN IP leaves crypto.randomUUID undefined, which threw here uncaught.
// This id is only ever used as a local-storage key, not sent to any
// server, so a non-cryptographic fallback is fine.
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function loadSubscriptions(): Subscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Subscription[]) : []
  } catch {
    return []
  }
}

function rangeKey(id: string, start: string, end: string): string {
  return `${id}:${start}:${end}`
}

export const useSubscriptionsStore = defineStore('subscriptions', () => {
  const subscriptions = ref<Subscription[]>(loadSubscriptions())
  const enabled = reactive<Record<string, boolean>>(Object.fromEntries(subscriptions.value.map((s) => [s.id, true])))
  const byRange = ref<Record<string, CalendarObject[]>>({})
  const errors = reactive<Record<string, string>>({})

  function persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions.value))
  }

  function add(name: string, url: string, color = DEFAULT_COLOR): void {
    const sub: Subscription = { id: generateId(), name, url, color }
    subscriptions.value.push(sub)
    enabled[sub.id] = true
    persist()
  }

  function remove(id: string): void {
    subscriptions.value = subscriptions.value.filter((s) => s.id !== id)
    delete enabled[id]
    delete errors[id]
    persist()
  }

  function toggle(id: string): void {
    enabled[id] = !enabled[id]
  }

  function setColor(id: string, color: string): void {
    const sub = subscriptions.value.find((s) => s.id === id)
    if (sub) {
      sub.color = color
      persist()
    }
  }

  async function loadRange(start: string, end: string): Promise<void> {
    const active = subscriptions.value.filter((s) => enabled[s.id])
    await Promise.all(
      active.map(async (sub) => {
        try {
          const events = await api.getSubscriptionEvents(sub.url, start, end)
          // Remap to the local subscription id so color/name lookups
          // in the UI don't need to know the server's synthetic calendarId.
          byRange.value[rangeKey(sub.id, start, end)] = events.map((e) => ({ ...e, calendarId: sub.id }))
          delete errors[sub.id]
        } catch (err) {
          errors[sub.id] = err instanceof Error ? err.message : 'Failed to load subscription'
          byRange.value[rangeKey(sub.id, start, end)] = []
        }
      }),
    )
  }

  function eventsFor(start: string, end: string): CalendarObject[] {
    return subscriptions.value
      .filter((s) => enabled[s.id])
      .flatMap((s) => byRange.value[rangeKey(s.id, start, end)] ?? [])
  }

  return { subscriptions, enabled, errors, add, remove, toggle, setColor, loadRange, eventsFor }
})
