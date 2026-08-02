<script setup lang="ts">
import type { EditScope } from '@yourcal/shared'

defineProps<{ verb: string }>()
const emit = defineEmits<{ choose: [scope: EditScope]; cancel: [] }>()
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="dialog">
      <h2>{{ verb }} recurring event</h2>
      <p class="dialog__hint">This event repeats. What would you like to {{ verb.toLowerCase() }}?</p>
      <div class="dialog__options">
        <button class="btn btn-secondary" @click="emit('choose', 'this')">This event</button>
        <button class="btn btn-secondary" @click="emit('choose', 'thisAndFuture')">This and future events</button>
        <button class="btn btn-secondary" @click="emit('choose', 'all')">All events</button>
      </div>
      <button class="btn btn-ghost dialog__cancel" @click="emit('cancel')">Cancel</button>
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
  z-index: 30;
  animation: fade-in 0.12s ease;
}
.dialog {
  background: var(--color-surface);
  padding: 1.5rem;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 320px;
  animation: pop-in 0.14s ease;
}
.dialog h2 {
  font-size: 1.05rem;
}
.dialog__hint {
  margin: 0.35rem 0 1rem;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.dialog__options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.dialog__options .btn {
  justify-content: flex-start;
  text-align: left;
}
.dialog__cancel {
  margin-top: 0.75rem;
  width: 100%;
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
