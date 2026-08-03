<script setup lang="ts">
import { ref } from 'vue'
import { ApiRequestError } from '../api.js'
import { useCalendarsStore } from '../stores/calendars.js'

const props = defineProps<{ calendarId: string; calendarName: string; calendarColor: string }>()
const emit = defineEmits<{ close: [] }>()

const store = useCalendarsStore()
const displayName = ref(props.calendarName)
const color = ref(props.calendarColor)
const submitting = ref(false)
const error = ref<string | null>(null)

async function submit(): Promise<void> {
  if (!displayName.value.trim()) return
  submitting.value = true
  error.value = null
  try {
    await store.renameCalendar(props.calendarId, { displayName: displayName.value.trim(), color: color.value })
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiRequestError ? err.message : 'Failed to update calendar'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <h2>Rename calendar</h2>

      <form @submit.prevent="submit">
        <label class="dialog__field">
          <span>Name</span>
          <input v-model="displayName" type="text" autofocus />
        </label>
        <label class="dialog__field">
          <span>Color</span>
          <input v-model="color" type="color" class="dialog__swatch" />
        </label>
        <p v-if="error" class="dialog__error">{{ error }}</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="submitting || !displayName.trim()">
            {{ submitting ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(16, 20, 26, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  animation: fade-in 0.12s ease;
}
.dialog {
  background: var(--color-surface);
  padding: 1.5rem;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 300px;
  animation: pop-in 0.14s ease;
}
.dialog h2 {
  font-size: 1.05rem;
  margin: 0 0 0.75rem;
}
.dialog__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.dialog__field input[type='text'] {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: var(--color-surface);
  color: inherit;
  box-sizing: border-box;
}
.dialog__swatch {
  -webkit-appearance: none;
  appearance: none;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: 50%;
  background: none;
  cursor: pointer;
  overflow: hidden;
}
.dialog__swatch::-webkit-color-swatch-wrapper {
  padding: 0;
}
.dialog__swatch::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}
.dialog__error {
  margin: 0 0 0.75rem;
  font-size: 0.8rem;
  color: var(--color-danger);
}
.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(4px);
  }
}
</style>
