import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

/** users[i] sits at position i, unless `reorder` changes that. */
async function startGame(n = 4, startDice?: number, reorder?: (users: string[]) => string[]) {
  const room = await createRoom(t, n, 'liars-dice')
  const { users, roomId } = room
  const host = users[0]!
  if (startDice !== undefined) await t.call(host, 'liars_set_settings', roomId, null, startDice)
  if (reorder) await t.call(host, 'liars_set_settings', roomId, reorder(users), null)
  await t.call(host, 'liars_start', roomId)

  const snap = (user: string) => t.call(user, 'liars_snapshot', roomId)
  const state = async () => (await snap(host)).game
  const act = async (user: string, fn: string, ...args: unknown[]) =>
    t.call(user, `liars_${fn}`, roomId, (await state()).round_no, ...args)
  const alive = async () => {
    const game = await state()
    return (game.order_ids as string[]).filter((p) => game.dice_counts[p] > 0)
  }
  const rollAll = async () => {
    for (const p of await alive()) await act(p, 'roll')
  }
  /** One full round in which `loser` doubts and is wrong. */
  const lose = async (loser: string) => {
    await rollAll()
    await act(loser, 'doubt')
    await act(loser, 'set_verdict', 'doubter_loses')
    await act(loser, 'next_round', 'doubter_loses')
  }
  const goOffline = (ids: string[]) =>
    t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = any($2)`,
      [roomId, ids],
    )
  return { ...room, host, snap, state, act, alive, rollAll, lose, goOffline }
}

describe('lobby', () => {
  it('lets only the host set the order and the number of dice', async () => {
    const { users, roomId } = await createRoom(t, 3, 'liars-dice')
    const lobby = () => t.call(users[1]!, 'liars_lobby', roomId)
    expect(await lobby()).toEqual({ order_ids: users, start_dice: 5 })
    const reversed = [...users].reverse()
    await expect(t.call(users[1]!, 'liars_set_settings', roomId, reversed, null)).rejects.toThrow(
      'not_host',
    )
    await t.call(users[0]!, 'liars_set_settings', roomId, reversed, null)
    await t.call(users[0]!, 'liars_set_settings', roomId, null, 2)
    expect(await lobby()).toEqual({ order_ids: reversed, start_dice: 2 })
    for (const bad of [[users[0]], [users[0], users[0], users[1]], [...users, randomUUID()]]) {
      await expect(t.call(users[0]!, 'liars_set_settings', roomId, bad, null)).rejects.toThrow(
        'players_changed',
      )
    }
    await expect(t.call(users[0]!, 'liars_set_settings', roomId, null, 7)).rejects.toThrow(
      'invalid_action',
    )
    expect(await t.call(randomUUID(), 'liars_lobby', roomId)).toBeNull()
  })

  it('appends newcomers and drops leavers from the saved order', async () => {
    const { users, roomId, code } = await createRoom(t, 3, 'liars-dice')
    await t.call(users[0]!, 'liars_set_settings', roomId, [users[2], users[0], users[1]], 3)
    await t.call(users[0]!, 'kick_player', roomId, users[1])
    const late = randomUUID()
    await t.call(late, 'join_room', code, 'Neu')
    expect((await t.call(users[0]!, 'liars_lobby', roomId)).order_ids).toEqual([
      users[2], users[0], late,
    ])
  })

  it('starts with the chosen order and number of dice, with 2 players or more', async () => {
    const g = await startGame(3, 2, (u) => [u[1]!, u[2]!, u[0]!])
    const game = await g.state()
    expect(game.order_ids).toEqual([g.users[1], g.users[2], g.users[0]])
    expect(Object.values(game.dice_counts)).toEqual([2, 2, 2])
    expect(game.order_ids).toContain(game.starter_id)
    expect((await (await startGame(2)).state()).phase).toBe('rolling')
    const alone = await createRoom(t, 1, 'liars-dice')
    await expect(t.call(alone.users[0]!, 'liars_start', alone.roomId)).rejects.toThrow(
      'not_enough_players',
    )
  })

  it('does not let anyone join a running game', async () => {
    const g = await startGame(3)
    await expect(t.call(randomUUID(), 'join_room', g.code, 'Spät')).rejects.toThrow('game_running')
  })
})

describe('rolling and secrets', () => {
  it('rolls valid dice once, and opens bidding when everyone has rolled', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.act(a, 'roll')
    const first = (await g.snap(a)).own_dice as number[]
    expect(first).toHaveLength(5)
    for (const d of first) expect(d).toBeGreaterThanOrEqual(1)
    for (const d of first) expect(d).toBeLessThanOrEqual(6)
    await g.act(a, 'roll') // a second tap must not re-roll
    expect((await g.snap(a)).own_dice).toEqual(first)
    await g.act(b, 'roll')
    expect((await g.state()).phase).toBe('rolling')
    await expect(g.act(a, 'doubt')).rejects.toThrow('wrong_phase')
    await g.act(c, 'roll')
    expect((await g.state()).phase).toBe('bidding')
  })

  it('produces all six numbers', async () => {
    const g = await startGame(10, 6)
    await g.rollAll()
    await g.act(g.users[0]!, 'doubt')
    const all = Object.values<number[]>((await g.state()).revealed).flat()
    expect(all).toHaveLength(60)
    expect(new Set(all).size).toBe(6)
  })

  it('shows nobody else’s dice before a doubt, even directly', async () => {
    const g = await startGame()
    await g.rollAll()
    for (const user of g.users) {
      const rows = await t.as<any>(user, 'select * from liars_dice where room_id = $1', [g.roomId])
      expect(rows.map((r) => r.player_id)).toEqual([user])
      expect((await g.snap(user)).game.revealed).toBeNull()
    }
    await g.act(g.users[2]!, 'doubt')
    const revealed = (await g.snap(g.users[0]!)).game.revealed
    expect(Object.keys(revealed).sort()).toEqual([...g.users].sort())
    expect(revealed[g.users[1]!]).toEqual((await g.snap(g.users[1]!)).own_dice)
  })

  it('blocks writes, outsiders and internals', async () => {
    const g = await startGame()
    for (const table of ['liars_settings', 'liars_games', 'liars_dice']) {
      expect(await t.as(randomUUID(), `select * from ${table}`)).toEqual([])
      await expect(t.as(g.users[1]!, `delete from ${table}`)).rejects.toThrow(/permission denied/)
    }
    await expect(
      t.as(g.host, 'select private.liars_end($1)', [g.roomId]),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('doubting', () => {
  it('accuses the player before the doubter, wrapping around', async () => {
    const g = await startGame()
    await g.rollAll()
    await g.act(g.users[0]!, 'doubt')
    expect(await g.state()).toMatchObject({
      phase: 'revealed', doubter_id: g.users[0], accused_id: g.users[3], verdict: null,
    })
    // Only the first doubt counts.
    await expect(g.act(g.users[2]!, 'doubt')).rejects.toThrow('wrong_phase')
  })

  it('skips players who are out', async () => {
    const g = await startGame(4, 1)
    await g.lose(g.users[1]!)
    expect((await g.state()).eliminated_ids).toEqual([g.users[1]])
    await expect(g.act(g.users[1]!, 'roll')).rejects.toThrow('wrong_role')
    await g.rollAll()
    await expect(g.act(g.users[1]!, 'doubt')).rejects.toThrow('wrong_role')
    await g.act(g.users[2]!, 'doubt')
    expect((await g.state()).accused_id).toBe(g.users[0])
  })

  it('lets only the doubter or the host judge, and change it', async () => {
    const g = await startGame()
    await g.rollAll()
    const [, doubter, other] = g.users as [string, string, string]
    await g.act(doubter, 'doubt')
    await expect(g.act(other, 'set_verdict', 'accused_loses')).rejects.toThrow('not_host')
    await expect(g.act(doubter, 'next_round', null)).rejects.toThrow('no_verdict')
    await g.act(doubter, 'set_verdict', 'accused_loses')
    await g.act(g.host, 'set_verdict', 'doubter_loses')
    // Nothing is taken away yet.
    expect(Object.values((await g.state()).dice_counts)).toEqual([5, 5, 5, 5])
    await expect(g.act(doubter, 'next_round', 'accused_loses')).rejects.toThrow('verdict_changed')
    await expect(g.act(other, 'next_round', 'doubter_loses')).rejects.toThrow('not_host')
    await g.act(doubter, 'next_round', 'doubter_loses')
    const game = await g.state()
    expect(game.dice_counts[doubter]).toBe(4)
    expect(game).toMatchObject({
      phase: 'rolling', round_no: 2, starter_id: doubter, revealed: null, verdict: null,
    })
    expect((await g.snap(doubter)).own_dice).toBeNull()
  })

  it('takes the die from the accused, who then starts', async () => {
    const g = await startGame()
    await g.rollAll()
    await g.act(g.users[2]!, 'doubt')
    await g.act(g.users[2]!, 'set_verdict', 'accused_loses')
    await g.act(g.users[2]!, 'next_round', 'accused_loses')
    const game = await g.state()
    expect(game.dice_counts[g.users[1]!]).toBe(4)
    expect(game.starter_id).toBe(g.users[1])
    await g.rollAll()
    expect((await g.snap(g.users[1]!)).own_dice).toHaveLength(4)
  })

  it('passes the start on when the loser is out', async () => {
    const g = await startGame(3, 1)
    await g.lose(g.users[2]!)
    expect((await g.state()).starter_id).toBe(g.users[0])
  })

  it('plays until one player has dice, and starts fresh again', async () => {
    const g = await startGame(3, 2)
    const [a, b, c] = g.users as [string, string, string]
    for (const loser of [b, b, c, c]) await g.lose(loser)
    expect(await g.state()).toMatchObject({ phase: 'game_over', eliminated_ids: [b, c] })
    expect((await g.state()).dice_counts[a]).toBe(2)
    expect((await t.call(a, 'room_snapshot', g.code)).room.status).toBe('finished')
    await t.call(a, 'return_to_lobby', g.roomId)
    await t.call(a, 'liars_start', g.roomId)
    const game = await g.state()
    expect(game).toMatchObject({ round_no: 1, eliminated_ids: [] })
    expect(Object.values(game.dice_counts)).toEqual([2, 2, 2])
  })
})

describe('stuck rounds and missing players', () => {
  it('lets only the host reroll, without anyone losing a die', async () => {
    const g = await startGame()
    await g.rollAll()
    await g.act(g.users[1]!, 'doubt')
    await expect(g.act(g.users[1]!, 'reroll')).rejects.toThrow('not_host')
    const starter = (await g.state()).starter_id
    await g.act(g.host, 'reroll')
    const game = await g.state()
    expect(game).toMatchObject({ phase: 'rolling', round_no: 2, starter_id: starter, revealed: null })
    expect(Object.values(game.dice_counts)).toEqual([5, 5, 5, 5])
  })

  it('rerolls without the dice of a player who leaves', async () => {
    const g = await startGame()
    await g.rollAll()
    const starter = (await g.state()).starter_id as string
    const leaver = starter === g.host ? g.users[1]! : starter
    await t.call(leaver, 'leave_room', g.roomId)
    const game = await g.state()
    expect(game).toMatchObject({ phase: 'rolling', round_no: 2 })
    expect(game.order_ids).not.toContain(leaver)
    expect(game.order_ids).toContain(game.starter_id)
    expect(game.dice_counts).not.toHaveProperty(leaver)
  })

  it('hands the start to the next player when the starter leaves', async () => {
    let g = await startGame()
    while ((await g.state()).starter_id !== g.users[3]) g = await startGame()
    await t.call(g.users[3]!, 'leave_room', g.roomId)
    expect((await g.state()).starter_id).toBe(g.users[0])
  })

  it('carries on unchanged when a spectator leaves', async () => {
    const g = await startGame(3, 1)
    await g.lose(g.users[2]!)
    await g.rollAll()
    await t.call(g.users[2]!, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'bidding', round_no: 2, eliminated_ids: [] })
  })

  it('ends when only one player has dice left', async () => {
    const g = await startGame(2)
    await t.call(g.users[1]!, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'game_over', order_ids: [g.users[0]] })
  })

  it('lets the host judge for an offline doubter', async () => {
    const g = await startGame()
    await g.rollAll()
    await g.act(g.users[2]!, 'doubt')
    await g.goOffline([g.users[2]!])
    await g.act(g.host, 'set_verdict', 'accused_loses')
    await g.act(g.host, 'next_round', 'accused_loses')
    expect((await g.state()).dice_counts[g.users[1]!]).toBe(4)
  })
})
