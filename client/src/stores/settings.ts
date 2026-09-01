import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type WeekStart = 'sunday' | 'monday'

// 'server' preserves whatever order the CalDAV server's PROPFIND response
// enumerated calendars in (CalDAV has no standard ordering property, so
// this is really just "however the server happens to return them" -- see
// AGENTS.md's calendar-sorting note).
export type CalendarSortOrder = 'server' | 'name-asc' | 'name-desc'

// 'fixed'     -> new events always default to defaultCalendarId
// 'last-used' -> new events default to whichever calendar the last event was
//                created in, falling back to defaultCalendarId
export type DefaultCalendarMode = 'fixed' | 'last-used'

const STORAGE_KEY = 'calendar.weekStart'
const DEFAULT_CALENDAR_STORAGE_KEY = 'calendar.defaultCalendarId'
const DEFAULT_CALENDAR_MODE_STORAGE_KEY = 'calendar.defaultCalendarMode'
const LAST_USED_CALENDAR_STORAGE_KEY = 'calendar.lastUsedCalendarId'
const SORT_ORDER_STORAGE_KEY = 'calendar.sortOrder'

function loadInitial(): WeekStart {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'monday' ? 'monday' : 'sunday'
}

function loadDefaultCalendarMode(): DefaultCalendarMode {
  return localStorage.getItem(DEFAULT_CALENDAR_MODE_STORAGE_KEY) === 'last-used' ? 'last-used' : 'fixed'
}

function loadSortOrder(): CalendarSortOrder {
  const stored = localStorage.getItem(SORT_ORDER_STORAGE_KEY)
  return stored === 'name-asc' || stored === 'name-desc' ? stored : 'server'
}

export const useSettingsStore = defineStore('settings', () => {
  const weekStart = ref<WeekStart>(loadInitial())
  const defaultCalendarId = ref<string>(localStorage.getItem(DEFAULT_CALENDAR_STORAGE_KEY) ?? '')
  const defaultCalendarMode = ref<DefaultCalendarMode>(loadDefaultCalendarMode())
  const lastUsedCalendarId = ref<string>(localStorage.getItem(LAST_USED_CALENDAR_STORAGE_KEY) ?? '')
  const calendarSortOrder = ref<CalendarSortOrder>(loadSortOrder())

  // FullCalendar's firstDay option: 0 = Sunday, 1 = Monday.
  const firstDay = computed(() => (weekStart.value === 'monday' ? 1 : 0))

  function setWeekStart(value: WeekStart): void {
    weekStart.value = value
    localStorage.setItem(STORAGE_KEY, value)
  }

  function setDefaultCalendarId(value: string): void {
    defaultCalendarId.value = value
    localStorage.setItem(DEFAULT_CALENDAR_STORAGE_KEY, value)
  }

  function setDefaultCalendarMode(value: DefaultCalendarMode): void {
    defaultCalendarMode.value = value
    localStorage.setItem(DEFAULT_CALENDAR_MODE_STORAGE_KEY, value)
  }

  function setLastUsedCalendarId(value: string): void {
    lastUsedCalendarId.value = value
    localStorage.setItem(LAST_USED_CALENDAR_STORAGE_KEY, value)
  }

  function setCalendarSortOrder(value: CalendarSortOrder): void {
    calendarSortOrder.value = value
    localStorage.setItem(SORT_ORDER_STORAGE_KEY, value)
  }

  return {
    weekStart,
    firstDay,
    setWeekStart,
    defaultCalendarId,
    setDefaultCalendarId,
    defaultCalendarMode,
    setDefaultCalendarMode,
    lastUsedCalendarId,
    setLastUsedCalendarId,
    calendarSortOrder,
    setCalendarSortOrder,
  }
})
