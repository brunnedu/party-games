import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

async function setup(n = 3) {
  const room = await createRoom(t, n, 'extreme-activity')
  const { users, roomId } = room
  const host = users[0]!
  await t.call(host, 'activity_start', roomId)

  const snap = (user = host) => t.call(user, 'activity_snapshot', roomId)
  const state = async () => (await snap()).game
  const submit = (user: string, words: string[], name: string | null = null) =>
    t.call(user, 'activity_submit', roomId, words, name)
  /** A turn action by the game phone (or `user`). */
  const act = async (fn: string, args: unknown[] = [], user?: string) => {
    const s = await snap()
    return t.call(user ?? s.phone_id, `activity_${fn}`, roomId, s.game.turn_no, ...args)
  }
  const word = async (user?: string) => (await snap(user ?? (await snap()).phone_id)).word
  const guess = async () => act('guessed', [(await word()).id])
  const summary = async () => (await snap((await snap()).phone_id)).summary
  /** Moves the running clock into the past. */
  const elapse = (seconds: number) =>
    t.db.query(
      `update public.activity_games
       set running_since = running_since - make_interval(secs => $2)
       where room_id = $1`,
      [roomId, seconds],
    )
  const timeUp = async () => {
    await elapse(61)
    await act('time_up')
  }
  const total = async (team: number) =>
    (await snap()).points
      .filter((p: any) => p.team === team)
      .reduce((sum: number, p: any) => sum + p.points, 0)
  return { ...room, host, snap, state, submit, act, word, guess, summary, elapse, timeUp, total }
}

/** A game in which team 0 is about to take its first turn. */
async function play(words = ['Apfel', 'Birne', 'Citrone']) {
  const g = await setup()
  await g.submit(g.host, words)
  await t.call(g.host, 'activity_play', g.roomId)
  return g
}

describe('lobby', () => {
  it('works with a single phone and lets only the host change settings', async () => {
    const { users, roomId } = await createRoom(t, 1, 'extreme-activity')
    await t.call(users[0]!, 'activity_start', roomId)

    const room = await createRoom(t, 2, 'extreme-activity')
    const [host, other] = room.users as [string, string]
    const lobby = () => t.call(other, 'activity_lobby', room.roomId)
    expect(await lobby()).toEqual({ phone_id: host, max_words: 3 })
    await expect(
      t.call(other, 'activity_set_settings', room.roomId, 5, null),
    ).rejects.toThrow('not_host')
    await t.call(host, 'activity_set_settings', room.roomId, 5, null)
    await t.call(host, 'activity_set_settings', room.roomId, null, other)
    expect(await lobby()).toEqual({ phone_id: other, max_words: 5 })
    await expect(
      t.call(host, 'activity_set_settings', room.roomId, 7, null),
    ).rejects.toThrow('invalid_action')
    await expect(
      t.call(host, 'activity_set_settings', room.roomId, null, randomUUID()),
    ).rejects.toThrow('players_changed')
    // The chosen phone leaves: back to the host.
    await t.call(other, 'leave_room', room.roomId)
    expect((await t.call(host, 'activity_lobby', room.roomId)).phone_id).toBe(host)
  })
})

describe('writing', () => {
  it('accepts own words once and words of guests by name', async () => {
    const g = await setup(2)
    const [host, other] = g.users as [string, string]
    await g.submit(host, ['  Eiffel   Turm ', '', 'Gurke'])
    await expect(g.submit(host, ['Noch eins'])).rejects.toThrow('already_submitted')
    await g.submit(host, ['Zahnarzt'], 'Gast')
    await expect(g.submit(other, ['x'], 'gast')).rejects.toThrow('name_taken')
    await expect(g.submit(host, ['x'], 'spieler 2')).rejects.toThrow('name_taken')
    await expect(g.submit(other, [' ', ''])).rejects.toThrow('invalid_word')
    await expect(g.submit(other, ['a'.repeat(41)])).rejects.toThrow('invalid_word')
    await expect(g.submit(other, ['a', 'b', 'c', 'd'])).rejects.toThrow('too_many_words')
    await g.submit(other, ['Gurke'])

    const s = await g.snap(other)
    expect(s.words_total).toBe(4)
    expect(s.writers).toEqual([
      { name: 'Spieler 1', count: 2 },
      { name: 'Gast', count: 1 },
      { name: 'Spieler 2', count: 1 },
    ])
    expect(s.own_submitted).toBe(true)
  })

  it('never shows words while writing, even to their author', async () => {
    const g = await setup(2)
    await g.submit(g.host, ['Geheimwort'])
    for (const user of g.users) {
      expect(JSON.stringify(await g.snap(user))).not.toContain('Geheimwort')
    }
    await expect(t.as(g.host, 'select * from private.activity_words')).rejects.toThrow(
      'permission denied',
    )
    expect(await t.call(randomUUID(), 'activity_snapshot', g.roomId)).toBeNull()
  })

  it('starts playing only for the host and only with words', async () => {
    const g = await setup(2)
    await expect(t.call(g.host, 'activity_play', g.roomId)).rejects.toThrow('no_words')
    await g.submit(g.host, ['Apfel'])
    await expect(t.call(g.users[1]!, 'activity_play', g.roomId)).rejects.toThrow('not_host')
    await t.call(g.host, 'activity_play', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'ready', mode: 1, team: 0, turn_no: 1 })
    await expect(g.submit(g.users[1]!, ['Zu spät'])).rejects.toThrow('wrong_phase')
  })

  it('lets phones join while a game runs', async () => {
    const g = await play()
    await t.call(randomUUID(), 'join_room', g.code, 'Nachzügler')
  })
})

describe('turns', () => {
  it('shows the open word to the game phone only, and only while running', async () => {
    const g = await play()
    const [host, other] = g.users as [string, string]
    expect(await g.word()).toBeNull()
    await expect(g.act('begin_turn', [], other)).rejects.toThrow('wrong_role')
    await g.act('begin_turn')
    const open = await g.word(host)
    expect(open.text).toBeTruthy()
    expect(JSON.stringify(await g.snap(other))).not.toContain(open.text)
    await expect(g.act('guessed', [open.id], other)).rejects.toThrow('wrong_role')

    await g.act('pause')
    expect(await g.word()).toBeNull()
    const paused = (await g.state()).time_left_ms
    expect(paused).toBeLessThanOrEqual(60000)
    expect(paused).toBeGreaterThan(55000)
    await g.act('resume')
    expect(await g.word()).toEqual(open)
  })

  it('counts a double tap once', async () => {
    const g = await play()
    await g.act('begin_turn')
    const first = await g.word()
    await g.act('guessed', [first.id])
    await expect(g.act('guessed', [first.id])).rejects.toThrow('wrong_phase')
    expect(await g.total(0)).toBe(1)
    expect((await g.snap()).words_left).toBe(2)
  })

  it('ends only when the time is up, keeps the open word in the bucket', async () => {
    const g = await play()
    await g.act('begin_turn')
    await g.guess()
    await expect(g.act('time_up')).rejects.toThrow('time_not_up')
    const open = await g.word()
    await g.elapse(63)
    await expect(g.act('guessed', [open.id])).rejects.toThrow('time_up')
    await g.act('time_up')
    expect(await g.state()).toMatchObject({ phase: 'summary', mode: 1, time_left_ms: 0 })
    const rows = await g.summary()
    expect(rows.map((r: any) => r.counted)).toEqual([true, false])
    expect(rows[1].text).toBe(open.text)
    expect((await g.snap(g.users[1]!)).summary).toBeNull()

    await g.act('pass_on')
    expect(await g.state()).toMatchObject({ phase: 'ready', team: 1, turn_no: 2 })
    expect((await g.snap()).summary).toBeNull()
    expect((await g.snap()).words_left).toBe(2)
    await g.act('begin_turn')
    expect((await g.state()).time_left_ms).toBeGreaterThan(55000)
  })

  it('continues into the next mode with the time left and all words back', async () => {
    const g = await play(['Apfel', 'Birne'])
    await g.act('begin_turn')
    await g.elapse(20)
    await g.guess()
    await g.guess()
    const s = await g.state()
    expect(s).toMatchObject({ phase: 'new_mode', mode: 2, played_mode: 1 })
    expect(s.time_left_ms).toBeLessThanOrEqual(40000)
    expect(s.time_left_ms).toBeGreaterThan(35000)
    expect((await g.snap()).words_left).toBe(2)
    expect(await g.word()).toBeNull()
    await g.act('resume')
    expect(await g.state()).toMatchObject({ phase: 'playing', played_mode: 2 })
    expect((await g.word()).text).toBeTruthy()
  })

  it('can take back the tap that ended a mode', async () => {
    const g = await play(['Apfel', 'Birne'])
    await g.act('begin_turn')
    await g.guess()
    const last = await g.word()
    await g.guess()
    await g.act('undo_mode')
    expect(await g.state()).toMatchObject({ phase: 'playing', mode: 1 })
    expect(await g.word()).toEqual(last)
    expect(await g.total(0)).toBe(1)
  })

  it('lets the next team start the next mode when the time ran out with the last word', async () => {
    const g = await play(['Apfel'])
    await g.act('begin_turn')
    const only = await g.word()
    await g.elapse(60.5)
    await g.act('guessed', [only.id])
    expect(await g.state()).toMatchObject({ phase: 'summary', mode: 2, played_mode: 1 })
    await g.act('pass_on')
    expect(await g.state()).toMatchObject({ phase: 'ready', mode: 2, team: 1 })
  })

  it('re-opens or finishes a mode through corrections', async () => {
    const g = await play(['Apfel', 'Birne'])
    await g.act('begin_turn')
    await g.guess()
    await g.timeUp()
    const [first, late] = await g.summary()
    // Counting the last word finishes the mode.
    await g.act('set_counted', [late.id, true])
    expect((await g.state()).mode).toBe(2)
    expect(await g.total(0)).toBe(2)
    // Removing a word re-opens it.
    await g.act('set_counted', [first.id, false])
    expect((await g.state()).mode).toBe(1)
    expect((await g.snap()).words_left).toBe(1)
    expect(await g.total(0)).toBe(1)
    await expect(g.act('set_counted', [first.id, true], g.users[1])).rejects.toThrow('wrong_role')
  })

  it('only corrects words of the last mode the turn played', async () => {
    const g = await play(['Apfel'])
    await g.act('begin_turn')
    await g.guess()
    await g.act('resume')
    await g.timeUp()
    const [done, open] = await g.summary()
    expect([done.mode, open.mode]).toEqual([1, 2])
    await expect(g.act('set_counted', [done.id, false])).rejects.toThrow('invalid_action')
    await g.act('set_counted', [open.id, true])
    expect((await g.state()).mode).toBe(3)
  })

  it('plays every word once in all five modes, then shows words and authors', async () => {
    const g = await play(['Apfel', 'Birne'])
    await g.act('begin_turn')
    for (let mode = 1; mode <= 5; mode++) {
      expect((await g.state()).mode).toBe(mode)
      await g.guess()
      await g.guess()
      if (mode < 5) await g.act('resume')
    }
    expect(await g.state()).toMatchObject({ phase: 'summary', mode: 6 })
    expect((await g.snap(g.users[1]!)).all_words).toBeNull()
    await g.act('pass_on')
    const end = await g.snap(g.users[1]!)
    expect(end.game.phase).toBe('game_over')
    expect(end.all_words).toEqual([
      { text: 'Apfel', author: 'Spieler 1' },
      { text: 'Birne', author: 'Spieler 1' },
    ])
    expect(await g.total(0)).toBe(10)
    const room = await t.call(g.host, 'room_snapshot', g.code)
    expect(room.room.status).toBe('finished')

    // A new game starts with an empty bucket.
    await t.call(g.host, 'return_to_lobby', g.roomId)
    await t.call(g.host, 'activity_start', g.roomId)
    expect((await g.snap()).words_total).toBe(0)
    expect((await g.snap()).points).toEqual([])
  })
})

describe('game phone', () => {
  it('can be changed mid-turn, which pauses the clock', async () => {
    const g = await play()
    const [host, other] = g.users as [string, string]
    await g.act('begin_turn')
    await t.call(host, 'activity_set_settings', g.roomId, null, other)
    expect((await g.state()).phase).toBe('paused')
    await expect(g.act('resume', [], host)).rejects.toThrow('wrong_role')
    await g.act('resume', [], other)
    expect((await g.word(other)).text).toBeTruthy()
    expect(await g.word(host)).toBeNull()
    await expect(
      t.call(host, 'activity_set_settings', g.roomId, 5, null),
    ).rejects.toThrow('wrong_phase')
  })

  it('falls back to the host and pauses when the chosen player leaves', async () => {
    const g = await play()
    const [host, other] = g.users as [string, string]
    await t.call(host, 'activity_set_settings', g.roomId, null, other)
    await g.act('begin_turn')
    await t.call(other, 'leave_room', g.roomId)
    expect((await g.snap()).phone_id).toBe(host)
    expect((await g.state()).phase).toBe('paused')
  })

  it('follows the host when the host leaves, with the clock stopped', async () => {
    const g = await play()
    const [host, other] = g.users as [string, string]
    await g.act('begin_turn')
    await t.call(host, 'leave_room', g.roomId)
    const s = await g.snap(other)
    expect(s.phone_id).toBe(other)
    expect(s.game.phase).toBe('paused')
    expect(s.words_total).toBe(3)
  })
})
