import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type WeekStart = 'sunday' | 'monday'

export type TimeFormat = '12h' | '24h'

// 'server' preserves whatever order the CalDAV server's PROPFIND response
// enumerated calendars in (CalDAV has no standard ordering property, so
// this is really just "however the server happens to return them" -- see
// AGENTS.md's calendar-sorting note).
export type CalendarSortOrder = 'server' | 'name-asc' | 'name-desc'

// 'fixed'     -> new events always default to defaultCalendarId
// 'last-used' -> new events default to whichever calendar the last event was
//                created in, falling back to defaultCalendarId
export type DefaultCalendarMode = 'fixed' | 'last-used'

// Matches the FullCalendar view names wired up in CalendarView.vue's
// headerToolbar (multiMonthYear,dayGridMonth,timeGridWeek,timeGridDay,listUpcoming) --
// keep in sync if a view is ever renamed or removed there.
export type CalendarViewType = 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listUpcoming'

const STORAGE_KEY = 'calendar.weekStart'
const DEFAULT_CALENDAR_STORAGE_KEY = 'calendar.defaultCalendarId'
const DEFAULT_CALENDAR_MODE_STORAGE_KEY = 'calendar.defaultCalendarMode'
const LAST_USED_CALENDAR_STORAGE_KEY = 'calendar.lastUsedCalendarId'
const SORT_ORDER_STORAGE_KEY = 'calendar.sortOrder'
const TIME_FORMAT_STORAGE_KEY = 'calendar.timeFormat'
const DEFAULT_VISIBLE_CALENDARS_STORAGE_KEY = 'calendar.defaultVisibleCalendarIds'
const DEFAULT_VIEW_STORAGE_KEY = 'calendar.defaultView'

const VALID_VIEWS: CalendarViewType[] = ['multiMonthYear', 'dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listUpcoming']

function loadDefaultView(): CalendarViewType {
  const stored = localStorage.getItem(DEFAULT_VIEW_STORAGE_KEY)
  return (VALID_VIEWS as string[]).includes(stored ?? '') ? (stored as CalendarViewType) : 'dayGridMonth'
}

function loadInitial(): WeekStart {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'monday' ? 'monday' : 'sunday'
}

function loadTimeFormat(): TimeFormat {
  return localStorage.getItem(TIME_FORMAT_STORAGE_KEY) === '24h' ? '24h' : '12h'
}

function loadDefaultCalendarMode(): DefaultCalendarMode {
  return localStorage.getItem(DEFAULT_CALENDAR_MODE_STORAGE_KEY) === 'last-used' ? 'last-used' : 'fixed'
}

function loadSortOrder(): CalendarSortOrder {
  const stored = localStorage.getItem(SORT_ORDER_STORAGE_KEY)
  return stored === 'name-asc' || stored === 'name-desc' ? stored : 'server'
}

// Empty means "no preference set" -- every calendar starts visible, same as
// before this setting existed. A non-empty list is an explicit whitelist of
// which calendars should be checked on load.
function loadDefaultVisibleCalendarIds(): string[] {
  try {
    const raw = localStorage.getItem(DEFAULT_VISIBLE_CALENDARS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const weekStart = ref<WeekStart>(loadInitial())
  const defaultCalendarId = ref<string>(localStorage.getItem(DEFAULT_CALENDAR_STORAGE_KEY) ?? '')
  const defaultCalendarMode = ref<DefaultCalendarMode>(loadDefaultCalendarMode())
  const lastUsedCalendarId = ref<string>(localStorage.getItem(LAST_USED_CALENDAR_STORAGE_KEY) ?? '')
  const calendarSortOrder = ref<CalendarSortOrder>(loadSortOrder())
  const timeFormat = ref<TimeFormat>(loadTimeFormat())
  const defaultVisibleCalendarIds = ref<string[]>(loadDefaultVisibleCalendarIds())
  const defaultView = ref<CalendarViewType>(loadDefaultView())

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

  function setTimeFormat(value: TimeFormat): void {
    timeFormat.value = value
    localStorage.setItem(TIME_FORMAT_STORAGE_KEY, value)
  }

  function setDefaultVisibleCalendarIds(ids: string[]): void {
    defaultVisibleCalendarIds.value = ids
    localStorage.setItem(DEFAULT_VISIBLE_CALENDARS_STORAGE_KEY, JSON.stringify(ids))
  }

  function setDefaultView(value: CalendarViewType): void {
    defaultView.value = value
    localStorage.setItem(DEFAULT_VIEW_STORAGE_KEY, value)
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
    timeFormat,
    setTimeFormat,
    defaultVisibleCalendarIds,
    setDefaultVisibleCalendarIds,
    defaultView,
    setDefaultView,
  }
})
