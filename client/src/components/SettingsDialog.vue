<script setup lang="ts">
import { computed } from 'vue'
import { useCalendarsStore } from '../stores/calendars.js'
import { useSettingsStore, type CalendarSortOrder, type WeekStart } from '../stores/settings.js'

const emit = defineEmits<{ close: [] }>()

const settingsStore = useSettingsStore()
const calendarsStore = useCalendarsStore()

const weekStartModel = computed<WeekStart>({
  get: () => settingsStore.weekStart,
  set: (value) => settingsStore.setWeekStart(value),
})

const calendarSortOrderModel = computed<CalendarSortOrder>({
  get: () => settingsStore.calendarSortOrder,
  set: (value) => settingsStore.setCalendarSortOrder(value),
})

// Same "writable + currently enabled" restriction CalendarView applies when
// seeding the new-event dialog's default calendar -- a default that's
// read-only or hidden can't actually be used to create an event.
const writableEnabledCalendarIds = computed(() =>
  calendarsStore.calendars.filter((c) => calendarsStore.enabled[c.id] && !c.readOnly).map((c) => c.id),
)

const preferredDefaultCalendarId = computed(() =>
  writableEnabledCalendarIds.value.includes(settingsStore.defaultCalendarId)
    ? settingsStore.defaultCalendarId
    : (writableEnabledCalendarIds.value[0] ?? ''),
)

const defaultCalendarModel = computed<string>({
  get: () => preferredDefaultCalendarId.value,
  set: (value) => settingsStore.setDefaultCalendarId(value),
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <h2>Settings</h2>

      <label class="dialog__field dialog__field--row">
        <span>Week starts on</span>
        <select v-model="weekStartModel">
          <option value="sunday">Sunday</option>
          <option value="monday">Monday</option>
        </select>
      </label>

      <label class="dialog__field dialog__field--row">
        <span>Sort calendars by</span>
        <select v-model="calendarSortOrderModel">
          <option value="server">Server order</option>
          <option value="name-asc">Name (A→Z)</option>
          <option value="name-desc">Name (Z→A)</option>
        </select>
      </label>

      <label v-if="writableEnabledCalendarIds.length > 0" class="dialog__field dialog__field--row">
        <span>Default calendar</span>
        <select v-model="defaultCalendarModel">
          <option v-for="id in writableEnabledCalendarIds" :key="id" :value="id">
            {{ calendarsStore.calendars.find((c) => c.id === id)?.displayName }}
          </option>
        </select>
      </label>

      <div class="dialog__actions">
        <button type="button" class="btn btn-primary" @click="emit('close')">Done</button>
      </div>
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
.dialog__field--row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.dialog__field select {
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: var(--color-surface);
  color: inherit;
}
.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
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
