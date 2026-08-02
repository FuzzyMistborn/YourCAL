import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type WeekStart = 'sunday' | 'monday'

const STORAGE_KEY = 'calendar.weekStart'

function loadInitial(): WeekStart {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'monday' ? 'monday' : 'sunday'
}

export const useSettingsStore = defineStore('settings', () => {
  const weekStart = ref<WeekStart>(loadInitial())

  // FullCalendar's firstDay option: 0 = Sunday, 1 = Monday.
  const firstDay = computed(() => (weekStart.value === 'monday' ? 1 : 0))

  function setWeekStart(value: WeekStart): void {
    weekStart.value = value
    localStorage.setItem(STORAGE_KEY, value)
  }

  return { weekStart, firstDay, setWeekStart }
})
