import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, type User } from '@/lib/api'
export const useAuth = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const ready = ref(false)
  async function restore() { try { user.value = await get<User>('/me') } catch { user.value = null } finally { ready.value = true } }
  async function login(organization: string, username: string, password: string) { await post('/login',{organization,username,password});await restore() }
  async function logout() { await post('/logout',{});user.value=null }
  return { user, ready, restore, login, logout }
})
