import { defineStore } from 'pinia'
import { ref } from 'vue'

// How long an undo offer stays on screen before it's dropped. Deliberately
// short -- the toast is a convenience for the "wait, no" moment right after
// an action, not a persistent history.
const UNDO_WINDOW_MS = 8_000

export interface UndoOffer {
  message: string
  // Reverts the action. May throw -- the toast surfaces the failure.
  run: () => Promise<void>
}

export const useUndoStore = defineStore('undo', () => {
  const pending = ref<UndoOffer | null>(null)
  const running = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  // Replaces any still-pending offer -- only the most recent action is
  // undoable, matching what the single toast can show.
  function offer(message: string, run: () => Promise<void>): void {
    clearTimer()
    pending.value = { message, run }
    timer = setTimeout(() => {
      pending.value = null
      timer = undefined
    }, UNDO_WINDOW_MS)
  }

  function dismiss(): void {
    clearTimer()
    pending.value = null
  }

  async function invoke(): Promise<void> {
    const offered = pending.value
    if (!offered || running.value) return
    clearTimer()
    running.value = true
    try {
      await offered.run()
      pending.value = null
    } finally {
      running.value = false
    }
  }

  return { pending, running, offer, dismiss, invoke }
})
