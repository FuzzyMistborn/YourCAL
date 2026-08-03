import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type WeekStart = 'sunday' | 'monday'

const STORAGE_KEY = 'calendar.weekStart'
const DEFAULT_CALENDAR_STORAGE_KEY = 'calendar.defaultCalendarId'

function loadInitial(): WeekStart {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'monday' ? 'monday' : 'sunday'
}

export const useSettingsStore = defineStore('settings', () => {
  const weekStart = ref<WeekStart>(loadInitial())
  const defaultCalendarId = ref<string>(localStorage.getItem(DEFAULT_CALENDAR_STORAGE_KEY) ?? '')

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

  return { weekStart, firstDay, setWeekStart, defaultCalendarId, setDefaultCalendarId }
})
