import { createClient } from '@supabase/supabase-js'
import { storageKey } from './storage'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

export const supabase = createClient(
  url || 'http://localhost:54321',
  key || 'not-configured',
  { auth: { storageKey: storageKey('auth') } },
)

let signIn: Promise<string> | null = null

/** Returns the player's id, signing in anonymously on the first visit. */
export function ensureUserId(): Promise<string> {
  signIn ??= (async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session.user.id
    const { data: created, error } = await supabase.auth.signInAnonymously()
    if (error || !created.user) throw error ?? new Error('sign-in failed')
    return created.user.id
  })().catch((e) => {
    signIn = null
    throw e
  })
  return signIn
}
