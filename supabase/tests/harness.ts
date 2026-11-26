// Runs the real migrations in PGlite (embedded Postgres) with a minimal
// stand-in for the parts of Supabase they rely on.
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase grants everything in "public" by default; the migrations must lock it down.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create publication supabase_realtime;
`

export async function createDatabase() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(file, dir), 'utf8'))
  }

  /** Runs one query the way a signed-in client would (RLS applies). */
  async function as<T = any>(userId: string | null, sql: string, params: unknown[] = []) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`)
    try {
      return (await db.query<T>(sql, params)).rows
    } finally {
      await db.exec('reset role')
    }
  }

  async function call<T = any>(userId: string, fn: string, ...params: unknown[]): Promise<T> {
    const args = params.map((_, i) => `$${i + 1}`).join(', ')
    const rows = await as(userId, `select public.${fn}(${args}) as result`, params)
    return rows[0]?.result as T
  }

  return { db, as, call }
}

export type TestDb = Awaited<ReturnType<typeof createDatabase>>

/** Creates a room with n players; the first one is the host. */
export async function createRoom(t: TestDb, n: number, gameType = 'just-one') {
  const users = Array.from({ length: n }, () => randomUUID())
  const code = await t.call<string>(users[0]!, 'create_room', gameType, 'Spieler 1')
  let roomId = ''
  for (let i = 1; i < n; i++) {
    roomId = await t.call<string>(users[i]!, 'join_room', code, `Spieler ${i + 1}`)
  }
  roomId ||= (await t.call(users[0]!, 'room_snapshot', code)).room.id
  return { users, code, roomId }
}
