<script setup lang="ts">
import type { CalendarObject } from '@yourcal/shared'
import { DateTime } from 'luxon'

const props = defineProps<{
  kind: 'update' | 'delete'
  // The server's current version, if it could still be found after the
  // reload triggered by the 412 (null if the event was deleted elsewhere).
  serverEvent: CalendarObject | null
  attemptedSummary: string
}>()
const emit = defineEmits<{ discard: []; reapply: [] }>()

function whenText(event: CalendarObject): string {
  // See EventDetailPopover's timeRangeText: an all-day instant is a
  // UTC-midnight-anchored calendar date, not a real timezone-bearing
  // instant -- read in the browser's local zone (Luxon's default), it can
  // land on the previous day in any negative-offset zone.
  const start = DateTime.fromISO(event.start, { zone: event.allDay ? 'utc' : undefined })
  return event.allDay ? start.toFormat('LLL d, yyyy') : start.toFormat('LLL d, h:mm a')
}
</script>

<template>
  <div class="overlay" @click.self="emit('discard')">
    <div class="dialog">
      <h2>This event changed elsewhere</h2>
      <p class="dialog__hint">
        Someone (maybe you, in another tab) changed this event before your
        {{ props.kind === 'delete' ? 'delete' : 'save' }} went through.
      </p>

      <div v-if="serverEvent" class="dialog__version">
        <span class="dialog__version-label">Current version on the server</span>
        <p class="dialog__version-title">{{ serverEvent.summary || '(No title)' }}</p>
        <p class="dialog__version-when">{{ whenText(serverEvent) }}</p>
      </div>
      <p v-else class="dialog__hint">It looks like this event was deleted elsewhere.</p>

      <div class="dialog__version" v-if="props.kind === 'update'">
        <span class="dialog__version-label">Your attempted change</span>
        <p class="dialog__version-title">{{ attemptedSummary }}</p>
      </div>

      <div class="dialog__actions">
        <button type="button" class="btn btn-ghost" @click="emit('discard')">Discard my changes</button>
        <button
          v-if="serverEvent"
          type="button"
          class="btn btn-primary"
          @click="emit('reapply')"
        >
          {{ props.kind === 'delete' ? 'Delete anyway' : 'Reapply my changes' }}
        </button>
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
  z-index: 50;
  animation: fade-in 0.12s ease;
}
.dialog {
  background: var(--color-surface);
  padding: 1.5rem;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 360px;
  animation: pop-in 0.14s ease;
}
.dialog h2 {
  font-size: 1.05rem;
  margin: 0;
}
.dialog__hint {
  margin: 0.5rem 0 0.75rem;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.dialog__version {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-hover);
}
.dialog__version-label {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
  margin-bottom: 0.2rem;
}
.dialog__version-title {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text);
}
.dialog__version-when {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
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
