<script setup lang="ts">
import type { CalendarObject } from '@yourcal/shared'
import { DateTime } from 'luxon'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  event: CalendarObject
  color: string
  calendarName: string
  x: number
  y: number
  readOnly?: boolean
}>()

const emit = defineEmits<{ edit: []; delete: []; close: [] }>()

const popoverEl = ref<HTMLElement | null>(null)
const style = ref({ top: '0px', left: '0px' })

function computePosition(): void {
  const margin = 12
  const width = popoverEl.value?.offsetWidth ?? 300
  const height = popoverEl.value?.offsetHeight ?? 200
  let left = props.x + margin
  let top = props.y + margin
  if (left + width > window.innerWidth - margin) left = props.x - width - margin
  if (top + height > window.innerHeight - margin) top = window.innerHeight - height - margin
  style.value = { top: `${Math.max(margin, top)}px`, left: `${Math.max(margin, left)}px` }
}

function onDocumentMouseDown(event: MouseEvent): void {
  if (popoverEl.value && !popoverEl.value.contains(event.target as Node)) emit('close')
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}
function onScrollOrResize(): void {
  emit('close')
}

onMounted(() => {
  computePosition()
  document.addEventListener('mousedown', onDocumentMouseDown)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})

const timeRangeText = computed(() => {
  const start = DateTime.fromISO(props.event.start)
  const end = DateTime.fromISO(props.event.end)

  if (props.event.allDay) {
    // end is CalDAV's exclusive end -- the last inclusive day is end - 1.
    const lastDay = end.minus({ days: 1 })
    return lastDay.hasSame(start, 'day')
      ? start.toFormat('cccc, LLLL d, yyyy')
      : `${start.toFormat('LLL d, yyyy')} – ${lastDay.toFormat('LLL d, yyyy')}`
  }

  return start.hasSame(end, 'day')
    ? `${start.toFormat('cccc, LLLL d')} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`
    : `${start.toFormat('LLL d, h:mm a')} – ${end.toFormat('LLL d, h:mm a')}`
})

// Only worth calling out when it differs from the viewer's own zone -- the
// times above are always rendered in the browser's local zone regardless,
// so a matching timezone would be redundant noise.
const timezoneNote = computed(() => {
  if (props.event.allDay || !props.event.timezone) return null
  return props.event.timezone !== DateTime.local().zoneName ? props.event.timezone : null
})
</script>

<template>
  <Teleport to="body">
    <div ref="popoverEl" class="popover" :style="style">
      <div class="popover__header">
        <span class="popover__dot" :style="{ backgroundColor: color }" />
        <h3 class="popover__title">{{ event.summary || '(No title)' }}</h3>
        <button type="button" class="popover__close" aria-label="Close" @click="emit('close')">×</button>
      </div>

      <p class="popover__time">{{ timeRangeText }}</p>
      <p v-if="timezoneNote" class="popover__badge">🌐 {{ timezoneNote }}</p>
      <p v-if="event.isRecurring" class="popover__badge">🔁 Recurring event</p>
      <p v-if="event.location" class="popover__row">📍 {{ event.location }}</p>
      <p v-if="event.description" class="popover__description">{{ event.description }}</p>
      <p class="popover__calendar">{{ calendarName }}</p>

      <div v-if="!readOnly" class="popover__actions">
        <button type="button" class="btn btn-danger popover__delete" @click="emit('delete')">Delete</button>
        <button type="button" class="btn btn-primary" @click="emit('edit')">Edit</button>
      </div>
      <p v-else class="popover__badge">Read-only subscription</p>
    </div>
  </Teleport>
</template>

<style scoped>
.popover {
  position: fixed;
  z-index: 1000;
  width: 300px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  animation: pop-in 0.12s ease;
}
.popover__header {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.popover__dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  margin-top: 0.4rem;
  flex-shrink: 0;
}
.popover__title {
  flex: 1;
  font-size: 1rem;
  margin: 0;
  word-break: break-word;
}
.popover__close {
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.15rem;
}
.popover__close:hover {
  color: var(--color-text);
}
.popover__time {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text);
}
.popover__badge {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-muted);
}
.popover__row {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text);
}
.popover__description {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  max-height: 6rem;
  overflow-y: auto;
}
.popover__calendar {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-faint);
}
.popover__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.3rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--color-border);
}
.popover__delete {
  margin-right: auto;
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(4px);
  }
}
</style>
