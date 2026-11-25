import { t, type ErrorCode } from './strings.de'
import { ensureUserId, supabase } from './supabase'

/** Calls a Postgres function as the signed-in player. */
export async function rpc<T = void>(fn: string, args: Record<string, unknown>): Promise<T> {
  await ensureUserId()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

/** Turns an error from the database into a readable message. */
export function errorText(error: unknown): string {
  const message = (error as { message?: string } | null)?.message ?? ''
  if (Object.hasOwn(t.errors, message)) return t.errors[message as ErrorCode]
  console.error(error)
  return t.errors.unknown
}
