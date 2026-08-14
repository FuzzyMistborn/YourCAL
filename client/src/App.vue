<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { SESSION_EXPIRED_EVENT } from './api.js'
import { router } from './router.js'
import { useSessionStore } from './stores/session.js'

const session = useSessionStore()

// See api.ts's SESSION_EXPIRED_EVENT doc comment -- this is the one place
// that reacts to a mid-session 401 by actually taking the user back to
// /login instead of leaving them looking at silently-failing saves.
function onSessionExpired(): void {
  if (!session.info) return // already signed out / already on the login screen
  session.info = null
  void router.push({ name: 'login', query: { expired: '1' } })
}

onMounted(() => window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired))
onUnmounted(() => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired))
</script>

<template>
  <router-view />
</template>
