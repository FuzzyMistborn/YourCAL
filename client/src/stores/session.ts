import type { SessionInfo } from '@yourcal/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, ApiRequestError } from '../api.js'

export const useSessionStore = defineStore('session', () => {
  const info = ref<SessionInfo | null>(null)
  const checked = ref(false)

  async function refresh(): Promise<boolean> {
    try {
      info.value = await api.whoami()
      return true
    } catch (err) {
      info.value = null
      return false
    } finally {
      checked.value = true
    }
  }

  async function login(serverUrl: string, username: string, password: string): Promise<void> {
    info.value = await api.login({ serverUrl, username, password })
  }

  async function logout(): Promise<void> {
    await api.logout()
    info.value = null
  }

  return { info, checked, refresh, login, logout, ApiRequestError }
})
