import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { score } from '../../src/games/wavelength/scoring'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

async function startGame(n = 4) {
  const room = await createRoom(t, n, 'wavelength')
  const { users, roomId } = room
  const host = users[0]!
  await t.call(host, 'wavelength_start', roomId)

  const snap = (user: string) => t.call(user, 'wavelength_snapshot', roomId)
  const state = async () => {
    const game = (await snap(host)).game
    return { ...game, points: Number(game.points) }
  }
  const act = async (user: string, fn: string, ...args: unknown[]) =>
    t.call(user, `wavelength_${fn}`, roomId, (await state()).round_no, ...args)
  const roles = async () => {
    const game = await state()
    const giver = game.giver_id as string
    const players = (await t.call(host, 'room_snapshot', room.code)).room
      ? ((await t.call(host, 'room_snapshot', room.code)).players as { user_id: string }[])
      : []
    return { giver, guessers: players.map((p) => p.user_id).filter((p) => p !== giver) }
  }
  const target = async () => (await snap((await roles()).giver)).secret_target as number
  const clue = async (mode: 'shared' | 'individual', text: string | null = 'Kaffee') =>
    act((await roles()).giver, 'give_clue', mode, text)
  /** A position that is `distance` away from the target, staying on the scale. */
  const away = (goal: number, distance: number) =>
    goal + distance <= 100 ? goal + distance : goal - distance
  /** A whole shared round that ends `distance` away from the target. */
  const playShared = async (distance = 0) => {
    await clue('shared')
    const { guessers } = await roles()
    const position = away(await target(), distance)
    await act(guessers[0]!, 'move_dial', position)
    for (const g of guessers) {
      if ((await state()).phase === 'guessing') await act(g, 'confirm', position)
    }
  }
  const goOffline = (ids: string[]) =>
    t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = any($2)`,
      [roomId, ids],
    )
  return { ...room, host, snap, state, act, roles, target, clue, away, playShared, goOffline }
}

async function startGameWhere(hostGives: boolean, n = 4) {
  let g = await startGame(n)
  while (((await g.roles()).giver === g.host) !== hostGives) g = await startGame(n)
  return g
}

describe('scoring', () => {
  it('matches the bands the app draws, for every position and target', async () => {
    const { rows } = await t.db.query<{ p: number; target: number; points: number }>(
      `select p, target, private.wavelength_score(p, target) as points
       from generate_series(0, 100) p, generate_series(0, 100) target`,
    )
    expect(rows).toHaveLength(101 * 101)
    expect(rows.filter((r) => r.points !== score(r.p, r.target))).toEqual([])
  })
})

describe('game length', () => {
  it('gives everyone the same number of clues', async () => {
    for (const [players, rounds] of [[2, 6], [3, 9], [4, 8], [6, 12], [7, 7], [10, 10]]) {
      const g = await startGame(players)
      expect((await g.state()).rounds_total).toBe(rounds)
    }
  })

  it('plays through to the end, rotating the clue-giver by seat', async () => {
    const g = await startGame(3)
    const givers: string[] = []
    for (let i = 0; i < 9; i++) {
      givers.push((await g.roles()).giver)
      await g.playShared(0)
      await g.act(g.host, 'next_round')
    }
    for (const user of g.users) expect(givers.filter((x) => x === user)).toHaveLength(3)
    const start = g.users.indexOf(givers[0]!)
    expect(givers.slice(0, 3)).toEqual([0, 1, 2].map((i) => g.users[(start + i) % 3]))
    expect(await g.state()).toMatchObject({ phase: 'game_over', points: 36, rounds_played: 9 })
    expect((await g.snap(g.users[1]!)).history).toHaveLength(9)
    expect((await t.call(g.host, 'room_snapshot', g.code)).room.status).toBe('finished')

    await t.call(g.host, 'return_to_lobby', g.roomId)
    await t.call(g.host, 'wavelength_start', g.roomId)
    expect(await g.state()).toMatchObject({ round_no: 1, points: 0, rounds_played: 0 })
    expect((await g.snap(g.host)).history).toEqual([])
  }, 60_000)

  it('does not repeat a scale within a game', async () => {
    const g = await startGame(2)
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const game = await g.state()
      seen.add(`${game.left_label}|${game.right_label}`)
      await g.act(g.host, 'skip_round')
    }
    expect(seen.size).toBe(20)
    expect(await g.state()).toMatchObject({ rounds_played: 0, round_no: 21 })
  }, 60_000)
})

describe('secrets', () => {
  it('shows the target only to the clue-giver until the reveal', async () => {
    const g = await startGame()
    const { giver, guessers } = await g.roles()
    const target = await g.target()
    expect(target).toBeGreaterThanOrEqual(3)
    expect(target).toBeLessThanOrEqual(97)
    const peek = async (u: string) => ({
      rows: await t.as(u, 'select * from wavelength_targets where room_id = $1', [g.roomId]),
      snapshot: await g.snap(u),
    })
    for (const stage of ['clue', 'guessing']) {
      expect((await g.state()).phase).toBe(stage)
      for (const user of guessers) {
        const seen = await peek(user)
        expect(seen.rows).toEqual([])
        expect(seen.snapshot.secret_target).toBeNull()
        expect(seen.snapshot.game.target).toBeNull()
        expect(seen.snapshot.game).not.toHaveProperty('used_pairs')
      }
      if (stage === 'clue') await g.act(giver, 'give_clue', 'shared', null)
    }
    for (const user of guessers) await g.act(user, 'confirm', 50)
    expect((await g.snap(guessers[0]!)).game.target).toBe(target)
  })

  it('does not let the next clue-giver’s target leak to the previous one', async () => {
    const g = await startGame(3)
    const first = (await g.roles()).giver
    await g.playShared()
    await g.act(g.host, 'next_round')
    expect((await g.snap(first)).secret_target).toBeNull()
  })

  it('blocks writes, outsiders and internals', async () => {
    const g = await startGame()
    const tables = ['games', 'targets', 'guesses', 'history'].map((n) => `wavelength_${n}`)
    for (const table of tables) {
      expect(await t.as(randomUUID(), `select * from ${table}`)).toEqual([])
      await expect(t.as(g.users[1]!, `delete from ${table}`)).rejects.toThrow(/permission denied/)
    }
    await expect(t.as(g.host, 'select * from private.wavelength_pairs')).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      t.as(g.host, 'select private.wavelength_reveal($1)', [g.roomId]),
    ).rejects.toThrow(/permission denied/)
  })

  it('keeps individual guesses secret until everyone has submitted', async () => {
    const g = await startGame()
    await g.clue('individual')
    const { giver, guessers } = await g.roles()
    const [a, b, c] = guessers as [string, string, string]
    await g.act(a, 'submit_guess', 10)
    await g.act(b, 'submit_guess', 20)
    expect((await g.snap(a)).guesses).toHaveLength(1)
    expect((await g.snap(c)).guesses).toEqual([])
    expect((await g.snap(giver)).guesses).toEqual([])
    await g.act(c, 'submit_guess', 30)
    expect((await g.snap(giver)).guesses).toHaveLength(3)
  })
})

describe('clue and roles', () => {
  it('accepts a typed or spoken clue and a mode, only from the clue-giver', async () => {
    const g = await startGame()
    const { giver, guessers } = await g.roles()
    await expect(g.act(guessers[0]!, 'give_clue', 'shared', 'x')).rejects.toThrow('wrong_role')
    await expect(g.act(giver, 'give_clue', 'both', 'x')).rejects.toThrow('invalid_action')
    await expect(g.act(giver, 'give_clue', 'shared', 'x'.repeat(41))).rejects.toThrow(
      'clue_too_long',
    )
    await expect(g.act(guessers[0]!, 'move_dial', 20)).rejects.toThrow('wrong_phase')
    // No rules are enforced on the content.
    await g.act(giver, 'give_clue', 'individual', '  70 % heiss ')
    expect(await g.state()).toMatchObject({ clue: '70 % heiss', mode: 'individual' })
    await expect(g.act(giver, 'give_clue', 'shared', 'y')).rejects.toThrow('wrong_phase')
    await expect(g.act(giver, 'submit_guess', 20)).rejects.toThrow('wrong_role')
    await expect(g.act(guessers[0]!, 'move_dial', 20)).rejects.toThrow('wrong_phase')
    await expect(g.act(guessers[0]!, 'submit_guess', 101)).rejects.toThrow('invalid_position')
  })

  it('stores a spoken clue as empty and remembers the mode for the next round', async () => {
    const g = await startGame()
    await g.clue('individual', '   ')
    expect((await g.state()).clue).toBeNull()
    for (const u of (await g.roles()).guessers) await g.act(u, 'submit_guess', 40)
    await g.act(g.host, 'next_round')
    expect((await g.state()).mode).toBe('individual')
    await g.clue('shared')
    expect((await g.state()).mode).toBe('shared')
  })
})

describe('shared dial', () => {
  it('needs everyone to confirm, and moving resets confirmations', async () => {
    const g = await startGame()
    await g.clue('shared')
    const { giver, guessers } = await g.roles()
    const [a, b, c] = guessers as [string, string, string]
    await expect(g.act(giver, 'move_dial', 20)).rejects.toThrow('wrong_role')
    await expect(g.act(giver, 'confirm', 50)).rejects.toThrow('wrong_role')
    await g.act(a, 'move_dial', 30)
    await g.act(a, 'confirm', 30)
    await g.act(b, 'confirm', 30)
    expect((await g.state()).done_ids).toEqual([a, b])
    await g.act(c, 'move_dial', 30) // not actually moved
    expect((await g.state()).done_ids).toEqual([a, b])
    await g.act(c, 'move_dial', 31)
    expect((await g.state()).done_ids).toEqual([])
    // A confirmation of an outdated position does not count.
    await expect(g.act(a, 'confirm', 30)).rejects.toThrow('dial_moved')
    for (const u of guessers) await g.act(u, 'confirm', 31)
    expect((await g.state()).phase).toBe('reveal')
  })

  it('scores by distance', async () => {
    for (const [distance, points] of [[0, 4], [4, 4], [5, 3], [11, 3], [12, 2], [18, 2], [19, 0]]) {
      const g = await startGame(3)
      await g.playShared(distance)
      expect(await g.state()).toMatchObject({ phase: 'reveal', points, rounds_played: 1 })
    }
  }, 60_000)
})

describe('individual guesses', () => {
  it('averages the points, not the positions', async () => {
    const g = await startGame()
    await g.clue('individual')
    const { guessers } = await g.roles()
    const target = await g.target()
    const [a, b, c] = guessers as [string, string, string]
    await g.act(a, 'submit_guess', g.away(target, 40))
    await g.act(a, 'submit_guess', target) // changing is allowed
    await g.act(b, 'submit_guess', g.away(target, 8))
    await g.act(c, 'submit_guess', g.away(target, 15))
    const snapshot = await g.snap(g.host)
    expect(Number(snapshot.game.round_points)).toBe(3)
    expect(snapshot.guesses.map((q: any) => q.points).sort()).toEqual([2, 3, 4])
  })

  it('keeps two decimals', async () => {
    const g = await startGame()
    await g.clue('individual')
    const { guessers } = await g.roles()
    const target = await g.target()
    for (const [i, u] of guessers.entries()) {
      await g.act(u, 'submit_guess', i === 0 ? target : g.away(target, 8))
    }
    expect(Number((await g.state()).round_points)).toBe(3.33)
    expect((await g.state()).points).toBe(3.33)
  })
})

describe('between rounds', () => {
  it('lets only the host or the clue-giver move on', async () => {
    const g = await startGameWhere(false)
    await g.playShared()
    const { guessers } = await g.roles()
    const other = guessers.find((u) => u !== g.host)!
    await expect(g.act(other, 'next_round')).rejects.toThrow('not_host')
    await g.act((await g.roles()).giver, 'next_round')
    expect((await g.state()).phase).toBe('clue')
  })

  it('lets new players join only between rounds', async () => {
    const g = await startGame()
    await expect(t.call(randomUUID(), 'join_room', g.code, 'Spät')).rejects.toThrow('game_running')
    await g.playShared()
    const late = randomUUID()
    await t.call(late, 'join_room', g.code, 'Spät')
    await g.act(g.host, 'next_round')
    expect((await g.state()).rounds_total).toBe(8)
    await expect(t.call(randomUUID(), 'join_room', g.code, 'Später')).rejects.toThrow(
      'game_running',
    )
    expect((await g.roles()).guessers.concat((await g.roles()).giver)).toContain(late)
  })

  it('works with two players', async () => {
    const g = await startGame(2)
    await g.playShared()
    expect((await g.state()).phase).toBe('reveal')
  })
})

describe('missing players', () => {
  it('replaces the round when the clue-giver leaves, without counting it', async () => {
    const g = await startGameWhere(false)
    const { giver } = await g.roles()
    await t.call(giver, 'leave_room', g.roomId)
    const game = await g.state()
    expect(game).toMatchObject({ phase: 'clue', round_no: 2, rounds_played: 0 })
    expect(game.giver_id).not.toBe(giver)
  })

  it('reveals when the last missing guesser leaves', async () => {
    const g = await startGameWhere(false)
    await g.clue('shared')
    const { guessers } = await g.roles()
    const slow = guessers.find((u) => u !== g.host)!
    for (const u of guessers) if (u !== slow) await g.act(u, 'confirm', 50)
    await t.call(slow, 'leave_room', g.roomId)
    expect((await g.state()).phase).toBe('reveal')
  })

  it('ends the game below two players', async () => {
    const g = await startGame(2)
    await t.call(g.users[1]!, 'leave_room', g.roomId)
    expect((await g.state()).phase).toBe('game_over')
  })

  it('lets the host continue without offline players only', async () => {
    const g = await startGameWhere(false)
    await g.clue('individual')
    const { guessers } = await g.roles()
    const [b, c] = guessers.filter((u) => u !== g.host) as [string, string]
    await expect(g.act(b, 'force_reveal')).rejects.toThrow('not_host')
    await g.goOffline([c])
    // The guessing host has to submit first, and b is still online.
    await expect(g.act(g.host, 'force_reveal')).rejects.toThrow('players_still_here')
    await g.act(g.host, 'submit_guess', 20)
    await expect(g.act(g.host, 'force_reveal')).rejects.toThrow('players_still_here')
    await g.act(b, 'submit_guess', 25)
    await g.act(g.host, 'force_reveal')
    expect((await g.state()).phase).toBe('reveal')
    expect((await g.snap(g.host)).guesses).toHaveLength(2)
  })

  it('does not reveal without a single guess', async () => {
    const g = await startGameWhere(true, 3)
    await g.clue('shared')
    await g.goOffline((await g.roles()).guessers)
    await expect(g.act(g.host, 'force_reveal')).rejects.toThrow('no_guesses_yet')
    await g.act(g.host, 'skip_round')
    expect(await g.state()).toMatchObject({ phase: 'clue', rounds_played: 0 })
  })
})

describe('scales', () => {
  it('match the latest migration: 150+ unique Swiss-spelled pairs', async () => {
    const { PAIRS_DE } = await import('../../src/games/wavelength/pairs.de')
    const { rows } = await t.db.query<{ left_label: string; right_label: string }>(
      'select left_label, right_label from private.wavelength_pairs',
    )
    const key = (l: string, r: string) => `${l}|${r}`
    expect(rows.map((r) => key(r.left_label, r.right_label)).sort()).toEqual(
      PAIRS_DE.map(([l, r]) => key(l, r)).sort(),
    )
    expect(new Set(PAIRS_DE.map(([l, r]) => key(l, r))).size).toBe(PAIRS_DE.length)
    expect(PAIRS_DE.length).toBeGreaterThanOrEqual(150)
    expect(JSON.stringify(PAIRS_DE)).not.toContain('ß')
  })
})
