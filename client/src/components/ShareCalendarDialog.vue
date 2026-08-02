<script setup lang="ts">
import type { SharePermission, ShareCalendarResult } from '@yourcal/shared'
import { ref } from 'vue'
import { api, ApiRequestError } from '../api.js'

const props = defineProps<{ calendarId: string; calendarName: string }>()
const emit = defineEmits<{ close: [] }>()

const recipient = ref('')
const permission = ref<SharePermission>('readwrite')
const submitting = ref(false)
const error = ref<string | null>(null)
const result = ref<ShareCalendarResult | null>(null)

async function submit(): Promise<void> {
  if (!recipient.value.trim()) return
  submitting.value = true
  error.value = null
  try {
    result.value = await api.shareCalendar(props.calendarId, {
      recipient: recipient.value.trim(),
      permission: permission.value,
    })
  } catch (err) {
    error.value = err instanceof ApiRequestError ? err.message : 'Failed to share calendar'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <h2>Share &quot;{{ calendarName }}&quot;</h2>

      <div v-if="result">
        <p class="dialog__message">
          Shared with <strong>{{ recipient }}</strong>.
          <template v-if="result.pending">
            Your side is set up, but this server (Radicale) requires the recipient to separately accept the
            invite before it appears for them -- they'll see it under "Pending shares" the next time they log in.
          </template>
          <template v-else> They should see it the next time they load the app. </template>
        </p>
        <div class="dialog__actions">
          <button type="button" class="btn btn-primary" @click="emit('close')">Done</button>
        </div>
      </div>

      <form v-else @submit.prevent="submit">
        <p class="dialog__message">
          Enter the recipient's username (Radicale) or email address (Baikal) -- this app tries both, since it
          depends on which CalDAV server you're using.
        </p>
        <label class="dialog__field">
          <span>Recipient</span>
          <input v-model="recipient" type="text" placeholder="username or email" autofocus />
        </label>
        <label class="dialog__field">
          <span>Access</span>
          <select v-model="permission">
            <option value="readwrite">Can edit</option>
            <option value="read">View only</option>
          </select>
        </label>
        <p v-if="error" class="dialog__error">{{ error }}</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="submitting || !recipient.trim()">
            {{ submitting ? 'Sharing…' : 'Share' }}
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
  width: 340px;
  animation: pop-in 0.14s ease;
}
.dialog h2 {
  font-size: 1.05rem;
  margin: 0 0 0.5rem;
}
.dialog__message {
  margin: 0.5rem 0 1rem;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.dialog__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.dialog__field input,
.dialog__field select {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: var(--color-surface);
  color: inherit;
  box-sizing: border-box;
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
