<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiRequestError } from '../api.js'
import { useSessionStore } from '../stores/session.js'

const session = useSessionStore()
const router = useRouter()

const serverUrl = ref('')
const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

async function onSubmit(): Promise<void> {
  error.value = null
  submitting.value = true
  try {
    await session.login(serverUrl.value, username.value, password.value)
    await router.push({ name: 'calendar' })
  } catch (err) {
    error.value = err instanceof ApiRequestError ? err.message : 'Could not sign in. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <form class="login__card" @submit.prevent="onSubmit">
      <div class="login__mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4.5" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.6" />
          <path d="M3 9.5h18" stroke="currentColor" stroke-width="1.6" />
          <path d="M8 2.5v4M16 2.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </div>
      <h1>Sign in</h1>
      <p class="login__hint">Connect with your CalDAV server address and account credentials.</p>

      <label>
        <span>Server URL</span>
        <input v-model="serverUrl" type="url" placeholder="https://caldav.example.com/" required autofocus />
      </label>

      <label>
        <span>Username</span>
        <input v-model="username" type="text" autocomplete="username" required />
      </label>

      <label>
        <span>Password</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>

      <p v-if="error" class="login__error">{{ error }}</p>

      <button type="submit" class="btn btn-primary login__submit" :disabled="submitting">
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1.5rem;
}
.login__card {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  width: 100%;
  max-width: 360px;
  padding: 2.25rem 2rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}
.login__mark {
  color: var(--color-primary);
  margin-bottom: 0.25rem;
}
.login h1 {
  font-size: 1.25rem;
}
.login__hint {
  margin: -0.4rem 0 0.4rem;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.login__error {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
input {
  padding: 0.55rem 0.7rem;
}
.login__submit {
  margin-top: 0.5rem;
  padding: 0.65rem;
  font-size: 0.95rem;
}
</style>
