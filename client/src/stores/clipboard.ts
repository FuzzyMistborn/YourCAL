import type { CalendarObject } from '@yourcal/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

// In-app only -- an event copied with Ctrl/Cmd-C is held here until the tab
// is closed (no OS clipboard, no ICS serialization). Ctrl/Cmd-V opens the
// create dialog pre-filled from it.
export const useClipboardStore = defineStore('clipboard', () => {
  const copied = ref<CalendarObject | null>(null)

  function copy(event: CalendarObject): void {
    copied.value = event
  }

  function clear(): void {
    copied.value = null
  }

  return { copied, copy, clear }
})
