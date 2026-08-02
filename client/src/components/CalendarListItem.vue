<script setup lang="ts">
import type { Calendar } from '@yourcal/shared'
import { ApiRequestError } from '../api.js'
import { useCalendarsStore } from '../stores/calendars.js'

defineProps<{ cal: Calendar }>()
const emit = defineEmits<{ share: [id: string, name: string] }>()

const store = useCalendarsStore()

function onColorInput(id: string, event: Event): void {
  const input = event.target as HTMLInputElement
  store.setColorOverride(id, input.value)
}

// Both actions can genuinely fail server-side (e.g. the DAV server
// rejects the delete, or Radicale's hide fails for the unsubscribe path)
// -- surfacing that is more important than it looks here, since a silent
// failure leaves the calendar exactly where it was with no indication
// anything went wrong. No dedicated error-banner UI exists at this list-
// item scope (unlike ShareCalendarDialog's inline error text), so this
// uses a plain alert(), matching the confirm()-based style already used
// for these same two actions below.
async function onDeleteClick(cal: Calendar): Promise<void> {
  if (!confirm(`Delete "${cal.displayName}"? This removes it for everyone it's shared with.`)) return
  try {
    await store.deleteCalendar(cal.id)
  } catch (err) {
    alert(err instanceof ApiRequestError ? err.message : `Failed to delete "${cal.displayName}".`)
  }
}

async function onUnsubscribeClick(cal: Calendar): Promise<void> {
  if (!confirm(`Stop showing "${cal.displayName}"? The owner keeps their calendar; you can be re-invited later.`)) return
  try {
    await store.unsubscribeCalendar(cal.id)
  } catch (err) {
    alert(err instanceof ApiRequestError ? err.message : `Failed to unsubscribe from "${cal.displayName}".`)
  }
}
</script>

<template>
  <li class="calendar-list__item">
    <label class="calendar-list__toggle">
      <input type="checkbox" :checked="store.enabled[cal.id]" @change="store.toggle(cal.id)" />
      <span class="calendar-list__name" :title="cal.displayName">{{ cal.displayName }}</span>
    </label>
    <input
      type="color"
      class="calendar-list__swatch"
      :value="store.colorFor(cal.id)"
      :title="`Color for ${cal.displayName}`"
      @input="onColorInput(cal.id, $event)"
    />
    <button
      v-if="cal.id in store.colorOverrides"
      type="button"
      class="calendar-list__reset"
      title="Reset to server color"
      @click="store.resetColorOverride(cal.id)"
    >
      ×
    </button>
    <button
      v-if="!cal.isShared"
      type="button"
      class="calendar-list__share"
      title="Share this calendar"
      @click="emit('share', cal.id, cal.displayName)"
    >
      ↗
    </button>
    <button
      v-if="!cal.isShared"
      type="button"
      class="calendar-list__delete"
      title="Delete this calendar"
      @click="onDeleteClick(cal)"
    >
      🗑
    </button>
    <button
      v-if="cal.isShared"
      type="button"
      class="calendar-list__unsubscribe"
      title="Unsubscribe from this shared calendar"
      @click="onUnsubscribeClick(cal)"
    >
      ✕
    </button>
  </li>
</template>

<style scoped>
.calendar-list__item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-sm);
  transition: background-color 0.12s ease;
}
.calendar-list__item:hover {
  background: var(--color-surface-hover);
}
.calendar-list__toggle {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1;
  min-width: 0;
  padding: 0.2rem 0;
  cursor: pointer;
}
input[type='checkbox'] {
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
}
.calendar-list__name {
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calendar-list__swatch {
  -webkit-appearance: none;
  appearance: none;
  width: 1.1rem;
  height: 1.1rem;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: 50%;
  background: none;
  cursor: pointer;
  overflow: hidden;
}
.calendar-list__swatch::-webkit-color-swatch-wrapper {
  padding: 0;
}
.calendar-list__swatch::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}
.calendar-list__reset {
  flex-shrink: 0;
  padding: 0 0.2rem;
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
}
.calendar-list__reset:hover {
  color: var(--color-danger);
}
.calendar-list__share {
  flex-shrink: 0;
  padding: 0 0.2rem;
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.calendar-list__share:hover {
  color: var(--color-text);
}
.calendar-list__delete,
.calendar-list__unsubscribe {
  flex-shrink: 0;
  padding: 0 0.2rem;
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
}
.calendar-list__delete:hover,
.calendar-list__unsubscribe:hover {
  color: var(--color-danger);
}
</style>
