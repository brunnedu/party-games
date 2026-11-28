// The site password, invite links and the access log.
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, createRoom, type TestDb } from './harness'

const PASSWORD = 'vier zufaellige test woerter'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

beforeEach(async () => {
  await headers(null)
  await t.db.exec(`select private.remove_app_password(); delete from private.access_log`)
})

/** What PostgREST would pass on about the request. */
async function headers(value: Record<string, string> | string | null) {
  const text = typeof value === 'string' ? value : value ? JSON.stringify(value) : ''
  await t.db.query(`select set_config('request.headers', $1, false)`, [text])
}

const setPassword = (password = PASSWORD) =>
  t.db.query('select private.set_app_password($1)', [password])
const unlock = (user: string, password = PASSWORD) => t.call<string>(user, 'unlock', password)
const create = (user: string) => t.call<string>(user, 'create_room', 'just-one', 'Anna')
const join = (user: string, code: string, name = 'Ben', invite: string | null = null) =>
  t.call<string>(user, 'join_room', code, name, invite)
const info = (user: string, code: string, invite: string | null = null) =>
  t.as(user, 'select * from get_room_info($1, $2)', [code, invite])
const log = async () =>
  (await t.db.query<any>('select * from private.access_log order by id')).rows
const actions = async () => (await log()).map((r) => r.action)

/** A room whose host knows the password, with its invite. */
async function lockedRoom() {
  await setPassword()
  const host = randomUUID()
  await unlock(host)
  const code = await create(host)
  const roomId = (await t.call(host, 'room_snapshot', code)).room.id as string
  const invite = await t.call<string>(host, 'room_invite', roomId)
  return { host, code, roomId, invite }
}

const REFUSED = [{ game_type: null, status: null, joinable: null, access_required: true }]

describe('without a password', () => {
  it('lets anyone create, look up and join, also like the old app does', async () => {
    const { code } = await createRoom(t, 2)
    const user = randomUUID()
    expect(await t.as(user, 'select * from get_room_info($1)', [code])).toEqual([
      { game_type: 'just-one', status: 'lobby', joinable: true, access_required: false },
    ])
    expect(await t.call(user, 'join_room', code, 'Neu')).toBeTruthy()
    expect(await unlock(user, 'irgendwas')).toBe('ok')
  })
})

describe('with a password', () => {
  it('needs it to create a room', async () => {
    await setPassword()
    const user = randomUUID()
    await expect(create(user)).rejects.toThrow('access_required')
    expect(await unlock(user, 'falsch')).toBe('wrong')
    await expect(create(user)).rejects.toThrow('access_required')
    expect(await unlock(user)).toBe('ok')
    expect(await create(user)).toHaveLength(5)
  })

  it('forgives spaces around it, but not other capitals', async () => {
    await setPassword()
    expect(await unlock(randomUUID(), PASSWORD.toUpperCase())).toBe('wrong')
    expect(await unlock(randomUUID(), `  ${PASSWORD} `)).toBe('ok')
  })

  it('tells outsiders nothing about which codes exist', async () => {
    const { code } = await lockedRoom()
    const user = randomUUID()
    expect(await info(user, code)).toEqual(REFUSED)
    expect(await info(user, 'ZZZZZ')).toEqual(REFUSED)
    await expect(join(user, code)).rejects.toThrow('access_required')
    await expect(join(user, 'ZZZZZ')).rejects.toThrow('access_required')
    await unlock(user)
    expect(await info(user, 'ZZZZZ')).toEqual([])
    await expect(join(user, 'ZZZZZ')).rejects.toThrow('room_not_found')
    expect(await join(user, code)).toBeTruthy()
  })

  it('lets an invite join its own room, and nothing else', async () => {
    const { code, invite } = await lockedRoom()
    const other = await lockedRoom()
    const guest = randomUUID()
    await expect(join(guest, code, 'Gast', 'falsch')).rejects.toThrow('access_required')
    await expect(join(guest, code, 'Gast', other.invite)).rejects.toThrow('access_required')
    expect(await info(guest, code, invite)).toMatchObject([{ access_required: false }])
    expect(await join(guest, code, 'Gast', invite)).toBeTruthy()
    await expect(create(guest)).rejects.toThrow('access_required')
    await expect(join(guest, other.code, 'Gast', invite)).rejects.toThrow('access_required')
  })

  it('gives the invite only to people in the room', async () => {
    const { roomId, code, invite } = await lockedRoom()
    await expect(t.call(randomUUID(), 'room_invite', roomId)).rejects.toThrow('not_in_room')
    const guest = randomUUID()
    await join(guest, code, 'Gast', invite)
    expect(await t.call(guest, 'room_invite', roomId)).toBe(invite)
    expect(invite).toMatch(/^[0-9a-f]{32}$/)
  })

  it('replaces the invite when someone is removed', async () => {
    const { host, roomId, code, invite } = await lockedRoom()
    const guest = randomUUID()
    await join(guest, code, 'Gast', invite)
    await t.call(host, 'kick_player', roomId, guest)
    await expect(join(randomUUID(), code, 'Gast2', invite)).rejects.toThrow('access_required')
    const next = await t.call<string>(host, 'room_invite', roomId)
    expect(next).not.toBe(invite)
    expect(await join(randomUUID(), code, 'Gast2', next)).toBeTruthy()
    await expect(join(guest, code, 'Gast', next)).rejects.toThrow('kicked')
  })

  it('asks everyone again after a change, but keeps people in their rooms', async () => {
    const { host, code, roomId } = await lockedRoom()
    await setPassword('ganz neue test woerter')
    await expect(create(host)).rejects.toThrow('access_required')
    expect(await join(host, code)).toBe(roomId)
    expect(await info(host, code)).toMatchObject([{ access_required: false }])
    expect((await t.call(host, 'room_snapshot', code)).players).toHaveLength(1)
    expect(await unlock(host)).toBe('wrong')
    expect(await unlock(host, 'ganz neue test woerter')).toBe('ok')
  })

  it('can be switched off again', async () => {
    await setPassword()
    await t.db.query('select private.remove_app_password()')
    expect(await create(randomUUID())).toHaveLength(5)
  })

  it('refuses short and overlong passwords, and stores only a hash', async () => {
    await expect(setPassword('x'.repeat(8))).rejects.toThrow('9 to 72')
    await expect(setPassword(`  ${'x'.repeat(8)}  `)).rejects.toThrow('9 to 72')
    await expect(setPassword('x'.repeat(73))).rejects.toThrow('9 to 72')
    await setPassword('x'.repeat(9))
    await setPassword()
    const { rows } = await t.db.query<any>('select hash from private.app_password')
    expect(rows[0].hash).toMatch(/^\$2a\$10\$/)
  })

  it('keeps the owner functions and tables away from players', async () => {
    const user = randomUUID()
    for (const sql of [
      `select private.set_app_password('ein eigenes passwort')`,
      'select private.remove_app_password()',
      'select * from private.access_log',
      'select * from private.access_overview',
      'select * from private.app_password',
      'select * from private.room_invites',
    ]) {
      await expect(t.as(user, sql)).rejects.toThrow('permission denied')
    }
  })
})

describe('attempt limits', () => {
  it('blocks an account after 10 wrong attempts, then lets it try again', async () => {
    await setPassword()
    const user = randomUUID()
    for (let i = 0; i < 10; i++) expect(await unlock(user, 'falsch')).toBe('wrong')
    expect(await unlock(user)).toBe('blocked')
    expect(await unlock(randomUUID())).toBe('ok')
    await t.db.exec(`update private.password_failures set at = at - interval '16 minutes'`)
    expect(await unlock(user)).toBe('ok')
  }, 60_000)

  it('also blocks new accounts from the same address', async () => {
    await setPassword()
    await headers({ 'cf-connecting-ip': '203.0.113.5' })
    for (let i = 0; i < 10; i++) await unlock(randomUUID(), 'falsch')
    expect(await unlock(randomUUID())).toBe('blocked')
    await headers({ 'cf-connecting-ip': '203.0.113.6' })
    expect(await unlock(randomUUID())).toBe('ok')
  }, 60_000)

  it('stops after 100 wrong attempts per hour in total', async () => {
    await setPassword()
    for (let i = 0; i < 100; i++) await unlock(randomUUID(), 'falsch')
    expect(await unlock(randomUUID())).toBe('blocked')
    await t.db.exec(`update private.password_failures set at = at - interval '61 minutes'`)
    expect(await unlock(randomUUID())).toBe('ok')
  }, 120_000)
})

describe('access log', () => {
  it('records who did what, from where, without passwords', async () => {
    await setPassword()
    await headers({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
      'user-agent': 'TestBrowser/1.0',
    })
    const host = randomUUID()
    await unlock(host, 'falsches passwort')
    await unlock(host)
    const code = await create(host)
    expect(await actions()).toEqual(['password_wrong', 'password_ok', 'room_created'])
    expect((await log())[2]).toMatchObject({
      user_id: host,
      name: 'Anna',
      room_code: code,
      ip: '203.0.113.7',
      forwarded_for: '198.51.100.1, 10.0.0.1',
      user_agent: 'TestBrowser/1.0',
    })
    const all = JSON.stringify(await log())
    expect(all).not.toContain(PASSWORD)
    expect(all).not.toContain('falsches passwort')
  })

  it('falls back to the forwarded address, and survives odd headers', async () => {
    await headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })
    await create(randomUUID())
    await headers('not json')
    await create(randomUUID())
    await headers(null)
    await create(randomUUID())
    expect((await log()).map((r) => r.ip)).toEqual(['198.51.100.1', null, null])
  })

  it('records lookups, joins and returns, repeats only once an hour', async () => {
    const { code, invite, roomId } = await lockedRoom()
    await t.db.exec('delete from private.access_log')
    const guest = randomUUID()
    for (let i = 0; i < 3; i++) await info(guest, code)
    for (let i = 0; i < 3; i++) await info(guest, code, invite)
    await join(guest, code, 'Gast', invite)
    await t.call(guest, 'note_return', roomId) // just joined: nothing new
    await join(guest, code)
    expect(await actions()).toEqual(['lookup_denied', 'lookup', 'joined'])
    await t.db.exec(`update private.access_log set at = at - interval '2 hours'`)
    await t.call(guest, 'note_return', roomId)
    await t.call(guest, 'note_return', roomId)
    await t.call(randomUUID(), 'note_return', roomId) // not in the room
    expect(await actions()).toEqual(['lookup_denied', 'lookup', 'joined', 'returned'])
  })

  it('shows the latest name and address of each account', async () => {
    const user = randomUUID()
    const code = await create(randomUUID())
    await headers({ 'cf-connecting-ip': '203.0.113.8' })
    await join(user, code, 'Zuerst')
    await t.db.exec(`update private.access_log set at = at - interval '1 minute'`)
    await headers({ 'cf-connecting-ip': '203.0.113.9' })
    await info(user, code)
    const { rows } = await t.db.query<any>(
      'select * from private.access_overview where user_id = $1',
      [user],
    )
    expect(rows).toMatchObject([{ last_name: 'Zuerst', last_ip: '203.0.113.9' }])
    expect(Number(rows[0].entries)).toBe(2)
  })

  it('limits entries per account and in total, without stopping the game', async () => {
    const user = randomUUID()
    for (let i = 0; i < 70; i++) await info(user, `A${1000 + i}`)
    expect(await log()).toHaveLength(60)

    await t.db.exec(`
      insert into private.access_log (user_id, action, at)
      select gen_random_uuid(), 'lookup', now() - interval '1 day'
      from generate_series(1, private.access_log_limit() - 60)`)
    expect(await create(randomUUID())).toHaveLength(5)
    const { rows } = await t.db.query<any>('select * from private.access_status')
    expect(Number(rows[0].log_entries)).toBe(100_000)
  }, 60_000)
})
