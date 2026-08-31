<script setup lang="ts">
export type DuplicateScope = 'single' | 'series'

defineProps<{ summary: string }>()
const emit = defineEmits<{ choose: [scope: DuplicateScope]; cancel: [] }>()
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="dialog">
      <h2>Duplicate recurring event</h2>
      <p class="dialog__hint">
        “{{ summary || '(No title)' }}” repeats. What would you like to duplicate?
      </p>
      <div class="dialog__options">
        <button class="btn btn-secondary" @click="emit('choose', 'single')">
          This occurrence as a one-off event
        </button>
        <button class="btn btn-secondary" @click="emit('choose', 'series')">
          The whole series (copy the repeat rule)
        </button>
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
  width: 340px;
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
